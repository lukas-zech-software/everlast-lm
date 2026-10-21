import { api, ApiError, authFetch } from "./lib/api.ts";
import { clear, confirmDialog, h, toast } from "./lib/dom.ts";
import { validateTitle } from "./lib/text.ts";
import type { NotebookDto } from "./lib/types.ts";
import {
  adoptServerTheme,
  hydrateWorkspaceSettings,
  loadWorkspacePreferences,
  renderWorkspaceSettings,
  saveWorkspacePreferences,
  sortNotebookRows,
  type LocalWorkspacePreferences,
  type WorkspaceSettingsState,
} from "./workspace-preferences.ts";

/**
 * Notebook home (FR-WM-01): cards, create (default title, opens Add sources), rename via card menu, delete.
 * Release v2 (FR-WM-02, FR-WM-03, FR-UI-02): icon, Ready-source count, pin, grid/list view, sort and settings.
 * View mode and sort order are kept only in this browser's localStorage; the theme also on the server.
 */

/** Notebook row as listed by the API; the v2 fields are present when the release v2 runtime is enabled. */
type HomeNotebook = NotebookDto & {
  icon_emoji?: string;
  ready_source_count?: number;
  is_pinned?: boolean;
  last_opened_at?: string | null;
};

const ICON_CHOICES = ["📓", "📚", "🧬", "🔬", "💡", "🪐", "🌱", "📈", "🎓"];

export interface Navigator {
  go(path: string, state?: Record<string, unknown>): void;
}

function uuid(): string {
  return crypto.randomUUID();
}

export async function createNotebookAndOpen(nav: Navigator, button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  const key = uuid();
  try {
    let result: { notebook: NotebookDto } | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await api<{ notebook: NotebookDto }>("/api/notebooks", { method: "POST", json: {}, headers: { "idempotency-key": key } });
      } catch (err) {
        // Network retry reuses the same key; server errors are shown.
        if (err instanceof ApiError || attempt === 1) throw err;
      }
    }
    nav.go(`/notebook/${result!.notebook.id}`, { addSources: true });
  } catch (err) {
    toast(err instanceof ApiError && err.code === "NotebookQuotaExceeded" ? "You have reached the limit of 100 notebooks." : "Could not create notebook. Please try again.");
  } finally {
    if (button) button.disabled = false;
  }
}

