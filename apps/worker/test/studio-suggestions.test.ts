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
