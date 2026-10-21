import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { onNotebookForgotten } from "./poc-bridge.ts";
import { withTransaction } from "./transaction.ts";
import { v2Pool } from "./v2-persistence.ts";
import {
  clampCodePoints,
  DEFAULT_NOTE_TITLE,
  NOTE_TITLE_MAX_CODE_POINTS,
  SAVED_RESPONSE_DEFAULT_TITLE,
  sanitizeNoteMarkdown,
  stripCitationMarkers,
  type Citation,
  type CreateNoteInput,
  type Note,
  type PatchNoteInput,
} from "@everlast/contracts";

// Notes store (FR-NM-01, FR-NM-02, FR-GC-09): PostgreSQL table `notes` (0007, specs/013) when configured, else
// the TEST-ONLY in-memory double. Every write stores sanitized Markdown (FR-NM-01 FR-002): raw HTML and unsafe link targets never reach the store,
// whichever path wrote the note (routes, saved responses, editable copies, Studio conversion).

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
  fields = { ...fields, content_md: sanitizeNoteMarkdown(fields.content_md) };
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

// ---- PostgreSQL (specs/013) ----------------------------------------------------------------------------------

interface NoteRow {
  id: string;
  notebook_id: string;
  owner_id: string;
  title: string;
  content_md: string;
  origin_type: Note["origin_type"];
  source_message_id: string | null;
  citations_json: Citation[];
  origin_note_id: string | null;
  revision: number;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}
const NOTE_COLUMNS =
  "id, notebook_id, owner_id, title, content_md, origin_type, source_message_id, citations_json, origin_note_id, revision, display_order, created_at, updated_at";

const toNote = (r: NoteRow): Note => ({ ...r, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString() });

async function pgInsert(db: Pool | PoolClient, notebookId: string, ownerId: string, fields: Partial<Note> & Pick<Note, "title" | "content_md">): Promise<Note> {
  // Display order: per-notebook counter, never reused after a delete (same as the memory store).
  const { rows } = await db.query<NoteRow>(
    `WITH next AS (
       INSERT INTO notebook_v2_metadata (notebook_id, note_order_counter) VALUES ($2, 1)
       ON CONFLICT (notebook_id) DO UPDATE SET note_order_counter = notebook_v2_metadata.note_order_counter + 1
       RETURNING note_order_counter
     )
     INSERT INTO notes (id, notebook_id, owner_id, title, content_md, origin_type, source_message_id, citations_json, origin_note_id, display_order)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, note_order_counter FROM next
     RETURNING ${NOTE_COLUMNS}`,
    [
      randomUUID(),
      notebookId,
      ownerId,
      fields.title,
      sanitizeNoteMarkdown(fields.content_md),
      fields.origin_type ?? "manual",
      fields.source_message_id ?? null,
      JSON.stringify(fields.citations_json ?? []),
      fields.origin_note_id ?? null,
    ]
  );
  return toNote(rows[0]!);
}

async function pgLocked(client: PoolClient, notebookId: string, ownerId: string, noteId: string): Promise<NoteRow | undefined> {
  const { rows } = await client.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 AND notebook_id = $2 AND owner_id = $3 FOR UPDATE`,
    [noteId, notebookId, ownerId]
  );
  return rows[0];
}

async function pgGet(pool: Pool, notebookId: string, ownerId: string, noteId: string): Promise<Note | null> {
  const { rows } = await pool.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 AND notebook_id = $2 AND owner_id = $3`, [noteId, notebookId, ownerId]);
  return rows[0] ? toNote(rows[0]) : null;
}

export async function createNote(
  notebookId: string,
  ownerId: string,
  input: Partial<CreateNoteInput>
): Promise<Note> {
  const pool = v2Pool();
  if (pool) return pgInsert(pool, notebookId, ownerId, { title: input.title ?? DEFAULT_NOTE_TITLE, content_md: input.content_md ?? "" });
  return insert(notebookId, ownerId, {
    title: input.title ?? DEFAULT_NOTE_TITLE,
    content_md: input.content_md ?? "",
  });
}

