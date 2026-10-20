import {
  AppError,
  clampCodePoints,
  NOTE_TITLE_MAX_CODE_POINTS,
  NOTE_ASSISTANT_MAX_NOTES,
  NOTE_ERROR_MESSAGES,
  NOTE_SOURCE_MAX_BYTES,
  NOTE_SOURCE_MAX_WORDS,
  SAVED_RESPONSE_DEFAULT_TITLE,
  InvalidScopeError,
  SourceNotReadyError,
  SourceQuotaExceededError,
  SourceSnapshotInvalidError,
  countNoteWords,
  noteSourceTitle,
  stripCitationMarkers,
  type ChatMessage,
  type Citation,
  type ConvertToSourceInput,
  type CreateNoteInput,
  type Note,
  type NoteAssistantAction,
  type NoteAssistantInput,
  type NoteSource,
  type NoteSourceOrigin,
  type PatchNoteInput,
  type SourceRevisionPair,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  convertToEditable,
  createNote,
  deleteNote,
  getChatMessages,
  getNote,
  listNotes,
  saveResponseAsNote,
  updateNote,
  type StoredCitation,
  type VisibleMessage,
} from "@everlast/db";
import { ModelUnavailableError } from "../chat/model.ts";
import type { NoteAssistantModel } from "./assistant-model.ts";

/**
 * Notes & Pinboard service (FR-NM-01..04, FR-GC-09). Notes live in the in-memory repository (D16); note-sources are
 * v1 PostgreSQL sources behind `NoteSourceStore` (owner decision 2026-10-20); the Note Assistant reads and
 * publishes through `NoteAssistantContext` (C-02 snapshot, bounded chunk read, PostgreSQL chat turn).
 */

export class NotesServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = "NotesServiceError";
  }
}

const err = (code: string, status: number, message = code) => new NotesServiceError(code, status, message);
const INGESTION_FAILED = "The notes could not be converted to a source. Please try again.";

/** FR-NM-03 / FR-WM-07: note-sources as v1 sources (one admission with uploads). */
export interface NoteSourceStore {
  /** Occupied (Uploading, Processing, Ready) and maximum source slots of the notebook. */
  slots(notebookId: string): Promise<{ used: number; limit: number }>;
  /** A Ready note-source converted from exactly these notes at these revisions (FR-NM-04 reuse), else null. */
  findReusable(ownerId: string, notebookId: string, origins: NoteSourceOrigin[]): Promise<NoteSource | null>;
  /** Reserves one slot, ingests the Markdown to Ready; throws SourceQuotaExceededError or an ingestion error. */
  create(
    ownerId: string,
    notebookId: string,
    input: { title: string; markdown: string; origin_notes: NoteSourceOrigin[]; origin_citations: Citation[] }
  ): Promise<NoteSource>;
}

/** FR-NM-04 / C-02 / FR-GC-06: scoped reads and publication for the Note Assistant. */
export interface NoteAssistantContext {
  /** Captures the (source_id, revision) snapshot of exactly these Ready sources and reads their chunks (bounded). */
  read(ownerId: string, notebookId: string, sourceIds: string[]): Promise<{ snapshot: SourceRevisionPair[]; chunks: UnifiedDocumentChunk[] }>;
  /** Rechecks ownership and the exact captured revisions; throws SourceSnapshotInvalidError when one changed. */
  verify(ownerId: string, notebookId: string, snapshot: SourceRevisionPair[]): Promise<void>;
  /** Publishes question and verified answer as one turn of the caller's chat thread under the publication fence. */
  publish(input: {
    ownerId: string;
    notebookId: string;
    snapshot: SourceRevisionPair[];
    question: string;
    answer: { kind: "answer" | "refusal"; content: string; citations: StoredCitation[] };
  }): Promise<VisibleMessage[]>;
}

export interface NotesServiceDeps {
  noteSources?: NoteSourceStore | undefined;
  /** Grounded answer port for the Note Assistant; absent → 503 (never a fabricated answer). */
  assistant?: NoteAssistantModel | undefined;
  context?: NoteAssistantContext | undefined;
  verifyOwnership?: (notebookId: string, userId: string) => Promise<boolean> | boolean;
  /** Visible chat messages of the caller (shared save-note action); default: the v2 bridge reader. */
  getMessages?: (notebookId: string, userId: string) => Promise<ChatMessage[]>;
  /** Advances the notebook's `updated_at` after a note or note-source write (FR-WM-02). */
  onNotebookModified?: (notebookId: string) => Promise<unknown> | void;
}

export interface CitationKinds {
  [chunk_id: string]: "note_assertion" | "source_fact";
}

export interface AssistantResult {
  message: VisibleMessage;
  messages: VisibleMessage[];
  note_source: NoteSource;
  reused: boolean;
  snapshot: SourceRevisionPair[];
  note_assertion_source_ids: string[];
  citation_kinds: CitationKinds;
}

