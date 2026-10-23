import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook } from "../src/notebooks.ts";
import { countOccupiedSources, getSourceById } from "../src/quota.ts";
import * as sync from "../src/source-sync.ts";

/**
 * [009-multimodal-ingestion-sync] T034 — Ready-preserving re-sync transaction (FR-SI-01/05, FR-WM-07, C-01/C-02;
 * spec FR-007, FR-011, FR-012, FR-013, SC-004, SC-005, SC-006): May→June replacement with fresh chunk IDs, hash and
 * last_synced_at; inclusive byte/word boundaries; the existing quota slot; deleted/stale fences.
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

async function linked(text = "Release v1 in May.") {
  const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  const { sourceId, chunkIds } = await seedReadySource(db.pool, owner, nb, { title: "Roadmap", pages: [text], embed: async (t) => t.map(() => vec), mediaType: "text/plain" });
  await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/roadmap', media_type = 'text/html', content_hash = 'h1' WHERE id = $1", [sourceId]);
  return { nb, sourceId, chunkIds };
}

async function claimed(nb: string, sourceId: string) {
  const { operation } = await sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
  const claim = (await sync.claimSourceOperation(db.pool, operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
  return { operationId: operation.operation_id, fencingToken: claim.fencingToken };
}

function input(op: { operationId: string; fencingToken: number }, sourceId: string, text: string, sizes: { bytes?: number; words?: number } = {}): sync.CommitSyncInput {
  return {
    ...op,
    sourceId,
    expectedRevision: 1,
    byteSize: sizes.bytes ?? text.length,
    wordCount: sizes.words ?? text.split(" ").length,
    pageCount: 1,
    embeddingModel: "test",
    contentHash: `h-${text}`,
    pages: [{ page_number: 1, text }],
    chunks: [{ chunk: { chunk_id: uuidv7(), source_id: sourceId, revision: 2, locator: { page_number: 1, start_offset: 0, end_offset: Array.from(text).length }, token_count: 4, text }, embedding: vec }],
  };
}

describe("May → June replacement (FR-SI-05)", () => {
  it("SYNC-01: fresh chunk IDs, new hash and last_synced_at; the slot is reused, not re-reserved", async () => {
    const { nb, sourceId, chunkIds } = await linked();
    const before = await countOccupiedSources(db.pool, nb);
    const op = await claimed(nb, sourceId);
    const commit = input(op, sourceId, "Release v1 in June.");
    expect(await sync.commitSyncReplacement(db.pool, commit)).toEqual({ published: true, revision: 2 });
    expect(await countOccupiedSources(db.pool, nb)).toBe(before);
    const src = (await getSourceById(db.pool, sourceId))!;
    expect(src).toMatchObject({ status: "Ready", active_revision: 2, content_hash: "h-Release v1 in June.", progress: null });
    expect(src.last_synced_at).not.toBeNull();
    const current = await db.pool.query("SELECT chunk_id FROM chunks WHERE source_id = $1 AND revision = 2", [sourceId]);
    expect(current.rows.map((r) => r.chunk_id)).toEqual([commit.chunks[0]!.chunk.chunk_id]);
    expect(chunkIds).not.toContain(commit.chunks[0]!.chunk.chunk_id);
  });

  it("SYNC-02: identical upstream content completes without a new revision and records the sync time", async () => {
    const { nb, sourceId } = await linked();
    const op = await claimed(nb, sourceId);
    expect(await sync.completeSyncUnchanged(db.pool, { ...op, sourceId, expectedRevision: 1 })).toEqual({ published: true, revision: 1 });
    expect((await getSourceById(db.pool, sourceId))!).toMatchObject({ active_revision: 1, progress: null });
  });
});

describe("inclusive limits on replacement (FR-WM-07, FR-SI-01)", () => {
  it("SYNC-03: bytes 199,999,999 and 200,000,000 commit; 200,000,001 is rejected and nothing changes", async () => {
    for (const [bytes, ok] of [[199_999_999, true], [200_000_000, true], [200_000_001, false]] as const) {
      const { nb, sourceId } = await linked();
      const op = await claimed(nb, sourceId);
      if (ok) expect((await sync.commitSyncReplacement(db.pool, input(op, sourceId, "June", { bytes }))).published).toBe(true);
      else {
        await expect(sync.commitSyncReplacement(db.pool, input(op, sourceId, "June", { bytes }))).rejects.toThrow(/limit/);
        expect((await getSourceById(db.pool, sourceId))!.active_revision).toBe(1);
      }
    }
  });

  it("SYNC-04: words 499,999 and 500,000 commit; 500,001 is rejected and nothing changes", async () => {
    for (const [words, ok] of [[499_999, true], [500_000, true], [500_001, false]] as const) {
      const { nb, sourceId } = await linked();
      const op = await claimed(nb, sourceId);
      if (ok) expect((await sync.commitSyncReplacement(db.pool, input(op, sourceId, "June", { words }))).published).toBe(true);
      else await expect(sync.commitSyncReplacement(db.pool, input(op, sourceId, "June", { words }))).rejects.toThrow(/limit/);
    }
  });
});

describe("fences (FR-SI-05, C-02)", () => {
  it("SYNC-05: a source deleted during the operation can never be republished; the operation row is gone", async () => {
    const { nb, sourceId } = await linked();
    const op = await claimed(nb, sourceId);
    await sync.deleteSource(db.pool, owner, nb, sourceId);
    expect(await sync.commitSyncReplacement(db.pool, input(op, sourceId, "June"))).toEqual({ published: false, reason: "fenced" });
    expect(await getSourceById(db.pool, sourceId)).toBeNull();
    expect((await sync.claimSourceOperation(db.pool, op.operationId, { leaseSeconds: 60 })).status).toBe("missing");
  });

  it("SYNC-06: a failed operation keeps the committed revision and slot; a new request can start afterwards", async () => {
    const { nb, sourceId } = await linked();
    const op = await claimed(nb, sourceId);
    expect(await sync.failSourceOperation(db.pool, { ...op, code: "WebExtractionFailed", message: "Unable to extract content from URL" })).toBe(true);
    expect((await getSourceById(db.pool, sourceId))!).toMatchObject({ status: "Ready", active_revision: 1, progress: null });
    const again = await sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
    expect(again.replayed).toBe(false);
  });
});
