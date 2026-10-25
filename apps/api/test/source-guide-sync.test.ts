import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@everlast/contracts";
import { claimSourceOperation, commitSyncReplacement, getSourceGuide, requestSourceSync, resetPackageV22Store, runWithV2Persistence } from "@everlast/db";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { createV2Runtime } from "../src/v2/runtime.ts";

/**
 * [009-multimodal-ingestion-sync] T036 (runtime) — Source Guide regeneration after re-sync survives restarts
 * (FR-SI-02/05, C-02, D16; spec FR-011, FR-014, FR-015, SC-008): a new process drains the durable publication event
 * and generates exactly one guide for the exact new revision/language through the app-scoped pool, even when the
 * Ready transition is older than the watcher lookback and nobody reopens the source; an existing Ready guide of
 * that revision/language is reused, never regenerated because a process restarted.
 */

let db: TestDatabase;
let owner: string;
const vec = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const calls: { source_id: string; revision: number }[] = [];
const generation: StructuredGenerationClient = {
  async generateSourceGuide({ source }) {
    calls.push({ source_id: source.source_id, revision: source.revision });
    return { summary_md: `Release v1 happens in ${source.chunks.map((c) => c.text).join(" ").includes("June") ? "June" : "May"}.`, key_topics: ["Release"], supporting_chunk_ids: [source.chunks[0]!.chunk_id] };
  },
  async generateOverview() {
    throw new Error("unused");
  },
  async generateFollowUps() {
    throw new Error("unused");
  },
};

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
});
afterAll(async () => {
  await db?.drop();
});

async function syncedSource() {
  const nb = (await db.pool.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, 'NB') RETURNING id", [randomUUID(), owner])).rows[0].id as string;
  const { sourceId } = await seedReadySource(db.pool, owner, nb, { pages: ["Release v1 in May."], embed: async (t) => t.map(() => vec), mediaType: "text/plain" });
  await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://intranet.corp/r', media_type = 'text/html' WHERE id = $1", [sourceId]);
  await db.pool.query("UPDATE source_publication_events SET status = 'Done' WHERE source_id = $1", [sourceId]);
  const { operation } = await requestSourceSync(db.pool, owner, nb, sourceId, { attemptId: randomUUID(), trigger: "manual" });
  const claim = (await claimSourceOperation(db.pool, operation.operation_id, { leaseSeconds: 60 })) as { fencingToken: number };
  const text = "Release v1 in June.";
  await commitSyncReplacement(db.pool, {
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
  // The commit happened "long ago": far outside the 30 s Ready-watcher lookback.
  await db.pool.query("UPDATE sources SET updated_at = now() - interval '2 hours' WHERE id = $1", [sourceId]);
  return { nb, sourceId };
}

describe("durable Guide regeneration after re-sync (FR-SI-02, D16)", () => {
  it("GUIDE-RT-01: a freshly started process regenerates the guide for revision 2 once, without any user reopen", async () => {
    const { nb, sourceId } = await syncedSource();
    resetPackageV22Store();
    const runtime = createV2Runtime({ pool: db.pool, sourceLimit: 50, generation });
    try {
      await runtime.drainPublicationEvents();
      await runtime.drainPublicationEvents();
      // Any output language: the owner's effective language is resolved by the runtime (FR-UI-02).
      const guide = await runWithV2Persistence(db.pool, () => getSourceGuide(nb, sourceId, 2));
      expect(guide).toMatchObject({ status: "GuideReady", revision: 2, summary_md: "Release v1 happens in June." });
      expect(calls.filter((c) => c.source_id === sourceId)).toEqual([{ source_id: sourceId, revision: 2 }]);
      const events = await db.pool.query("SELECT revision, status FROM source_publication_events WHERE source_id = $1 AND revision = 2", [sourceId]);
      expect(events.rows).toEqual([{ revision: 2, status: "Done" }]);
    } finally {
      runtime.close();
    }
  });

  it("GUIDE-RT-02: after another restart the existing Ready guide is reused, not regenerated", async () => {
    const { sourceId } = await syncedSource();
    const first = createV2Runtime({ pool: db.pool, sourceLimit: 50, generation });
    await first.drainPublicationEvents();
    first.close();
    await db.pool.query("UPDATE source_publication_events SET status = 'Pending' WHERE source_id = $1 AND revision = 2", [sourceId]);
    const before = calls.length;
    resetPackageV22Store();
    const second = createV2Runtime({ pool: db.pool, sourceLimit: 50, generation });
    try {
      await second.drainPublicationEvents();
      expect(calls.length).toBe(before);
    } finally {
      second.close();
    }
  });
});
