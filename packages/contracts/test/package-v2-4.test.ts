import { describe, it, expect } from "vitest";
import {
  CreateStudioJobRequestSchema,
  CustomReportPromptSchema,
  ReportSuggestionsResultSchema,
  StudioArtifactSchema,
  StudioPluginRegistry,
  canTransitionStudioStatus,
  validateCustomReportPrompt,
  type StudioGeneratorPlugin,
} from "../src/index.ts";

const NB = "11111111-1111-4111-8111-111111111111";
const SRC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHUNK = "01890000-0000-7000-8000-000000000001";
const NOW = "2026-10-19T10:00:00.000Z";

const base = {
  id: "22222222-2222-4222-8222-222222222222",
  notebook_id: NB,
  plugin_type: "report" as const,
  subtype: "briefing_doc" as const,
  title: "Briefing doc",
  params_json: {},
  active_source_ids_snapshot: [{ source_id: SRC_A, revision: 1 }],
  output_language: null,
  progress: null,
  failure: null,
  payload_json: null,
  attempt: 1,
  retry_of: null,
  created_at: NOW,
  updated_at: NOW,
};

describe("C-03 lifecycle (Queued → Running → Completed | Failed | Cancelled)", () => {
  it("allows only legal transitions and keeps terminal states immutable", () => {
    expect(canTransitionStudioStatus("Queued", "Running")).toBe(true);
    expect(canTransitionStudioStatus("Queued", "Cancelled")).toBe(true);
    expect(canTransitionStudioStatus("Running", "Completed")).toBe(true);
    expect(canTransitionStudioStatus("Running", "Failed")).toBe(true);
    expect(canTransitionStudioStatus("Running", "Cancelled")).toBe(true);
    expect(canTransitionStudioStatus("Queued", "Completed")).toBe(false);
    expect(canTransitionStudioStatus("Completed", "Running")).toBe(false);
    expect(canTransitionStudioStatus("Failed", "Completed")).toBe(false);
    expect(canTransitionStudioStatus("Cancelled", "Completed")).toBe(false);
  });
});

describe("FR-ST-10 StudioArtifact schema", () => {
  it("accepts a Queued artifact without payload", () => {
    expect(StudioArtifactSchema.safeParse({ ...base, status: "Queued" }).success).toBe(true);
  });
  it("requires payload with citations iff Completed", () => {
    const payload = {
      content_md: "# Report [1]",
      citations: [{ badge_number: 1, chunk_id: CHUNK, source_id: SRC_A, revision: 1, snippet: "x" }],
    };
    expect(StudioArtifactSchema.safeParse({ ...base, status: "Completed", payload_json: payload }).success).toBe(true);
    expect(StudioArtifactSchema.safeParse({ ...base, status: "Completed", payload_json: null }).success).toBe(false);
    expect(
      StudioArtifactSchema.safeParse({ ...base, status: "Completed", payload_json: { ...payload, citations: [] } }).success
    ).toBe(false);
    expect(StudioArtifactSchema.safeParse({ ...base, status: "Running", payload_json: payload }).success).toBe(false);
  });
  it("requires a failure explanation for Failed and rejects an empty snapshot", () => {
    expect(StudioArtifactSchema.safeParse({ ...base, status: "Failed" }).success).toBe(false);
    expect(
      StudioArtifactSchema.safeParse({
        ...base,
        status: "Failed",
        failure: { code: "SourceChanged", message: "Source A was replaced." },
      }).success
    ).toBe(true);
    expect(StudioArtifactSchema.safeParse({ ...base, status: "Queued", active_source_ids_snapshot: [] }).success).toBe(false);
  });
});

