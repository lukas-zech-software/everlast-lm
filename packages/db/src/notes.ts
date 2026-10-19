import { randomUUID } from "node:crypto";
import { onNotebookForgotten } from "./poc-bridge.ts";
import {
  clampCodePoints,
  DEFAULT_NOTE_TITLE,
  NOTE_TITLE_MAX_CODE_POINTS,
  type Citation,
  type CreateNoteInput,
  type Note,
  type PatchNoteInput,
} from "@everlast/contracts";

// In-memory notes store (FR-NM-01, FR-NM-02, FR-GC-09); PoC per D16, PostgreSQL persistence follows in v3.

export class NoteNotFoundError extends Error {
  constructor(message = "Note not found") {
    super(message);
    this.name = "NoteNotFoundError";
  }
}
export class NoteReadOnlyError extends Error {
  constructor(message = "Saved responses cannot be edited") {
    super(message);
    this.name = "NoteReadOnlyError";
  }
}
export class RevisionConflictError extends Error {
  constructor(message = "Note revision conflict") {
    super(message);
    this.name = "RevisionConflictError";
  }
}
export class NotSavedResponseError extends Error {
  constructor(message = "Only saved responses can be converted to editable notes") {
    super(message);
    this.name = "NotSavedResponseError";
  }
}

const noteStore = new Map<string, Note>();
const orderCounters = new Map<string, number>();

export function resetNoteStore(): void {
  noteStore.clear();
  orderCounters.clear();
}

export function deleteNotesForNotebook(notebookId: string): void {
  for (const [id, n] of noteStore) {
    if (n.notebook_id === notebookId) noteStore.delete(id);
  }
  orderCounters.delete(notebookId);
}

function nextOrder(notebookId: string): number {
  const next = (orderCounters.get(notebookId) ?? 0) + 1;
  orderCounters.set(notebookId, next);
  return next;
}

function scoped(notebookId: string, ownerId: string, noteId: string): Note | undefined {
  const n = noteStore.get(noteId);
  return n && n.notebook_id === notebookId && n.owner_id === ownerId ? n : undefined;
}

function insert(notebookId: string, ownerId: string, fields: Partial<Note> & Pick<Note, "title" | "content_md">): Note {
  const now = new Date().toISOString();
  const note: Note = {
    id: randomUUID(),
    notebook_id: notebookId,
    owner_id: ownerId,
    origin_type: "manual",
    source_message_id: null,
    citations_json: [],
    origin_note_id: null,
    revision: 1,
    display_order: nextOrder(notebookId),
    created_at: now,
    updated_at: now,
    ...fields,
  };
  noteStore.set(note.id, note);
  return structuredClone(note);
}

export async function createNote(
  notebookId: string,
  ownerId: string,
  input: Partial<CreateNoteInput>
): Promise<Note> {
  return insert(notebookId, ownerId, {
    title: input.title ?? DEFAULT_NOTE_TITLE,
    content_md: input.content_md ?? "",
  });
}

export async function listNotes(notebookId: string, ownerId: string): Promise<Note[]> {
  return [...noteStore.values()]
    .filter((n) => n.notebook_id === notebookId && n.owner_id === ownerId)
    .sort((a, b) => a.display_order - b.display_order)
    .map((n) => structuredClone(n));
}

export async function getNote(notebookId: string, ownerId: string, noteId: string): Promise<Note | null> {
  const n = scoped(notebookId, ownerId, noteId);
  return n ? structuredClone(n) : null;
}

export async function updateNote(
  notebookId: string,
  ownerId: string,
  noteId: string,
  patch: PatchNoteInput
): Promise<Note> {
  const n = scoped(notebookId, ownerId, noteId);
  if (!n) throw new NoteNotFoundError();
  if (n.origin_type === "saved_response") throw new NoteReadOnlyError();
  if (patch.base_revision !== undefined && patch.base_revision !== n.revision) {
    throw new RevisionConflictError();
  }
  if (patch.title === undefined && patch.content_md === undefined) return structuredClone(n);
  if (patch.title !== undefined) n.title = patch.title;
  if (patch.content_md !== undefined) n.content_md = patch.content_md;
  n.revision += 1;
  n.updated_at = new Date().toISOString();
  return structuredClone(n);
}

export async function deleteNote(notebookId: string, ownerId: string, noteId: string): Promise<boolean> {
  return scoped(notebookId, ownerId, noteId) ? noteStore.delete(noteId) : false;
}

function savedResponseTitle(content: string): string {
  const firstLine =
    content
      .split("\n")
      .map((l) => l.replace(/\[\d+\]/g, "").replace(/[#*_`>\-]/g, "").trim())
      .find((l) => l.length > 0) ?? "Saved response";
  return clampCodePoints(firstLine, NOTE_TITLE_MAX_CODE_POINTS);
}

/** Idempotent on (notebook, owner, source_message_id) (FR-GC-09). Copies content and citations. */
export async function saveResponseAsNote(
  notebookId: string,
  ownerId: string,
  input: { message_id: string; content: string; citations: Citation[] }
): Promise<{ note: Note; created: boolean }> {
  for (const n of noteStore.values()) {
    if (n.notebook_id === notebookId && n.owner_id === ownerId && n.source_message_id === input.message_id) {
      return { note: structuredClone(n), created: false };
    }
  }
  const note = insert(notebookId, ownerId, {
    title: savedResponseTitle(input.content),
    content_md: input.content,
    origin_type: "saved_response",
    source_message_id: input.message_id,
    citations_json: structuredClone(input.citations),
  });
  return { note, created: true };
}

/** FR-NM-02: separate manual copy; verified badges removed; original unchanged. */
export async function convertToEditable(notebookId: string, ownerId: string, noteId: string): Promise<Note> {
  const n = scoped(notebookId, ownerId, noteId);
  if (!n) throw new NoteNotFoundError();
  if (n.origin_type !== "saved_response") throw new NotSavedResponseError();
  const badges = new Set(n.citations_json.map((c) => c.badge_number));
  const content = n.content_md
    .replace(/[ \t]?\[(\d+)\]/g, (m, d: string) => (badges.has(Number(d)) ? "" : m))
    .trim();
  return insert(notebookId, ownerId, {
    title: n.title,
    content_md: content,
    origin_note_id: n.id,
    source_message_id: null,
  });
}

onNotebookForgotten(deleteNotesForNotebook);
