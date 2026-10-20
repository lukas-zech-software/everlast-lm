import { describe, it, expect } from "vitest";
import { ReportsModalController } from "../src/studio/reports-modal.ts";
import type { StudioApi } from "../src/studio/api.ts";

const api = (suggestions: StudioApi["suggestions"]): StudioApi => ({
  list: async () => [], get: async () => { throw new Error("x"); }, create: async (b) => ({ id: JSON.stringify(b) } as never),
  retry: async () => { throw new Error("x"); },
  convert: async () => ({ source_id: "s" }), remove: async () => undefined, suggestions,
});
const ready = { state: "SuggestionsReady", suggestions: [1, 2, 3].map((i) => ({ title: `T${i}`, description: `D${i}`, prompt_template: `Prompt ${i}` })) } as const;

describe("ReportsModalController (FR-ST-11, FR-018)", () => {
  it("moves SuggestionsLoading → SuggestionsReady and pre-fills the prompt on pencil edit", async () => {
    const ctl = new ReportsModalController({ api: api(async () => ready), notebookId: "n", getActiveSourceIds: () => ["a"] });
    expect(ctl.suggestionState).toBe("SuggestionsLoading");
    await ctl.loadSuggestions();
    expect(ctl.suggestionState).toBe("SuggestionsReady");
    ctl.editSuggestion(1);
    expect(ctl.prompt).toBe("Prompt 2");
    expect(ctl.canGenerate).toBe(true);
  });
  it("Generate boundaries: 0 and whitespace disabled, 1 and 5,000 enabled, 5,001 disabled", () => {
    const ctl = new ReportsModalController({ api: api(async () => ready), notebookId: "n", getActiveSourceIds: () => ["a"] });
    for (const [text, ok] of [["", false], ["  \n ", false], ["a", true], ["😀".repeat(5000), true], ["😀".repeat(5001), false]] as const) {
      ctl.setPrompt(text);
      expect(ctl.canGenerate).toBe(ok);
    }
  });
  it("stays usable when suggestions are unavailable or fail; templates need a non-empty scope", async () => {
    const ctl = new ReportsModalController({ api: api(async () => { throw new Error("down"); }), notebookId: "n", getActiveSourceIds: () => [] });
    await ctl.loadSuggestions();
    expect(ctl.suggestionState).toBe("SuggestionsUnavailable");
    expect(ctl.templatesEnabled).toBe(false);
    ctl.setPrompt("custom");
    expect(ctl.canGenerate).toBe(false);
  });
  it("generate sends a custom report with the active scope", async () => {
    const ctl = new ReportsModalController({ api: api(async () => ready), notebookId: "n", getActiveSourceIds: () => ["a", "b"] });
    ctl.setPrompt("Include a risk matrix");
    const created = await ctl.generate();
    expect(JSON.parse(created.id)).toMatchObject({ plugin_type: "report", subtype: "custom", active_source_ids: ["a", "b"], custom_prompt: "Include a risk matrix" });
  });
});