export async function listNotes(notebookId: string, ownerId: string): Promise<Note[]> {
  const pool = v2Pool();
  if (pool) {
    const { rows } = await pool.query<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE notebook_id = $1 AND owner_id = $2 ORDER BY display_order, created_at, id`,
      [notebookId, ownerId]
    );
    return rows.map(toNote);
  }
  return [...noteStore.values()]
    .filter((n) => n.notebook_id === notebookId && n.owner_id === ownerId)
    .sort((a, b) => a.display_order - b.display_order)
    .map((n) => structuredClone(n));
}

export async function getNote(notebookId: string, ownerId: string, noteId: string): Promise<Note | null> {
  const pool = v2Pool();
  if (pool) return pgGet(pool, notebookId, ownerId, noteId);
  const n = scoped(notebookId, ownerId, noteId);
  return n ? structuredClone(n) : null;
}

export async function updateNote(
  notebookId: string,
  ownerId: string,
  noteId: string,
  patch: PatchNoteInput
): Promise<Note> {
  const pool = v2Pool();
  if (pool) {
    // FR-009: the row lock serializes concurrent edits; the second sees the new revision and conflicts.
    return withTransaction(pool, async (client) => {
      const row = await pgLocked(client, notebookId, ownerId, noteId);
      if (!row) throw new NoteNotFoundError();
      if (row.origin_type === "saved_response") throw new NoteReadOnlyError();
      if (patch.base_revision !== undefined && patch.base_revision !== row.revision) throw new RevisionConflictError();
      if (patch.title === undefined && patch.content_md === undefined) return toNote(row);
      const { rows } = await client.query<NoteRow>(
        `UPDATE notes SET title = $2, content_md = $3, revision = revision + 1, updated_at = greatest(now(), updated_at)
         WHERE id = $1 RETURNING ${NOTE_COLUMNS}`,
        [noteId, patch.title ?? row.title, patch.content_md !== undefined ? sanitizeNoteMarkdown(patch.content_md) : row.content_md]
      );
      return toNote(rows[0]!);
    }, { retries: 0 });
  }
  const n = scoped(notebookId, ownerId, noteId);
  if (!n) throw new NoteNotFoundError();
  if (n.origin_type === "saved_response") throw new NoteReadOnlyError();
  if (patch.base_revision !== undefined && patch.base_revision !== n.revision) {
    throw new RevisionConflictError();
  }
  if (patch.title === undefined && patch.content_md === undefined) return structuredClone(n);
  if (patch.title !== undefined) n.title = patch.title;
  if (patch.content_md !== undefined) n.content_md = sanitizeNoteMarkdown(patch.content_md);
  n.revision += 1;
  n.updated_at = new Date().toISOString();
  return structuredClone(n);
}

export async function deleteNote(notebookId: string, ownerId: string, noteId: string): Promise<boolean> {
  const pool = v2Pool();
  if (pool) {
    const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1 AND notebook_id = $2 AND owner_id = $3", [noteId, notebookId, ownerId]);
    return (rowCount ?? 0) > 0;
  }
  return scoped(notebookId, ownerId, noteId) ? noteStore.delete(noteId) : false;
}

/** Shared save-note title rule (FR-NM-02 FR-006): the given title (the preceding user question) trimmed and clamped. */
function savedResponseTitle(title: string | undefined): string {
  const clamped = clampCodePoints((title ?? "").trim(), NOTE_TITLE_MAX_CODE_POINTS).trim();
  return clamped || SAVED_RESPONSE_DEFAULT_TITLE;
}

/** Idempotent on (notebook, owner, source_message_id) (FR-GC-09). Copies content and citations. */
export async function saveResponseAsNote(
  notebookId: string,
  ownerId: string,
  input: { message_id: string; content: string; citations: Citation[]; title?: string | undefined }
): Promise<{ note: Note; created: boolean }> {
  const pool = v2Pool();
  if (pool) {
    const existing = async () =>
      (await pool.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM notes WHERE notebook_id = $1 AND owner_id = $2 AND source_message_id = $3`, [notebookId, ownerId, input.message_id])).rows[0];
    const found = await existing();
    if (found) return { note: toNote(found), created: false };
    try {
      const note = await pgInsert(pool, notebookId, ownerId, {
        title: savedResponseTitle(input.title),
        content_md: input.content,
        origin_type: "saved_response",
        source_message_id: input.message_id,
        citations_json: input.citations,
      });
      return { note, created: true };
    } catch (err) {
      // FR-009: a concurrent save of the same message won the unique key; return its note.
      if ((err as { code?: string }).code !== "23505") throw err;
      return { note: toNote((await existing())!), created: false };
    }
  }
  for (const n of noteStore.values()) {
    if (n.notebook_id === notebookId && n.owner_id === ownerId && n.source_message_id === input.message_id) {
      return { note: structuredClone(n), created: false };
    }
  }
  const note = insert(notebookId, ownerId, {
    title: savedResponseTitle(input.title),
    content_md: input.content,
    origin_type: "saved_response",
    source_message_id: input.message_id,
    citations_json: structuredClone(input.citations),
  });
  return { note, created: true };
}

/** FR-NM-02: separate manual copy; verified badges removed; original unchanged. */
export async function convertToEditable(notebookId: string, ownerId: string, noteId: string): Promise<Note> {
  const pool = v2Pool();
  if (pool) {
    const original = await pgGet(pool, notebookId, ownerId, noteId);
    if (!original) throw new NoteNotFoundError();
    if (original.origin_type !== "saved_response") throw new NotSavedResponseError();
    const content = stripCitationMarkers(original.content_md, new Set(original.citations_json.map((c) => c.badge_number))).trim();
    return pgInsert(pool, notebookId, ownerId, { title: original.title, content_md: content, origin_note_id: original.id, source_message_id: null });
  }
  const n = scoped(notebookId, ownerId, noteId);
  if (!n) throw new NoteNotFoundError();
  if (n.origin_type !== "saved_response") throw new NotSavedResponseError();
  const content = stripCitationMarkers(n.content_md, new Set(n.citations_json.map((c) => c.badge_number))).trim();
  return insert(notebookId, ownerId, {
    title: n.title,
    content_md: content,
    origin_note_id: n.id,
    source_message_id: null,
  });
}

onNotebookForgotten(deleteNotesForNotebook);
