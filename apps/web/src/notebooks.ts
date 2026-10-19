import type { Notebook, NotebookOverviewItem, NotebookSortOrder, NotebookViewMode } from "@everlast/contracts";
import { setupTitleEditor, showToast } from "./notebook-title.js";
import { showDeleteConfirmationModal } from "./delete-notebook.js";
import { applyTheme, hydrateWorkspaceSettings, loadWorkspacePreferences, saveWorkspacePreferences, sortNotebookRows, renderWorkspaceSettings, type LocalWorkspacePreferences, type WorkspaceSettingsState } from "./workspace-preferences.js";

export interface NotebookHomeOptions {
  apiBase?: string;
  authToken?: string;
  onNavigate?: (path: string) => void;
  initialNotebooks?: NotebookOverviewItem[];
  initialPreferences?: WorkspaceSettingsState;
}

interface OverviewOptions {
  locale?: string;
  onPreferencesChange?: (preferences: LocalWorkspacePreferences) => void;
  onPinChange?: (notebookId: string, isPinned: boolean) => Promise<void> | void;
  onIconChange?: (notebookId: string, icon: string) => Promise<void> | void;
  onOpen?: (notebookId: string) => void;
  onNavigate?: (path: string) => void;
  onDelete?: (notebookId: string, title: string) => void;
  onRename?: (notebookId: string, title: string) => Promise<void>;
}

const iconChoices = ["📓", "📚", "🧬", "🔬", "💡", "🪐", "🌱", "📈", "🎓"];

function formatSourceCount(count: number, locale?: string): string {
  return locale?.toLowerCase().startsWith("de") ? `${count} Quellen` : `${count} ${count === 1 ? "source" : "sources"}`;
}

function dateLabel(value: string, locale?: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale);
}

