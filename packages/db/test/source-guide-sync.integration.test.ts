import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook } from "../src/notebooks.ts";
import { getSourceGuide, saveSourceGuide } from "../src/package-v2-2.ts";
import { runWithV2Persistence } from "../src/v2-persistence.ts";
import * as sync from "../src/source-sync.ts";

/**
 * [009-multimodal-ingestion-sync] T036 (DB) — durable Guide trigger and stale-publication fence after re-sync
 * (FR-SI-02, FR-SI-05, C-02, D16; spec FR-011, FR-013, FR-015, SC-006): each committed revision records a Pending
 * publication event that survives restarts; events of superseded revisions are closed; a Source Guide can only be
 * stored for the source's current Ready revision (an old generation finishing late is dropped).
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

async function resynced() {
  const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  const { sourceId } = await seedReadySource(db.pool, owner, nb, { pages: ["Release v1 in May."], embed: async (t) => t.map(() => vec), mediaType: "text/plain" });
  await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/r', media_type = 'text/html' WHERE id = $1", [sourceId]);
  const { operation } = await sync.requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
  const claim = (await sync.claimSourceOperation(db.pool, operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
  const text = "Release v1 in June.";
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
  return { nb, sourceId };
}

const guide = (nb: string, sourceId: string, revision: number) => ({
  notebook_id: nb,
  source_id: sourceId,
  revision,
  output_language: "en",
  status: "GuideReady" as const,
  source_word_count: 4,
  summary_md: `Summary of revision ${revision}.`,
  key_topics: ["Release"],
  supporting_chunk_ids: [randomUUID()],
  generated_at: new Date().toISOString(),
});

describe("publication events (FR-SI-02, D16)", () => {
  it("GUIDE-DB-01: the committed sync revision has a Pending event that a later process can claim; superseded events close", async () => {
    const { sourceId } = await resynced();
    const events = (await sync.claimPendingPublicationEvents(db.pool, 100)).filter((e) => e.source_id === sourceId);
    expect(events.map((e) => e.revision)).toEqual([2]);
    const closed = await db.pool.query("SELECT revision, status FROM source_publication_events WHERE source_id = $1 ORDER BY revision", [sourceId]);
    expect(closed.rows).toEqual([{ revision: 1, status: "Done" }, { revision: 2, status: "Pending" }]);
    await sync.completePublicationEvent(db.pool, events[0]!.id);
    expect((await sync.claimPendingPublicationEvents(db.pool, 100)).some((e) => e.source_id === sourceId)).toBe(false);
  });
});

describe("Guide publication fence (FR-SI-02, FR-SI-05)", () => {
  it("GUIDE-DB-02: a guide for the replaced revision finishing late is not stored; the current revision's guide is", async () => {
    const { nb, sourceId } = await resynced();
    await runWithV2Persistence(db.pool, async () => {
      await saveSourceGuide(guide(nb, sourceId, 1));
      expect(await getSourceGuide(nb, sourceId, 1, "en")).toBeNull();
      await saveSourceGuide(guide(nb, sourceId, 2));
      expect((await getSourceGuide(nb, sourceId, 2, "en"))?.summary_md).toBe("Summary of revision 2.");
    });
  });
});