export async function renderHome(root: HTMLElement, nav: Navigator): Promise<void> {
  clear(root);
  let prefs: LocalWorkspacePreferences = loadWorkspacePreferences();
  const grid = h("div", { class: "notebook-grid", "data-testid": "notebook-grid" });
  const createButton = h("button", { class: "btn btn-primary", "data-testid": "create-notebook", text: "+ Create new" });
  createButton.addEventListener("click", () => void createNotebookAndOpen(nav, createButton));
  const counter = h("span", { class: "muted", "data-testid": "notebook-counter" });

  const settingsPanel = h("div", { class: "workspace-settings-host", "data-testid": "workspace-settings", hidden: true });
  const settingsToggle = h("button", { class: "btn btn-sm", "data-testid": "workspace-settings-toggle", "aria-expanded": "false", text: "Settings" });
  let settings: WorkspaceSettingsState = { theme: prefs.theme, input_language: "auto", output_language: null };
  const patchPreference = (key: string, value: unknown) =>
    authFetch("/api/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [key]: value }) }).catch(() => undefined);
  settingsToggle.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsToggle.setAttribute("aria-expanded", String(!settingsPanel.hidden));
    if (!settingsPanel.hidden) {
      renderWorkspaceSettings(settingsPanel, settings, {
        onUpdate: async (next, key) => {
          settings = next;
          await patchPreference(key, next[key]);
        },
      });
    }
  });
  void hydrateWorkspaceSettings(settings, { fetcher: authFetch }).then((loaded) => {
    settings = loaded;
    adoptServerTheme(loaded.theme, document.documentElement);
    prefs = { ...prefs, theme: loaded.theme };
  });

  const viewButtons = (["grid", "list"] as const).map((view) => {
    const button = h("button", { class: "btn btn-sm", "data-testid": `notebook-view-${view}`, "aria-pressed": String(prefs.view_mode === view), text: view === "grid" ? "Grid" : "List" });
    button.addEventListener("click", () => setPrefs({ view_mode: view }));
    return button;
  });
  const sort = h(
    "select",
    { class: "notebook-sort", "data-testid": "notebook-sort", "aria-label": "Sort notebooks" },
    h("option", { value: "recent", text: "Most recently opened" }),
    h("option", { value: "title_asc", text: "Title (A–Z)" }),
    h("option", { value: "created_desc", text: "Created date (newest first)" })
  );
  sort.value = prefs.sort_order;
  sort.addEventListener("change", () => setPrefs({ sort_order: sort.value as LocalWorkspacePreferences["sort_order"] }));

  root.append(
    h(
      "main",
      { class: "home" },
      h("div", { class: "home-header" }, h("h1", { text: "Notebooks" }), counter, h("div", { class: "grow" }), settingsToggle, createButton),
      settingsPanel,
      h("div", { class: "notebook-overview-controls" }, h("div", { role: "group", "aria-label": "Notebook view" }, ...viewButtons), sort),
      grid
    )
  );

  const { notebooks, notebooks_used, notebook_limit } = await api<{ notebooks: HomeNotebook[]; notebooks_used: number; notebook_limit: number }>("/api/notebooks");
  counter.textContent = `${notebooks_used} / ${notebook_limit} notebooks`;
  if (notebooks_used >= notebook_limit) createButton.disabled = true;

  const render = () => {
    clear(grid);
    grid.dataset.viewMode = prefs.view_mode;
    grid.classList.toggle("notebook-list", prefs.view_mode === "list");
    viewButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(prefs.view_mode === (i === 0 ? "grid" : "list"))));
    // FR-WM-03 / FR-009: an empty overview offers creation and has nothing to sort.
    sort.disabled = notebooks.length === 0;
    if (notebooks.length === 0) {
      const cta = h("button", { class: "btn btn-primary empty-home", "data-testid": "empty-home", text: "Create your first notebook" });
      cta.addEventListener("click", () => void createNotebookAndOpen(nav, cta));
      grid.append(cta);
    }
    const rows = notebooks.map((n) => ({ ...n, is_pinned: n.is_pinned ?? false, last_opened_at: n.last_opened_at ?? null }));
    for (const notebook of sortNotebookRows(rows, prefs.sort_order)) {
      grid.append(renderCard(notebook, nav, () => void renderHome(root, nav), (patch) => {
        Object.assign(notebooks.find((n) => n.id === notebook.id)!, patch);
        render();
      }));
    }
  };
  /** View mode and sort order: localStorage only, never sent to the server (FR-WM-03, FR-008). */
  const setPrefs = (patch: Partial<Pick<LocalWorkspacePreferences, "view_mode" | "sort_order">>) => {
    // The theme may have changed in Settings meanwhile; keep the stored one.
    prefs = { ...prefs, ...patch, theme: loadWorkspacePreferences().theme };
    saveWorkspacePreferences(prefs);
    render();
  };
  render();
}

