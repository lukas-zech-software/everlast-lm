import { api, ApiError } from "./lib/api.ts";
import { clear, confirmDialog, h, toast } from "./lib/dom.ts";
import { validateTitle } from "./lib/text.ts";
import type { NotebookDto } from "./lib/types.ts";

/** Notebook home (FR-WM-01): cards, create (default title, opens Add sources), rename via card menu, delete. */

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
  const grid = h("div", { class: "notebook-grid", "data-testid": "notebook-grid" });
  const createButton = h("button", { class: "btn btn-primary", "data-testid": "create-notebook", text: "+ Create new" });
  createButton.addEventListener("click", () => void createNotebookAndOpen(nav, createButton));
  const counter = h("span", { class: "muted", "data-testid": "notebook-counter" });
  root.append(h("main", { class: "home" }, h("div", { class: "home-header" }, h("h1", { text: "Notebooks" }), counter, createButton), grid));

  const { notebooks, notebooks_used, notebook_limit } = await api<{ notebooks: NotebookDto[]; notebooks_used: number; notebook_limit: number }>("/api/notebooks");
  counter.textContent = `${notebooks_used} / ${notebook_limit} notebooks`;
  if (notebooks_used >= notebook_limit) createButton.disabled = true;
  if (notebooks.length === 0) grid.append(h("p", { class: "muted", "data-testid": "empty-home", text: "No notebooks yet. Create one to add sources." }));
  for (const notebook of notebooks) grid.append(renderCard(notebook, nav, () => void renderHome(root, nav)));
}

function renderCard(notebook: NotebookDto, nav: Navigator, refresh: () => void): HTMLElement {
  const title = h("h2", { class: "card-title", "data-testid": "card-title", text: notebook.title });
  const menuButton = h("button", { class: "icon-btn", "aria-label": "Notebook actions", "data-testid": "card-menu", text: "⋮" });
  const menu = h(
    "div",
    { class: "menu", hidden: true, role: "menu" },
    h("button", { role: "menuitem", "data-action": "rename", text: "Rename" }),
    h("button", { role: "menuitem", "data-action": "delete", class: "danger", text: "Delete" })
  );
  const card = h(
    "article",
    { class: "notebook-card", "data-testid": "notebook-card", "data-notebook-id": notebook.id, tabindex: 0 },
    h("div", { class: "card-head" }, title, menuButton, menu),
    h("p", { class: "muted", text: `Updated ${new Date(notebook.updated_at).toLocaleString()}` })
  );
  card.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".card-head button, .menu, input")) return;
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
