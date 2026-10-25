import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook } from "../src/notebooks.ts";
import { countOccupiedSources } from "../src/quota.ts";
import { captureScopeSnapshot, verifyScopeSnapshot } from "../src/scope-guard.ts";
import { getOrCreateThread, projectVisibleMessages, publishTurn, listThreadMessages } from "../src/chat-history.ts";
import * as sync from "../src/source-sync.ts";

/**
 * [009-multimodal-ingestion-sync] T037 (DB) — deletion, replacement and history semantics (FR-SI-03/05, FR-GC-02/03/06,
 * FR-WM-07, C-02/C-03, NFR-EVAL-04; spec FR-010, FR-013, FR-014, FR-016, SC-004, SC-006): captured snapshots fail
 * after delete or replace; deletion frees the slot and records durable object cleanup; a citation to a replaced
 * revision is "Source updated" with its saved historical snippet but no exact-passage locator and the answer stays
 * viewable; a deleted source's citations are "Source deleted" and dependent answers are hidden.
 */

let db: TestDatabase;
let owner: string;
const vec = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
});
afterAll(async () => {
  await db?.drop();
});

async function answered(text = "Release v1 in May.") {
  const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  const { sourceId, chunkIds } = await seedReadySource(db.pool, owner, nb, { pages: [text], embed: async (t) => t.map(() => vec), mediaType: "text/plain" });
  await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/r', media_type = 'text/html' WHERE id = $1", [sourceId]);
  const snapshot = await captureScopeSnapshot(db.pool, owner, nb, [sourceId]);
  const thread = await getOrCreateThread(db.pool, owner, nb);
  await publishTurn(db.pool, { thread, snapshot, requestId: randomUUID(), question: "When is v1?", answer: { kind: "answer", content: "In May [[1]]", citations: [{ badge_number: 1, source_id: sourceId, chunk_id: chunkIds[0]!, revision: 1 }] } });
  return { nb, sourceId, snapshot, thread };
}

async function resync(nb: string, sourceId: string, text = "Release v1 in June.") {
  const { operation } = await sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
  const claim = (await sync.claimSourceOperation(db.pool, operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
  await sync.commitSyncReplacement(db.pool, {
    operationId: operation.operation_id,
    fencingToken: claim.fencingToken,
    sourceId,
    expectedRevision: 1,
    byteSize: text.length,
    wordCount: 4,
    pageCount: 1,
    embeddingModel: "t",
    contentHash: "h2",
    pages: [{ page_number: 1, text }],
    chunks: [{ chunk: { chunk_id: uuidv7(), source_id: sourceId, revision: 2, locator: { page_number: 1, start_offset: 0, end_offset: text.length }, token_count: 4, text }, embedding: vec }],
  });
}

describe("captured snapshots (C-02/C-03, FR-SI-05)", () => {
  it("LIFE-DB-01: a generation captured before a re-sync or a removal cannot publish", async () => {
    for (const mutate of ["resync", "delete"] as const) {
      const { nb, sourceId, snapshot, thread } = await answered();
      if (mutate === "resync") await resync(nb, sourceId);
      else await sync.deleteSource(db.pool, owner, nb, sourceId);
      await expect(verifyScopeSnapshot(db.pool, snapshot)).rejects.toMatchObject({ code: "SourceSnapshotInvalid" });
      await expect(
        publishTurn(db.pool, { thread, snapshot, requestId: randomUUID(), question: "q", answer: { kind: "answer", content: "stale", citations: [] } })
      ).rejects.toMatchObject({ code: "SourceSnapshotInvalid" });
    }
  });
});

describe("history projection after replacement and removal (FR-GC-03, FR-SI-05, NFR-EVAL-04)", () => {
  it("LIFE-DB-02: a replaced revision's citation says 'updated' with the saved snippet and no locator; the answer stays visible", async () => {
    const { nb, sourceId, thread } = await answered();
    await resync(nb, sourceId);
    const [, answer] = await projectVisibleMessages(db.pool, nb, await listThreadMessages(db.pool, thread.id));
    expect(answer!.content).toBe("In May [[1]]");
    expect(answer!.unavailable_reason).toBeNull();
    expect(answer!.citations[0]).toMatchObject({ status: "updated", source_title: "Fixture.pdf", snippet: "Release v1 in May.", locator: null });
  });

  it("LIFE-DB-03: removal makes citations 'deleted', hides dependent answers, frees the slot and records object cleanup", async () => {
    const { nb, sourceId, thread } = await answered();
    expect(await countOccupiedSources(db.pool, nb)).toBe(1);
    const { deletion_id } = await sync.deleteSource(db.pool, owner, nb, sourceId);
    expect(await countOccupiedSources(db.pool, nb)).toBe(0);
    const [, answer] = await projectVisibleMessages(db.pool, nb, await listThreadMessages(db.pool, thread.id));
    expect(answer).toMatchObject({ content: null, unavailable_reason: "source_deleted" });
    expect(answer!.citations[0]).toMatchObject({ status: "deleted", snippet: null, source_title: null });
    const cleanup = await db.pool.query("SELECT object_prefix, status FROM cleanup_operations WHERE id = $1", [deletion_id]);
    expect(cleanup.rows[0]).toEqual({ object_prefix: `notebooks/${nb}/sources/${sourceId}/`, status: "Pending" });
    const leftovers = await db.pool.query(
      "SELECT (SELECT count(*) FROM chunks WHERE source_id = $1)::int + (SELECT count(*) FROM source_pages WHERE source_id = $1)::int + (SELECT count(*) FROM source_operations WHERE source_id = $1)::int AS n",
      [sourceId]
    );
    expect(leftovers.rows[0].n).toBe(0);
    await expect(captureScopeSnapshot(db.pool, owner, nb, [sourceId])).rejects.toMatchObject({ code: "InvalidScope" });
  });

  it("LIFE-DB-04: removing twice or removing a foreign source exposes nothing", async () => {
    const { nb, sourceId } = await answered();
    await sync.deleteSource(db.pool, owner, nb, sourceId);
    await expect(sync.deleteSource(db.pool, owner, nb, sourceId)).rejects.toMatchObject({ status: 404 });
    const other = await createTestUser(db.pool);
    const fresh = await answered();
    await expect(sync.deleteSource(db.pool, other, fresh.nb, fresh.sourceId)).rejects.toMatchObject({ status: 403 });
  });
});
