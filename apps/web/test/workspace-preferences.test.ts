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
import { renderHome, renderIconPicker } from "../src/home.ts";
import { createWorkspaceFeatures } from "../src/v2/workspace-features.ts";

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
    renderWorkspaceSettings(panel as unknown as HTMLElement, { theme: "system", input_language: "auto", output_language: "en-US" }, {
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
    const initial = { theme: "system", input_language: "auto", output_language: null } as const;
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

// ---- Convergence tests (specs/005 Phase 7) ------------------------------------------------------------

type Call = { url: string; method: string; body: any };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Minimal fake API for the home overview and workspace settings; records every request. */
function fakeApi(options: {
  notebooks?: any[];
  preferences?: Record<string, unknown>;
  rejectIcon?: boolean;
} = {}) {
  const calls: Call[] = [];
  const notebooks = options.notebooks ?? [];
  const preferences = { owner_id: "owner", theme: "system", input_language: "auto", output_language: null, ...options.preferences };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/notebooks" && method === "GET") return json({ notebooks, notebooks_used: notebooks.length, notebook_limit: 100 });
    if (url === "/api/notebooks" && method === "POST") return json({ notebook: { id: "nb-new", title: "Untitled notebook", created_at: base.created_at, updated_at: base.updated_at } }, 201);
    if (url === "/api/preferences" && method === "GET") return json(preferences);
    if (url === "/api/preferences" && method === "PATCH") return json({ ...preferences, ...body });
    const icon = url.match(/^\/api\/notebooks\/([^/]+)\/icon$/);
    if (icon && method === "PATCH") {
      if (options.rejectIcon) return json({ error: { code: "InvalidEmoji", message: "Icon must be one valid emoji grapheme" } }, 400);
      const nb = notebooks.find((n) => n.id === icon[1]);
      if (nb) Object.assign(nb, { icon_emoji: body.icon_emoji, icon_source: "custom" });
      return json({ notebook: nb });
    }
    if (url.endsWith("/preferences") && method === "GET") return json({ notebook_input_language: null, notebook_output_language: null, is_pinned: false });
    if (url.endsWith("/overview") && method === "POST") return json({ overview_md: "Overview", starter_prompts: [] });
    return json({}, 404);
  });
  globalThis.fetch = fetcher as unknown as typeof fetch;
  return { calls, notebooks, fetcher };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const row = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ ...base, id, title, ...extra });

describe("Home empty state (FR-WM-03, FR-009, US1 Scenario 5)", () => {
  it("shows a Create your first notebook call to action that creates a notebook, with sorting disabled", async () => {
    const { document } = setupMockDOM();
    const { calls } = fakeApi();
    const root = document.createElement("div");
    const nav = { go: vi.fn() };
    await renderHome(root as unknown as HTMLElement, nav);
    const cta = root.querySelector("[data-testid=empty-home]");
    expect(cta?.tagName).toBe("BUTTON");
    expect(cta?.textContent).toBe("Create your first notebook");
    expect((root.querySelector("[data-testid=notebook-sort]") as any).disabled).toBe(true);
    cta!.click();
    await vi.waitFor(() => expect(nav.go).toHaveBeenCalledWith("/notebook/nb-new", { addSources: true }));
    expect(calls.filter((c) => c.url === "/api/notebooks" && c.method === "POST")).toHaveLength(1);
  });

  it("returns the sort control and hides the call to action once a notebook exists", async () => {
    const { document } = setupMockDOM();
    fakeApi({ notebooks: [row("nb-1", "Alpha")] });
    const root = document.createElement("div");
    await renderHome(root as unknown as HTMLElement, { go: vi.fn() });
    expect(root.querySelector("[data-testid=empty-home]")).toBeNull();
    expect((root.querySelector("[data-testid=notebook-sort]") as any).disabled).toBe(false);
    expect(root.querySelectorAll("[data-testid=notebook-card]")).toHaveLength(1);
  });
});