function renderCard(
  notebook: HomeNotebook,
  nav: Navigator,
  refresh: () => void,
  update: (patch: Partial<HomeNotebook>) => void = () => undefined
): HTMLElement {
  const title = h("h2", { class: "card-title", "data-testid": "card-title", text: notebook.title });
  const menuButton = h("button", { class: "icon-btn", "aria-label": "Notebook actions", "data-testid": "card-menu", text: "⋮" });
  const menu = h(
    "div",
    { class: "menu", hidden: true, role: "menu" },
    h("button", { role: "menuitem", "data-action": "rename", text: "Rename" }),
    h("button", { role: "menuitem", "data-action": "delete", class: "danger", text: "Delete" })
  );
  const v2 = notebook.icon_emoji !== undefined;
  const iconPicker = v2 ? renderIconPicker(notebook, update) : null;
  const pin = v2
    ? h("button", { class: "icon-btn notebook-pin", "data-testid": "notebook-pin", "aria-pressed": String(Boolean(notebook.is_pinned)), "aria-label": notebook.is_pinned ? "Unpin notebook" : "Pin notebook", text: notebook.is_pinned ? "★" : "☆" })
    : null;
  pin?.addEventListener("click", async () => {
    const next = !notebook.is_pinned;
    const res = await authFetch(`/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_pinned: next }) }).catch(() => null);
    if (res?.ok) update({ is_pinned: next });
    else toast("Could not update the pin.");
  });
  const card = h(
    "article",
    { class: "notebook-card", "data-testid": "notebook-card", "data-notebook-id": notebook.id, tabindex: 0 },
    h("div", { class: "card-head" }, ...(iconPicker ? [iconPicker] : []), title, ...(pin ? [pin] : []), menuButton, menu),
    h("p", { class: "muted", text: `Updated ${new Date(notebook.updated_at).toLocaleString()}` }),
    ...(v2
      ? [
          h(
            "p",
            { class: "muted notebook-meta" },
            h("span", { class: "notebook-source-count", "data-testid": "notebook-source-count", text: `${notebook.ready_source_count ?? 0} ${(notebook.ready_source_count ?? 0) === 1 ? "source" : "sources"}` }),
            " · ",
            h("span", { class: "notebook-created-date", text: `Created ${new Date(notebook.created_at).toLocaleDateString()}` }),
            " · ",
            h("span", { class: "notebook-role", "data-testid": "notebook-role", text: "Owner" })
          ),
        ]
      : [])
  );
  card.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".card-head button, .card-head select, .menu, input")) return;
    nav.go(`/notebook/${notebook.id}`);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target === card) nav.go(`/notebook/${notebook.id}`);
  });
  menuButton.addEventListener("click", () => (menu.hidden = !menu.hidden));
  menu.addEventListener("click", async (event) => {
    const action = (event.target as HTMLElement).getAttribute("data-action");
    menu.hidden = true;
    if (action === "rename") startCardRename(card, title, notebook);
    if (action === "delete") {
      const ok = await confirmDialog({ title: "Delete notebook?", body: `"${notebook.title}" and all its sources and chat history will be permanently deleted.`, confirm: "Delete", danger: true });
      if (!ok) return;
      try {
        await api(`/api/notebooks/${notebook.id}`, { method: "DELETE" });
        refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) refresh();
        else toast("Could not delete notebook. Please try again.");
      }
    }
  });
  return card;
}

/**
 * Notebook icon picker for home cards and the workspace header (FR-WM-02): any listed emoji; the server validates
 * one grapheme, and a rejected choice keeps the current icon.
 */
export function renderIconPicker(
  notebook: { id: string; title: string; icon_emoji?: string },
  update: (patch: { icon_emoji: string }) => void,
  testId = "notebook-icon"
): HTMLSelectElement {
  const picker = h("select", { class: "notebook-icon-picker", "data-testid": testId, "aria-label": `Change icon for ${notebook.title}` });
  for (const emoji of new Set([notebook.icon_emoji!, ...ICON_CHOICES])) picker.append(h("option", { value: emoji, text: emoji }));
  picker.value = notebook.icon_emoji!;
  picker.addEventListener("change", async () => {
    const res = await authFetch(`/api/notebooks/${notebook.id}/icon`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ icon_emoji: picker.value }) }).catch(() => null);
    if (res?.ok) {
      notebook.icon_emoji = picker.value;
      update({ icon_emoji: picker.value });
    } else {
      picker.value = notebook.icon_emoji!;
      toast("Could not save the notebook icon.");
    }
  });
  return picker;
}

function startCardRename(card: HTMLElement, title: HTMLElement, notebook: NotebookDto): void {
  const input = h("input", { class: "title-input", value: notebook.title, "data-testid": "card-title-input", "aria-label": "Notebook title" });
  title.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save: boolean) => {
    if (done) return;
    done = true;
    if (save) {
      const result = validateTitle(input.value);
      if (!result.ok) {
        toast(result.message);
      } else if (result.value !== notebook.title) {
        try {
          const updated = await api<{ notebook: NotebookDto }>(`/api/notebooks/${notebook.id}`, { method: "PATCH", json: { title: result.value } });
          notebook.title = updated.notebook.title;
        } catch {
          toast("Could not rename notebook. The previous title was kept.");
        }
      }
    }
    title.textContent = notebook.title;
    input.replaceWith(title);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void finish(true);
    if (event.key === "Escape") void finish(false);
  });
  input.addEventListener("blur", () => void finish(true));
  void card;
}
