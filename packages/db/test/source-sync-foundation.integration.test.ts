import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, type UnifiedDocumentChunk } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, testDatabaseUrl, type TestDatabase } from "../src/testing.ts";
import { getAvailableMigrations, runMigrations } from "../src/migrate.ts";
import { createNotebook, deleteNotebook } from "../src/notebooks.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import { getSourceById } from "../src/quota.ts";
import * as sync from "../src/source-sync.ts";

/**
 * [009-multimodal-ingestion-sync] T004 — migration 0009 and the durable source-operation foundation
 * (FR-SI-01, FR-SI-05, FR-WM-07, C-01, C-02; spec FR-007, FR-011, FR-012).
 */

let db: TestDatabase;
let owner: string;
const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
});

afterAll(async () => {
  await db?.drop();
});

async function notebook(): Promise<string> {
  return (await createNotebook(db.pool, owner, {})).notebook.id;
}

/** A Ready web source (linked) at revision 1, seeded through the real admission → publication path. */
async function linkedSource(text = "Release v1 in May."): Promise<{ notebookId: string; sourceId: string }> {
  const notebookId = await notebook();
  const { sourceId } = await seedReadySource(db.pool, owner, notebookId, { title: "Roadmap", pages: [text], embed, mediaType: "text/plain" });
  await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/roadmap', media_type = 'text/html' WHERE id = $1", [sourceId]);
  return { notebookId, sourceId };
}

function replacement(sourceId: string, revision: number, text: string): { pages: sync.SyncPage[]; chunks: { chunk: UnifiedDocumentChunk; embedding: number[] }[] } {
  const length = Array.from(text).length;
  return {
    pages: [{ page_number: 1, text, dom_selector: "section:nth-of-type(1)" }],
    chunks: [
      {
        chunk: { chunk_id: uuidv7(), source_id: sourceId, revision, locator: { selector: "section:nth-of-type(1)", start_offset: 0, end_offset: length }, token_count: 4, text },
        embedding: Array.from({ length: 768 }, (_, i) => (i === 1 ? 1 : 0)),
      },
    ],
  };
}

async function commit(op: { operationId: string; fencingToken: number }, sourceId: string, expectedRevision: number, text: string, extra: Partial<sync.CommitSyncInput> = {}) {
  return sync.commitSyncReplacement(db.pool, {
    operationId: op.operationId,
    fencingToken: op.fencingToken,
    sourceId,
    expectedRevision,
    byteSize: Buffer.byteLength(text),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    pageCount: 1,
    embeddingModel: "test",
    contentHash: `sha256:${text}`,
    ...replacement(sourceId, expectedRevision + 1, text),
    ...extra,
  });
}