const ACTION_PROMPTS: Record<NoteAssistantAction, string> = {
  summarize: "Summarize the selected notes.",
  create_outline: "Create an outline from the selected notes.",
  related_ideas: "Suggest related ideas based on the selected notes and the comparison sources.",
  critique: "Critique the selected notes against the comparison sources.",
};

/** FR-NM-03: `# title` + body per note in display order; verified citation markers removed (FR-013). */
export function composeNoteMarkdown(notes: Pick<Note, "title" | "content_md" | "citations_json">[]): string {
  return notes
    .map((n) => {
      const body = stripCitationMarkers(n.content_md, new Set(n.citations_json.map((c) => c.badge_number)));
      return `# ${n.title}\n\n${body}`.trimEnd();
    })
    .join("\n\n");
}

export class NotesService {
  private readonly deps: NotesServiceDeps;
  constructor(deps: NotesServiceDeps) {
    this.deps = deps;
  }

  private async modified<T>(notebookId: string, result: T): Promise<T> {
    await this.deps.onNotebookModified?.(notebookId);
    return result;
  }

  /** FR-NM-01: create, edit and delete notes; each write advances the notebook's modified time (FR-WM-02). */
  async create(notebookId: string, userId: string, input: CreateNoteInput): Promise<Note> {
    return this.modified(notebookId, await createNote(notebookId, userId, input));
  }

  async update(notebookId: string, userId: string, noteId: string, patch: PatchNoteInput): Promise<Note> {
    return this.modified(notebookId, await updateNote(notebookId, userId, noteId, patch));
  }

  async remove(notebookId: string, userId: string, noteId: string): Promise<boolean> {
    const deleted = await deleteNote(notebookId, userId, noteId);
    return deleted ? this.modified(notebookId, deleted) : deleted;
  }

  /** Occupied and maximum source slots, shared by uploads and note-sources (FR-WM-07). */
  async sourceSlots(notebookId: string): Promise<{ used: number; limit: number } | null> {
    return this.deps.noteSources ? this.deps.noteSources.slots(notebookId) : null;
  }

  /** FR-NM-02 / FR-GC-09: copy an assistant message into a read-only saved-response note (shared save-note route). */
  async saveFromMessage(notebookId: string, userId: string, messageId: string) {
    const messages = await (this.deps.getMessages ?? ((nb: string, uid: string) => getChatMessages(undefined, nb, uid)))(notebookId, userId);
    const msg = messages.find((m) => m.id === messageId && m.role === "assistant");
    if (!msg) {
      // Repeat saves stay idempotent even after the chat was cleared.
      const existing = (await listNotes(notebookId, userId)).find((n) => n.source_message_id === messageId);
      if (existing) return { note: existing, created: false };
      throw err("MessageNotFound", 404, "Assistant message not found");
    }
    // Shared save-note contract (FR-GC-09, FR-NM-02): title = preceding user question trimmed to 200 code points.
    const index = messages.findIndex((m) => m.id === msg.id);
    const question = messages.slice(0, index).reverse().find((m) => m.role === "user")?.content.trim() ?? "";
    const title = question ? clampCodePoints(question, NOTE_TITLE_MAX_CODE_POINTS).trim() : SAVED_RESPONSE_DEFAULT_TITLE;
    const saved = await saveResponseAsNote(notebookId, userId, {
      message_id: msg.id,
      content: msg.content,
      citations: msg.citations ?? [],
      title,
    });
    return saved.created ? this.modified(notebookId, saved) : saved;
  }

  async convertToEditable(notebookId: string, userId: string, noteId: string) {
    return this.modified(notebookId, await convertToEditable(notebookId, userId, noteId));
  }

  private async resolveNotes(notebookId: string, userId: string, input: ConvertToSourceInput): Promise<Note[]> {
    if ("all" in input) return listNotes(notebookId, userId);
    const notes: Note[] = [];
    for (const id of new Set(input.note_ids)) {
      const n = await getNote(notebookId, userId, id);
      if (!n) throw err("NoteNotFound", 404, "Note not found");
      notes.push(n);
    }
    return notes.sort((a, b) => a.display_order - b.display_order);
  }

  private store(): NoteSourceStore {
    if (!this.deps.noteSources) throw err("Unavailable", 503, "Converting notes to sources is not configured");
    return this.deps.noteSources;
  }

  /** FR-NM-03: snapshot notes into one note_markdown v1 source; `reuse` returns a Ready snapshot of the same notes. */
  async convertToSource(notebookId: string, userId: string, input: ConvertToSourceInput): Promise<{ source: NoteSource; reused: boolean }> {
    const notes = await this.resolveNotes(notebookId, userId, input);
    return this.snapshotNotes(notebookId, userId, notes, "reuse" in input && input.reuse === true);
  }

