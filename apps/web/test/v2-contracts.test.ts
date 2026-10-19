import { describe, expect, it } from "vitest";
import * as contracts from "@everlast/contracts";
import * as local from "../src/lib/v2-contracts.ts";

/** The SPA's browser copies (no bundler) must stay equal to packages/contracts (FR-UI-02, FR-GC-07, FR-NM-01..04). */
describe("browser contract copies match packages/contracts", () => {
  it("keeps constants and the supported language list identical", () => {
    expect(local.SUPPORTED_OUTPUT_LANGUAGES).toEqual(contracts.SUPPORTED_OUTPUT_LANGUAGES);
    expect(local.NOTE_ASSISTANT_MAX_NOTES).toBe(contracts.NOTE_ASSISTANT_MAX_NOTES);
    expect(local.SOURCE_LIMIT_REACHED_MESSAGE).toBe(contracts.SOURCE_LIMIT_REACHED_MESSAGE);
    expect(local.NOTE_AUTOSAVE_DEBOUNCE_MS).toBe(contracts.NOTE_AUTOSAVE_DEBOUNCE_MS);
    expect(local.NOTE_ERROR_MESSAGES).toEqual(contracts.NOTE_ERROR_MESSAGES);
  });

  it.each([
    ["NotebookViewModeSchema", ["grid", "list", "table", null]],
    ["NotebookSortOrderSchema", ["recent", "title_asc", "created_desc", "oldest"]],
    ["NotebookThemeSchema", ["light", "dark", "system", "blue"]],
    ["InputLanguageSchema", ["auto", "fr-FR", "xx-XX", " de-DE", "", 5]],
    ["OutputLanguageSchema", ["de-DE", "xx-XX", null]],
    ["NullableOutputLanguageSchema", ["de-DE", null, "xx-XX"]],
  ] as const)("%s accepts exactly what the contract accepts", (name, samples) => {
    for (const value of samples) {
      expect((local as any)[name].safeParse(value).success, `${name}(${JSON.stringify(value)})`).toBe((contracts as any)[name].safeParse(value).success);
    }
  });

  it("validates chat configuration like ChatConfigurationSchema", () => {
    const samples = [
      { style: "default", response_length: "default" },
      { style: "custom", custom_instructions: "  Be brief  ", response_length: "shorter" },
      { style: "custom", custom_instructions: "  ", response_length: "default" },
      { style: "analyst", custom_instructions: "x", response_length: "default" },
      { style: "custom", custom_instructions: "x".repeat(5001), response_length: "default" },
      { style: "bogus", response_length: "default" },
      { style: "default", response_length: "default", extra: true },
      {},
    ];
    for (const value of samples) {
      const expected = contracts.ChatConfigurationSchema.safeParse(value);
      const actual = local.ChatConfigurationSchema.safeParse(value);
      expect(actual.success, JSON.stringify(value)).toBe(expected.success);
      if (actual.success && expected.success) expect(actual.data).toEqual(expected.data);
    }
  });
});