describe("Notebook icon picker shared by home cards and the workspace header (FR-WM-02, FR-003, US1 Scenario 1)", () => {
  it("saves a valid choice through PATCH /icon, shows it in the header and on the home card after navigating back", async () => {
    const { document } = setupMockDOM();
    const api = fakeApi({ notebooks: [row("nb-1", "Genetics")] });
    const shown: string[] = [];
    const picker = renderIconPicker({ id: "nb-1", title: "Genetics", icon_emoji: "📓" }, (patch) => void shown.push(patch.icon_emoji!), "workspace-notebook-icon");
    expect(picker.tagName).toBe("SELECT");
    expect(picker.getAttribute("data-testid")).toBe("workspace-notebook-icon");
    expect(picker.value).toBe("📓");
    expect(picker.querySelectorAll("option").length).toBeGreaterThan(1);
    picker.value = "🧬";
    (picker as any).dispatchEvent({ type: "change", target: picker });
    await vi.waitFor(() => expect(shown).toContain("🧬"));
    expect(api.calls).toContainEqual({ url: "/api/notebooks/nb-1/icon", method: "PATCH", body: { icon_emoji: "🧬" } });
    expect(picker.value).toBe("🧬");

    const home = document.createElement("div");
    await renderHome(home as unknown as HTMLElement, { go: vi.fn() });
    const cardPicker = home.querySelector("[data-testid=notebook-icon]");
    expect(cardPicker?.value).toBe("🧬");
  });

  it("keeps the current icon when the server rejects the choice", async () => {
    setupMockDOM();
    fakeApi({ notebooks: [row("nb-1", "Genetics")], rejectIcon: true });
    const shown: string[] = [];
    const picker = renderIconPicker({ id: "nb-1", title: "Genetics", icon_emoji: "📓" }, (patch) => void shown.push(patch.icon_emoji!), "workspace-notebook-icon");
    picker.value = "🧬";
    (picker as any).dispatchEvent({ type: "change", target: picker });
    await vi.waitFor(() => expect(picker.value).toBe("📓"));
    expect(shown).toEqual([]);
  });
});

describe("View mode and sort order live only in localStorage (FR-WM-03, FR-008, US1 Scenarios 4 and 9)", () => {
  it("sends no PATCH /api/preferences when the view or sort changes", async () => {
    const { document, localStorage } = setupMockDOM();
    const { calls } = fakeApi({ notebooks: [row("nb-1", "Alpha"), row("nb-2", "Beta")] });
    const root = document.createElement("div");
    await renderHome(root as unknown as HTMLElement, { go: vi.fn() });
    root.querySelector("[data-testid=notebook-view-list]")!.click();
    const sort = root.querySelector("[data-testid=notebook-sort]")!;
    sort.value = "title_asc";
    sort.dispatchEvent({ type: "change", target: sort });
    await flush();
    expect(calls.filter((c) => c.url === "/api/preferences" && c.method === "PATCH")).toEqual([]);
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!)).toMatchObject({ view_mode: "list", sort_order: "title_asc" });
  });

  it("never overwrites the local view/sort with server values on hydration or a theme change", async () => {
    const { document, localStorage } = setupMockDOM();
    localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ view_mode: "list", sort_order: "title_asc", theme: "light" }));
    const fetcher = vi.fn(async () => json({ owner_id: "owner", view_mode: "grid", sort_order: "created_desc", theme: "system", input_language: "auto", output_language: null })) as unknown as typeof fetch;
    const loaded = await hydrateWorkspaceSettings({ theme: "light", input_language: "auto", output_language: null }, { fetcher });
    expect(loaded).not.toHaveProperty("view_mode");
    expect(loaded).not.toHaveProperty("sort_order");
    const panel = document.createElement("div");
    renderWorkspaceSettings(panel as unknown as HTMLElement, { ...loaded, view_mode: "grid", sort_order: "created_desc" } as any, { root: document.createElement("html") as unknown as HTMLElement, storage: localStorage, prefersDark: false });
    const theme = panel.querySelector("#theme-select")!;
    theme.value = "dark";
    theme.dispatchEvent({ type: "change", target: theme });
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!)).toEqual({ view_mode: "list", sort_order: "title_asc", theme: "dark" });
  });
});

