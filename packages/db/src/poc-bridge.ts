import { randomUUID } from "node:crypto";
import type { ChatMessage, Notebook } from "@everlast/contracts";

/**
 * Release v2 proof-of-concept bridge (D16).
 *
 * The v2 stores (workspace preferences, Source Guide and chat control, notes, Studio artifacts) keep their
 * data in process memory on purpose: persistence is not a goal of the proof of concept and moves to
 * PostgreSQL in v3. This module is the only place where those stores read v1 data. The API keeps it in
 * sync with PostgreSQL after it has authorized a request (notebook ownership, ready-source counts, chat
 * messages), so v2 never decides access on its own.
 */

// ---- Notebook directory -------------------------------------------------------------------------------

const notebooks = new Map<string, Notebook>();
const readySourceCounts = new Map<string, number>();
const forgetListeners: ((notebookId: string) => void)[] = [];

/** Records a notebook the API has just read from PostgreSQL for this owner. */
export function rememberNotebook(notebook: Omit<Notebook, "archived_at"> & { archived_at?: string | null }): Notebook {
  const existing = notebooks.get(notebook.id);
  // Keep a newer in-memory modification time (v2 marks content changes the v1 row does not track).
  const updatedAt =
    existing && Date.parse(existing.updated_at) > Date.parse(notebook.updated_at) ? existing.updated_at : notebook.updated_at;
  const record: Notebook = { ...notebook, updated_at: updatedAt, archived_at: notebook.archived_at ?? null };
  notebooks.set(notebook.id, record);
  return record;
}

export function getNotebookRaw(notebookId: string): Notebook | null {
  return notebooks.get(notebookId) ?? null;
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

export function setReadySourceCount(notebookId: string, count: number): void {
  readySourceCounts.set(notebookId, count);
}

export async function getReadySourceCount(notebookId: string): Promise<number> {
  return readySourceCounts.get(notebookId) ?? 0;
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