  private async snapshotNotes(notebookId: string, userId: string, notes: Note[], reuse: boolean): Promise<{ source: NoteSource; reused: boolean }> {
    if (notes.length === 0 || notes.every((n) => n.content_md.trim() === "")) {
      throw err("NoteSourceEmpty", 422, "Selected notes have no content to convert");
    }
    const origins: NoteSourceOrigin[] = notes.map((n) => ({ note_id: n.id, revision: n.revision, title: n.title }));
    const store = this.store();
    if (reuse) {
      const existing = await store.findReusable(userId, notebookId, origins);
      if (existing) return { source: existing, reused: true };
    }
    const markdown = composeNoteMarkdown(notes);
    if (Buffer.byteLength(markdown, "utf8") > NOTE_SOURCE_MAX_BYTES) throw err("SourceOversized", 422, "Combined notes exceed 200,000,000 bytes");
    if (countNoteWords(markdown) > NOTE_SOURCE_MAX_WORDS) throw err("SourceOversizedWords", 422, "Combined notes exceed 500,000 words");

    let source: NoteSource;
    try {
      source = await store.create(userId, notebookId, {
        title: noteSourceTitle(notes.map((n) => n.title)),
        markdown,
        origin_notes: origins,
        origin_citations: notes.flatMap((n) => n.citations_json),
      });
    } catch (e) {
      if (e instanceof SourceQuotaExceededError) throw err("SourceLimitReached", 409, NOTE_ERROR_MESSAGES.SourceLimitReached);
      if (e instanceof AppError && (e.status === 404 || e.status === 403)) throw err("NotebookNotFound", 404, "Notebook not found");
      if (e instanceof AppError && e.status === 503) throw err("Unavailable", 503, "Converting notes to sources is not configured");
      // Never forward upstream error text (NFR-SEC-01); the source is Failed and its slot released.
      throw err("IngestionFailed", 502, INGESTION_FAILED);
    }
    return { source: await this.modified(notebookId, source), reused: false };
  }

  private async assertAuthorized(notebookId: string, userId: string): Promise<void> {
    if (this.deps.verifyOwnership && !(await this.deps.verifyOwnership(notebookId, userId))) {
      throw err("Forbidden", 403, "User is not authorized for this notebook.");
    }
  }

  /**
   * FR-NM-04: reuse or convert the exact selection (FR-NM-03), read through C-02 with a revision snapshot, answer
   * with the grounded model and the v1 verifier, recheck, then publish one turn to the PostgreSQL chat thread.
   * Summarize/Outline read the note-source alone; Related ideas/Critique add the selected existing sources.
   */
  async runAssistant(notebookId: string, userId: string, input: NoteAssistantInput): Promise<AssistantResult> {
    if (input.selected_note_ids.length > NOTE_ASSISTANT_MAX_NOTES) throw err("ValidationError", 422);
    const needsComparison = input.action_type === "related_ideas" || input.action_type === "critique";
    if (needsComparison && input.selected_source_ids.length === 0) {
      throw err("ComparisonSourceRequired", 400, NOTE_ERROR_MESSAGES.ComparisonSourceRequired);
    }
    const notes = await this.resolveNotes(notebookId, userId, { note_ids: input.selected_note_ids });
    const { assistant, context } = this.deps;
    if (!assistant || !context) throw err("Unavailable", 503, "The note assistant model is not configured");
    await this.assertAuthorized(notebookId, userId);

    const { source: noteSource, reused } = await this.snapshotNotes(notebookId, userId, notes, true);
    const scopeIds = needsComparison ? [noteSource.id, ...input.selected_source_ids.filter((id) => id !== noteSource.id)] : [noteSource.id];

    let snapshot: SourceRevisionPair[];
    let chunks: UnifiedDocumentChunk[];
    try {
      ({ snapshot, chunks } = await context.read(userId, notebookId, scopeIds));
    } catch (e) {
      if (e instanceof InvalidScopeError) throw err("InvalidScope", 404, "Selected source is not available");
      if (e instanceof SourceNotReadyError) throw err("SourceNotReady", 409, "Selected source is not ready");
      throw e;
    }

    const question = ACTION_PROMPTS[input.action_type];
    let answer;
    try {
      answer = await assistant.answer({ question, chunks });
    } catch (e) {
      if (e instanceof ModelUnavailableError) throw err("Unavailable", 503, "The note assistant model is not available. Please try again.");
      throw e;
    }

    // Recheck authorization and the captured revisions before publishing (FR-018).
    await this.assertAuthorized(notebookId, userId);
    let messages: VisibleMessage[];
    try {
      await context.verify(userId, notebookId, snapshot);
      messages = await context.publish({ ownerId: userId, notebookId, snapshot, question, answer });
    } catch (e) {
      if (e instanceof SourceSnapshotInvalidError || e instanceof InvalidScopeError || e instanceof SourceNotReadyError) {
        throw err("SourceSnapshotInvalid", 409, "A source changed while the action was running");
      }
      throw e;
    }
    const message = messages.find((m) => m.role === "assistant")!;
    const kinds: CitationKinds = {};
    for (const c of answer.citations) kinds[c.chunk_id] = c.source_id === noteSource.id ? "note_assertion" : "source_fact";
    return {
      message,
      messages,
      note_source: noteSource,
      reused,
      snapshot,
      note_assertion_source_ids: [noteSource.id],
      citation_kinds: kinds,
    };
  }
}
