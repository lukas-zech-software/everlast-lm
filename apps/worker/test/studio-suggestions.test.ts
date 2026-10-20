import { describe, it, expect } from "vitest";
import type { SourceGuideState } from "@everlast/contracts";
import { ReportSuggestionService } from "../src/studio/reports/suggestions.ts";
import { DeterministicReportModel } from "../src/studio/reports/deterministic-model.ts";
import type { ReportSuggestionModel } from "../src/studio/reports/model.ts";
import { FakeGuides, NB, OWNER, VENDOR_A, VENDOR_B } from "./studio-fixtures.ts";

const snap = [VENDOR_A, VENDOR_B].map((source_id) => ({ source_id, revision: 1 }));
const ready = (id: string): SourceGuideState => ({ source_id: id, revision: 1, status: "Ready", summary: "s", key_topics: ["architecture"] });
const req = (snapshot = snap, output_language?: string) => ({ notebook_id: NB, owner_id: OWNER, snapshot, output_language });

describe("ReportSuggestionService (FR-ST-11, FR-009, FR-018)", () => {
  it("returns 3–4 suggestions within 3 s and caches by identity", async () => {
    let calls = 0;
    const model = new DeterministicReportModel();
    const counting: ReportSuggestionModel = { suggest: (r) => (calls++, model.suggest(r)) };
    const svc = new ReportSuggestionService({ guides: new FakeGuides(new Map([[VENDOR_A, ready(VENDOR_A)], [VENDOR_B, ready(VENDOR_B)]])), model: counting });
    const t0 = Date.now();
    const first = await svc.getSuggestions(req());
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(first.state === "SuggestionsReady" && first.suggestions.length >= 3).toBe(true);
    await svc.getSuggestions(req());
    expect(calls).toBe(1);
    await svc.getSuggestions(req([{ source_id: VENDOR_A, revision: 1 }]));
    await svc.getSuggestions(req(snap, "de"));
    expect(calls).toBe(3);
  });
  it("Pending guide → loading and is not cached; Failed → unavailable", async () => {
    const guides = new FakeGuides(new Map());
    const svc = new ReportSuggestionService({ guides, model: new DeterministicReportModel() });
    expect((await svc.getSuggestions(req())).state).toBe("SuggestionsLoading");
    guides.states = new Map([[VENDOR_A, ready(VENDOR_A)], [VENDOR_B, ready(VENDOR_B)]]);
    expect((await svc.getSuggestions(req())).state).toBe("SuggestionsReady");
    guides.states = new Map([[VENDOR_A, { source_id: VENDOR_A, revision: 1, status: "Failed" }]]);
    expect((await svc.getSuggestions(req([{ source_id: VENDOR_A, revision: 1 }]))).state).toBe("SuggestionsUnavailable");
  });
  it("model timeout or invalid count → unavailable", async () => {
    const ok = new FakeGuides(new Map([[VENDOR_A, ready(VENDOR_A)]]));
    const one = [{ source_id: VENDOR_A, revision: 1 }];
    const base = new DeterministicReportModel();
    const slow: ReportSuggestionModel = { suggest: () => new Promise(() => undefined) };
    expect((await new ReportSuggestionService({ guides: ok, model: slow, timeoutMs: 20 }).getSuggestions(req(one))).state).toBe("SuggestionsUnavailable");
    const few: ReportSuggestionModel = { suggest: async () => (await base.suggest({ guides: [], signal: new AbortController().signal })).slice(0, 2) };
    expect((await new ReportSuggestionService({ guides: ok, model: few }).getSuggestions(req(one))).state).toBe("SuggestionsUnavailable");
  });
});

/**
 * [008-studio-text-reports] T044 — Flash-Lite suggestions through the Package 2.2 Vertex structured-generation
 * client (`[006-source-guide-chat-control] T075`; the client is a FAKE, no network, no second Vertex client).
 * Per FR-ST-11, FR-009, FR-018, US2/AC1, US2/AC5, model routing (Flash-Lite); owner default 2026-10-20:
 * without a configured model, suggestions are unavailable, never an endless loading state.
 */
