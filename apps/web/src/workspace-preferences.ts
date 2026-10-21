import type { NotebookSortOrder, NotebookTheme, NotebookViewMode } from "@everlast/contracts";
import {
  InputLanguageSchema,
  NotebookSortOrderSchema,
  NotebookThemeSchema,
  NotebookViewModeSchema,
  NullableOutputLanguageSchema,
  resolveOutputLanguage,
  SUPPORTED_OUTPUT_LANGUAGES,
} from "./lib/v2-contracts.ts";

/** Kept in this browser's localStorage (FR-WM-03 view/sort only here; FR-UI-02 theme also on the server). */
export interface LocalWorkspacePreferences {
  view_mode: NotebookViewMode;
  sort_order: NotebookSortOrder;
  theme: NotebookTheme;
}

/** Settings panel state: the server-side owner preferences (FR-UI-02). View mode and sort order are not part of it. */
export interface WorkspaceSettingsState {
  theme: NotebookTheme;
  input_language: string;
  output_language: string | null;
  notebook_input_language?: string | null;
  notebook_output_language?: string | null;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}


export async function hydrateWorkspaceSettings(
  initial: WorkspaceSettingsState,
  options?: { apiBase?: string; headers?: HeadersInit; notebookId?: string; fetcher?: typeof fetch },
): Promise<WorkspaceSettingsState> {
  let settings = { ...initial };
  const api = options?.apiBase ?? "";
  const request = options?.fetcher ?? globalThis.fetch;
  try {
    const response = await request(`${api}/api/preferences`, { headers: options?.headers ?? {} });
    if (response.ok) {
      const saved = await response.json() as Record<string, unknown>;
      if (NotebookThemeSchema.safeParse(saved.theme).success) settings.theme = saved.theme as NotebookTheme;
      if (InputLanguageSchema.safeParse(saved.input_language).success) settings.input_language = saved.input_language as string;
      if (NullableOutputLanguageSchema.safeParse(saved.output_language).success) settings.output_language = saved.output_language as string | null;
    }
  } catch {
    // Browser-mirrored preferences remain available when the API is unreachable.
  }
  if (options?.notebookId) {
    try {
      const response = await request(`${api}/api/notebooks/${encodeURIComponent(options.notebookId)}/preferences`, { headers: options.headers ?? {} });
      if (response.ok) {
        const saved = await response.json() as Record<string, unknown>;
        if (InputLanguageSchema.nullable().safeParse(saved.notebook_input_language).success) {
          settings.notebook_input_language = saved.notebook_input_language as string | null;
        }
        if (NullableOutputLanguageSchema.safeParse(saved.notebook_output_language).success) {
          settings.notebook_output_language = saved.notebook_output_language as string | null;
        }
      }
    } catch {
      // Notebook settings remain at their owner-preference fallback.
    }
  }
  return settings;
}

export const WORKSPACE_PREFS_KEY = "everlast.v2.workspace";
export const DEFAULT_LOCAL_WORKSPACE_PREFERENCES: LocalWorkspacePreferences = {
  view_mode: "grid",
  sort_order: "recent",
  theme: "system",
};

function getStorage(storage?: KeyValueStorage): KeyValueStorage | undefined {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return undefined;
}

export function loadWorkspacePreferences(storage?: KeyValueStorage): LocalWorkspacePreferences {
  const target = getStorage(storage);
  if (!target) return { ...DEFAULT_LOCAL_WORKSPACE_PREFERENCES };
  try {
    const raw = target.getItem(WORKSPACE_PREFS_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_WORKSPACE_PREFERENCES };
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      view_mode: NotebookViewModeSchema.parse(value.view_mode),
      sort_order: NotebookSortOrderSchema.parse(value.sort_order),
      theme: NotebookThemeSchema.parse(value.theme),
    };
  } catch {
    return { ...DEFAULT_LOCAL_WORKSPACE_PREFERENCES };
  }
}

