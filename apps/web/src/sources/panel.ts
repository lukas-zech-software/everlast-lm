import { api, ApiError } from "../lib/api.ts";
import { clear, h, toast } from "../lib/dom.ts";
import { SelectionModel } from "../lib/selection.ts";
import type { QuotaSummary, SourceDto } from "../lib/types.ts";

/**
 * Sources panel (FR-SI-01, FR-SI-03, FR-WM-07): server-authoritative capacity, upload/paste modal, status rows,
 * dismissible error rows, per-source checkboxes and "Select all sources" with indeterminate state.
 */

export interface SourcesPanelOptions {
  notebookId: string;
  selection: SelectionModel;
  onSelectionChange(): void;
  onOpenSource(sourceId: string): void;
  onNotebookMissing(): void;
}

export interface SourcesPanel {
  element: HTMLElement;
  refresh(): Promise<void>;
  sources(): SourceDto[];
  openAddSources(): void;
}

const ACCEPT = ".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown";
const ICONS: Record<string, string> = { "application/pdf": "📄", "text/plain": "📝", "text/markdown": "📝", copied_text: "📋" };

export function createSourcesPanel(options: SourcesPanelOptions): SourcesPanel {
  let sources: SourceDto[] = [];
  let quota: QuotaSummary | null = null;
  let firstLoad = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const counter = h("span", { class: "quota-count", "data-testid": "source-quota" });
  const addButton = h("button", { class: "btn btn-primary btn-sm", "data-testid": "add-source", text: "+ Add source" });
  const master = h("input", { type: "checkbox", "data-testid": "select-all", id: `select-all-${options.notebookId}` });
  const masterRow = h("label", { class: "source-row select-all", for: master.id }, h("span", { class: "grow", text: "Select all sources" }), master);
  const list = h("ul", { class: "source-list", "data-testid": "source-list" });
  const element = h("div", { class: "sources-panel" }, h("div", { class: "sources-toolbar" }, counter, addButton), masterRow, list);

  const atLimit = () => (quota ? quota.sources_used >= quota.source_limit : false);

  const renderCounter = () => {
    if (!quota) return;
    counter.textContent = `${quota.sources_used} / ${quota.source_limit} sources`;
    counter.classList.toggle("at-limit", atLimit());
    addButton.disabled = atLimit();
    addButton.title = atLimit() ? `Source limit of ${quota.source_limit} reached` : "";
  };

  /** Updates checkbox and master states in place (no re-render, so focus and element identity persist). */
  const updateChecks = () => {
    const state = options.selection.master();
    master.checked = state === "checked";
    master.indeterminate = state === "indeterminate";
    master.disabled = !sources.some((s) => s.status === "Ready");
    for (const row of list.querySelectorAll<HTMLElement>("[data-source-id]")) {
      const box = row.querySelector<HTMLInputElement>('[data-testid="source-checkbox"]');
      if (box) box.checked = options.selection.isSelected(row.dataset.sourceId!);
    }
  };

  const renderList = () => {
    clear(list);
    for (const source of sources) list.append(renderRow(source));
    if (sources.length === 0) list.append(h("li", { class: "muted empty", text: "Add sources to get started." }));
    updateChecks();
  };

  const renderRow = (source: SourceDto): HTMLElement => {
    const ready = source.status === "Ready";
    const checkbox = h("input", {
      type: "checkbox",
      "data-testid": "source-checkbox",
      "aria-label": `Use ${source.title}`,
      checked: ready && options.selection.isSelected(source.id),
      disabled: !ready,
    });
    checkbox.addEventListener("change", () => {
      options.selection.toggle(source.id);
      updateChecks();
      options.onSelectionChange();
    });
    const status =
      source.status === "Failed"
        ? h("span", { class: "status status-failed", "data-testid": "source-error", text: source.error?.message ?? "Failed" })
        : ready
          ? h("span", { class: "status status-ready", "aria-label": "Ready", text: ICONS[source.media_type] ?? "📄" })
          : h("span", { class: "spinner", "data-testid": "source-spinner", "aria-label": source.status, title: source.status });
    const titleButton = h("button", { class: "source-title", "data-testid": "source-title", text: source.title, disabled: !ready });
    titleButton.addEventListener("click", () => options.onOpenSource(source.id));
    const row = h(
      "li",
      { class: `source-row status-${source.status.toLowerCase()}`, "data-testid": "source-row", "data-source-id": source.id, "data-status": source.status },
      status,
      titleButton,
      source.status === "Failed" ? null : checkbox
    );
    if (source.status === "Failed") {
      const dismiss = h("button", { class: "icon-btn", "data-testid": "dismiss-error", "aria-label": "Dismiss error", text: "✕" });
      dismiss.addEventListener("click", async () => {
        try {
          await api(`/api/notebooks/${options.notebookId}/sources/${source.id}/error`, { method: "DELETE" });
        } catch {
          toast("Could not dismiss the error row.");
        }
        await refresh();
      });
      row.append(dismiss);
    }
    return row;
  };

  master.addEventListener("change", () => {
    options.selection.setAll(options.selection.master() !== "checked");
    updateChecks();
    options.onSelectionChange();
  });

  const schedulePoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    if (sources.some((s) => s.status === "Uploading" || s.status === "Processing")) {
      pollTimer = setTimeout(() => void refresh(), 1000);
    }
  };

  async function refresh(): Promise<void> {
    try {
      const [list, q] = await Promise.all([
        api<{ sources: SourceDto[] }>(`/api/notebooks/${options.notebookId}/sources`),
        api<QuotaSummary>(`/api/notebooks/${options.notebookId}/quota`),
      ]);
      sources = list.sources;
      quota = q;
      options.selection.sync(sources, firstLoad);
      firstLoad = false;
      renderCounter();
      renderList();
      options.onSelectionChange();
      schedulePoll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) options.onNotebookMissing();
    }
  }

  async function uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const descriptors = files.map((file) => ({ attempt_id: crypto.randomUUID(), file_name: file.name, declared_bytes: file.size }));
    type UploadItem = { attempt_id: string; admitted: boolean; source?: SourceDto; upload?: { url: string; headers: Record<string, string> }; error?: { code: string; message: string } };
    let items: UploadItem[];
    try {
      ({ items } = await api<{ items: UploadItem[] }>(`/api/notebooks/${options.notebookId}/sources/uploads`, { method: "POST", json: { files: descriptors } }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Upload failed.");
      return;
    }
    await refresh();
    await Promise.all(
      items.map(async (item, i) => {
        const file = files[i]!;
        if (!item.admitted || !item.upload || !item.source) {
          if (item.error) toast(`${file.name}: ${item.error.message}`);
          return;
        }
        options.selection.markImported(item.source.id);
        try {
          const put = await fetch(item.upload.url, { method: "PUT", headers: item.upload.headers, body: file });
          if (!put.ok) throw new Error(`upload failed (${put.status})`);
          await api(`/api/notebooks/${options.notebookId}/sources/${item.source.id}/complete`, { method: "POST", json: { attempt_id: item.attempt_id } });
        } catch {
          toast(`${file.name}: upload failed. Please try again.`);
        }
      })
    );
    await refresh();
  }

  async function insertText(text: string): Promise<boolean> {
    try {
      const { source } = await api<{ source: SourceDto }>(`/api/notebooks/${options.notebookId}/sources/text`, {
        method: "POST",
        json: { attempt_id: crypto.randomUUID(), text },
      });
      options.selection.markImported(source.id);
      await refresh();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add the text.");
      return false;
    }
  }

  function openAddSources(): void {
    document.querySelector(".add-sources-modal")?.remove();
    const fileInput = h("input", { type: "file", multiple: true, accept: ACCEPT, "data-testid": "file-input", class: "visually-hidden" });
    const disabled = atLimit();
    const dropzone = h(
      "div",
      { class: "dropzone", "data-testid": "dropzone", "data-disabled": String(disabled), tabindex: 0, role: "button" },
      h("strong", { text: "Upload files: PDF, .txt, Markdown" }),
      h("span", { class: "muted", text: disabled ? "Source limit reached" : "Drag and drop or click to browse" })
    );
    const pasteChip = h("button", { class: "chip", "data-testid": "copied-text", text: "Copied text", disabled });
    const close = h("button", { class: "icon-btn", "data-testid": "close-add-sources", "aria-label": "Close", text: "✕" });
    const body = h("div", { class: "modal-body" }, dropzone, h("div", { class: "chips" }, pasteChip), fileInput);
    const modal = h(
      "div",
      { class: "modal-backdrop add-sources-modal", "data-testid": "add-sources-modal", role: "dialog", "aria-modal": "true" },
      h("div", { class: "modal" }, h("div", { class: "modal-head" }, h("h2", { text: "Add sources" }), counter.cloneNode(true), close), body)
    );
    const dismiss = () => modal.remove();
    close.addEventListener("click", dismiss);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) dismiss();
    });
    const pick = () => {
      if (!atLimit()) fileInput.click();
    };
    dropzone.addEventListener("click", pick);
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") pick();
    });
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
      if (atLimit()) return;
      dismiss();
      void uploadFiles([...(event.dataTransfer?.files ?? [])]);
    });
    fileInput.addEventListener("change", () => {
      const files = [...(fileInput.files ?? [])];
      dismiss();
      void uploadFiles(files);
    });
    pasteChip.addEventListener("click", () => {
      clear(body);
      const textarea = h("textarea", { class: "paste-area", "data-testid": "paste-text", rows: 12, placeholder: "Paste text here" });
      const insert = h("button", { class: "btn btn-primary", "data-testid": "insert-text", text: "Insert", disabled: true });
      textarea.addEventListener("input", () => (insert.disabled = textarea.value.trim().length === 0));
      insert.addEventListener("click", async () => {
        insert.disabled = true;
        if (await insertText(textarea.value)) dismiss();
        else insert.disabled = false;
      });
      body.append(textarea, h("div", { class: "modal-actions" }, insert));
      textarea.focus();
    });
    document.body.append(modal);
  }

  addButton.addEventListener("click", openAddSources);

  return { element, refresh, sources: () => sources, openAddSources };
}
