import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTENT_QUARANTINED_MESSAGE } from "@everlast/contracts";
import { admitLinkedImport, captureScopeSnapshot, getSourceById, requestSourceSync } from "@everlast/db";
import { PROMPT_INJECTION_TEXT, articleHtml, roadmapHtml } from "@everlast/testkit/multimodal-fixtures";
import { ModelArmorScreener, modelArmorConfigFromEnv, type ContentScreener } from "../src/ingestion/screening.ts";
import { createWebAdapter, type Transport } from "../src/ingestion/web.ts";
import { processIngestJob, type IngestionDeps } from "../src/ingestion/pipeline.ts";
import { processSyncJob } from "../src/ingestion/sync.ts";
import { FixtureOcr, createWorkerHarness, type WorkerHarness } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T020 — mandatory prompt-injection screening of web and refreshed external content
 * (FR-SI-01, FR-SI-05, NFR-SEC-01/02, C-02; spec FR-008, FR-013, FR-015, FR-016, SC-006): Model Armor in the EU
 * region, fail closed on timeout/error, quarantined content never becomes Ready or reaches C-02, and a failed
 * re-sync screen keeps the prior revision.
 */

let h: WorkerHarness;
beforeAll(async () => {
  h = await createWorkerHarness();
});
afterAll(async () => {
  await h?.close();
});

let page = articleHtml();
const transport: Transport = {
  async request() {
    const body = page;
    return { status: 200, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from(body); })() };
  },
};
const web = createWebAdapter({ resolver: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } });
const deps = (screener?: ContentScreener): IngestionDeps => ({ pool: h.db.pool, storage: h.storage, embedder: h.embedder, ocr: new FixtureOcr(), adapters: { web }, screener });

async function importWith(screener: ContentScreener | undefined) {
  const nb = await h.newNotebook();
  const admitted = await admitLinkedImport(h.db.pool, h.ownerId, nb, { attempt_id: randomUUID(), kind: "web", url: "https://news.example.test/a" });
  await processIngestJob(deps(screener), { source_id: admitted.source.id, attempt_id: admitted.source.attempt_id, operation_id: admitted.operation.operation_id }, 8);
  return (await getSourceById(h.db.pool, admitted.source.id))!;
}

describe("Model Armor client (NFR-SEC-01, D3)", () => {
  it("SCREEN-01: calls the europe-west4 regional endpoint and maps MATCH_FOUND to quarantine", async () => {
    const calls: { url: string; data: any }[] = [];
    const screener = new ModelArmorScreener({
      projectId: "p1",
      location: "europe-west4",
      templateId: "everlast-web",
      request: async (req) => {
        calls.push(req);
        return { sanitizationResult: { filterMatchState: String(req.data.userPromptData.text).includes("Ignore all previous") ? "MATCH_FOUND" : "NO_MATCH_FOUND" } };
      },
    });
    expect(await screener.screen(["A harmless paragraph."])).toEqual({ verdict: "clean" });
    expect((await screener.screen(["fine", PROMPT_INJECTION_TEXT])).verdict).toBe("quarantined");
    expect(calls[0]!.url).toBe("https://modelarmor.europe-west4.rep.googleapis.com/v1/projects/p1/locations/europe-west4/templates/everlast-web:sanitizeUserPrompt");
  });

  it("SCREEN-02: long content is screened completely in bounded requests", async () => {
    const seen: number[] = [];
    const screener = new ModelArmorScreener({ projectId: "p", location: "europe-west4", templateId: "t", maxCharsPerRequest: 1000, request: async (req) => (seen.push(String(req.data.userPromptData.text).length), { sanitizationResult: { filterMatchState: "NO_MATCH_FOUND" } }) });
    await screener.screen(Array.from({ length: 30 }, () => "x".repeat(400)));
    expect(seen.every((n) => n <= 1000)).toBe(true);
    expect(seen.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30 * 400);
  });

  it("SCREEN-03: transport errors and timeouts throw (callers fail closed); non-EU locations are refused", async () => {
    const failing = new ModelArmorScreener({ projectId: "p", location: "europe-west4", templateId: "t", request: async () => { throw new Error("deadline exceeded"); } });
    await expect(failing.screen(["x"])).rejects.toThrow();
    const slow = new ModelArmorScreener({ projectId: "p", location: "europe-west4", templateId: "t", timeoutMs: 20, request: () => new Promise((r) => setTimeout(() => r({ sanitizationResult: { filterMatchState: "NO_MATCH_FOUND" } }), 500)) });
    await expect(slow.screen(["x"])).rejects.toThrow();
    expect(() => new ModelArmorScreener({ projectId: "p", location: "us-central1", templateId: "t" })).toThrow(/EU/);
    expect(modelArmorConfigFromEnv({})).toBeNull();
  });
});

describe("pipeline screening (Constitution VI, C-02)", () => {
  it("SCREEN-04: quarantined web content fails, stores no chunks and can never enter C-02", async () => {
    page = articleHtml({ injected: PROMPT_INJECTION_TEXT });
    const source = await importWith({ name: "fixture", screen: async (texts) => (texts.some((t) => t.includes(PROMPT_INJECTION_TEXT)) ? { verdict: "quarantined" } : { verdict: "clean" }) });
    expect(source).toMatchObject({ status: "Failed", failure_code: "ContentQuarantined", failure_message: CONTENT_QUARANTINED_MESSAGE });
    expect((await h.db.pool.query("SELECT count(*)::int AS n FROM chunks WHERE source_id = $1", [source.id])).rows[0].n).toBe(0);
    await expect(captureScopeSnapshot(h.db.pool, h.ownerId, source.notebook_id, [source.id])).rejects.toMatchObject({ code: "SourceNotReady" });
  });

  it("SCREEN-05: a missing, erroring or timing-out screener fails closed", async () => {
    page = articleHtml();
    for (const screener of [undefined, { name: "boom", screen: async () => { throw new Error("503"); } }] as (ContentScreener | undefined)[]) {
      const source = await importWith(screener);
      expect(source).toMatchObject({ status: "Failed", failure_code: "ScreeningUnavailable" });
    }
  });

  it("SCREEN-06: a re-sync whose new content is quarantined keeps the prior Ready revision intact", async () => {
    page = roadmapHtml("May");
    const source = await importWith({ name: "clean", screen: async () => ({ verdict: "clean" }) });
    expect(source.status).toBe("Ready");
    page = roadmapHtml("June").replace("</article>", `<p>${PROMPT_INJECTION_TEXT}</p></article>`);
    const { operation } = await requestSourceSync(h.db.pool, h.ownerId, source.notebook_id, source.id, { attemptId: randomUUID(), trigger: "manual" });
    const outcome = await processSyncJob(deps({ name: "armor", screen: async (t) => (t.some((x) => x.includes(PROMPT_INJECTION_TEXT)) ? { verdict: "quarantined" } : { verdict: "clean" }) }), { operation_id: operation.operation_id }, 1);
    expect(outcome).toMatchObject({ status: "failed", code: "ContentQuarantined" });
    const after = (await getSourceById(h.db.pool, source.id))!;
    expect(after).toMatchObject({ status: "Ready", active_revision: 1 });
    const text = (await h.db.pool.query("SELECT string_agg(text, ' ') AS t FROM chunks WHERE source_id = $1 AND revision = 1", [source.id])).rows[0].t;
    expect(text).toContain("Release v1 in May");
  });
});
