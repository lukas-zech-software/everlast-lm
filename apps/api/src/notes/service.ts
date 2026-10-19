import { randomUUID } from "node:crypto";
import {
  NOTE_ASSISTANT_MAX_NOTES,
  NOTE_ERROR_MESSAGES,
  NOTE_SOURCE_MAX_BYTES,
  NOTE_SOURCE_MAX_WORDS,
  InvalidScopeError,
  SourceQuotaExceededError,
  SourceSnapshotInvalidError,
  countNoteWords,
  noteSourceTitle,
  type ChatMessage,
  type ConvertToSourceInput,
  type Note,
  type NoteAssistantAction,
  type NoteAssistantInput,
  type NoteSource,
  type NoteSourceIngestor,
  type ScopedContextProvider,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  convertToEditable,
  getChatMessages,
  getNote,
  getOrCreateChatThread,
  getScopedContext,
  listNotes,
  persistChatMessage,
  registerSource,
  saveResponseAsNote,
} from "@everlast/db";
import type { NoteAssistantModel } from "./assistant-model.ts";

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

export interface NotesServiceDeps {
  ingestor: NoteSourceIngestor;
  /** Grounded answer port for the Note Assistant; absent → 503 (never a fabricated answer). */
  assistant?: NoteAssistantModel;
  scopedContext?: ScopedContextProvider;
  verifyOwnership?: (notebookId: string, userId: string) => Promise<boolean> | boolean;
  /** Reserves one source slot for a note source (FR-WM-07); throws SourceQuotaExceededError when full. */
  reserveSlot?: (notebookId: string, bytes: number) => Promise<void>;
  /** Source titles for citation metadata (note sources are resolved from the registry). */
  sourceTitles?: (notebookId: string, sourceIds: string[]) => Promise<Map<string, string>>;
}

export interface CitationKinds {
  [chunk_id: string]: "note_assertion" | "source_fact";
}

export interface AssistantResult {
  message: ChatMessage;
  note_source: NoteSource;
  snapshot: { source_id: string; revision: number }[];
  note_assertion_source_ids: string[];
  citation_kinds: CitationKinds;
}

const ACTION_PROMPTS: Record<NoteAssistantAction, string> = {
  summarize: "Summarize the selected notes.",
  create_outline: "Create an outline from the selected notes.",
  related_ideas: "Suggest related ideas based on the selected notes and the comparison sources.",
  critique: "Critique the selected notes against the comparison sources.",
};

export function composeNoteMarkdown(notes: Pick<Note, "title" | "content_md">[]): string {
  return notes.map((n) => `# ${n.title}\n\n${n.content_md}`.trimEnd()).join("\n\n");
}

export class NotesService {
  private readonly deps: NotesServiceDeps;
  constructor(deps: NotesServiceDeps) {
    this.deps = deps;
  }

  private get provider(): ScopedContextProvider {
    return this.deps.scopedContext ?? { getScopedContext };
  }

  /** FR-NM-02 / FR-GC-09: copy an assistant message into a read-only saved-response note. */
  async saveFromMessage(notebookId: string, userId: string, messageId: string) {
    const messages = await getChatMessages(undefined, notebookId, userId);
    const msg = messages.find((m) => m.id === messageId && m.role === "assistant");
    if (!msg) {
      // Repeat saves stay idempotent even after the chat was cleared.
      const existing = (await listNotes(notebookId, userId)).find((n) => n.source_message_id === messageId);
      if (existing) return { note: existing, created: false };
      throw err("MessageNotFound", 404, "Assistant message not found");
    }
    return saveResponseAsNote(notebookId, userId, {
      message_id: msg.id,
      content: msg.content,
      citations: msg.citations ?? [],
    });
  }

