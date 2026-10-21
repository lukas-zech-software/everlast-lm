import type { Note, NoteAssistantAction, SavedResponseNote } from "@everlast/contracts";
import { clear, confirmDialog, h, toast } from "../lib/dom.ts";
import type { ChatMessage } from "../lib/types.ts";
import { NOTE_ASSISTANT_MAX_NOTES, SAVED_TO_NOTES_MESSAGE, SOURCE_LIMIT_REACHED_MESSAGE } from "../lib/v2-contracts.ts";
import { ASSISTANT_DISCLOSURE, assistantActions } from "./assistant.ts";
import { NoteEditorSession, type DraftStore, type NoteDraft, type SaveStatus } from "./editor-session.ts";
import { conversionState, orderNotes, togglePinboardSelection } from "./pinboard.ts";
import { citationForBadge, savedResponseView } from "./saved-response.ts";

/**
 * Right Panel notes pinboard (FR-NM-01..04). List with checkboxes, Note Editor (title, Markdown toolbar, debounced
 * auto-save, browser-local draft recovery, flush on close), read-only saved-response viewer whose badges open the
 * Source Inspector, Convert to editable, Convert to source / selected / all (gated by the shared source limit), and
 * the Note Assistant bar with separate snapshot and synthesis phases. Text is always set via textContent.
 */

export type MarkdownFormat = "h1" | "h2" | "bold" | "italic" | "bullets" | "numbers" | "link";

const FORMATS: { format: MarkdownFormat; text: string; label: string }[] = [
  { format: "h1", text: "H1", label: "Heading 1" },
  { format: "h2", text: "H2", label: "Heading 2" },
  { format: "bold", text: "B", label: "Bold" },
  { format: "italic", text: "I", label: "Italic" },
  { format: "bullets", text: "•", label: "Bulleted list" },
  { format: "numbers", text: "1.", label: "Numbered list" },
  { format: "link", text: "🔗", label: "Link" },
];

/** Applies one toolbar format to the selected range [start, end) of `value` (FR-NM-01: Markdown only). */
export function applyMarkdownFormat(value: string, start: number, end: number, format: MarkdownFormat): { value: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, value.length));
  const b = Math.max(a, Math.min(end, value.length));
  const selected = value.slice(a, b);
  const wrap = (left: string, right: string, placeholder: string) => {
    const inner = selected || placeholder;
    return { value: value.slice(0, a) + left + inner + right + value.slice(b), start: a + left.length, end: a + left.length + inner.length };
  };
  if (format === "bold") return wrap("**", "**", "bold text");
  if (format === "italic") return wrap("_", "_", "italic text");
  if (format === "link") {
    const inner = selected || "link text";
    return { value: `${value.slice(0, a)}[${inner}](https://)${value.slice(b)}`, start: a + 1, end: a + 1 + inner.length };
  }
  // Line formats apply to every line touched by the selection.
  const lineStart = value.lastIndexOf("\n", a - 1) + 1;
  const nextBreak = value.indexOf("\n", b);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const formatted = lines
    .map((line, i) => {
      if (format === "h1") return `# ${line}`;
      if (format === "h2") return `## ${line}`;
      if (format === "bullets") return `- ${line}`;
      return `${i + 1}. ${line}`;
    })
    .join("\n");
  return { value: value.slice(0, lineStart) + formatted + value.slice(lineEnd), start: lineStart, end: lineStart + formatted.length };
}

/** Browser-local draft store (FR-NM-01 FR-005); storage errors never break editing. */
export function localDraftStore(notebookId: string): DraftStore {
  const key = (noteId: string) => `everlast.note-draft.${notebookId}.${noteId}`;
  const storage = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    save(noteId, draft) {
      try {
        storage()?.setItem(key(noteId), JSON.stringify(draft));
      } catch {
        /* storage full or blocked: the in-memory draft still exists */
      }
    },
    load(noteId) {
      try {
        const raw = storage()?.getItem(key(noteId));
        return raw ? (JSON.parse(raw) as NoteDraft) : null;
      } catch {
        return null;
      }
    },
    clear(noteId) {
      try {
        storage()?.removeItem(key(noteId));
      } catch {
        /* ignore */
      }
    },
  };
}