export function renderNotebookOverview(
  container: HTMLElement,
  notebooks: NotebookOverviewItem[],
  initialPreferences: Pick<LocalWorkspacePreferences, "view_mode" | "sort_order">,
  options?: OverviewOptions,
): void {
  let preferences: LocalWorkspacePreferences = { ...loadWorkspacePreferences(), ...initialPreferences, theme: loadWorkspacePreferences().theme };
  const render = () => {
    container.innerHTML = "";
    const hasRows = notebooks.length > 0;
    if (hasRows) {
      const controls = document.createElement("div");
      controls.className = "notebook-overview-controls";
      const viewControls = document.createElement("div");
      viewControls.setAttribute("role", "group");
      viewControls.setAttribute("aria-label", "Notebook view");
      for (const view of ["grid", "list"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = `notebook-view-${view}`;
        button.textContent = view === "grid" ? "Grid" : "List";
        button.setAttribute("aria-pressed", String(preferences.view_mode === view));
        button.addEventListener("click", () => changePreferences({ view_mode: view }));
        viewControls.appendChild(button);
      }
      const sort = document.createElement("select");
      sort.id = "notebook-sort";
      sort.setAttribute("aria-label", "Sort notebooks");
      const sortChoices: { value: NotebookSortOrder; label: string }[] = [
        { value: "recent", label: "Most recently opened" },
        { value: "title_asc", label: "Title (A–Z)" },
        { value: "created_desc", label: "Created date (newest first)" },
      ];
      for (const { value, label } of sortChoices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        sort.appendChild(option);
      }
      sort.value = preferences.sort_order;
      sort.addEventListener("change", () => changePreferences({ sort_order: sort.value as NotebookSortOrder }));
      controls.appendChild(viewControls);
      controls.appendChild(sort);
      container.appendChild(controls);
    }

    const list = document.createElement("div");
    list.id = "notebook-list";
    list.className = preferences.view_mode === "grid" ? "notebook-overview-grid notebook-grid" : "notebook-overview-list notebook-list";
    list.setAttribute("data-view-mode", preferences.view_mode);
    if (!hasRows) {
      const empty = document.createElement("div");
      empty.className = "notebook-empty-state";
      const emptyMessage = document.createElement("p");
      emptyMessage.textContent = "Create your first notebook";
      empty.appendChild(emptyMessage);
      const create = document.createElement("button");
      create.type = "button";
      create.className = "btn btn-primary notebook-empty-create";
      create.textContent = "+ New Notebook";
      create.addEventListener("click", () => document.getElementById("new-notebook-btn")?.click());
      empty.appendChild(create);
      list.appendChild(empty);
      container.appendChild(list);
      return;
    }

    for (const item of sortNotebookRows(notebooks, preferences.sort_order)) {
      const card = document.createElement("article");
      card.className = `notebook-card${preferences.view_mode === "list" ? " notebook-row" : ""}`;
      card.setAttribute("data-id", item.id);
      const icon = document.createElement("span");
      icon.className = "notebook-icon";
      icon.textContent = item.icon_emoji;
      icon.setAttribute("aria-hidden", "true");
      card.appendChild(icon);
      const title = document.createElement("h3");
      title.className = "notebook-title";
      title.textContent = item.title;
      card.appendChild(title);
      if (options?.onRename) {
        setupTitleEditor(title, item.title, async (newTitle) => {
          await options.onRename?.(item.id, newTitle);
          item.title = newTitle;
        });
      }
      const role = document.createElement("span");
      role.className = "notebook-role";
      role.textContent = item.owner_role ?? "Owner";
      role.hidden = preferences.view_mode !== "list";
      card.appendChild(role);
      const created = document.createElement("time");
      created.className = "notebook-created-date";
      created.dateTime = item.created_at;
      created.textContent = `Created ${dateLabel(item.created_at, options?.locale)}`;
      card.appendChild(created);
      const modified = document.createElement("time");
      modified.className = "notebook-modified-date notebook-date";
      modified.dateTime = item.updated_at;
      modified.textContent = `Modified ${dateLabel(item.updated_at, options?.locale)}`;
      card.appendChild(modified);
      const count = document.createElement("span");
      count.className = "notebook-source-count";
      count.textContent = formatSourceCount(item.ready_source_count, options?.locale);
      card.appendChild(count);

      const picker = document.createElement("select");
      picker.className = "notebook-icon-picker";
      picker.setAttribute("aria-label", `Change icon for ${item.title}`);
      for (const emoji of new Set([item.icon_emoji, ...iconChoices])) {
        const option = document.createElement("option");
        option.value = emoji;
        option.textContent = emoji;
        picker.appendChild(option);
      }
      picker.value = item.icon_emoji;
      picker.addEventListener("click", (event) => event.stopPropagation());
      picker.addEventListener("change", async () => {
        const oldIcon = item.icon_emoji;
        const newIcon = picker.value;
        item.icon_emoji = newIcon;
        icon.textContent = newIcon;
        try {
          await options?.onIconChange?.(item.id, newIcon);
        } catch (error) {
          item.icon_emoji = oldIcon;
          icon.textContent = oldIcon;
          showToast(error instanceof Error ? error.message : "Could not save notebook icon", true);
        }
      });
      card.appendChild(picker);

      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "notebook-pin";
      pin.textContent = item.is_pinned ? "★" : "☆";
      pin.setAttribute("aria-label", `${item.is_pinned ? "Unpin" : "Pin"} notebook`);
      pin.addEventListener("click", async (event) => {
        event.stopPropagation();
        const oldPin = item.is_pinned;
        item.is_pinned = !oldPin;
        try {
          await options?.onPinChange?.(item.id, item.is_pinned);
          render();
        } catch (error) {
          item.is_pinned = oldPin;
          showToast(error instanceof Error ? error.message : "Could not update pin", true);
        }
      });
      card.appendChild(pin);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-icon btn-delete-notebook";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete ${item.title}`);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        options?.onDelete?.(item.id, item.title);
      });
      card.appendChild(remove);

      title.addEventListener("click", (event) => event.stopPropagation());
      card.addEventListener("click", () => {
        if (options?.onOpen) options.onOpen(item.id);
        else if (options?.onNavigate) options.onNavigate(`/notebook/${item.id}`);
      });
      list.appendChild(card);
    }
    container.appendChild(list);
  };

  const changePreferences = (patch: Partial<LocalWorkspacePreferences>) => {
    preferences = { ...preferences, ...patch };
    saveWorkspacePreferences(preferences);
    options?.onPreferencesChange?.({ ...preferences });
    const changed = Object.keys(patch)[0];
    const list = container.querySelector("#notebook-list");
    if (list && changed === "view_mode") {
      list.className = preferences.view_mode === "grid"
        ? "notebook-overview-grid notebook-grid"
        : "notebook-overview-list notebook-list";
      list.setAttribute("data-view-mode", preferences.view_mode);
      for (const card of Array.from(list.querySelectorAll(".notebook-card"))) {
        card.classList.toggle("notebook-row", preferences.view_mode === "list");
        const role = card.querySelector(".notebook-role");
        if (role) (role as HTMLElement).hidden = preferences.view_mode !== "list";
      }
      for (const view of ["grid", "list"] as const) {
        container.querySelector(`#notebook-view-${view}`)?.setAttribute("aria-pressed", String(preferences.view_mode === view));
      }
      return;
    }
    if (list && changed === "sort_order") {
      const cards = new Map(Array.from(list.querySelectorAll(".notebook-card")).map((card) => [card.getAttribute("data-id"), card]));
      for (const item of sortNotebookRows(notebooks, preferences.sort_order)) {
        const card = cards.get(item.id);
        if (card) list.appendChild(card);
      }
      const sort = container.querySelector("#notebook-sort");
      if (sort) (sort as HTMLSelectElement).value = preferences.sort_order;
      return;
    }
    render();
  };

  render();
}

