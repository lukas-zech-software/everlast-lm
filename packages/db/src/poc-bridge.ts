import { randomUUID } from "node:crypto";
import type { ChatMessage, Notebook } from "@everlast/contracts";
import { v2Pool } from "./v2-persistence.ts";

/**
 * Bridge between the v2 stores and v1 data (FR-007, D16; specs/013-v2-persistence-postgres).
 *
 * With PostgreSQL configured (`configureV2Persistence`, always in the API) notebook ownership and Ready counts
 * are read from the v1 tables, so v2 never keeps its own copy of access data. Without it (TEST-ONLY memory
 * double) the notebook directory below stands in for those tables: tests mirror notebooks into it.
 */

// ---- Notebook directory -------------------------------------------------------------------------------

const notebooks = new Map<string, Notebook>();
const readySourceCounts = new Map<string, number>();
const forgetListeners: ((notebookId: string) => void)[] = [];

/** Memory double: records a notebook as if read from PostgreSQL. No-op mirror in PostgreSQL mode. */
export function rememberNotebook(notebook: Omit<Notebook, "archived_at"> & { archived_at?: string | null }): Notebook {
  const existing = notebooks.get(notebook.id);
  // Keep a newer in-memory modification time (v2 marks content changes the v1 row does not track).
  const updatedAt =
    existing && Date.parse(existing.updated_at) > Date.parse(notebook.updated_at) ? existing.updated_at : notebook.updated_at;
  const record: Notebook = { ...notebook, updated_at: updatedAt, archived_at: notebook.archived_at ?? null };
  if (!v2Pool()) notebooks.set(notebook.id, record);
  return record;
}

/** Memory double only: the mirrored notebook. Production code uses `getNotebookRecord` / `getNotebookOwner`. */
export function getNotebookRaw(notebookId: string): Notebook | null {
  return notebooks.get(notebookId) ?? null;
}

/** The live notebook (v1 `notebooks` row in PostgreSQL mode); null when it does not exist (or was deleted). */
export async function getNotebookRecord(notebookId: string): Promise<Notebook | null> {
  const pool = v2Pool();
  if (!pool) return getNotebookRaw(notebookId);
  const { rows } = await pool.query<{ id: string; owner_id: string; title: string; created_at: Date; updated_at: Date }>(
    "SELECT id, owner_id, title, created_at, updated_at FROM notebooks WHERE id = $1",
    [notebookId]
  );
  const row = rows[0];
  return row
    ? { id: row.id, owner_id: row.owner_id, title: row.title, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), archived_at: null }
    : null;
}

/** Owner of a live, non-archived notebook, or null (FR-WM-04: access is decided from v1 ownership). */
export async function getNotebookOwner(notebookId: string): Promise<string | null> {
  const notebook = await getNotebookRecord(notebookId);
  return notebook && !notebook.archived_at ? notebook.owner_id : null;
}

/** Registers cleanup for a v2 store; runs when a notebook is deleted. */
export function onNotebookForgotten(listener: (notebookId: string) => void): void {
  forgetListeners.push(listener);
}

/** Drops every v2 record of a deleted notebook. */
export function forgetNotebook(notebookId: string): void {
  notebooks.delete(notebookId);
  readySourceCounts.delete(notebookId);
  for (const listener of forgetListeners) listener(notebookId);
}

/** Memory double only; in PostgreSQL mode Ready counts come from `sources`. */
export function setReadySourceCount(notebookId: string, count: number): void {
  if (v2Pool()) return;
  readySourceCounts.set(notebookId, count);
}

export async function getReadySourceCount(notebookId: string): Promise<number> {
  const pool = v2Pool();
  if (!pool) return readySourceCounts.get(notebookId) ?? 0;
  const { rows } = await pool.query<{ ready: number }>("SELECT count(*)::int AS ready FROM sources WHERE notebook_id = $1 AND status = 'Ready'", [notebookId]);
  return rows[0]!.ready;
}

/** Ready counts for several notebooks in one query (notebook overview). */
export async function getReadySourceCounts(notebookIds: string[]): Promise<Map<string, number>> {
  const pool = v2Pool();
  if (!pool) return new Map(notebookIds.map((id) => [id, readySourceCounts.get(id) ?? 0]));
  const { rows } = await pool.query<{ notebook_id: string; ready: number }>(
    "SELECT notebook_id, count(*)::int AS ready FROM sources WHERE notebook_id = ANY($1::uuid[]) AND status = 'Ready' GROUP BY notebook_id",
    [notebookIds]
  );
  const counts = new Map(notebookIds.map((id) => [id, 0]));
  for (const r of rows) counts.set(r.notebook_id, r.ready);
  return counts;
}

/** Test helper: creates an in-memory notebook without PostgreSQL. */
export function createPocNotebook(ownerId: string, title = "Untitled notebook"): Notebook {
  const now = new Date().toISOString();
  return rememberNotebook({ id: randomUUID(), owner_id: ownerId, title, created_at: now, updated_at: now });
}

// ---- Chat messages ------------------------------------------------------------------------------------

export type ChatMessageReader = (notebookId: string, userId: string) => Promise<ChatMessage[]>;

const messageStore = new Map<string, ChatMessage>();
let messageReader: ChatMessageReader | null = null;

/** The API points v2 at the PostgreSQL chat history; without it the in-memory store is used (tests). */
export function configureChatMessageReader(reader: ChatMessageReader | null): void {
  messageReader = reader;
}

/** PostgreSQL chat history (when configured) plus turns written by v2 features themselves, oldest first. */
export async function getChatMessages(_client: unknown, notebookId: string, userId: string): Promise<ChatMessage[]> {
  const persisted = messageReader ? await messageReader(notebookId, userId) : [];
  const local = [...messageStore.values()].filter((m) => m.notebook_id === notebookId && m.user_id === userId);
  return [...persisted, ...local]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((m) => ({ ...m }));
}

/** In-memory thread handle for v2 turns (one thread per user and notebook). */
export async function getOrCreateChatThread(
  _client: unknown,
  notebookId: string,
  userId: string
): Promise<{ id: string; notebook_id: string; user_id: string }> {
  return { id: notebookId, notebook_id: notebookId, user_id: userId };
}

/** Clears the in-memory v2 turns of one thread; the PostgreSQL thread is cleared by the v1 chat route. */
export async function clearChatThread(_client: unknown, notebookId: string, userId: string): Promise<{ cleared: boolean }> {
  for (const [id, m] of messageStore) {
    if (m.notebook_id === notebookId && m.user_id === userId) messageStore.delete(id);
  }
  return { cleared: true };
}

export function resetChatStore(): void {
  messageStore.clear();
}

/** In-memory message write used by v2 tests and the notes assistant's own turns. */
export async function persistChatMessage(
  _client: unknown,
  data: Omit<ChatMessage, "id" | "created_at" | "citations" | "active_source_revisions_snapshot"> & {
    id?: string;
    created_at?: string;
    citations?: ChatMessage["citations"];
    active_source_revisions_snapshot?: ChatMessage["active_source_revisions_snapshot"];
  }
): Promise<ChatMessage> {
  const message: ChatMessage = {
    ...data,
    id: data.id ?? randomUUID(),
    created_at: data.created_at ?? new Date().toISOString(),
    citations: data.citations ?? [],
    active_source_revisions_snapshot: data.active_source_revisions_snapshot ?? [],
  };
  messageStore.set(message.id, message);
  return { ...message };
}

/** Resets every bridge record (tests). */
export function resetPocBridge(): void {
  notebooks.clear();
  readySourceCounts.clear();
  messageStore.clear();
  messageReader = null;
}