describe("Flash-Lite report suggestions on the Package 2.2 client (FR-ST-11, FR-009, FR-018)", () => {
  const load = () => import("../src/studio/reports/suggestions.ts");
  const VENDOR_C_ID = "99999999-9999-4999-8999-999999999999";
  const vendors = [VENDOR_A, VENDOR_B, VENDOR_C_ID];
  const vendorGuide = (id: string, i: number): SourceGuideState => ({ source_id: id, revision: 1, status: "Ready", summary: `Vendor ${i} proposes architecture ${i}.`, key_topics: [`architecture ${i}`, "risk"] });
  const card = (n: number) => ({ title: `Format ${n}`, description: `Compare vendor proposals ${n}.`, prompt_template: `Write report ${n} comparing the vendor architectures.` });
  const three = vendors.map((source_id) => ({ source_id, revision: 1 }));

  function client(result: () => Promise<unknown>) {
    const inputs: any[] = [];
    return { inputs, generateReportSuggestions: (input: unknown) => (inputs.push(input), result() as Promise<any>) };
  }
  function guidesFor(states: SourceGuideState[]) {
    const languages: (string | undefined)[] = [];
    return { languages, getGuides: async (_nb: string, snap: { source_id: string; revision: number }[], lang?: string) => (languages.push(lang), snap.map((p) => states.find((s) => s.source_id === p.source_id) ?? { ...p, status: "Pending" as const })) };
  }

  it("three vendor guides yield 3–4 cards derived only from those guides, in the effective language, within 3 s", async () => {
    const { ReportSuggestionService, structuredSuggestionModel } = await load();
    const c = client(async () => ({ suggestions: [card(1), card(2), card(3)] }));
    const guides = guidesFor(vendors.map(vendorGuide));
    const svc = new ReportSuggestionService({ guides, model: structuredSuggestionModel(c) });
    const t0 = Date.now();
    const result = await svc.getSuggestions(req(three, "de-DE"));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(result).toEqual({ state: "SuggestionsReady", suggestions: [card(1), card(2), card(3)] });
    expect(guides.languages).toEqual(["de-DE"]);
    expect(c.inputs[0].output_language).toBe("de-DE");
    expect(c.inputs[0].guides).toEqual(vendors.map((id, i) => ({ source_id: id, summary: vendorGuide(id, i).summary, key_topics: vendorGuide(id, i).key_topics })));
  });

  it("fewer than 3, more than 4, invalid cards, a failure or a timeout → SuggestionsUnavailable", async () => {
    const { ReportSuggestionService, structuredSuggestionModel } = await load();
    const run = async (result: () => Promise<unknown>, timeoutMs?: number) =>
      (await new ReportSuggestionService({ guides: guidesFor(vendors.map(vendorGuide)), model: structuredSuggestionModel(client(result)), ...(timeoutMs ? { timeoutMs } : {}) }).getSuggestions(req(three))).state;
    expect(await run(async () => ({ suggestions: [card(1), card(2)] }))).toBe("SuggestionsUnavailable");
    expect(await run(async () => ({ suggestions: [1, 2, 3, 4, 5].map(card) }))).toBe("SuggestionsUnavailable");
    expect(await run(async () => ({ suggestions: [card(1), card(2), { ...card(3), prompt_template: "   " }] }))).toBe("SuggestionsUnavailable");
    expect(await run(async () => Promise.reject(new Error("upstream")))).toBe("SuggestionsUnavailable");
    expect(await run(() => new Promise(() => undefined), 20)).toBe("SuggestionsUnavailable");
  });

  it("pending guides → SuggestionsLoading, not cached and no model call", async () => {
    const { ReportSuggestionService, structuredSuggestionModel } = await load();
    const c = client(async () => ({ suggestions: [card(1), card(2), card(3)] }));
    const states: SourceGuideState[] = [];
    const svc = new ReportSuggestionService({ guides: guidesFor(states), model: structuredSuggestionModel(c) });
    expect((await svc.getSuggestions(req(three))).state).toBe("SuggestionsLoading");
    expect(c.inputs).toHaveLength(0);
    states.push(...vendors.map(vendorGuide));
    expect((await svc.getSuggestions(req(three))).state).toBe("SuggestionsReady");
  });

  it("without a configured model, suggestions are unavailable even while guides are pending (never endless loading)", async () => {
    const { ReportSuggestionService, structuredSuggestionModel } = await load();
    expect(structuredSuggestionModel(undefined)).toBeUndefined();
    expect(structuredSuggestionModel({})).toBeUndefined();
    const svc = new ReportSuggestionService({ guides: guidesFor([]) });
    expect(await svc.getSuggestions(req(three))).toMatchObject({ state: "SuggestionsUnavailable", reason: expect.stringMatching(/unavailable/i) });
  });

  it("the Vertex client generates suggestions with Flash-Lite and a JSON schema from guide metadata only", async () => {
    const { VertexStructuredGenerationClient, StructuredGenerationError } = await import("../src/package-v2-2-gemini.ts");
    const requests: any[] = [];
    const responses = [JSON.stringify({ suggestions: [card(1), card(2), card(3)] }), JSON.stringify({ suggestions: [card(1)] })];
    const vertex = new VertexStructuredGenerationClient({
      project: "everlast-eu",
      createClient: () => ({ models: { generateContent: async (r) => (requests.push(r), { text: responses.shift() }) } }),
    });
    const input = { guides: [{ source_id: VENDOR_A, summary: "Vendor Alpha proposes a monolith.", key_topics: ["monolith"] }], output_language: "en-US" };
    expect((await vertex.generateReportSuggestions(input)).suggestions).toHaveLength(3);
    expect(requests[0].model).toBe("gemini-2.5-flash-lite");
    expect(requests[0].config).toMatchObject({ temperature: 0, responseMimeType: "application/json" });
    expect(JSON.parse(requests[0].contents)).toMatchObject({ output_language: "en-US", guides: input.guides });
    await expect(vertex.generateReportSuggestions(input)).rejects.toBeInstanceOf(StructuredGenerationError);
  });
});
