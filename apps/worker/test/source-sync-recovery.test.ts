import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admitLinkedImport, claimSourceOperation, commitSyncReplacement, getSourceById, requestSourceSync } from "@everlast/db";
import { roadmapHtml } from "@everlast/testkit/multimodal-fixtures";
import { processIngestJob, type IngestionDeps } from "../src/ingestion/pipeline.ts";
import { processSyncJob } from "../src/ingestion/sync.ts";
import { createWebAdapter, type Transport } from "../src/ingestion/web.ts";
import { FixtureOcr, createWorkerHarness, type WorkerHarness } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T036 (worker) — re-sync executor recovery (FR-SI-02/05, C-02; spec FR-011..FR-015,
 * SC-004, SC-006, SC-008): transport redelivery of the same operation never runs twice or duplicates a revision; an
 * expired lease is reclaimed under a new fencing token and the stale worker cannot publish; every failure class keeps
 * the committed revision and slot; a committed sync leaves a durable Guide event before any dispatch happens.
 */

let h: WorkerHarness;
let page: { status: number; body: string } = { status: 200, body: roadmapHtml("May") };
let delayMs = 0;
const transport: Transport = {
  async request() {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const p = page;
    return { status: p.status, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from(p.body); })() };
  },
};
const clean = { name: "clean", screen: async () => ({ verdict: "clean" as const }) };
let deps: IngestionDeps;

beforeAll(async () => {
  h = await createWorkerHarness();
  deps = {
    pool: h.db.pool,
    storage: h.storage,
    embedder: h.embedder,
    ocr: new FixtureOcr(),
    adapters: { web: createWebAdapter({ resolver: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } }) },
    screener: clean,
  };
});
afterAll(async () => {
  await h?.close();
});

async function readySource() {
  page = { status: 200, body: roadmapHtml("May") };
  const nb = await h.newNotebook();
  const admitted = await admitLinkedImport(h.db.pool, h.ownerId, nb, { attempt_id: randomUUID(), kind: "web", url: "https://intranet.example.test/roadmap" });
  await processIngestJob(deps, { source_id: admitted.source.id, attempt_id: admitted.source.attempt_id, operation_id: admitted.operation.operation_id });
  return (await getSourceById(h.db.pool, admitted.source.id))!;
}

const requestSync = async (s: { notebook_id: string; id: string }) =>
  (await requestSourceSync(h.db.pool, h.ownerId, s.notebook_id, s.id, { attemptId: randomUUID(), trigger: "manual" })).operation.operation_id;

const chunkText = async (sourceId: string, revision: number) =>
  (await h.db.pool.query("SELECT string_agg(text, ' ') AS t FROM chunks WHERE source_id = $1 AND revision = $2", [sourceId, revision])).rows[0].t as string | null;

describe("redelivery and lease recovery (FR-SI-05)", () => {
  it("RECOVER-01: two deliveries of one operation run once; a later redelivery is a no-op; exactly one new revision", async () => {
    const source = await readySource();
    const op = await requestSync(source);
    page = { status: 200, body: roadmapHtml("June") };
    delayMs = 100;
    const [a, b] = await Promise.all([processSyncJob(deps, { operation_id: op }), processSyncJob(deps, { operation_id: op })]);
    delayMs = 0;
    expect([a.status, b.status].sort()).toEqual(["busy", "synced"]);
    expect((await processSyncJob(deps, { operation_id: op })).status).toBe("stale");
    const revs = await h.db.pool.query("SELECT revision FROM source_revisions WHERE source_id = $1 ORDER BY revision", [source.id]);
    expect(revs.rows.map((r) => r.revision)).toEqual([1, 2]);
    expect(await chunkText(source.id, 2)).toContain("June");
  });

  it("RECOVER-02: a crashed worker's expired lease is reclaimed; its stale fencing token can no longer publish", async () => {
    const source = await readySource();
    const op = await requestSync(source);
    const crashed = (await claimSourceOperation(h.db.pool, op, { leaseSeconds: 60 })) as { fencingToken: number };
    await h.db.pool.query("UPDATE source_operations SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [op]);
    page = { status: 200, body: roadmapHtml("June") };
    expect(await processSyncJob(deps, { operation_id: op })).toMatchObject({ status: "synced", revision: 2 });
    const late = await commitSyncReplacement(h.db.pool, {
      operationId: op,
      fencingToken: crashed.fencingToken,
      sourceId: source.id,
      expectedRevision: 1,
      byteSize: 1,
      wordCount: 1,
      pageCount: 1,
      embeddingModel: "t",
      contentHash: "stale",
      pages: [{ page_number: 1, text: "x" }],
      chunks: [{ chunk: { chunk_id: "0192a6b0-0000-7000-8000-0000000000aa", source_id: source.id, revision: 2, locator: { page_number: 1, start_offset: 0, end_offset: 1 }, token_count: 1, text: "x" }, embedding: Array(768).fill(0) }],
    });
    expect(late.published).toBe(false);
  });
});

describe("failures keep the committed revision (FR-SI-05, SC-004)", () => {
  it("RECOVER-03: HTTP 503, unextractable content, embedding errors, screening errors and quarantine all keep the May revision and slot", async () => {
    const cases: { name: string; setup: () => void; deps?: Partial<IngestionDeps> }[] = [
      { name: "http-503", setup: () => (page = { status: 503, body: "busy" }) },
      { name: "parse", setup: () => (page = { status: 200, body: "<html><body><nav>Home</nav></body></html>" }) },
      { name: "embedding", setup: () => (page = { status: 200, body: roadmapHtml("June") }), deps: { embedder: { model: "x", embed: async () => { throw new Error("embedding outage"); } } as never } },
      { name: "screen-error", setup: () => (page = { status: 200, body: roadmapHtml("June") }), deps: { screener: { name: "down", screen: async () => { throw new Error("503"); } } } },
      { name: "quarantine", setup: () => (page = { status: 200, body: roadmapHtml("June") }), deps: { screener: { name: "armor", screen: async () => ({ verdict: "quarantined" }) } } },
    ];
    for (const c of cases) {
      const source = await readySource();
      const occupied = (await h.db.pool.query("SELECT count(*)::int AS n FROM sources WHERE notebook_id = $1 AND status <> 'Failed'", [source.notebook_id])).rows[0].n;
      const op = await requestSync(source);
      c.setup();
      const outcome = await processSyncJob({ ...deps, ...c.deps }, { operation_id: op }, 8);
      expect(outcome.status, c.name).toBe("failed");
      const after = (await getSourceById(h.db.pool, source.id))!;
      expect(after, c.name).toMatchObject({ status: "Ready", active_revision: 1, progress: null });
      expect(await chunkText(source.id, 1), c.name).toContain("May");
      expect((await h.db.pool.query("SELECT count(*)::int AS n FROM sources WHERE notebook_id = $1 AND status <> 'Failed'", [source.notebook_id])).rows[0].n).toBe(occupied);
    }
  });

  it("RECOVER-04: a committed sync durably records the Guide event for the new revision before any dispatch", async () => {
    const source = await readySource();
    const op = await requestSync(source);
    page = { status: 200, body: roadmapHtml("June") };
    await processSyncJob(deps, { operation_id: op });
    const events = await h.db.pool.query("SELECT revision, status FROM source_publication_events WHERE source_id = $1 ORDER BY revision", [source.id]);
    expect(events.rows).toEqual([{ revision: 1, status: "Pending" }, { revision: 2, status: "Pending" }]);
  });
});
