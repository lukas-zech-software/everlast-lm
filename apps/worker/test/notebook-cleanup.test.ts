import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "@everlast/db";
import { createTestDatabase, createTestUser, type TestDatabase } from "@everlast/db/testing";
import { createNotebook, deleteNotebook, getCleanupStatus, notebookObjectPrefix, reserveSources } from "@everlast/db";
import { LocalObjectStorage } from "@everlast/cloud";
import { processNotebookCleanup } from "../src/notebook-cleanup.ts";
import { drainJobs } from "../src/jobs.ts";

/** T016/T022/T054 — durable cleanup against PostgreSQL and versioned object storage (FR-WM-01, FR-WM-04). */

let db: TestDatabase;
let pool: Pool;
let dir: string;
let storage: LocalObjectStorage;

beforeAll(async () => {
  db = await createTestDatabase();
  pool = db.pool;
  dir = await mkdtemp(join(tmpdir(), "everlast-cleanup-"));
  storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://localhost" });
});

afterAll(async () => {
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

async function notebookWithObjects(generations = 2) {
  const owner = await createTestUser(pool);
  const { notebook } = await createNotebook(pool, owner, {});
  const prefix = notebookObjectPrefix(notebook.id);
  for (let g = 0; g < generations; g++) {
    await storage.write(`${prefix}sources/a/raw`, Buffer.from(`secret content v${g}`), "text/plain");
  }
  await storage.write(`${prefix}sources/b/raw`, Buffer.from("other secret"), "text/plain");
  return { owner, notebook, prefix };
}

describe("FR-WM-01 / FR-WM-04: notebook cleanup worker", () => {
  it("CLN-01: purges every live and noncurrent generation, then records Purged", async () => {
    const { owner, notebook, prefix } = await notebookWithObjects(3);
    const other = await notebookWithObjects(1);
    expect((await storage.listVersions(prefix)).length).toBe(4);
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    const outcome = await processNotebookCleanup({ pool, storage }, deletion_id);
    expect(outcome).toEqual({ status: "purged", deleted: 4 });
    expect(await storage.listVersions(prefix)).toEqual([]);
    expect((await getCleanupStatus(pool, owner, deletion_id)).status).toBe("Purged");
    // Another notebook's objects are untouched.
    expect((await storage.listVersions(other.prefix)).length).toBe(2);
  });

  it("CLN-02: replay and duplicate events are idempotent", async () => {
    const { owner, notebook } = await notebookWithObjects();
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    await processNotebookCleanup({ pool, storage }, deletion_id);
    expect(await processNotebookCleanup({ pool, storage }, deletion_id)).toEqual({ status: "purged", deleted: 0 });
    expect(await processNotebookCleanup({ pool, storage }, "00000000-0000-4000-8000-000000000000")).toEqual({ status: "missing" });
  });

  it("CLN-03: outstanding upload capabilities keep the operation Pending; a late upload is swept after expiry", async () => {
    const { owner, notebook, prefix } = await notebookWithObjects(1);
    await reserveSources(pool, owner, notebook.id, [
      { attempt_id: crypto.randomUUID(), title: "late.pdf", media_type: "application/pdf", declared_bytes: 10 },
    ], { uploadTtlSeconds: 600 });
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    const first = await processNotebookCleanup({ pool, storage }, deletion_id);
    expect(first.status).toBe("deferred");
    expect((await getCleanupStatus(pool, owner, deletion_id)).status).toBe("Pending");

    // A signed upload completes after deletion (late callback): object appears in the namespace.
    await storage.write(`${prefix}sources/late/raw`, Buffer.from("late secret"), "application/pdf");
    const later = new Date(Date.now() + 601_000);
    const final = await processNotebookCleanup({ pool, storage, now: () => later }, deletion_id);
    expect(final).toEqual({ status: "purged", deleted: 1 });
    expect(await storage.listVersions(prefix)).toEqual([]);
  });

  it("CLN-04: storage failures and retained objects keep status non-terminal, never Purged", async () => {
    const { owner, notebook, prefix } = await notebookWithObjects(1);
    const [held] = await storage.listVersions(prefix);
    await storage.setRetained(held!.name, held!.generation, true);
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    expect(await processNotebookCleanup({ pool, storage }, deletion_id)).toMatchObject({ status: "retry", errorCode: "RetainedObject" });
    expect(await getCleanupStatus(pool, owner, deletion_id)).toEqual({ deletion_id, status: "Pending", last_error_code: "RetainedObject" });

    const failing = Object.assign(Object.create(storage), {
      listVersions: async () => {
        throw Object.assign(new Error("unavailable"), { code: 503 });
      },
    });
    await storage.setRetained(held!.name, held!.generation, false);
    expect(await processNotebookCleanup({ pool, storage: failing }, deletion_id)).toMatchObject({ status: "retry", errorCode: "Storage503" });
    expect((await getCleanupStatus(pool, owner, deletion_id)).status).toBe("Pending");
    expect(await processNotebookCleanup({ pool, storage }, deletion_id)).toMatchObject({ status: "purged" });
  });

  it("CLN-05: cleanup status and records contain no source content, titles or object names", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, { title: "Confidential Merger" });
    await storage.write(`${notebookObjectPrefix(notebook.id)}sources/x/raw`, Buffer.from("TOP SECRET"), "text/plain");
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    await processNotebookCleanup({ pool, storage }, deletion_id);
    const row = JSON.stringify((await pool.query("SELECT * FROM cleanup_operations WHERE id = $1", [deletion_id])).rows[0]);
    const status = JSON.stringify(await getCleanupStatus(pool, owner, deletion_id));
    for (const text of [row, status]) {
      expect(text).not.toContain("Confidential Merger");
      expect(text).not.toContain("TOP SECRET");
      expect(text).not.toContain("sources/x/raw");
    }
  });

  it("CLN-06: the durable outbox drains cleanup jobs, including ones left Running by a crashed worker", async () => {
    const { owner, notebook, prefix } = await notebookWithObjects(1);
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    // Simulate a worker that claimed the job and crashed: Running with an expired lease.
    await pool.query(
      "UPDATE jobs SET status = 'Running', attempts = 1, next_attempt_at = now() - interval '1 second' WHERE payload->>'deletion_id' = $1",
      [deletion_id]
    );
    const { processed } = await drainJobs(pool, {
      cleanup: async (job) => {
        const outcome = await processNotebookCleanup({ pool, storage }, job.payload.deletion_id!);
        return outcome.status === "purged" || outcome.status === "missing" ? { kind: "done" } : { kind: "retry", errorCode: "x" };
      },
    });
    expect(processed).toBeGreaterThanOrEqual(1);
    expect((await getCleanupStatus(pool, owner, deletion_id)).status).toBe("Purged");
    expect(await storage.listVersions(prefix)).toEqual([]);
    const job = await pool.query("SELECT status FROM jobs WHERE payload->>'deletion_id' = $1", [deletion_id]);
    expect(job.rows[0].status).toBe("Done");
  });
});