/** Saves the theme to localStorage and keeps this browser's view mode and sort order (FR-WM-03, FR-UI-02). */
export function saveThemePreference(theme: NotebookTheme, storage?: KeyValueStorage): void {
  saveWorkspacePreferences({ ...loadWorkspacePreferences(storage), theme }, storage);
}

/**
 * The server theme arrives after first paint: it replaces the local one and is written to localStorage, so the
 * next load's pre-paint script paints it (FR-UI-02, FR-010).
 */
export function adoptServerTheme(theme: NotebookTheme, root: HTMLElement, storage?: KeyValueStorage, prefersDark?: boolean): void {
  applyTheme(theme, root, systemPrefersDark(prefersDark));
  saveThemePreference(theme, storage);
}

function browserLanguage(): string | undefined {
  return typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : undefined;
}

/** Effective output language in the browser: notebook language > user default > supported browser locale > en-US. */
export function effectiveOutputLanguage(
  settings: Pick<WorkspaceSettingsState, "output_language" | "notebook_output_language">,
  browserLocale: string | undefined = browserLanguage(),
): string {
  return resolveOutputLanguage({
    notebookDefault: settings.notebook_output_language ?? null,
    userDefault: settings.output_language,
    browserLocale: browserLocale ?? null,
  });
}

export function saveWorkspacePreferences(preferences: LocalWorkspacePreferences, storage?: KeyValueStorage): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    const validated: LocalWorkspacePreferences = {
      view_mode: NotebookViewModeSchema.parse(preferences.view_mode),
      sort_order: NotebookSortOrderSchema.parse(preferences.sort_order),
      theme: NotebookThemeSchema.parse(preferences.theme),
    };
    target.setItem(WORKSPACE_PREFS_KEY, JSON.stringify(validated));
  } catch {
    // Storage access and corrupted preferences must not prevent the workspace from opening.
  }
}

function systemPrefersDark(fallback?: boolean): boolean {
  if (fallback !== undefined) return fallback;
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function resolveTheme(theme: NotebookTheme, prefersDark = systemPrefersDark()): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: NotebookTheme, root: HTMLElement, prefersDark = systemPrefersDark()): void {
  const resolved = resolveTheme(theme, prefersDark);
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-mode", theme);
  root.style.colorScheme = resolved;
}

export function initializeTheme(root: HTMLElement, storage?: KeyValueStorage, prefersDark?: boolean): void {
  const preferences = loadWorkspacePreferences(storage);
  applyTheme(preferences.theme, root, systemPrefersDark(prefersDark));
  registerSystemThemeListener(root);
}

const systemThemeListeners = new WeakMap<HTMLElement, { media: MediaQueryList; listener: (event: MediaQueryListEvent) => void }>();

function registerSystemThemeListener(root: HTMLElement): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const prior = systemThemeListeners.get(root);
  if (prior) prior.media.removeEventListener?.("change", prior.listener);
  const listener = (event: MediaQueryListEvent) => {
    if (root.getAttribute("data-theme-mode") === "system") applyTheme("system", root, event.matches);
  };
  media.addEventListener?.("change", listener);
  systemThemeListeners.set(root, { media, listener });
}

/** UI locale for collation: the document language, else the browser language. */
function uiLocale(): string | undefined {
  const lang = typeof document !== "undefined" ? document.documentElement?.getAttribute?.("lang") : null;
  return lang || browserLanguage();
}

function titleCollator(locale: string | undefined): Intl.Collator {
  try {
    return new Intl.Collator(locale, { sensitivity: "base" });
  } catch {
    return new Intl.Collator(undefined, { sensitivity: "base" });
  }
}

/**
 * Pinned first, then the selected order (FR-WM-03). Title order is case-insensitive through `Intl.Collator` for
 * the UI locale; equal titles (and every other tie) fall back to `created_at` descending, then `id`.
 */
