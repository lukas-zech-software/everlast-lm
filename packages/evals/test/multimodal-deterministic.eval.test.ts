import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCX_MEDIA_TYPE } from "@everlast/contracts";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import {
  acceptReceivedSource,
  admitLinkedImport,
  createNotebook,
  deleteSource,
  getSourceById,
  requestSourceSync,
  reserveSources,
} from "@everlast/db";
import { createTestDatabase, createTestUser, type TestDatabase } from "@everlast/db/testing";
import { ChatService, type TurnObservation } from "@everlast/api/chat/service";
import { createOfficeAdapter } from "@everlast/worker/ingestion/office";
import { createAudioAdapter } from "@everlast/worker/ingestion/media";
import { createWebAdapter, type Transport } from "@everlast/worker/ingestion/web";
import { processIngestJob, type IngestionDeps } from "@everlast/worker/ingestion/pipeline";
import { processSyncJob } from "@everlast/worker/ingestion/sync";
import { articleHtml, docxFixture, interviewMp3, interviewWords, roadmapHtml } from "../src/fixtures/multimodal-ingestion.ts";
import { AdversarialCitingModel, LexicalCitingModel } from "../src/deterministic-models.ts";
import { judgeMetric, ratio } from "../src/metrics.ts";

/**
 * [009-multimodal-ingestion-sync] T048 — deterministic every-PR evals over mixed-modality sources (FR-GC-02,
 * NFR-EVAL-02/04; spec FR-014, FR-015, SC-007): Office (page_span), web (dom_path), audio (time_span) and a re-synced
 * web source go through the real ingestion pipeline, C-02 retrieval and the D13 verifier with deterministic model
 * doubles. Citation-ID precision must be 1.0 (every published ID was retrieved for that turn) and leakage 0 (no
 * deselected, removed or replaced-revision chunk is retrieved, prompted or cited). Answer quality is out of scope
 * here (judged release suite, NFR-EVAL-01/03).
 */

let db: TestDatabase;
let dir: string;
let owner: string;
let nb: string;
let month: "May" | "June" = "May";
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
let deps: IngestionDeps;
const ids: Record<string, string> = {};

const transport: Transport = {
  async request(req) {
    const body = req.url.pathname.includes("roadmap") ? roadmapHtml(month) : articleHtml();
    return { status: 200, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from(body); })() };
  },
};

async function upload(name: string, mediaType: string, bytes: Buffer): Promise<string> {
  const attempt = randomUUID();
  const [r] = await reserveSources(db.pool, owner, nb, [{ attempt_id: attempt, title: name, media_type: mediaType, declared_bytes: bytes.length }]);
  const source = r!.source!;
  const name_ = `notebooks/${nb}/sources/${source.id}/raw`;
  const written = await deps.storage.write(name_, bytes, mediaType);
  await acceptReceivedSource(db.pool, { sourceId: source.id, attemptId: attempt, actualBytes: written.size, objectName: name_, objectGeneration: written.generation });
  await processIngestJob(deps, { source_id: source.id, attempt_id: attempt });
  return source.id;
}

async function linked(url: string): Promise<string> {
  const a = await admitLinkedImport(db.pool, owner, nb, { attempt_id: randomUUID(), kind: "web", url });
  await processIngestJob(deps, { source_id: a.source.id, attempt_id: a.source.attempt_id, operation_id: a.operation.operation_id });
  return a.source.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), "everlast-mm-eval-"));
  owner = await createTestUser(db.pool);
  nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  deps = {
    pool: db.pool,
    storage: new LocalObjectStorage({ root: dir, publicBaseUrl: "http://localhost" }),
    embedder,
    ocr: { name: "none", recognize: async () => new Map() },
    adapters: {
      office: createOfficeAdapter({}),
      audio: createAudioAdapter({ transcriber: { name: "fixture-asr", transcribe: async () => ({ words: interviewWords() }) } }),
      web: createWebAdapter({ resolver: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } }),
    },
    screener: { name: "clean", screen: async () => ({ verdict: "clean" }) },
  };
  ids.docx = await upload("Falcon.docx", DOCX_MEDIA_TYPE, docxFixture());
  ids.audio = await upload("Interview.mp3", "audio/mpeg", interviewMp3());
  ids.web = await linked("https://news.example.test/articles/depot-automation");
  ids.roadmap = await linked("https://intranet.example.test/roadmap");
  ids.removed = await linked("https://news.example.test/articles/removed");
  for (const id of Object.values(ids)) expect((await getSourceById(db.pool, id))!.status).toBe("Ready");
});