describe("Server theme replaces the local one after first paint (FR-UI-02, FR-010, SC-003)", () => {
  it("home applies the server theme and writes it to localStorage for the next pre-paint", async () => {
    const { document, localStorage } = setupMockDOM();
    localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ view_mode: "list", sort_order: "title_asc", theme: "light" }));
    fakeApi({ notebooks: [row("nb-1", "Alpha")], preferences: { theme: "dark" } });
    const root = document.createElement("div");
    await renderHome(root as unknown as HTMLElement, { go: vi.fn() });
    await vi.waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!)).toEqual({ view_mode: "list", sort_order: "title_asc", theme: "dark" });
    const nextLoad = document.createElement("html");
    initializeTheme(nextLoad as unknown as HTMLElement, localStorage as unknown as Storage, false);
    expect(nextLoad.getAttribute("data-theme")).toBe("dark");
  });

  it("the workspace applies the server theme and writes it to localStorage", async () => {
    const { document, localStorage } = setupMockDOM();
    localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ view_mode: "grid", sort_order: "recent", theme: "dark" }));
    fakeApi({ preferences: { theme: "light" } });
    createWorkspaceFeatures({ notebookId: "nb-1", notebookTitle: "Alpha" });
    await vi.waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("light"));
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!).theme).toBe("light");
  });

  it("a theme change from Settings writes localStorage and PATCH /api/preferences", async () => {
    const { document, localStorage } = setupMockDOM();
    const { calls } = fakeApi({ notebooks: [row("nb-1", "Alpha")] });
    const root = document.createElement("div");
    await renderHome(root as unknown as HTMLElement, { go: vi.fn() });
    await flush();
    root.querySelector("[data-testid=workspace-settings-toggle]")!.click();
    const theme = root.querySelector("#theme-select")!;
    theme.value = "dark";
    theme.dispatchEvent({ type: "change", target: theme });
    await vi.waitFor(() => expect(calls).toContainEqual({ url: "/api/preferences", method: "PATCH", body: { theme: "dark" } }));
    expect(JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY)!).theme).toBe("dark");
  });
});

describe("Title sort uses Intl.Collator for the UI locale with a created_at tie-break (FR-WM-03, FR-005, US1 Scenario 3)", () => {
  it("orders case-insensitively, breaks equal titles by created_at descending and keeps pinned first", () => {
    const rows = [
      row("a-early", "Alpha", { created_at: "2026-01-01T00:00:00.000Z" }),
      row("z-late", "alpha", { created_at: "2026-01-03T00:00:00.000Z" }),
      row("m-beta", "beta", { created_at: "2026-01-02T00:00:00.000Z" }),
      row("p-zeta", "Zeta", { created_at: "2026-01-02T00:00:00.000Z", is_pinned: true }),
    ];
    expect(sortNotebookRows(rows, "title_asc").map((r) => r.id)).toEqual(["p-zeta", "z-late", "a-early", "m-beta"]);
  });

  it("follows the collation of the given UI locale", () => {
    const rows = [row("1", "Äpfel"), row("2", "Zebra")];
    expect(sortNotebookRows(rows, "title_asc", "de-DE").map((r) => r.title)).toEqual(["Äpfel", "Zebra"]);
    expect(sortNotebookRows(rows, "title_asc", "sv-SE").map((r) => r.title)).toEqual(["Zebra", "Äpfel"]);
  });
});

describe("Client default output language (FR-UI-02, FR-012, US2 Scenario 6)", () => {
  it("shows the supported browser locale, or en-US when it is unsupported, when no user language is saved", () => {
    const { document } = setupMockDOM();
    const supported = document.createElement("div");
    renderWorkspaceSettings(supported as unknown as HTMLElement, { theme: "system", input_language: "auto", output_language: null }, { browserLocale: "de-DE" } as any);
    expect(supported.querySelector("#output-language-select")?.value).toBe("de-DE");
    const unsupported = document.createElement("div");
    renderWorkspaceSettings(unsupported as unknown as HTMLElement, { theme: "system", input_language: "auto", output_language: null }, { browserLocale: "pt-PT" } as any);
    expect(unsupported.querySelector("#output-language-select")?.value).toBe("en-US");
  });

  it("the workspace sends the resolved supported tag, not raw navigator.language", async () => {
    setupMockDOM();
    const { calls } = fakeApi();
    vi.stubGlobal("navigator", { language: "pt-PT" });
    try {
      const features = createWorkspaceFeatures({ notebookId: "nb-1", notebookTitle: "Alpha" });
      features.onSelectionChange([{ id: "s-1", status: "Ready", revision: 1 } as any], ["s-1"]);
      await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/overview"))).toBe(true), { timeout: 2000 });
      expect(calls.find((c) => c.url.endsWith("/overview"))!.body.output_language).toBe("en-US");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