export function sortNotebookRows<T extends {
  id: string;
  title: string;
  created_at: string;
  is_pinned: boolean;
  last_opened_at: string | null;
}>(items: T[], sort: NotebookSortOrder, locale: string | undefined = uiLocale()): T[] {
  const instant = (value: string) => Date.parse(value) || 0;
  const collator = titleCollator(locale);
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    let order = 0;
    if (sort === "title_asc") {
      order = collator.compare(a.title, b.title);
    } else if (sort === "recent") {
      order = instant(b.last_opened_at ?? b.created_at) - instant(a.last_opened_at ?? a.created_at);
    }
    return order || instant(b.created_at) - instant(a.created_at) || a.id.localeCompare(b.id);
  });
}

function addOption(select: HTMLSelectElement, value: string, label: string): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

export function renderWorkspaceSettings(
  container: HTMLElement,
  preferences: WorkspaceSettingsState,
  options?: {
    root?: HTMLElement;
    storage?: KeyValueStorage;
    prefersDark?: boolean;
    onUpdate?: (preferences: WorkspaceSettingsState, changedKey: keyof WorkspaceSettingsState) => void | Promise<void>;
    notebookId?: string;
    /** Browser locale for the default output language (defaults to `navigator.language`). */
    browserLocale?: string;
  },
): void {
  container.innerHTML = "";
  const section = document.createElement("section");
  section.id = "workspace-settings-panel";
  section.className = "workspace-settings";
  const title = document.createElement("h2");
  title.textContent = "Workspace settings";
  section.appendChild(title);

  let current: WorkspaceSettingsState = { ...preferences };
  // With no saved user language the select shows the default the server would use: supported browser locale,
  // else en-US (FR-UI-02, FR-012).
  const defaultOutput = resolveOutputLanguage({ browserLocale: options?.browserLocale ?? browserLanguage() ?? null });
  const root = options?.root ?? document.documentElement;

  const createSelect = (id: string, labelText: string, value: string, key: keyof WorkspaceSettingsState, choices: { value: string; label: string }[]) => {
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;
    const select = document.createElement("select");
    select.id = id;
    select.setAttribute("aria-label", labelText);
    select.value = value;
    for (const choice of choices) addOption(select, choice.value, choice.label);
    select.value = value;
    select.addEventListener("change", () => {
      const next = { ...current, [key]: select.value } as WorkspaceSettingsState;
      current = next;
      if (key === "theme") {
        saveThemePreference(next.theme, options?.storage);
        applyTheme(next.theme, root, systemPrefersDark(options?.prefersDark));
      }
      void options?.onUpdate?.({ ...next }, key);
    });
    section.appendChild(label);
    section.appendChild(select);
  };

  createSelect("theme-select", "Theme", current.theme, "theme", [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ]);
  createSelect("input-language-select", "Input language", current.input_language || "auto", "input_language", [
    { value: "auto", label: "Detect automatically" },
    ...SUPPORTED_OUTPUT_LANGUAGES.map(({ tag, name }) => ({ value: tag, label: name })),
  ]);
  createSelect("output-language-select", "Output language", current.output_language ?? defaultOutput, "output_language", [
    ...SUPPORTED_OUTPUT_LANGUAGES.map(({ tag, name }) => ({ value: tag, label: name })),
  ]);
  if (options?.notebookId) {
    createSelect("notebook-input-language-select", "Notebook input language", current.notebook_input_language ?? "", "notebook_input_language", [
      { value: "", label: "Use owner preference" },
      { value: "auto", label: "Detect automatically" },
      ...SUPPORTED_OUTPUT_LANGUAGES.map(({ tag, name }) => ({ value: tag, label: name })),
    ]);
    createSelect("notebook-output-language-select", "Notebook output language", current.notebook_output_language ?? "", "notebook_output_language", [
      { value: "", label: "Use owner preference" },
      ...SUPPORTED_OUTPUT_LANGUAGES.map(({ tag, name }) => ({ value: tag, label: name })),
    ]);
  }
  container.appendChild(section);
}