afterAll(async () => {
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

const QUESTIONS: { q: string; active: () => string[] }[] = [
  { q: "What is the Falcon programme budget for phase two?", active: () => [ids.docx!, ids.web!] },
  { q: "Why does the budget review move to Thursday?", active: () => [ids.audio!] },
  { q: "How did automating the northern depot change loading time?", active: () => [ids.web!, ids.audio!] },
  { q: "When is Release v1 in the roadmap?", active: () => [ids.roadmap!] },
  { q: "What speaker notes mention the vendor contract?", active: () => [ids.audio!] },
];

describe("mixed-modality deterministic evals (NFR-EVAL-02/04)", () => {
  it("MM-EVAL-01: citation-ID precision is 1.0 and leakage 0 across Office, web, audio, deselection, removal and re-sync", async () => {
    // Invalidation cases: one source removed, the roadmap re-synced May → June (revision 1 must never be used again).
    await deleteSource(db.pool, owner, nb, ids.removed!);
    month = "June";
    const { operation } = await requestSourceSync(db.pool, owner, nb, ids.roadmap!, { attemptId: randomUUID(), trigger: "manual" });
    expect(await processSyncJob(deps, { operation_id: operation.operation_id })).toMatchObject({ status: "synced", revision: 2 });

    const observations: TurnObservation[] = [];
    const lexical = new ChatService({ pool: db.pool, embedder, model: new LexicalCitingModel(), observer: (o) => observations.push(o) });
    let published = 0;
    let valid = 0;
    let leaks = 0;
    const failing: string[] = [];
    for (const { q, active } of QUESTIONS) {
      const selection = active();
      for await (const event of lexical.runTurn({ ownerId: owner, notebookId: nb, message: q, activeSourceIds: selection, requestId: randomUUID() })) {
        if (event.type !== "final") continue;
        const obs = observations.at(-1)!;
        const retrieved = new Set(obs.retrieved.map((c) => c.chunk_id));
        for (const m of event.messages.filter((x) => x.role === "assistant")) {
          for (const c of m.citations) {
            published++;
            if (retrieved.has(c.chunk_id) && selection.includes(c.source_id)) valid++;
            else failing.push(`${q}:${c.chunk_id}`);
          }
        }
        for (const c of obs.retrieved) {
          const outOfScope = !selection.includes(c.source_id) || c.source_id === ids.removed || (c.source_id === ids.roadmap && c.revision !== 2);
          if (outOfScope) leaks++;
        }
        if (obs.modelInput?.chunks.some((c) => c.text.includes("Release v1 in May"))) leaks++;
      }
    }
    const precision = judgeMetric("citation_precision", ratio(valid, published, "citation_precision"), { numerator: valid, denominator: published, failing_cases: failing });
    const leakage = judgeMetric("scoping_leakage_count", leaks, { failing_cases: [] });
    expect(published).toBeGreaterThan(0);
    expect(precision).toMatchObject({ status: "pass", value: 1 });
    expect(leakage).toMatchObject({ status: "pass", value: 0 });
  });

  it("MM-EVAL-02: an adversarial model citing removed, replaced or deselected chunks never publishes them (D13)", async () => {
    const foreign = async () => {
      const rows = await db.pool.query<{ chunk_id: string }>(
        "SELECT chunk_id FROM chunks WHERE notebook_id = $1 AND (source_id = $2 OR (source_id = $3 AND revision = 1))",
        [nb, ids.docx, ids.roadmap]
      );
      return rows.rows.map((r) => r.chunk_id);
    };
    const foreignIds = await foreign();
    expect(foreignIds.length).toBeGreaterThan(0);
    const model = new AdversarialCitingModel(() => foreignIds);
    const service = new ChatService({ pool: db.pool, embedder, model });
    for (const selection of [[ids.web!], [ids.audio!], [ids.roadmap!]]) {
      for await (const event of service.runTurn({ ownerId: owner, notebookId: nb, message: "Tell me about the depot.", activeSourceIds: selection, requestId: randomUUID() })) {
        if (event.type !== "final") continue;
        const answer = event.messages.find((m) => m.role === "assistant")!;
        expect(answer.kind).toBe("refusal");
        expect(answer.citations.filter((c) => foreignIds.includes(c.chunk_id))).toEqual([]);
      }
    }
    expect(model.attempts).toBe(3);
  });
});