  async convertToEditable(notebookId: string, userId: string, noteId: string) {
    return convertToEditable(notebookId, userId, noteId);
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

  /** FR-NM-03: snapshot notes into one note_markdown source through the Markdown ingestion path. */
  async convertToSource(notebookId: string, userId: string, input: ConvertToSourceInput): Promise<NoteSource> {
    const notes = await this.resolveNotes(notebookId, userId, input);
    return this.convertNotes(notebookId, notes);
  }

  private async convertNotes(notebookId: string, notes: Note[]): Promise<NoteSource> {
    if (notes.length === 0 || notes.every((n) => n.content_md.trim() === "")) {
      throw err("NoteSourceEmpty", 422, "Selected notes have no content to convert");
    }
    const markdown = composeNoteMarkdown(notes);
    const bytes = Buffer.byteLength(markdown, "utf8");
    if (bytes > NOTE_SOURCE_MAX_BYTES) throw err("SourceOversized", 422, "Combined notes exceed 200,000,000 bytes");
    if (countNoteWords(markdown) > NOTE_SOURCE_MAX_WORDS) {
      throw err("SourceOversizedWords", 422, "Combined notes exceed 500,000 words");
    }

    const sourceId = randomUUID();
    try {
      await this.deps.reserveSlot?.(notebookId, bytes);
    } catch (e) {
      if (e instanceof SourceQuotaExceededError) {
        throw err("SourceLimitReached", 409, NOTE_ERROR_MESSAGES.SourceLimitReached);
      }
      if (e instanceof InvalidScopeError) throw err("NotebookNotFound", 404, "Notebook not found");
      throw e;
    }

    const title = noteSourceTitle(notes.map((n) => n.title));
    let result;
    try {
      result = await this.deps.ingestor.ingest({
        attempt_id: sourceId, notebook_id: notebookId, source_id: sourceId, revision_id: 1, title, markdown,
      });
    } catch (e) {
      throw err("IngestionFailed", 502, e instanceof Error ? e.message : "Ingestion failed");
    }
    if (result.status !== "Ready") {
      throw err("IngestionFailed", 502, result.error_message ?? "Ingestion failed");
    }

    const source: NoteSource = {
      id: sourceId,
      notebook_id: notebookId,
      title,
      media_type: "note_markdown",
      status: "Ready",
      revision_id: 1,
      byte_size: result.byte_size,
      word_count: result.word_count,
      origin_notes: notes.map((n) => ({ note_id: n.id, revision: n.revision, title: n.title })),
      created_at: new Date().toISOString(),
    };
    await registerSource(source, result.chunks);
    return source;
  }

  private async assertAuthorized(notebookId: string, userId: string): Promise<void> {
    if (this.deps.verifyOwnership && !(await this.deps.verifyOwnership(notebookId, userId))) {
      throw err("Forbidden", 403, "User is not authorized for this notebook.");
    }
  }

  private revisionsOf(chunks: UnifiedDocumentChunk[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const c of chunks) m.set(c.source_id, Math.max(m.get(c.source_id) ?? 0, c.revision));
    return m;
  }

  /** FR-NM-04: convert the selection, read through C-02 with a revision snapshot, answer, publish. */
  async runAssistant(notebookId: string, userId: string, input: NoteAssistantInput): Promise<AssistantResult> {
    if (input.selected_note_ids.length > NOTE_ASSISTANT_MAX_NOTES) throw err("ValidationError", 422);
    const needsComparison = input.action_type === "related_ideas" || input.action_type === "critique";
    if (needsComparison && input.selected_source_ids.length === 0) {
      throw err("ComparisonSourceRequired", 400, NOTE_ERROR_MESSAGES.ComparisonSourceRequired);
    }

    const notes = await this.resolveNotes(notebookId, userId, { note_ids: input.selected_note_ids });
    const noteSource = await this.convertNotes(notebookId, notes);

    const activeIds = [noteSource.id, ...input.selected_source_ids.filter((id) => id !== noteSource.id)];
    await this.assertAuthorized(notebookId, userId);
    let chunks: UnifiedDocumentChunk[];
    try {
      chunks = await this.provider.getScopedContext(notebookId, activeIds);
    } catch (e) {
      if (e instanceof InvalidScopeError) throw err("InvalidScope", 404, "Selected source is not available");
      throw e;
    }
    const snapshot = [...this.revisionsOf(chunks)].map(([source_id, revision]) => ({ source_id, revision }));

    if (!this.deps.assistant) throw err("Unavailable", 503, "The note assistant model is not configured");
    const thread = await getOrCreateChatThread(undefined, notebookId, userId);
    const titles = (await this.deps.sourceTitles?.(notebookId, activeIds)) ?? new Map<string, string>();
    titles.set(noteSource.id, noteSource.title);
    const turn = await this.deps.assistant.answer({ question: ACTION_PROMPTS[input.action_type], chunks, titles });

    // Recheck authorization and revisions before publishing.
    await this.assertAuthorized(notebookId, userId);
    try {
      const fresh = this.revisionsOf(await this.provider.getScopedContext(notebookId, activeIds));
      for (const s of snapshot) {
        if (fresh.get(s.source_id) !== s.revision) throw new SourceSnapshotInvalidError();
      }
    } catch (e) {
      if (e instanceof SourceSnapshotInvalidError || e instanceof InvalidScopeError) {
        throw err("SourceSnapshotInvalid", 409, "A source changed while the action was running");
      }
      throw e;
    }

    await persistChatMessage(undefined, {
      thread_id: thread.id, notebook_id: notebookId, user_id: userId, role: "user",
      content: ACTION_PROMPTS[input.action_type], active_source_revisions_snapshot: snapshot,
    });
    const message = await persistChatMessage(undefined, {
      thread_id: thread.id, notebook_id: notebookId, user_id: userId, role: "assistant",
      content: turn.content, active_source_revisions_snapshot: snapshot, citations: turn.citations ?? [],
    });

    const kinds: CitationKinds = {};
    for (const c of turn.citations ?? []) {
      kinds[c.chunk_id] = c.source_id === noteSource.id ? "note_assertion" : "source_fact";
    }
    return {
      message,
      note_source: noteSource,
      snapshot,
      note_assertion_source_ids: [noteSource.id],
      citation_kinds: kinds,
    };
  }
}
