import { api, ApiError } from "../lib/api.ts";
import { clear, confirmDialog, h, toast } from "../lib/dom.ts";
import { SelectionModel } from "../lib/selection.ts";
import type { QuotaSummary, SourceDto } from "../lib/types.ts";
import { KIND_ICONS, UPLOAD_ACCEPT, parseGoogleDocumentLink, sourceKind, validRenameTitle } from "../lib/v3-sources.ts";

/**
 * Sources panel (FR-SI-01, FR-SI-03, FR-SI-05, FR-WM-07): server-authoritative capacity, Add sources modal (file
 * upload incl. Word/PowerPoint/audio, Website, YouTube/Video URL, Google Drive, Copied text), format icons, status
 * rows with progress substates, dismissible error rows, the ⋮ menu (Rename source / Remove source), per-source
 * checkboxes and "Select all sources" with indeterminate state.
 */

export interface SourcesPanelOptions {
  notebookId: string;
  selection: SelectionModel;
  onSelectionChange(): void;
  onOpenSource(sourceId: string): void;
  onNotebookMissing(): void;
  /** Called after a source was removed or renamed so dependent views (Inspector, chat) refresh. */
  onSourceChanged?(sourceId: string, change: "renamed" | "removed"): void;
}

export interface SourcesPanel {
  element: HTMLElement;
  refresh(): Promise<void>;
  sources(): SourceDto[];
  openAddSources(): void;
}

