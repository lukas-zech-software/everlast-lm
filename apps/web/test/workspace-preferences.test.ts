import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMockDOM } from "./mock-dom.js";
import {
  loadWorkspacePreferences,
  resolveTheme,
  saveWorkspacePreferences,
  sortNotebookRows,
  WORKSPACE_PREFS_KEY,
} from "../src/workspace-preferences.js";
import { renderNotebookHome, renderNotebookOverview } from "../src/notebooks.js";
import { renderWorkspaceLayout } from "../src/workspace-layout.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPPORTED_OUTPUT_LANGUAGES } from "@everlast/contracts";
import { applyTheme, initializeTheme, renderWorkspaceSettings } from "../src/workspace-preferences.js";

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

  it("hydrates and persists global and notebook language settings in their respective surfaces", async () => {
    const patches: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") patches.push({ url: String(input), body: JSON.parse(String(init.body)) });
      const url = String(input);
      const body = url.endsWith("/api/preferences")
        ? { owner_id: "owner", view_mode: "grid", sort_order: "recent", theme: "system", input_language: "fr-FR", output_language: "de-DE" }
        : url.endsWith("/api/notebooks/notebook-1/preferences")
          ? { owner_id: "owner", notebook_id: "notebook-1", notebook_input_language: "ja-JP", notebook_output_language: "zh-TW" }
          : { notebooks: [] };
      return { ok: true, json: async () => body } as Response;
    });
    const { document } = setupMockDOM();
    (document as any).documentElement = document.createElement("html");
    const home = document.createElement("div");
    renderNotebookHome(home as unknown as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (home.querySelector("#workspace-settings") as any).hidden = true;
    home.querySelector("#workspace-settings-toggle")?.click();
    expect(home.querySelector("#input-language-select")?.value).toBe("fr-FR");
    const globalOutput = home.querySelector("#output-language-select")!;
    expect(globalOutput.value).toBe("de-DE");
    globalOutput.value = "es-ES";
    globalOutput.dispatchEvent({ type: "change", target: globalOutput });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(patches).toContainEqual({ url: "/api/preferences", body: { output_language: "es-ES" } });

    const workspace = document.createElement("div");
    renderWorkspaceLayout(workspace as unknown as HTMLElement, { activeNotebookId: "notebook-1" });
    workspace.querySelector("#workspace-settings-toggle")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspace.querySelector("#notebook-input-language-select")?.value).toBe("ja-JP");
    const notebookOutput = workspace.querySelector("#notebook-output-language-select")!;
    expect(notebookOutput.value).toBe("zh-TW");
    notebookOutput.value = "it-IT";
    notebookOutput.dispatchEvent({ type: "change", target: notebookOutput });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(patches).toContainEqual({ url: "/api/notebooks/notebook-1/preferences", body: { notebook_output_language: "it-IT" } });
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

  it("renders the active notebook title and saved icon in the workspace header", () => {
    const { document } = setupMockDOM();
    const workspace = document.createElement("div");
    renderWorkspaceLayout(workspace as unknown as HTMLElement, {
      activeNotebookId: "notebook-1",
      notebookTitle: "Climate research",
      notebookIcon: "🧬",
    } as any);
    expect(workspace.querySelector(".workspace-notebook-icon")?.textContent).toBe("🧬");
    expect(workspace.querySelector(".notebook-title")?.textContent).toBe("Climate research");
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

  it("renders accessible grid/list metadata, owner role, pin controls and empty-state CTA", () => {
    const { document } = setupMockDOM();
    const container = document.createElement("div");
    const row = { ...base, id: "n1", title: "Climate", ready_source_count: 2, is_pinned: true };
    renderNotebookOverview(container as unknown as HTMLElement, [row] as any, { view_mode: "list", sort_order: "recent" });
    expect(container.querySelector(".notebook-overview-list")).not.toBeNull();
    expect(container.querySelector(".notebook-role")?.textContent).toBe("Owner");
    expect(container.querySelector(".notebook-icon")?.textContent).toBe("📓");
    expect(container.querySelector(".notebook-source-count")?.textContent).toContain("2 sources");
    expect(container.querySelector(".notebook-created-date")).not.toBeNull();
    expect(container.querySelector(".notebook-modified-date")).not.toBeNull();
    expect(container.querySelector(".notebook-pin")?.getAttribute("aria-label")).toBe("Unpin notebook");
    renderNotebookOverview(container as unknown as HTMLElement, [], { view_mode: "grid", sort_order: "recent" });
    expect(container.querySelector(".notebook-empty-state")?.textContent).toContain("Create your first notebook");
    expect(container.querySelector("#notebook-sort")).toBeNull();
  });
});