describe("migration 0009 is additive (FR-SI-01/05, C-01)", () => {
  it("SYNC-F01: 0001–0008 data survives applying 0009; v3 columns default to NULL", async () => {
    const admin = new pg.Client({ connectionString: testDatabaseUrl() });
    await admin.connect();
    const name = `everlast_t_mig_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(testDatabaseUrl());
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString() });
    try {
      const files = getAvailableMigrations();
      const before = files.filter((f) => !/\/00(09|[1-9]\d)_/.test(f));
      expect(files.some((f) => f.endsWith("0009_multimodal_ingestion_sync.sql"))).toBe(true);
      await pool.query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
      for (const file of before) {
        await pool.query(readFileSync(file, "utf8"));
        await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file.split("/").pop()]);
      }
      const user = randomUUID();
      const nb = randomUUID();
      const src = randomUUID();
      await pool.query("INSERT INTO users (id, issuer, subject) VALUES ($1, 'iss', $2)", [user, `sub-${user}`]);
      await pool.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, 'Legacy')", [nb, user]);
      await pool.query(
        "INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes) VALUES ($1, $2, $3, 'Old.pdf', 'application/pdf', 'Uploading', 10)",
        [src, nb, randomUUID()]
      );
      const applied = await runMigrations(pool);
      expect(applied).toContain("0009_multimodal_ingestion_sync.sql");
      const row = await pool.query("SELECT title, media_type, status, link_kind, external_url, content_hash, last_synced_at, progress FROM sources WHERE id = $1", [src]);
      expect(row.rows[0]).toEqual({ title: "Old.pdf", media_type: "application/pdf", status: "Uploading", link_kind: null, external_url: null, content_hash: null, last_synced_at: null, progress: null });
      // A second run is a no-op (MIGRATE_ON_START restarts).
      expect(await runMigrations(pool)).toEqual([]);
    } finally {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: testDatabaseUrl() });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    }
  });

  it("SYNC-F02: SQL accepts v3 media types and still rejects unknown ones and unknown operation states", async () => {
    const nb = await notebook();
    for (const type of ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg", "text/html", "video_url"]) {
      await db.pool.query(
        "INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes) VALUES ($1, $2, $3, 't', $4, 'Uploading', 1)",
        [randomUUID(), nb, randomUUID(), type]
      );
    }
    await expect(
      db.pool.query("INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes) VALUES ($1, $2, $3, 't', 'application/x-msdownload', 'Uploading', 1)", [randomUUID(), nb, randomUUID()])
    ).rejects.toThrow();
    const { sourceId } = await linkedSource();
    await expect(
      db.pool.query("INSERT INTO source_operations (id, notebook_id, source_id, kind, trigger, state) VALUES ($1, (SELECT notebook_id FROM sources WHERE id = $2), $2, 'sync', 'manual', 'Syncing')", [randomUUID(), sourceId])
    ).rejects.toThrow();
  });
});

describe("inclusive source limits on replacement (FR-WM-07, FR-SI-01)", () => {
  it("SYNC-F03: 200000000 bytes and 500000 words are accepted; 200000001 / 500001 are rejected without truncation", async () => {
    const { notebookId, sourceId } = await linkedSource();
    const op = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const claim = await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 });
    expect(claim.status).toBe("claimed");
    const token = { operationId: op.operation.operation_id, fencingToken: (claim as { fencingToken: number }).fencingToken };
    await expect(commit(token, sourceId, 1, "June text", { byteSize: 200_000_001 })).rejects.toThrow(/limit/);
    await expect(commit(token, sourceId, 1, "June text", { wordCount: 500_001 })).rejects.toThrow(/limit/);
    const ok = await commit(token, sourceId, 1, "Release v1 in June.", { byteSize: 200_000_000, wordCount: 500_000 });
    expect(ok).toEqual({ published: true, revision: 2 });
    const source = await getSourceById(db.pool, sourceId);
    expect(source).toMatchObject({ status: "Ready", active_revision: 2, actual_bytes: 200_000_000, word_count: 500_000 });
  });
});

describe("Ready-preserving staged replacement (FR-SI-05, C-02)", () => {
  it("SYNC-F04: while an operation runs, scope capture and reads stay on the committed revision; commit swaps atomically", async () => {
    const { notebookId, sourceId } = await linkedSource("Release v1 in May.");
    const op = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const claim = (await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    const during = await captureScopeSnapshot(db.pool, owner, notebookId, [sourceId]);
    expect(during.sources).toEqual([{ source_id: sourceId, revision: 1 }]);
    expect((await getSourceById(db.pool, sourceId))!.status).toBe("Ready");
    expect(await sync.getSourceProgress(db.pool, sourceId)).toBe("Syncing");

    const result = await commit({ operationId: op.operation.operation_id, fencingToken: claim.fencingToken }, sourceId, 1, "Release v1 in June.");
    expect(result).toEqual({ published: true, revision: 2 });
    const after = await captureScopeSnapshot(db.pool, owner, notebookId, [sourceId]);
    expect(after.sources).toEqual([{ source_id: sourceId, revision: 2 }]);
    const status = await sync.getSourceOperation(db.pool, owner, notebookId, sourceId, op.operation.operation_id);
    expect(status).toMatchObject({ state: "Succeeded", committed_revision: 2, progress: null });
    const meta = await db.pool.query("SELECT content_hash, last_synced_at FROM sources WHERE id = $1", [sourceId]);
    expect(meta.rows[0].content_hash).toBe("sha256:Release v1 in June.");
    expect(meta.rows[0].last_synced_at).toBeInstanceOf(Date);
    // Fresh, non-reused chunk IDs: old revision chunks are retained only as historical evidence.
    const chunks = await db.pool.query<{ revision: number; chunk_id: string }>("SELECT revision, chunk_id FROM chunks WHERE source_id = $1 ORDER BY revision", [sourceId]);
    const byRev = (r: number) => chunks.rows.filter((c) => c.revision === r).map((c) => c.chunk_id);
    expect(byRev(2).length).toBe(1);
    expect(byRev(1).some((id) => byRev(2).includes(id))).toBe(false);
  });

  it("SYNC-F05: a failing commit writes nothing; the old revision and slot are intact", async () => {
    const { notebookId, sourceId } = await linkedSource();
    const op = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const claim = (await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    const bad = replacement(sourceId, 2, "June");
    bad.chunks[0]!.chunk.source_id = randomUUID(); // provenance mismatch
    await expect(commit({ operationId: op.operation.operation_id, fencingToken: claim.fencingToken }, sourceId, 1, "June", bad)).rejects.toThrow();
    const source = await getSourceById(db.pool, sourceId);
    expect(source).toMatchObject({ status: "Ready", active_revision: 1 });
    const revisions = await db.pool.query("SELECT revision FROM source_revisions WHERE source_id = $1", [sourceId]);
    expect(revisions.rows.map((r) => r.revision)).toEqual([1]);
    await sync.failSourceOperation(db.pool, { operationId: op.operation.operation_id, fencingToken: claim.fencingToken, code: "ParseFailed", message: "Unable to extract content from URL" });
    expect(await getSourceById(db.pool, sourceId)).toMatchObject({ status: "Ready", active_revision: 1 });
    expect(await sync.getSourceOperation(db.pool, owner, notebookId, sourceId, op.operation.operation_id)).toMatchObject({
      state: "Failed",
      error: { code: "ParseFailed", message: "Unable to extract content from URL" },
    });
  });
});

describe("operation fencing and recovery (FR-SI-05; spec FR-011/012)", () => {
  it("SYNC-F06: an expired lease is reclaimed with a new fencing token; the stale worker cannot publish", async () => {
    const { notebookId, sourceId } = await linkedSource();
    const op = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const first = (await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    // A live lease is not stolen by a redelivered job.
    expect((await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })).status).toBe("busy");
    await db.pool.query("UPDATE source_operations SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [op.operation.operation_id]);
    const second = (await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);
    expect(await commit({ operationId: op.operation.operation_id, fencingToken: first.fencingToken }, sourceId, 1, "stale")).toEqual({ published: false, reason: "stale_token" });
    expect(await commit({ operationId: op.operation.operation_id, fencingToken: second.fencingToken }, sourceId, 1, "fresh")).toEqual({ published: true, revision: 2 });
    // A finished operation is terminal for any later delivery.
    expect((await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })).status).toBe("terminal");
  });

  it("SYNC-F07: expected-revision mismatch and a deleted notebook fence publication", async () => {
    const { notebookId, sourceId } = await linkedSource();
    const op = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const claim = (await sync.claimSourceOperation(db.pool, op.operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
    await db.pool.query("UPDATE sources SET active_revision = active_revision WHERE id = $1", [sourceId]);
    expect(await commit({ operationId: op.operation.operation_id, fencingToken: claim.fencingToken }, sourceId, 7, "x")).toEqual({ published: false, reason: "revision_changed" });
    await deleteNotebook(db.pool, owner, notebookId);
    expect(await commit({ operationId: op.operation.operation_id, fencingToken: claim.fencingToken }, sourceId, 1, "x")).toEqual({ published: false, reason: "fenced" });
  });
});

describe("atomic operation + outbox admission (FR-SI-05; spec FR-011)", () => {
  it("SYNC-F08: admission writes one Queued operation and exactly one sync job; same-key replay adds nothing", async () => {
    const { notebookId, sourceId } = await linkedSource();
    const attemptId = randomUUID();
    const first = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId, trigger: "manual" });
    expect(first.replayed).toBe(false);
    expect(first.operation).toMatchObject({ state: "Queued", kind: "sync", committed_revision: 1 });
    const replay = await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId, trigger: "manual" });
    expect(replay).toMatchObject({ replayed: true, operation: { operation_id: first.operation.operation_id } });
    const jobs = await db.pool.query("SELECT payload FROM jobs WHERE kind = 'sync' AND payload->>'operation_id' = $1", [first.operation.operation_id]);
    expect(jobs.rowCount).toBe(1);
  });

  it("SYNC-F09: a distinct request while active is rejected with 'Sync already in progress'; at most one active operation exists", async () => {
    const { notebookId, sourceId } = await linkedSource();
    await sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => sync.requestSourceSync(db.pool, owner, notebookId, sourceId, { attemptId: randomUUID(), trigger: i % 2 ? "webhook" : "manual" }))
    );
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "SyncAlreadyInProgress", message: "Sync already in progress" });
    }
    const active = await db.pool.query("SELECT count(*)::int AS n FROM source_operations WHERE source_id = $1 AND state IN ('Queued','Running')", [sourceId]);
    expect(active.rows[0].n).toBe(1);
    const jobs = await db.pool.query("SELECT count(*)::int AS n FROM jobs j JOIN source_operations o ON o.id::text = j.payload->>'operation_id' WHERE o.source_id = $1", [sourceId]);
    expect(jobs.rows[0].n).toBe(1);
  });
});
