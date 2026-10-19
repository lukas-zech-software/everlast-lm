import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { InvalidScopeError, SourceNotReadyError, SourceSnapshotInvalidError, EmptyScopeError } from "@everlast/contracts";
import { createTestDatabase, createTestUser, type TestDatabase } from "../src/testing.ts";
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  listNotebooks,
  renameNotebook,
  NotebookForbiddenError,
  NotebookNotFoundError,
  NotebookQuotaExceededError,
  InvalidTitleError,
} from "../src/notebooks.ts";
import {
  reserveSources,
  acceptReceivedSource,
  failSource,
  dismissSourceError,
  getQuotaSummary,
  type AdmissionEntry,
} from "../src/quota.ts";
import { captureScopeSnapshot, verifyScopeSnapshot } from "../src/scope-guard.ts";
import { getCleanupStatus } from "../src/cleanup.ts";
import { ensureUser } from "../src/users.ts";
import { getAvailableMigrations, runMigrations } from "../src/migrate.ts";
import { withTransaction } from "../src/transaction.ts";

/**
 * T009/T014/T025/T033 — database foundation, notebook repository, isolation races and atomic admission,
 * executed against an isolated PostgreSQL 16 + pgvector database (FR-WM-01, FR-WM-04, FR-WM-07, C-02).
 */

let db: TestDatabase;
let pool: Pool;

beforeAll(async () => {
  db = await createTestDatabase();
  pool = db.pool;
});

afterAll(async () => {
  await db?.drop();
});

function entry(overrides: Partial<AdmissionEntry> = {}): AdmissionEntry {
  return {
    attempt_id: randomUUID(),
    title: "Report.pdf",
    media_type: "application/pdf",
    declared_bytes: 1024,
    ...overrides,
  };
}