export function renderNotebookList(container: HTMLElement, notebooks: Notebook[], options?: NotebookHomeOptions): void {
  const list = container.querySelector("#notebook-list");
  if (!list) return;
  renderNotebookOverview(list as HTMLElement, notebooks.map((notebook) => ({
    ...notebook,
    icon_emoji: (notebook as NotebookOverviewItem).icon_emoji ?? "📓",
    icon_source: (notebook as NotebookOverviewItem).icon_source ?? "default",
    ready_source_count: (notebook as NotebookOverviewItem).ready_source_count ?? 0,
    is_pinned: (notebook as NotebookOverviewItem).is_pinned ?? false,
    last_opened_at: (notebook as NotebookOverviewItem).last_opened_at ?? null,
    owner_role: "Owner",
  })), loadWorkspacePreferences(), {
    onNavigate: options?.onNavigate,
  } as OverviewOptions);
}

export function renderNotebookHome(container: HTMLElement, options?: NotebookHomeOptions): void {
  container.innerHTML = `
    <div class="notebook-home-container">
      <header class="home-header">
        <h1 class="home-title">Everlast LM</h1>
        <div class="home-actions">
          <button id="workspace-settings-toggle" type="button" aria-expanded="false">Settings</button>
          <button id="new-notebook-btn" class="btn btn-primary" type="button">+ New Notebook</button>
        </div>
      </header>
      <div id="workspace-settings" hidden></div>
      <div id="notebook-overview"></div>
    </div>
  `;
  const localPreferences = loadWorkspacePreferences();
  let notebooks: NotebookOverviewItem[] = options?.initialNotebooks ?? [];
  let settings: WorkspaceSettingsState = options?.initialPreferences ?? {
    ...localPreferences,
    input_language: "auto",
    output_language: null,
  };
  const settingsContainer = container.querySelector("#workspace-settings") as HTMLElement;
  const listContainer = container.querySelector("#notebook-overview") as HTMLElement;
  const authHeaders = options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {};
  const api = options?.apiBase ?? "";
  const savePrefs = async (preferences: LocalWorkspacePreferences) => {
    try {
      await fetch(`${api}/api/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ view_mode: preferences.view_mode, sort_order: preferences.sort_order }),
      });
    } catch {
      // Local preference remains available if the API is unreachable.
    }
  };
  const renderOverview = () => renderNotebookOverview(listContainer, notebooks, localPreferences, {
    ...(settings.output_language ? { locale: settings.output_language } : {}),
    onPreferencesChange: (next) => { Object.assign(localPreferences, next); void savePrefs(next); },
    onPinChange: async (id, isPinned) => {
      const response = await fetch(`${api}/api/notebooks/${id}/preferences`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ is_pinned: isPinned }),
      });
      if (!response.ok) throw new Error(`Could not save pin preference (HTTP ${response.status})`);
    },
    onIconChange: async (id, icon) => {
      const response = await fetch(`${api}/api/notebooks/${id}/icon`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ icon_emoji: icon }),
      });
      if (!response.ok) throw new Error(`Could not save notebook icon (HTTP ${response.status})`);
    },
    onOpen: (id) => {
      void fetch(`${api}/api/notebooks/${id}/opened`, { method: "POST", headers: authHeaders });
      const search = typeof window !== "undefined" ? window.location.search : "";
      const target = `/notebook/${id}${search}`;
      if (options?.onNavigate) options.onNavigate(target);
      else if (typeof window !== "undefined") window.location.href = target;
    },
    onRename: async (id, title) => {
      const response = await fetch(`${api}/api/notebooks/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(`Could not rename notebook (HTTP ${response.status})`);
    },
    onDelete: (id, title) => showDeleteConfirmationModal(id, title, async () => {
      const response = await fetch(`${api}/api/notebooks/${id}`, { method: "DELETE", headers: authHeaders });
      if (!response.ok && response.status !== 404) throw new Error(`Failed to delete notebook (HTTP ${response.status})`);
      notebooks = notebooks.filter((notebook) => notebook.id !== id);
      renderOverview();
    }),
  });

  const renderSettings = () => renderWorkspaceSettings(settingsContainer, settings, {
    root: document.documentElement,
    onUpdate: async (next, changedKey) => {
      settings = next;
      const value = next[changedKey];
      if (changedKey === "theme" || changedKey === "view_mode" || changedKey === "sort_order") {
        saveWorkspacePreferences(next);
      }
      await fetch(`${api}/api/preferences`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ [changedKey]: value }),
      }).catch(() => undefined);
      renderOverview();
    },
  });

  container.querySelector("#workspace-settings-toggle")?.addEventListener("click", () => {
    const toggle = container.querySelector("#workspace-settings-toggle") as HTMLButtonElement;
    settingsContainer.hidden = !settingsContainer.hidden;
    toggle.setAttribute("aria-expanded", String(!settingsContainer.hidden));
    if (!settingsContainer.hidden) renderSettings();
  });
  const newButton = container.querySelector("#new-notebook-btn") as HTMLButtonElement;
  newButton.addEventListener("click", async () => {
    newButton.disabled = true;
    try {
      const response = await fetch(`${api}/api/notebooks`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`Failed to create notebook (HTTP ${response.status})`);
      const result = await response.json() as { notebook: Notebook };
      const created = result.notebook;
      notebooks = [{ ...created, icon_emoji: "📓", icon_source: "default", ready_source_count: 0, is_pinned: false, last_opened_at: null, owner_role: "Owner" }, ...notebooks];
      renderOverview();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to create notebook", true);
    } finally {
      newButton.disabled = false;
    }
  });

  const hydrateSettings = async () => {
    settings = await hydrateWorkspaceSettings(settings, { apiBase: api, headers: authHeaders });
    Object.assign(localPreferences, {
      view_mode: settings.view_mode,
      sort_order: settings.sort_order,
      theme: settings.theme,
    });
    applyTheme(settings.theme, document.documentElement);
    if (!settingsContainer.hidden) renderSettings();
    renderOverview();
  };
  const load = async () => {
    if (!options?.initialNotebooks) {
      try {
        const response = await fetch(`${api}/api/notebooks`, { headers: authHeaders });
        if (!response.ok) throw new Error(`Could not load notebooks (HTTP ${response.status})`);
        const data = await response.json() as { notebooks: NotebookOverviewItem[] };
        notebooks = Array.isArray(data.notebooks) ? data.notebooks : [];
      } catch {
        notebooks = [];
      }
    }
    renderOverview();
  };
  void load();
  void hydrateSettings();
}