describe("FR-ST-11 custom report prompt boundaries (code points after trim)", () => {
  it("accepts 1 and 5,000 code points including surrogate pairs", () => {
    expect(validateCustomReportPrompt("a").valid).toBe(true);
    expect(validateCustomReportPrompt("😀".repeat(5000)).valid).toBe(true);
    expect(validateCustomReportPrompt("  x  ").normalized).toBe("x");
  });
  it("rejects empty, whitespace-only and 5,001 code points without truncation", () => {
    expect(validateCustomReportPrompt("").valid).toBe(false);
    expect(validateCustomReportPrompt(" \n\t ").valid).toBe(false);
    const over = validateCustomReportPrompt("😀".repeat(5001));
    expect(over.valid).toBe(false);
    expect(over.codePoints).toBe(5001);
    expect(CustomReportPromptSchema.safeParse("y".repeat(5001)).success).toBe(false);
  });
});

describe("FR-ST-10/11, FR-012 create request", () => {
  const ok = { plugin_type: "report", subtype: "faq", active_source_ids: [SRC_A] };
  it("rejects empty or omitted scope (no all-sources fallback)", () => {
    expect(CreateStudioJobRequestSchema.safeParse({ ...ok, active_source_ids: [] }).success).toBe(false);
    expect(CreateStudioJobRequestSchema.safeParse({ plugin_type: "report", subtype: "faq" }).success).toBe(false);
  });
  it("requires a prompt for dynamic and custom subtypes only", () => {
    expect(CreateStudioJobRequestSchema.safeParse({ ...ok, subtype: "custom" }).success).toBe(false);
    expect(CreateStudioJobRequestSchema.safeParse({ ...ok, subtype: "dynamic", custom_prompt: "  " }).success).toBe(false);
    expect(CreateStudioJobRequestSchema.safeParse({ ...ok, subtype: "custom", custom_prompt: "z" }).success).toBe(true);
    expect(CreateStudioJobRequestSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects unknown template subtypes", () => {
    expect(CreateStudioJobRequestSchema.safeParse({ ...ok, subtype: "mindmap" }).success).toBe(false);
  });
});

describe("FR-ST-11 suggestion results", () => {
  const card = (n: number) => ({ title: `T${n}`, description: "d", prompt_template: "p" });
  it("requires 3-4 suggestions when ready", () => {
    const mk = (n: number) => ({ state: "SuggestionsReady", suggestions: Array.from({ length: n }, (_, i) => card(i)) });
    expect(ReportSuggestionsResultSchema.safeParse(mk(2)).success).toBe(false);
    expect(ReportSuggestionsResultSchema.safeParse(mk(3)).success).toBe(true);
    expect(ReportSuggestionsResultSchema.safeParse(mk(4)).success).toBe(true);
    expect(ReportSuggestionsResultSchema.safeParse(mk(5)).success).toBe(false);
  });
  it("supports loading and unavailable states", () => {
    expect(ReportSuggestionsResultSchema.safeParse({ state: "SuggestionsLoading" }).success).toBe(true);
    expect(ReportSuggestionsResultSchema.safeParse({ state: "SuggestionsUnavailable", reason: "Guide failed" }).success).toBe(true);
  });
});

describe("C-03 StudioPluginRegistry", () => {
  const plugin = (type: string): StudioGeneratorPlugin => ({
    manifest: { plugin_type: type, display_name: type, subtypes: ["a"] },
    triggerJob: () => ({ title: "t", params_json: {} }),
    generate: async () => ({ status: "refused", code: "InsufficientEvidence", message: "n/a" }),
  });
  it("registers, resolves and lists plugins; rejects duplicates and unknown types", () => {
    const registry = new StudioPluginRegistry();
    registry.register(plugin("report"));
    registry.register(plugin("mindmap"));
    expect(registry.get("report").manifest.plugin_type).toBe("report");
    expect(registry.list().map((p) => p.manifest.plugin_type)).toEqual(["report", "mindmap"]);
    expect(() => registry.register(plugin("report"))).toThrow(/already registered/);
    expect(() => registry.get("nope")).toThrow(/Unknown Studio plugin/);
  });
});