type PanelNote = Pick<Note, "id" | "title" | "content_md" | "origin_type" | "citations_json" | "revision" | "display_order">;

interface NoteSourceResult {
  source: { id: string; title: string };
  reused?: boolean;
}

export interface NotesPanelOptions {
  notebookId: string;
  fetcher: typeof fetch;
  /** Opens the Source Inspector on a cited chunk (FR-NM-02 badges). */
  openCitation(sourceId: string, chunkId: string): void;
  /** A conversion created (or reused) a source: add it to this browser's selection and refresh the Left Panel. */
  onSourceCreated(sourceId: string): Promise<void> | void;
  /** Current Left Panel selection: the comparison sources of Related ideas and Critique (FR-NM-04). */
  selectedSourceIds(): string[];
  /** Appends the Note Assistant's validated turn to the Chat panel (FR-NM-04 FR-017). */
  onAssistantMessages(messages: ChatMessage[]): void;
  drafts?: DraftStore;
  confirm?: (options: { title: string; body: string; confirm: string; danger?: boolean }) => Promise<boolean>;
  notify?: (message: string, kind?: "error" | "info") => void;
  debounceMs?: number;
}

export interface NotesPanel {
  element: HTMLElement;
  refresh(): Promise<void>;
  /** Inserts a note saved from chat at once (≤ 300 ms, FR-NM-02) and refreshes in the background. */
  showSavedNote(note: SavedResponseNote): void;
  /** Re-evaluates actions that depend on the Left Panel selection. */
  updateSourceSelection(): void;
}

class PanelRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  pending: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved — your changes are kept on this device",
};
const RECOVERED_TEXT = "Draft recovered — not saved yet";
const NOT_SAVED_ON_CLOSE = "Not saved — your changes are kept on this device";