interface Connection {
  id: string;
  provider: string;
  account_label: string | null;
}

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

  const closeMenus = () => document.querySelectorAll(".source-menu-popup").forEach((m) => m.remove());

  const renameSource = (source: SourceDto) => {
    closeMenus();
    document.querySelector(".rename-modal")?.remove();
    const input = h("input", { class: "rename-input", "data-testid": "rename-input", value: source.title, "aria-label": "Source title" });
    const error = h("div", { class: "field-error", "data-testid": "rename-error", hidden: true });
    const save = h("button", { class: "btn btn-primary", "data-testid": "rename-save", text: "Save" });
    const cancel = h("button", { class: "btn", "data-testid": "rename-cancel", text: "Cancel" });
    const modal = h(
      "div",
      { class: "modal-backdrop rename-modal", role: "dialog", "aria-modal": "true" },
      h("div", { class: "modal" }, h("h2", { text: "Rename source" }), input, error, h("div", { class: "modal-actions" }, cancel, save))
    );
    const validate = () => {
      const ok = validRenameTitle(input.value);
      save.disabled = !ok;
      error.hidden = ok;
      error.textContent = ok ? "" : "Title must be 1–200 characters.";
      return ok;
    };
    input.addEventListener("input", validate);
    cancel.addEventListener("click", () => modal.remove());
    save.addEventListener("click", async () => {
      if (!validate()) return;
      save.disabled = true;
      try {
        await api(`/api/notebooks/${options.notebookId}/sources/${source.id}`, { method: "PATCH", json: { title: input.value } });
        modal.remove();
        await refresh();
        options.onSourceChanged?.(source.id, "renamed");
      } catch (err) {
        error.hidden = false;
        error.textContent = err instanceof ApiError ? err.message : "Could not rename the source.";
        save.disabled = false;
      }
    });
    document.body.append(modal);
    input.focus();
    input.select();
  };

  const removeSource = async (source: SourceDto) => {
    closeMenus();
    const confirmed = await confirmDialog({
      title: "Remove source?",
      body: `"${source.title}" and everything derived from it will be removed from this notebook.`,
      confirm: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/notebooks/${options.notebookId}/sources/${source.id}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) toast("Could not remove the source.");
    }
    await refresh();
    options.onSourceChanged?.(source.id, "removed");
  };

  const openMenu = (anchor: HTMLElement, source: SourceDto) => {
    const already = document.querySelector(`.source-menu-popup[data-for="${source.id}"]`);
    closeMenus();
    if (already) return;
    const rename = h("button", { class: "menu-item", role: "menuitem", "data-testid": "source-rename", text: "Rename source" });
    const remove = h("button", { class: "menu-item danger", role: "menuitem", "data-testid": "source-remove", text: "Remove source" });
    rename.addEventListener("click", () => renameSource(source));
    remove.addEventListener("click", () => void removeSource(source));
    const popup = h("div", { class: "source-menu-popup", role: "menu", "data-for": source.id }, source.status === "Failed" ? null : rename, remove);
    anchor.after(popup);
  };

  const renderRow = (source: SourceDto): HTMLElement => {
    const ready = source.status === "Ready";
    const kind = sourceKind(source);
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
    const progressLabel = source.progress ?? source.status;
    const icon = h("span", { class: "source-icon", "data-testid": "source-icon", "data-kind": kind, "aria-hidden": "true", text: KIND_ICONS[kind] });
    const status =
      source.status === "Failed"
        ? h("span", { class: "status status-failed", "data-testid": "source-error", text: source.error?.message ?? "Failed" })
        : ready
          ? h("span", { class: "status status-ready", "aria-label": "Ready" }, icon)
          : h("span", { class: "spinner", "data-testid": "source-spinner", "aria-label": progressLabel, title: progressLabel });
    const titleButton = h("button", { class: "source-title", "data-testid": "source-title", text: source.title, disabled: !ready });
    titleButton.addEventListener("click", () => options.onOpenSource(source.id));
    const syncing = ready && source.progress === "Syncing" ? h("span", { class: "source-syncing", "data-testid": "source-syncing", text: "Syncing..." }) : null;
    const menu = h("button", { class: "icon-btn source-menu", "data-testid": "source-menu", "aria-label": `More actions for ${source.title}`, "aria-haspopup": "menu", text: "⋮" });
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(menu, source);
    });
    const row = h(
      "li",
      {
        class: `source-row status-${source.status.toLowerCase()}`,
        "data-testid": "source-row",
        "data-source-id": source.id,
        "data-status": source.status,
        "data-kind": kind,
        "data-progress": source.progress ?? "",
      },
      status,
      !ready && source.status !== "Failed" ? icon : null,
      titleButton,
      // FR-NM-03: a source made from notes keeps a visible Note label (owner decision 2026-10-20: a v1 source).
      source.media_type === "note_markdown" ? h("span", { class: "source-kind", "data-testid": "source-kind-note", text: "Note" }) : null,
      syncing,
      source.status === "Failed" ? null : checkbox,
      source.status === "Uploading" ? null : menu
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
    if (sources.some((s) => s.status === "Uploading" || s.status === "Processing" || s.progress === "Syncing")) {
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

  /** Linked imports (FR-SI-01): 202 {source_id, operation_id}; the row shows Fetching/Transcribing/Parsing. */
  async function importLinked(body: Record<string, unknown>): Promise<boolean> {
    try {
      const accepted = await api<{ source_id: string }>(`/api/notebooks/${options.notebookId}/sources/imports`, {
        method: "POST",
        json: { attempt_id: crypto.randomUUID(), ...body },
      });
      options.selection.markImported(accepted.source_id);
      await refresh();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not import the link.");
      return false;
    }
  }

  function urlForm(body: HTMLElement, kind: "web" | "video", dismiss: () => void): void {
    clear(body);
    const input = h("input", {
      type: "url",
      class: "url-input",
      "data-testid": "url-input",
      placeholder: kind === "web" ? "https://example.com/article" : "https://www.youtube.com/watch?v=…",
      "aria-label": kind === "web" ? "Website URL" : "Video URL",
    });
    const submit = h("button", { class: "btn btn-primary", "data-testid": "url-import", text: "Insert", disabled: true });
    input.addEventListener("input", () => {
      try {
        const url = new URL(input.value.trim());
        submit.disabled = !(url.protocol === "https:" || url.protocol === "http:");
      } catch {
        submit.disabled = true;
      }
    });
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      if (await importLinked({ kind, url: input.value.trim() })) dismiss();
      else submit.disabled = false;
    });
    body.append(h("h3", { text: kind === "web" ? "Website" : "YouTube / Video URL" }), input, h("div", { class: "modal-actions" }, submit));
    input.focus();
  }

  async function driveForm(body: HTMLElement, dismiss: () => void): Promise<void> {
    clear(body);
    body.append(h("h3", { text: "Google Drive" }));
    let connections: Connection[] = [];
    try {
      ({ connections } = await api<{ connections: Connection[] }>("/api/connections"));
    } catch {
      toast("Could not load Google Drive connections.");
    }
    if (connections.length === 0) {
      const connect = h("button", { class: "btn btn-primary", "data-testid": "drive-connect", text: "Connect Google Drive" });
      connect.addEventListener("click", async () => {
        try {
          const { authorization_url } = await api<{ authorization_url: string }>("/api/connections/google/authorize", {
            method: "POST",
            json: { return_to: window.location.pathname },
          });
          window.location.assign(authorization_url);
        } catch (err) {
          toast(err instanceof ApiError ? err.message : "Google Drive access is not available.");
        }
      });
      body.append(h("p", { class: "muted", text: "Grant read-only access with your own Google account to import Docs and Slides." }), connect);
      return;
    }
    const connection = connections[0]!;
    const input = h("input", { type: "url", class: "url-input", "data-testid": "drive-link", placeholder: "https://docs.google.com/presentation/d/…", "aria-label": "Google Docs or Slides link" });
    const error = h("div", { class: "field-error", "data-testid": "drive-link-error", hidden: true, text: "Paste a Google Docs or Google Slides link." });
    const submit = h("button", { class: "btn btn-primary", "data-testid": "drive-import", text: "Import", disabled: true });
    input.addEventListener("input", () => {
      const ok = parseGoogleDocumentLink(input.value.trim()) !== null;
      submit.disabled = !ok;
      error.hidden = ok || input.value.trim() === "";
    });
    submit.addEventListener("click", async () => {
      const parsed = parseGoogleDocumentLink(input.value.trim());
      if (!parsed) return;
      submit.disabled = true;
      if (await importLinked({ kind: "drive", external_document_id: parsed.id, connection_id: connection.id })) dismiss();
      else submit.disabled = false;
    });
    body.append(
      h("p", { class: "muted", text: `Connected as ${connection.account_label ?? "your Google account"}` }),
      input,
      error,
      h("div", { class: "modal-actions" }, submit)
    );
    input.focus();
  }

  function openAddSources(): void {
    document.querySelector(".add-sources-modal")?.remove();
    const fileInput = h("input", { type: "file", multiple: true, accept: UPLOAD_ACCEPT, "data-testid": "file-input", class: "visually-hidden" });
    const disabled = atLimit();
    const dropzone = h(
      "div",
      { class: "dropzone", "data-testid": "dropzone", "data-disabled": String(disabled), tabindex: 0, role: "button" },
      h("strong", { text: "Upload files: PDF, .txt, Markdown, Word, PowerPoint, MP3/WAV/M4A audio" }),
      h("span", { class: "muted", text: disabled ? "Source limit reached" : "Drag and drop or click to browse" })
    );
    const websiteChip = h("button", { class: "chip", "data-testid": "add-website", text: "🌐 Website", disabled });
    const videoChip = h("button", { class: "chip", "data-testid": "add-video", text: "▶️ YouTube / Video URL", disabled });
    const driveChip = h("button", { class: "chip", "data-testid": "add-drive", text: "📙 Google Drive / Office files", disabled });
    const pasteChip = h("button", { class: "chip", "data-testid": "copied-text", text: "Copied text", disabled });
    const close = h("button", { class: "icon-btn", "data-testid": "close-add-sources", "aria-label": "Close", text: "✕" });
    const body = h("div", { class: "modal-body" }, dropzone, h("div", { class: "chips" }, websiteChip, videoChip, driveChip, pasteChip), fileInput);
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
    websiteChip.addEventListener("click", () => urlForm(body, "web", dismiss));
    videoChip.addEventListener("click", () => urlForm(body, "video", dismiss));
    driveChip.addEventListener("click", () => void driveForm(body, dismiss));
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
  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement | null)?.closest?.(".source-menu-popup, .source-menu")) closeMenus();
  });

  return { element, refresh, sources: () => sources, openAddSources };
}
