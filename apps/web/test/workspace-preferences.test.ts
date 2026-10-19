import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMockDOM } from "./mock-dom.ts";
import {
  loadWorkspacePreferences,
  resolveTheme,
  saveWorkspacePreferences,
  sortNotebookRows,
  WORKSPACE_PREFS_KEY,
} from "../src/workspace-preferences.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPPORTED_OUTPUT_LANGUAGES } from "@everlast/contracts";
import { applyTheme, hydrateWorkspaceSettings, initializeTheme, renderWorkspaceSettings } from "../src/workspace-preferences.ts";

const base = {
  owner_id: "owner",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  icon_emoji: "📓",
  icon_source: "default",
  ready_source_count: 0,
  is_pinned: false,
  last_opened_at: null,
  owner_role: "Owner",
};

const originalFetch = globalThis.fetch;
beforeEach(() => setupMockDOM());
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Workspace overview preferences (FR-WM-03, FR-UI-02)", () => {
  it("restores and validates view/sort/theme preferences, falling back on corrupt data", () => {
    const { localStorage } = setupMockDOM();
    localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ view_mode: "list", sort_order: "title_asc", theme: "dark" }));
    expect(loadWorkspacePreferences()).toEqual({ view_mode: "list", sort_order: "title_asc", theme: "dark" });
    localStorage.setItem(WORKSPACE_PREFS_KEY, "{bad");
    expect(loadWorkspacePreferences()).toEqual({ view_mode: "grid", sort_order: "recent", theme: "system" });
  });

  it("persists only validated local view/sort/theme values", () => {
    const { localStorage } = setupMockDOM();
    saveWorkspacePreferences({ view_mode: "list", sort_order: "created_desc", theme: "dark" });
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!)).toEqual({ view_mode: "list", sort_order: "created_desc", theme: "dark" });
  });

  it("resolves System to the browser color preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("sorts 500 records in each requested order with pinned records first", () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      ...base,
      id: `id-${String(index).padStart(3, "0")}`,
      title: `Notebook ${String(499 - index).padStart(3, "0")}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      last_opened_at: index % 2 ? null : new Date(Date.UTC(2026, 0, 2, 0, index)).toISOString(),
      is_pinned: index === 200,
    }));
    for (const order of ["recent", "title_asc", "created_desc"] as const) {
      const start = performance.now();
      const sorted = sortNotebookRows(rows, order);
      expect(performance.now() - start).toBeLessThan(100);
      expect(sorted[0]?.is_pinned).toBe(true);
      expect(sorted).toHaveLength(500);
    }
  });

  it("applies the saved theme before first paint and handles System preference", () => {
    const { document, localStorage } = setupMockDOM();
    const root = document.createElement("html");
    localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ view_mode: "grid", sort_order: "recent", theme: "dark" }));
    initializeTheme(root as unknown as HTMLElement, localStorage as unknown as Storage, false);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme("system", root as unknown as HTMLElement, true);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme("system", root as unknown as HTMLElement, false);
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("renders language selectors with exactly the supported locales and updates theme immediately", () => {
    const { document, localStorage } = setupMockDOM();
    const root = document.createElement("html");
    const panel = document.createElement("div");
    let updated: any;
    renderWorkspaceSettings(panel as unknown as HTMLElement, { theme: "system", view_mode: "grid", sort_order: "recent", input_language: "auto", output_language: "en-US" }, {
      root: root as unknown as HTMLElement,
      storage: localStorage,
      prefersDark: false,
      onUpdate: (preferences: any) => { updated = preferences; },
    });
    const input = panel.querySelector("#input-language-select");
    const output = panel.querySelector("#output-language-select");
    const theme = panel.querySelector("#theme-select");
    expect(input?.value).toBe("auto");
    expect(output?.querySelectorAll("option")).toHaveLength(40);
    expect(SUPPORTED_OUTPUT_LANGUAGES).toHaveLength(40);
    theme!.value = "dark";
    theme!.dispatchEvent({ type: "change", target: theme });
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(updated.theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!).theme).toBe("dark");
  });

  it("hydrates global and notebook language settings and reports each change with its key", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/preferences")
        ? { owner_id: "owner", view_mode: "grid", sort_order: "recent", theme: "system", input_language: "fr-FR", output_language: "de-DE" }
        : { owner_id: "owner", notebook_id: "notebook-1", notebook_input_language: "ja-JP", notebook_output_language: "zh-TW" };
      return { ok: true, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    const initial = { view_mode: "grid", sort_order: "recent", theme: "system", input_language: "auto", output_language: null } as const;
    const loaded = await hydrateWorkspaceSettings({ ...initial }, { notebookId: "notebook-1", fetcher });
    expect(loaded).toMatchObject({ input_language: "fr-FR", output_language: "de-DE", notebook_input_language: "ja-JP", notebook_output_language: "zh-TW" });
    const { document } = setupMockDOM();
    const host = document.createElement("div");
    const updates: [string, unknown][] = [];
    renderWorkspaceSettings(host as unknown as HTMLElement, loaded, { notebookId: "notebook-1", onUpdate: (next, key) => void updates.push([key, next[key]]) });
    const notebookOutput = host.querySelector("#notebook-output-language-select")!;
    expect(notebookOutput.value).toBe("zh-TW");
    notebookOutput.value = "it-IT";
    notebookOutput.dispatchEvent({ type: "change", target: notebookOutput });
    expect(updates).toContainEqual(["notebook_output_language", "it-IT"]);
  });
  it("updates a System theme when prefers-color-scheme changes", () => {
    const { window, document, localStorage } = setupMockDOM();
    let changeListener: ((event: { matches: boolean }) => void) | undefined;
    const mediaQuery = {
      matches: false,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { changeListener = listener; },
      removeEventListener: () => undefined,
    };
    (window as any).matchMedia = () => mediaQuery;
    const root = document.createElement("html");
    initializeTheme(root as unknown as HTMLElement, localStorage as unknown as Storage);
    expect(root.getAttribute("data-theme")).toBe("light");
    mediaQuery.matches = true;
    changeListener?.({ matches: true });
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("installs theme initialization in the document head before app paint", () => {
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    const headEnd = html.indexOf("</head>");
    const bodyStart = html.indexOf("<body>");
    const themeScript = html.indexOf("dataset.theme");
    expect(themeScript).toBeGreaterThanOrEqual(0);
    expect(themeScript).toBeLessThan(headEnd);
    expect(headEnd).toBeLessThan(bodyStart);
  });

});