export function createNotesPanel(options: NotesPanelOptions): NotesPanel {
  const base = `/api/notebooks/${options.notebookId}/notes`;
  const drafts = options.drafts ?? localDraftStore(options.notebookId);
  const confirm = options.confirm ?? confirmDialog;
  const notify = options.notify ?? ((message: string, kind: "error" | "info" = "info") => toast(message, kind));

  let notes: PanelNote[] = [];
  let slots = { used: 0, limit: 50 };
  let checked: string[] = [];
  let openNote: PanelNote | null = null;
  let session: NoteEditorSession | null = null;
  let editorContent: HTMLTextAreaElement | null = null;
  let busy = false;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await options.fetcher(path, {
      method,
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as { error?: { code?: string; message?: string } }) : null;
    if (!res.ok) throw new PanelRequestError(res.status, data?.error?.code ?? "Error", data?.error?.message ?? "The request failed. Please try again.");
    return data as T;
  }
  const messageOf = (error: unknown) =>
    error instanceof PanelRequestError ? (error.code === "SourceLimitReached" ? SOURCE_LIMIT_REACHED_MESSAGE : error.message) : "The request failed. Please try again.";

  // ---- Static frame -----------------------------------------------------------------------------------------
  const slotsLabel = h("span", { class: "notes-slots muted", "data-testid": "source-slots" });
  const addButton = h("button", { class: "btn btn-primary btn-sm", "data-testid": "add-note", text: "+ Add note" });
  const convertSelected = h("button", { class: "btn btn-sm", "data-testid": "convert-selected", text: "Convert selected to source" });
  const convertAll = h("button", { class: "btn btn-sm", "data-testid": "convert-all", text: "Convert all notes to source" });
  const status = h("div", { class: "notes-status", "data-testid": "notes-status", role: "status", "aria-live": "polite" });

  const disclosure = h("p", { class: "assistant-disclosure muted", "data-testid": "assistant-disclosure", id: `assistant-disclosure-${options.notebookId}`, text: ASSISTANT_DISCLOSURE });
  const actionRow = h("div", { class: "assistant-actions" });
  const hint = h("p", { class: "assistant-hint", "data-testid": "assistant-hint", hidden: true });
  const progress = h("p", { class: "assistant-progress", "data-testid": "assistant-progress", role: "status", "aria-live": "polite", hidden: true });
  const assistantError = h("p", { class: "assistant-error chat-error", "data-testid": "assistant-error", hidden: true });
  const assistantBar = h("div", { class: "assistant-bar", "data-testid": "assistant-bar", hidden: true }, disclosure, actionRow, hint, progress, assistantError);
  const actionButtons = new Map<NoteAssistantAction, HTMLButtonElement>();
  for (const state of assistantActions({ noteCount: 1, comparisonSourceCount: 1 })) {
    const button = h("button", {
      class: "chip assistant-action",
      type: "button",
      "data-testid": "assistant-action",
      "data-action": state.action,
      title: ASSISTANT_DISCLOSURE,
      "aria-describedby": disclosure.id,
      text: state.label,
    }) as HTMLButtonElement;
    button.addEventListener("click", () => void runAction(state.action));
    actionButtons.set(state.action, button);
    actionRow.append(button);
  }

  const body = h("div", { class: "notes-body" });
  const element = h(
    "section",
    { class: "notes-panel", "data-testid": "notes-panel", "aria-label": "Notes" },
    h("div", { class: "notes-header" }, h("h2", { text: "Notes" }), slotsLabel, addButton),
    h("div", { class: "notes-actions" }, convertSelected, convertAll),
    status,
    assistantBar,
    body
  );

  const setStatus = (text: string) => {
    status.textContent = text;
  };

  // ---- Gating -------------------------------------------------------------------------------------------------
  const gate = (button: HTMLButtonElement, scope: PanelNote[], emptyTooltip?: string) => {
    if (emptyTooltip && scope.length === 0) {
      button.disabled = true;
      button.title = emptyTooltip;
      return;
    }
    const state = conversionState(scope, slots);
    button.disabled = busy || !state.enabled;
    button.title = state.enabled ? "" : state.tooltip;
  };
  const assistantNoteIds = (): string[] => (checked.length > 0 ? checked : openNote ? [openNote.id] : []);
  function updateControls(): void {
    slotsLabel.textContent = `${slots.used} / ${slots.limit} sources`;
    gate(convertAll as HTMLButtonElement, notes);
    gate(convertSelected as HTMLButtonElement, notes.filter((n) => checked.includes(n.id)), "Select notes to convert");
    const convertOne = body.querySelector<HTMLButtonElement>("[data-testid=convert-note]");
    if (convertOne && openNote) {
      const live = editorContent ? { ...openNote, content_md: editorContent.value } : openNote;
      gate(convertOne, [live]);
    }
    const noteIds = assistantNoteIds();
    assistantBar.hidden = noteIds.length === 0;
    const states = assistantActions({ noteCount: noteIds.length, comparisonSourceCount: options.selectedSourceIds().length });
    for (const state of states) {
      const button = actionButtons.get(state.action)!;
      button.setAttribute("aria-disabled", String(busy || !state.enabled));
      button.disabled = busy;
    }
    for (const box of body.querySelectorAll<HTMLInputElement>("[data-testid=note-checkbox]")) {
      const id = box.closest<HTMLElement>("[data-note-id]")?.getAttribute("data-note-id") ?? "";
      box.checked = checked.includes(id);
      box.disabled = !box.checked && checked.length >= NOTE_ASSISTANT_MAX_NOTES;
    }
  }

  // ---- List view ------------------------------------------------------------------------------------------------
  function renderList(): void {
    openNote = null;
    session = null;
    editorContent = null;
    clear(body);
    const list = h("ul", { class: "notes-list", "data-testid": "notes-list" });
    for (const note of orderNotes(notes)) list.append(renderCard(note));
    if (notes.length === 0) list.append(h("li", { class: "muted empty", text: "Notes you add or save from chat appear here." }));
    body.append(list);
    updateControls();
  }

  function renderCard(note: PanelNote): HTMLElement {
    const saved = note.origin_type === "saved_response";
    const box = h("input", { type: "checkbox", "data-testid": "note-checkbox", "aria-label": `Select ${note.title}` }) as HTMLInputElement;
    box.addEventListener("change", () => {
      const next = togglePinboardSelection(checked, note.id, NOTE_ASSISTANT_MAX_NOTES);
      checked = next;
      box.checked = checked.includes(note.id);
      hint.hidden = true;
      updateControls();
    });
    const open = h("button", { class: "note-open", "data-testid": "note-open", text: `${saved ? "💬" : "📝"} ${note.title}` });
    open.addEventListener("click", () => void openById(note.id));
    const remove = h("button", { class: "icon-btn", "data-testid": "note-delete", "aria-label": `Delete ${note.title}`, title: "Delete", text: "🗑" });
    remove.addEventListener("click", () => void deleteNote(note));
    return h(
      "li",
      { class: `note-card origin-${note.origin_type}`, "data-testid": "note-card", "data-note-id": note.id, "data-origin": note.origin_type },
      box,
      open,
      saved ? h("span", { class: "note-tag muted", text: "Saved response" }) : null,
      drafts.load(note.id) ? h("span", { class: "note-tag note-draft", "data-testid": "note-draft-flag", text: "Unsaved draft" }) : null,
      remove
    );
  }

  // ---- Editor and viewer ------------------------------------------------------------------------------------------
  async function openById(noteId: string): Promise<void> {
    try {
      const { note } = await request<{ note: PanelNote }>("GET", `${base}/${noteId}`);
      if (note.origin_type === "saved_response") renderViewer(note);
      else renderEditor(note, false);
    } catch (error) {
      setStatus(messageOf(error));
    }
  }

  function closeButton(): HTMLElement {
    const button = h("button", { class: "btn btn-sm", "data-testid": "note-close", text: "Close" });
    button.addEventListener("click", () => void closeOpen());
    return button;
  }

  function convertOneButton(note: PanelNote): HTMLElement {
    const button = h("button", { class: "btn btn-sm", "data-testid": "convert-note", text: "Convert to source" });
    button.addEventListener("click", () => void convert({ note_ids: [note.id] }));
    return button;
  }

  function deleteButton(note: PanelNote): HTMLElement {
    const button = h("button", { class: "btn btn-sm btn-danger", "data-testid": "note-delete", text: "Delete" });
    button.addEventListener("click", () => void deleteNote(note));
    return button;
  }

  function renderEditor(note: PanelNote, focusContent: boolean): void {
    clear(body);
    openNote = note;
    const saveStatus = h("span", { class: "note-save-status muted", "data-testid": "note-save-status", role: "status", "aria-live": "polite" });
    const title = h("input", { class: "note-title", "data-testid": "note-title", "aria-label": "Note title", maxlength: 400 }) as HTMLInputElement;
    const content = h("textarea", { class: "note-content", "data-testid": "note-content", "aria-label": "Note content", rows: 14 }) as HTMLTextAreaElement;
    title.value = note.title;
    content.value = note.content_md;
    editorContent = content;
    let recovered = false;
    const show = (s: SaveStatus) => {
      if (s === "saved" || s === "saving") recovered = false;
      saveStatus.textContent = recovered && s === "pending" ? RECOVERED_TEXT : STATUS_TEXT[s];
    };
    const current = new NoteEditorSession({
      noteId: note.id,
      revision: note.revision,
      drafts,
      ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
      onStatus: show,
      api: {
        patchNote: async (noteId, patch) => {
          const { note: updated } = await request<{ note: PanelNote }>("PATCH", `${base}/${noteId}`, patch);
          notes = notes.map((n) => (n.id === updated.id ? updated : n));
          if (openNote?.id === updated.id) openNote = updated;
          return { revision: updated.revision };
        },
      },
    });
    session = current;
    const draft = drafts.load(note.id);
    if (draft && current.recoverDraft()) {
      if (draft.title !== undefined) title.value = draft.title;
      if (draft.content_md !== undefined) content.value = draft.content_md;
      recovered = true;
      current.edit(draft);
    }
    title.addEventListener("input", () => current.edit({ title: title.value }));
    content.addEventListener("input", () => {
      current.edit({ content_md: content.value });
      updateControls();
    });
    const toolbar = h("div", { class: "note-toolbar", "data-testid": "note-toolbar", role: "toolbar", "aria-label": "Formatting" });
    for (const f of FORMATS) {
      const button = h("button", { class: "icon-btn", type: "button", "data-format": f.format, "aria-label": f.label, title: f.label, text: f.text });
      button.addEventListener("click", () => {
        const start = typeof content.selectionStart === "number" ? content.selectionStart : content.value.length;
        const end = typeof content.selectionEnd === "number" ? content.selectionEnd : content.value.length;
        const next = applyMarkdownFormat(content.value, start, end, f.format);
        content.value = next.value;
        content.setSelectionRange?.(next.start, next.end);
        content.focus();
        current.edit({ content_md: content.value });
        updateControls();
      });
      toolbar.append(button);
    }
    body.append(
      h(
        "div",
        { class: "note-editor", "data-testid": "note-editor", "data-note-id": note.id },
        h("div", { class: "note-editor-head" }, closeButton(), saveStatus),
        title,
        toolbar,
        content,
        h("div", { class: "note-editor-actions" }, convertOneButton(note), deleteButton(note))
      )
    );
    show(current.status);
    if (recovered) saveStatus.textContent = RECOVERED_TEXT;
    updateControls();
    if (focusContent) content.focus();
  }

  function renderViewer(note: PanelNote): void {
    clear(body);
    openNote = note;
    const view = savedResponseView(note);
    const content = h("div", { class: "saved-response-content", "data-testid": "saved-response-content" });
    for (const segment of view.segments) {
      if (segment.type === "text") {
        content.append(segment.text);
        continue;
      }
      const citation = citationForBadge(note, segment.badge_number);
      const badge = h("button", {
        class: "citation-badge",
        "data-testid": "saved-citation",
        "data-badge": segment.badge_number,
        "aria-label": `Citation ${segment.badge_number}: ${citation?.source_title ?? "source"}`,
        text: String(segment.badge_number),
      });
      badge.addEventListener("click", () => {
        if (citation) options.openCitation(citation.source_id, citation.chunk_id);
      });
      content.append(badge);
    }
    const editable = h("button", { class: "btn btn-sm", "data-testid": "convert-to-editable", text: "Convert to editable note" });
    editable.addEventListener("click", () => void convertToEditable(note));
    body.append(
      h(
        "article",
        { class: "saved-response-viewer", "data-testid": "saved-response-viewer", "data-note-id": note.id },
        h("div", { class: "note-editor-head" }, closeButton(), h("span", { class: "note-tag muted", text: "Saved response · read-only" })),
        h("h3", { class: "saved-response-title", text: note.title }),
        content,
        h("div", { class: "note-editor-actions" }, editable, convertOneButton(note), deleteButton(note))
      )
    );
    updateControls();
  }

  /** Flushes the open editor; reports "not saved" when the flush failed (FR-NM-01 FR-003/FR-005). */
  async function flushOpen(): Promise<boolean> {
    if (!session) return true;
    const { ok } = await session.close();
    return ok;
  }

  async function closeOpen(): Promise<void> {
    const ok = await flushOpen();
    setStatus(ok ? "" : NOT_SAVED_ON_CLOSE);
    renderList();
    await refresh();
    if (!ok) setStatus(NOT_SAVED_ON_CLOSE);
  }

  // ---- Actions ------------------------------------------------------------------------------------------------------
  addButton.addEventListener("click", async () => {
    if (!(await flushOpen())) setStatus(NOT_SAVED_ON_CLOSE);
    try {
      const { note } = await request<{ note: PanelNote }>("POST", base, {});
      notes = [...notes, note];
      renderEditor(note, true);
    } catch (error) {
      setStatus(messageOf(error));
    }
  });

  async function deleteNote(note: PanelNote): Promise<void> {
    const ok = await confirm({ title: "Delete note?", body: `“${note.title}” will be permanently deleted.`, confirm: "Delete", danger: true });
    if (!ok) return;
    // Settle the open editor first, so no pending auto-save writes a draft for a deleted note.
    if (session && openNote?.id === note.id) await session.close();
    try {
      await request("DELETE", `${base}/${note.id}?confirm=true`);
      drafts.clear(note.id);
      notes = notes.filter((n) => n.id !== note.id);
      checked = checked.filter((id) => id !== note.id);
      session = null;
      setStatus("Note deleted");
      renderList();
      await refresh();
    } catch (error) {
      setStatus(messageOf(error));
    }
  }

  async function convertToEditable(note: PanelNote): Promise<void> {
    try {
      const { note: copy } = await request<{ note: PanelNote }>("POST", `${base}/${note.id}/convert-to-editable`);
      notes = [...notes, copy];
      renderEditor(copy, true);
      setStatus("Editable copy created");
    } catch (error) {
      setStatus(messageOf(error));
    }
  }

  async function convert(input: { note_ids: string[] } | { all: true }): Promise<void> {
    if (!(await flushOpen())) {
      setStatus(NOT_SAVED_ON_CLOSE);
      return;
    }
    busy = true;
    updateControls();
    try {
      const { source } = await request<NoteSourceResult>("POST", `${base}/convert-to-source`, input);
      await options.onSourceCreated(source.id);
      setStatus(`Source created: ${source.title}`);
      notify(`Source created: ${source.title}`, "info");
    } catch (error) {
      setStatus(messageOf(error));
      notify(messageOf(error), "error");
    } finally {
      busy = false;
      await refresh();
    }
  }
  convertAll.addEventListener("click", () => void convert({ all: true }));
  convertSelected.addEventListener("click", () => void convert({ note_ids: orderNotes(notes).filter((n) => checked.includes(n.id)).map((n) => n.id) }));

  async function runAction(action: NoteAssistantAction): Promise<void> {
    const noteIds = assistantNoteIds();
    const comparison = options.selectedSourceIds();
    const state = assistantActions({ noteCount: noteIds.length, comparisonSourceCount: comparison.length }).find((s) => s.action === action)!;
    assistantError.hidden = true;
    if (busy) return;
    if (!state.enabled) {
      hint.textContent = state.hint ?? "";
      hint.hidden = false;
      return;
    }
    hint.hidden = true;
    busy = true;
    updateControls();
    progress.hidden = false;
    try {
      if (!(await flushOpen())) throw new PanelRequestError(0, "NotSaved", NOT_SAVED_ON_CLOSE);
      // Phase 1 (FR-NM-03 / FR-019): the exact selection becomes, or reuses, a Ready note-source.
      progress.textContent = `Creating a source snapshot from ${noteIds.length} ${noteIds.length === 1 ? "note" : "notes"}…`;
      const { source } = await request<NoteSourceResult>("POST", `${base}/convert-to-source`, { note_ids: noteIds, reuse: true });
      await options.onSourceCreated(source.id);
      // Phase 2: synthesis over that snapshot (and the selected comparison sources for Related ideas/Critique).
      progress.textContent = `Synthesizing: ${state.label}…`;
      const needsComparison = action === "related_ideas" || action === "critique";
      const result = await request<{ messages: ChatMessage[] }>("POST", `${base}/assistant`, {
        action_type: action,
        selected_note_ids: noteIds,
        selected_source_ids: needsComparison ? comparison.filter((id) => id !== source.id) : [],
      });
      options.onAssistantMessages(result.messages);
      setStatus("Result added to the chat");
    } catch (error) {
      assistantError.textContent = messageOf(error);
      assistantError.hidden = false;
    } finally {
      busy = false;
      progress.hidden = true;
      progress.textContent = "";
      await refresh();
    }
  }

  // ---- Data -----------------------------------------------------------------------------------------------------------
  async function refresh(): Promise<void> {
    try {
      const data = await request<{ notes: PanelNote[]; source_slots: { used: number; limit: number } }>("GET", base);
      notes = data.notes;
      slots = data.source_slots;
      checked = checked.filter((id) => notes.some((n) => n.id === id));
      if (!openNote) renderList();
      else updateControls();
    } catch {
      updateControls();
    }
  }

  return {
    element,
    refresh,
    showSavedNote(saved) {
      if (!notes.some((n) => n.id === saved.id)) {
        const order = notes.reduce((max, n) => Math.max(max, n.display_order), 0) + 1;
        notes = [...notes, { id: saved.id, title: saved.title, content_md: saved.content_md, origin_type: "saved_response", citations_json: saved.citations_json, revision: 1, display_order: order }];
      }
      if (!openNote) renderList();
      setStatus(SAVED_TO_NOTES_MESSAGE);
      void refresh().then(() => setStatus(SAVED_TO_NOTES_MESSAGE));
    },
    updateSourceSelection: updateControls,
  };
}