async function seedReadySources(notebookId: string, ownerId: string, count: number): Promise<string[]> {
  const results = await reserveSources(
    pool,
    ownerId,
    notebookId,
    Array.from({ length: count }, () => entry()),
    { sourceLimit: 300 }
  );
  const ids = results.map((r) => r.source!.id);
  await pool.query(
    `UPDATE sources SET status = 'Ready', actual_bytes = declared_bytes, word_count = 10, active_revision = 1
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return ids;
}

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe("T009 schema invariants (FR-WM-01, FR-WM-04, FR-WM-07)", () => {
  it("DB-01: migrations apply in order and are idempotent", async () => {
    const files = getAvailableMigrations().map((f) => f.split("/").pop());
    expect(files[0]).toBe("0001_workspace.sql");
    const applied = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
    expect(applied.rows.map((r) => r.version)).toEqual(files);
    expect(await runMigrations(pool)).toEqual([]);
  });

  it("DB-02: users map a unique verified (issuer, subject); email is not the ownership key", async () => {
    const a = await ensureUser(pool, { issuer: "iss", subject: "sub-1", email: "same@example.test" });
    const again = await ensureUser(pool, { issuer: "iss", subject: "sub-1", email: "changed@example.test" });
    const other = await ensureUser(pool, { issuer: "iss", subject: "sub-2", email: "same@example.test" });
    expect(again.id).toBe(a.id);
    expect(other.id).not.toBe(a.id);
    expect(await sqlState(pool.query("INSERT INTO users (id, issuer, subject) VALUES ($1, 'iss', 'sub-1')", [randomUUID()]))).toBe("23505");
  });

  it("DB-03: notebooks require an existing owner and a 1–100 code point title", async () => {
    const owner = await createTestUser(pool);
    expect(await sqlState(pool.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, 't')", [randomUUID(), randomUUID()]))).toBe("23503");
    expect(await sqlState(pool.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, '')", [randomUUID(), owner]))).toBe("23514");
    expect(await sqlState(pool.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, $3)", [randomUUID(), owner, "🔬".repeat(101)]))).toBe("23514");
    expect(await sqlState(pool.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, $3)", [randomUUID(), owner, "🔬".repeat(100)]))).toBeUndefined();
  });

  it("DB-04: sources are keyed (notebook_id, id) and cascade with their notebook", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const [admitted] = await reserveSources(pool, owner, notebook.id, [entry()]);
    expect(await sqlState(pool.query("INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes) VALUES ($1, $2, $3, 't', 'text/plain', 'Uploading', 1)", [admitted!.source!.id, notebook.id, randomUUID()]))).toBe("23505");
    await pool.query("DELETE FROM notebooks WHERE id = $1", [notebook.id]);
    const left = await pool.query("SELECT 1 FROM sources WHERE id = $1", [admitted!.source!.id]);
    expect(left.rowCount).toBe(0);
  });

  it("DB-05: source metadata is non-negative and limits are enforced by constraints", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const insert = (bytes: number, status = "Uploading", words: number | null = null) =>
      pool.query(
        "INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes, word_count) VALUES ($1, $2, $3, 't', 'text/plain', $4, $5, $6)",
        [randomUUID(), notebook.id, randomUUID(), status, bytes, words]
      );
    expect(await sqlState(insert(-1))).toBe("23514");
    expect(await sqlState(insert(200_000_001))).toBe("23514");
    expect(await sqlState(insert(200_000_000))).toBeUndefined();
    expect(await sqlState(insert(10, "Processing", 500_001))).toBe("23514");
    expect(await sqlState(insert(10, "Ready"))).toBe("23514"); // Ready requires revision, words and bytes
  });

  it("DB-06: cleanup_operations is payload-free (no title, content or payload columns)", async () => {
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'cleanup_operations'"
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(["id", "notebook_id", "owner_id", "status", "object_prefix"]));
    for (const forbidden of ["title", "content", "payload", "text"]) expect(names).not.toContain(forbidden);
  });
});

describe("T014 notebook repository (FR-WM-01, FR-WM-04)", () => {
  it("DB-09: create persists a UUID v4 notebook with the default title and reopens unchanged", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    expect(notebook.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(notebook.title).toBe("Untitled notebook");
    expect(await getNotebook(pool, owner, notebook.id)).toEqual(notebook);
    expect(Object.keys(notebook)).not.toContain("owner_id");
  });

  it("DB-10: the 101st notebook is rejected; 99 plus two concurrent creates yields exactly one", async () => {
    const owner = await createTestUser(pool);
    await pool.query(
      "INSERT INTO notebooks (id, owner_id, title) SELECT gen_random_uuid(), $1, 'seed' FROM generate_series(1, 99)",
      [owner]
    );
    const outcomes = await Promise.allSettled([createNotebook(pool, owner, {}), createNotebook(pool, owner, {})]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(NotebookQuotaExceededError);
    expect((await listNotebooks(pool, owner)).notebooks_used).toBe(100);
  });

  it("DB-11: rename trims, accepts 100 code points, advances updated_at; failure leaves row unchanged", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, { title: "Original" });
    const renamed = await renameNotebook(pool, owner, notebook.id, "  Updated Title 🔬  ");
    expect(renamed.title).toBe("Updated Title 🔬");
    expect(Date.parse(renamed.updated_at)).toBeGreaterThan(Date.parse(notebook.updated_at));
    const hundred = "🔬".repeat(100);
    expect((await renameNotebook(pool, owner, notebook.id, hundred)).title).toBe(hundred);
    const before = await getNotebook(pool, owner, notebook.id);
    await expect(renameNotebook(pool, owner, notebook.id, "   ")).rejects.toBeInstanceOf(InvalidTitleError);
    await expect(renameNotebook(pool, owner, notebook.id, "a".repeat(101))).rejects.toBeInstanceOf(InvalidTitleError);
    expect(await getNotebook(pool, owner, notebook.id)).toEqual(before);
  });

  it("DB-12: delete cascades rows, records a payload-free cleanup operation and outbox job atomically", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, { title: "To Delete" });
    await seedReadySources(notebook.id, owner, 2);
    const { deletion_id } = await deleteNotebook(pool, owner, notebook.id);
    await expect(getNotebook(pool, owner, notebook.id)).rejects.toBeInstanceOf(NotebookNotFoundError);
    expect((await pool.query("SELECT 1 FROM sources WHERE notebook_id = $1", [notebook.id])).rowCount).toBe(0);
    expect(await getCleanupStatus(pool, owner, deletion_id)).toEqual({ deletion_id, status: "Pending" });
    const job = await pool.query("SELECT kind, payload FROM jobs WHERE payload->>'deletion_id' = $1", [deletion_id]);
    expect(job.rows).toEqual([{ kind: "cleanup", payload: { deletion_id } }]);
    await expect(deleteNotebook(pool, owner, notebook.id)).rejects.toBeInstanceOf(NotebookNotFoundError);
  });

  it("DB-13: another owner gets 403 on read/rename/delete/status; unknown IDs are 404", async () => {
    const alpha = await createTestUser(pool);
    const beta = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, alpha, { title: "Alpha Only" });
    await expect(getNotebook(pool, beta, notebook.id)).rejects.toBeInstanceOf(NotebookForbiddenError);
    await expect(renameNotebook(pool, beta, notebook.id, "x")).rejects.toBeInstanceOf(NotebookForbiddenError);
    await expect(deleteNotebook(pool, beta, notebook.id)).rejects.toBeInstanceOf(NotebookForbiddenError);
    await expect(getNotebook(pool, beta, randomUUID())).rejects.toBeInstanceOf(NotebookNotFoundError);
    await expect(getNotebook(pool, beta, "not-a-uuid")).rejects.toBeInstanceOf(NotebookNotFoundError);
    const { deletion_id } = await deleteNotebook(pool, alpha, notebook.id);
    await expect(getCleanupStatus(pool, beta, deletion_id)).rejects.toMatchObject({ code: "Forbidden", status: 403 });
    expect((await listNotebooks(pool, beta)).notebooks).toEqual([]);
  });

  it("DB-14: same create key replays the same notebook; replay after deletion never resurrects it", async () => {
    const owner = await createTestUser(pool);
    const key = randomUUID();
    const first = await createNotebook(pool, owner, {}, { idempotencyKey: key });
    const second = await createNotebook(pool, owner, {}, { idempotencyKey: key });
    expect(second).toEqual({ notebook: first.notebook, replayed: true });
    const other = await createTestUser(pool);
    const foreign = await createNotebook(pool, other, {}, { idempotencyKey: key });
    expect(foreign.notebook.id).not.toBe(first.notebook.id);
    await deleteNotebook(pool, owner, first.notebook.id);
    await expect(createNotebook(pool, owner, {}, { idempotencyKey: key })).rejects.toBeInstanceOf(NotebookNotFoundError);
    expect((await listNotebooks(pool, owner)).notebooks_used).toBe(0);
  });

  it("DB-14b: a failed transaction commits nothing (create rollback)", async () => {
    const owner = await createTestUser(pool);
    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, 'temp')", [randomUUID(), owner]);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect((await listNotebooks(pool, owner)).notebooks_used).toBe(0);
  });
});

describe("T025 isolation and snapshot races (FR-WM-04, C-02)", () => {
  it("DB-15: two owners / two notebooks keep identical-file sources independent; foreign IDs reject whole request", async () => {
    const alpha = await createTestUser(pool);
    const beta = await createTestUser(pool);
    const { notebook: nbA } = await createNotebook(pool, alpha, {});
    const { notebook: nbA2 } = await createNotebook(pool, alpha, {});
    const { notebook: nbB } = await createNotebook(pool, beta, {});
    const [a1] = await seedReadySources(nbA.id, alpha, 1);
    const [a2] = await seedReadySources(nbA2.id, alpha, 1);
    const [b1] = await seedReadySources(nbB.id, beta, 1);

    const snap = await captureScopeSnapshot(pool, alpha, nbA.id, [a1]);
    expect(snap.sources).toEqual([{ source_id: a1, revision: 1 }]);
    await expect(captureScopeSnapshot(pool, alpha, nbA.id, [a1, b1])).rejects.toBeInstanceOf(InvalidScopeError);
    await expect(captureScopeSnapshot(pool, alpha, nbA.id, [a1, a2])).rejects.toBeInstanceOf(InvalidScopeError);
    await expect(captureScopeSnapshot(pool, alpha, nbA.id, [randomUUID()])).rejects.toBeInstanceOf(InvalidScopeError);
    await expect(captureScopeSnapshot(pool, beta, nbA.id, [a1])).rejects.toBeInstanceOf(NotebookForbiddenError);
    await expect(captureScopeSnapshot(pool, alpha, nbA.id, [])).rejects.toBeInstanceOf(EmptyScopeError);
    await expect(captureScopeSnapshot(pool, alpha, nbA.id, undefined)).rejects.toBeInstanceOf(EmptyScopeError);

    // Deleting notebook A leaves the identical upload in notebook A2 untouched.
    await deleteNotebook(pool, alpha, nbA.id);
    expect((await captureScopeSnapshot(pool, alpha, nbA2.id, [a2])).sources).toHaveLength(1);
  });

  it("DB-16: the captured snapshot is immutable; non-Ready selections are rejected", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const [s1, s2] = await seedReadySources(notebook.id, owner, 2);
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [s1, s1]);
    expect(snapshot.sources).toEqual([{ source_id: s1, revision: 1 }]);
    const later = await captureScopeSnapshot(pool, owner, notebook.id, [s1, s2]);
    expect(later.sources).toHaveLength(2);
    expect(snapshot.sources.map((p) => p.source_id)).not.toContain(s2);
    await verifyScopeSnapshot(pool, snapshot);

    const [pending] = await reserveSources(pool, owner, notebook.id, [entry()]);
    await expect(captureScopeSnapshot(pool, owner, notebook.id, [pending!.source!.id])).rejects.toBeInstanceOf(
      SourceNotReadyError
    );
  });

  it("DB-17: revision replacement or source deletion between capture and read invalidates the snapshot", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const [s1, s2] = await seedReadySources(notebook.id, owner, 2);
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [s1, s2]);
    await pool.query("UPDATE sources SET active_revision = 2 WHERE id = $1", [s1]);
    await expect(verifyScopeSnapshot(pool, snapshot)).rejects.toBeInstanceOf(SourceSnapshotInvalidError);

    const snapshot2 = await captureScopeSnapshot(pool, owner, notebook.id, [s2]);
    await pool.query("DELETE FROM sources WHERE id = $1", [s2]);
    await expect(verifyScopeSnapshot(pool, snapshot2)).rejects.toBeInstanceOf(SourceSnapshotInvalidError);
  });

  it("DB-18: publication fence serializes with deletion in both orders", async () => {
    const owner = await createTestUser(pool);
    // Order A: deletion commits first → publication fails.
    const { notebook: nbA } = await createNotebook(pool, owner, {});
    const [a] = await seedReadySources(nbA.id, owner, 1);
    const snapA = await captureScopeSnapshot(pool, owner, nbA.id, [a]);
    await deleteNotebook(pool, owner, nbA.id);
    await expect(withTransaction(pool, (tx) => verifyScopeSnapshot(tx, snapA, { lock: "share" }))).rejects.toBeInstanceOf(
      SourceSnapshotInvalidError
    );

    // Order B: publication holds the fence → deletion waits until publication commits, then deletes.
    const { notebook: nbB } = await createNotebook(pool, owner, {});
    const [b] = await seedReadySources(nbB.id, owner, 1);
    const snapB = await captureScopeSnapshot(pool, owner, nbB.id, [b]);
    const events: string[] = [];
    let releaseFence!: () => void;
    const fenceHeld = new Promise<void>((resolve) => (releaseFence = resolve));
    let fenceAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => (fenceAcquired = resolve));
    const publication = withTransaction(pool, async (tx) => {
      await verifyScopeSnapshot(tx, snapB, { lock: "share" });
      fenceAcquired();
      await fenceHeld;
      events.push("published");
    });
    await acquired;
    const deletion = deleteNotebook(pool, owner, nbB.id).then(() => events.push("deleted"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events).toEqual([]);
    releaseFence();
    await Promise.all([publication, deletion]);
    expect(events).toEqual(["published", "deleted"]);
  });
});

describe("T033 atomic admission (FR-WM-07)", () => {
  it("DB-19: two connections race for the final slot at 49/50: exactly one admits", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    await seedReadySources(notebook.id, owner, 49);
    const [r1, r2] = await Promise.all([
      reserveSources(pool, owner, notebook.id, [entry()], { sourceLimit: 50 }),
      reserveSources(pool, owner, notebook.id, [entry()], { sourceLimit: 50 }),
    ]);
    const admitted = [r1![0]!, r2![0]!].filter((r) => r.admitted);
    expect(admitted).toHaveLength(1);
    expect([r1![0]!, r2![0]!].find((r) => !r.admitted)!.error!.code).toBe("SourceQuotaExceeded");
    expect((await getQuotaSummary(pool, owner, notebook.id, 50)).sources_used).toBe(50);
  });

  it("DB-20: winner failure releases its slot immediately so another attempt can be admitted", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    await seedReadySources(notebook.id, owner, 49);
    const [winner] = await reserveSources(pool, owner, notebook.id, [entry()], { sourceLimit: 50 });
    const [blocked] = await reserveSources(pool, owner, notebook.id, [entry()], { sourceLimit: 50 });
    expect(blocked!.admitted).toBe(false);
    expect(await failSource(pool, { sourceId: winner!.source!.id, attemptId: winner!.attempt_id, code: "ParseError", message: "x" })).toBe(true);
    const [retry] = await reserveSources(pool, owner, notebook.id, [entry()], { sourceLimit: 50 });
    expect(retry!.admitted).toBe(true);
  });

  it("DB-21: duplicate failure or dismissal cannot double-release a slot", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    await seedReadySources(notebook.id, owner, 48);
    const [a] = await reserveSources(pool, owner, notebook.id, [entry()], { sourceLimit: 50 });
    const failure = { sourceId: a!.source!.id, attemptId: a!.attempt_id, code: "ParseError", message: "x" };
    expect(await failSource(pool, failure)).toBe(true);
    expect(await failSource(pool, failure)).toBe(false);
    expect((await getQuotaSummary(pool, owner, notebook.id, 50)).sources_used).toBe(48);
    await dismissSourceError(pool, owner, notebook.id, a!.source!.id);
    expect((await getQuotaSummary(pool, owner, notebook.id, 50)).sources_used).toBe(48);
    await expect(dismissSourceError(pool, owner, notebook.id, a!.source!.id)).rejects.toMatchObject({ code: "SourceNotFound" });
    const ready = (await pool.query("SELECT id FROM sources WHERE notebook_id = $1 LIMIT 1", [notebook.id])).rows[0].id;
    await expect(dismissSourceError(pool, owner, notebook.id, ready)).rejects.toMatchObject({ status: 409 });
  });

  it("DB-22: batch of 10 at 45/50 admits the first five in order and rejects the rest", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    await seedReadySources(notebook.id, owner, 45);
    const batch = Array.from({ length: 10 }, () => entry());
    const results = await reserveSources(pool, owner, notebook.id, batch, { sourceLimit: 50 });
    expect(results.map((r) => r.attempt_id)).toEqual(batch.map((b) => b.attempt_id));
    expect(results.map((r) => r.admitted)).toEqual([true, true, true, true, true, false, false, false, false, false]);
    expect(results.slice(5).every((r) => r.error!.code === "SourceQuotaExceeded")).toBe(true);
  });

  it("DB-23: Uploading, Processing and Ready occupy slots; Failed does not; configured 300 limit holds", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const [u, p, f] = await reserveSources(pool, owner, notebook.id, [entry(), entry(), entry()]);
    await pool.query("UPDATE sources SET status = 'Processing' WHERE id = $1", [p!.source!.id]);
    await failSource(pool, { sourceId: f!.source!.id, attemptId: f!.attempt_id, code: "x", message: "x" });
    expect(u!.source!.status).toBe("Uploading");
    expect((await getQuotaSummary(pool, owner, notebook.id)).sources_used).toBe(2);

    const { notebook: big } = await createNotebook(pool, owner, {});
    await seedReadySources(big.id, owner, 299);
    const [last, overflow] = await reserveSources(pool, owner, big.id, [entry(), entry()], { sourceLimit: 300 });
    expect(last!.admitted).toBe(true);
    expect(overflow!.admitted).toBe(false);
    // Lowering the limit below usage blocks admission without deleting content.
    const [blocked] = await reserveSources(pool, owner, big.id, [entry()], { sourceLimit: 50 });
    expect(blocked!.error!.code).toBe("SourceQuotaExceeded");
    expect((await getQuotaSummary(pool, owner, big.id, 50)).sources_used).toBe(300);
  });

  it("DB-24: replay returns the existing attempt; oversize, foreign and deleted-notebook admissions fail", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const e = entry();
    const [first] = await reserveSources(pool, owner, notebook.id, [e]);
    const [replay] = await reserveSources(pool, owner, notebook.id, [e]);
    expect(replay!.source!.id).toBe(first!.source!.id);
    expect((await getQuotaSummary(pool, owner, notebook.id)).sources_used).toBe(1);

    const [exact] = await reserveSources(pool, owner, notebook.id, [entry({ declared_bytes: 200_000_000 })]);
    expect(exact!.admitted).toBe(true);
    const [over] = await reserveSources(pool, owner, notebook.id, [entry({ declared_bytes: 200_000_001 })]);
    expect(over!.error!.code).toBe("SourceOversized");
    const [docx] = await reserveSources(pool, owner, notebook.id, [entry({ media_type: "application/msword" })]);
    expect(docx!.error!.code).toBe("UnsupportedMediaType");

    const intruder = await createTestUser(pool);
    await expect(reserveSources(pool, intruder, notebook.id, [entry()])).rejects.toBeInstanceOf(NotebookForbiddenError);
    await deleteNotebook(pool, owner, notebook.id);
    await expect(reserveSources(pool, owner, notebook.id, [entry()])).rejects.toBeInstanceOf(NotebookNotFoundError);
  });

  it("DB-25: trusted receipt checks actual bytes; dishonest declarations fail and release the slot", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const [ok, liar, empty] = await reserveSources(pool, owner, notebook.id, [entry(), entry(), entry()]);
    const accepted = await acceptReceivedSource(pool, {
      sourceId: ok!.source!.id,
      attemptId: ok!.attempt_id,
      actualBytes: 200_000_000,
      objectName: "o",
      objectGeneration: "1",
    });
    expect(accepted.outcome).toBe("processing");
    const dishonest = await acceptReceivedSource(pool, {
      sourceId: liar!.source!.id,
      attemptId: liar!.attempt_id,
      actualBytes: 200_000_001,
      objectName: "o2",
      objectGeneration: "1",
    });
    expect(dishonest.outcome).toBe("failed");
    const zero = await acceptReceivedSource(pool, {
      sourceId: empty!.source!.id,
      attemptId: empty!.attempt_id,
      actualBytes: 0,
      objectName: "o3",
      objectGeneration: "1",
    });
    expect(zero).toMatchObject({ outcome: "failed", source: { failure_message: "File is empty" } });
    expect((await getQuotaSummary(pool, owner, notebook.id)).sources_used).toBe(1);
    // Late or replayed receipts are rejected without state change.
    const replay = await acceptReceivedSource(pool, {
      sourceId: ok!.source!.id,
      attemptId: ok!.attempt_id,
      actualBytes: 5,
      objectName: "o",
      objectGeneration: "2",
    });
    expect(replay).toEqual({ outcome: "rejected", reason: "not_uploading" });
    await deleteNotebook(pool, owner, notebook.id);
    const late = await acceptReceivedSource(pool, {
      sourceId: ok!.source!.id,
      attemptId: ok!.attempt_id,
      actualBytes: 5,
      objectName: "o",
      objectGeneration: "3",
    });
    expect(late).toEqual({ outcome: "rejected", reason: "fenced" });
  });
});
