import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTEBOOK_ICON,
  InputLanguageSchema,
  NotebookIconSchema,
  NotebookIconSourceSchema,
  NotebookSortOrderSchema,
  NotebookThemeSchema,
  NotebookViewModeSchema,
  OwnerNotebookPreferencesPatchSchema,
  OwnerNotebookPreferencesSchema,
  OwnerWorkspacePreferencesPatchSchema,
  OwnerWorkspacePreferencesSchema,
  OutputLanguageSchema,
  resolveOutputLanguage,
  SUPPORTED_OUTPUT_LANGUAGES,
} from "../src/package-v2-1.ts";

describe("Package 2.1 contracts (FR-WM-02, FR-WM-03, FR-UI-02)", () => {
  it("uses expected notebook icon and preference defaults", () => {
    expect(DEFAULT_NOTEBOOK_ICON).toBe("📓");
    expect(NotebookIconSourceSchema.parse("default")).toBe("default");
    expect(NotebookViewModeSchema.parse("grid")).toBe("grid");
    expect(NotebookViewModeSchema.parse("list")).toBe("list");
    expect(NotebookSortOrderSchema.parse("recent")).toBe("recent");
    expect(NotebookSortOrderSchema.parse("title_asc")).toBe("title_asc");
    expect(NotebookSortOrderSchema.parse("created_desc")).toBe("created_desc");
    expect(NotebookThemeSchema.parse("system")).toBe("system");
    expect(InputLanguageSchema.parse("auto")).toBe("auto");
    expect(OwnerWorkspacePreferencesSchema.parse({ owner_id: "owner", theme: "system", input_language: "auto" })).toEqual({
      owner_id: "owner",
      theme: "system",
      input_language: "auto",
      output_language: null,
    });
    expect(OwnerNotebookPreferencesSchema.parse({ owner_id: "owner", notebook_id: "notebook", is_pinned: false })).toBeTruthy();
  });

  it.each(["🧬", "👩🏽‍🔬", "🇺🇳", "1️⃣", "👨‍👩‍👧‍👦"]) (
    "accepts one emoji grapheme: %s", (emoji) => {
      expect(NotebookIconSchema.parse(emoji)).toBe(emoji);
    }
  );

  it.each(["", "abc", "🧬🧬", "🧬x", "👩‍", " "]) (
    "rejects invalid or multiple emoji graphemes: %s", (value) => {
      expect(() => NotebookIconSchema.parse(value)).toThrow();
    }
  );

  it("rejects unsupported preference enums and tags", () => {
    expect(() => NotebookViewModeSchema.parse("table")).toThrow();
    expect(() => NotebookSortOrderSchema.parse("random")).toThrow();
    expect(() => NotebookThemeSchema.parse("blue")).toThrow();
    expect(() => InputLanguageSchema.parse("not_a_tag")).toThrow();
    expect(() => OutputLanguageSchema.parse("xx-XX")).toThrow();
  });

  it("exposes exactly the versioned 40 supported BCP-47 output choices", () => {
    expect(SUPPORTED_OUTPUT_LANGUAGES).toHaveLength(40);
    expect(SUPPORTED_OUTPUT_LANGUAGES.map(({ tag }) => tag)).toContain("de-DE");
    expect(SUPPORTED_OUTPUT_LANGUAGES.map(({ tag }) => tag)).toContain("zh-TW");
  });

  it("resolves the first supported output language in required precedence order", () => {
    const common = { browserLocale: "fr-FR", userDefault: "es-ES", notebookDefault: "it-IT", personalOverride: "de-DE", jobLanguage: "ja-JP" };
    expect(resolveOutputLanguage(common)).toBe("ja-JP");
    expect(resolveOutputLanguage({ ...common, jobLanguage: null })).toBe("de-DE");
    expect(resolveOutputLanguage({ ...common, jobLanguage: null, personalOverride: null })).toBe("it-IT");
    expect(resolveOutputLanguage({ ...common, jobLanguage: null, personalOverride: null, notebookDefault: null })).toBe("es-ES");
    expect(resolveOutputLanguage({ ...common, jobLanguage: null, personalOverride: null, notebookDefault: null, userDefault: null })).toBe("fr-FR");
    expect(resolveOutputLanguage({ browserLocale: "xx-XX" })).toBe("en-US");
  });

  it("keeps view mode and sort order out of the server-side owner preferences (FR-WM-03, FR-008)", () => {
    expect(OwnerWorkspacePreferencesPatchSchema.safeParse({ view_mode: "list" }).success).toBe(false);
    expect(OwnerWorkspacePreferencesPatchSchema.safeParse({ sort_order: "title_asc" }).success).toBe(false);
    expect(OwnerWorkspacePreferencesSchema.safeParse({ owner_id: "owner", view_mode: "grid" }).success).toBe(false);
    expect(OwnerWorkspacePreferencesPatchSchema.safeParse({ theme: "dark" }).success).toBe(true);
  });

  it("rejects personal per-notebook overrides in v2; the Owner sets the notebook language (FR-UI-02, FR-013, FR-015)", () => {
    expect(OwnerNotebookPreferencesPatchSchema.safeParse({ input_language_override: "fr-FR" }).success).toBe(false);
    expect(OwnerNotebookPreferencesPatchSchema.safeParse({ output_language_override: "de-DE" }).success).toBe(false);
    expect(OwnerNotebookPreferencesPatchSchema.safeParse({ notebook_input_language: "auto", notebook_output_language: "de-DE" }).success).toBe(true);
    expect(OwnerNotebookPreferencesSchema.parse({ owner_id: "owner", notebook_id: "notebook" })).not.toHaveProperty("output_language_override");
  });
});
