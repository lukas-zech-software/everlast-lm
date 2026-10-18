import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ChatThread, ChatMessage } from "@everlast/contracts";

// In-memory backing stores for local tests and harness
const threadStore = new Map<string, ChatThread>(); // key: `${notebookId}:${userId}`
const messageStore = new Map<string, ChatMessage>(); // key: messageId

export function resetChatStore(): void {
  threadStore.clear();
  messageStore.clear();
}

/**
 * Deletes all chat threads and messages for a notebook (e.g. upon notebook deletion cascade).
 */
export function deleteChatThreadsForNotebook(notebookId: string): void {
  for (const [key, thread] of threadStore.entries()) {
    if (thread.notebook_id === notebookId) {
      threadStore.delete(key);
    }
  }
  for (const [id, msg] of messageStore.entries()) {
    if (msg.notebook_id === notebookId) {
      messageStore.delete(id);
    }
  }
}

/**
 * Get or create the unique chat thread for a notebook and user (FR-GC-06, C-01, C-02).
 * Enforces exactly one thread per (notebook_id, user_id) pair.
 */
export async function getOrCreateChatThread(
  client: PoolClient | undefined,
  notebookId: string,
  userId: string
): Promise<ChatThread> {
  if (client) {
    const selectRes = await client.query(
      `SELECT id, notebook_id, user_id, generation_epoch, created_at, updated_at
       FROM chat_threads
       WHERE notebook_id = $1 AND user_id = $2`,
      [notebookId, userId]
    );

    if (selectRes.rows.length > 0) {
      const row = selectRes.rows[0];
      return {
        id: row.id,
        notebook_id: row.notebook_id,
        user_id: row.user_id,
        generation_epoch: row.generation_epoch,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      };
    }

    const threadId = randomUUID();
    const insertRes = await client.query(
      `INSERT INTO chat_threads (id, notebook_id, user_id, generation_epoch, created_at, updated_at)
       VALUES ($1, $2, $3, 1, NOW(), NOW())
       ON CONFLICT (notebook_id, user_id)
       DO UPDATE SET updated_at = NOW()
       RETURNING id, notebook_id, user_id, generation_epoch, created_at, updated_at`,
      [threadId, notebookId, userId]
    );

    const row = insertRes.rows[0];
    return {
      id: row.id,
      notebook_id: row.notebook_id,
      user_id: row.user_id,
      generation_epoch: row.generation_epoch,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  const key = `${notebookId}:${userId}`;
  let thread = threadStore.get(key);
  if (!thread) {
    const now = new Date().toISOString();
    thread = {
      id: randomUUID(),
      notebook_id: notebookId,
      user_id: userId,
      generation_epoch: 1,
      created_at: now,
      updated_at: now,
    };
    threadStore.set(key, thread);
  }
  return { ...thread };
}

/**
 * Retrieve all chat messages for a user's thread in a notebook (FR-GC-06).
 * Returns messages ordered chronologically (created_at ASC).
 */
export async function getChatMessages(
  client: PoolClient | undefined,
  notebookId: string,
  userId: string
): Promise<ChatMessage[]> {
  if (client) {
    const res = await client.query(
      `SELECT id, thread_id, notebook_id, user_id, role, content,
              active_source_revisions_snapshot, citations, created_at
       FROM chat_messages
       WHERE notebook_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [notebookId, userId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      thread_id: row.thread_id,
      notebook_id: row.notebook_id,
      user_id: row.user_id,
      role: row.role,
      content: row.content,
      active_source_revisions_snapshot: Array.isArray(row.active_source_revisions_snapshot)
        ? row.active_source_revisions_snapshot
        : JSON.parse(row.active_source_revisions_snapshot || "[]"),
      citations: Array.isArray(row.citations)
        ? row.citations
        : JSON.parse(row.citations || "[]"),
      created_at: new Date(row.created_at).toISOString(),
    }));
  }

  const messages: ChatMessage[] = [];
  for (const msg of messageStore.values()) {
    if (msg.notebook_id === notebookId && msg.user_id === userId) {
      messages.push({ ...msg });
    }
  }

  messages.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return messages;
}

/**
 * Persist a user or assistant chat message with complete provenance and citations (FR-GC-06).
 */
export async function persistChatMessage(
  client: PoolClient | undefined,
  data: {
    id?: string;
    thread_id: string;
    notebook_id: string;
    user_id: string;
    role: "user" | "assistant";
    content: string;
    active_source_revisions_snapshot?: { source_id: string; revision: number }[];
    citations?: any[];
    created_at?: string;
  }
): Promise<ChatMessage> {
  const messageId = data.id ?? randomUUID();
  const createdAt = data.created_at ?? new Date().toISOString();
  const snapshot = data.active_source_revisions_snapshot ?? [];
  const citations = data.citations ?? [];

  if (client) {
    const res = await client.query(
      `INSERT INTO chat_messages (
         id, thread_id, notebook_id, user_id, role, content,
         active_source_revisions_snapshot, citations, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, thread_id, notebook_id, user_id, role, content,
                 active_source_revisions_snapshot, citations, created_at`,
      [
        messageId,
        data.thread_id,
        data.notebook_id,
        data.user_id,
        data.role,
        data.content,
        JSON.stringify(snapshot),
        JSON.stringify(citations),
        createdAt,
      ]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      thread_id: row.thread_id,
      notebook_id: row.notebook_id,
      user_id: row.user_id,
      role: row.role,
      content: row.content,
      active_source_revisions_snapshot: Array.isArray(row.active_source_revisions_snapshot)
        ? row.active_source_revisions_snapshot
        : JSON.parse(row.active_source_revisions_snapshot || "[]"),
      citations: Array.isArray(row.citations)
        ? row.citations
        : JSON.parse(row.citations || "[]"),
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  const message: ChatMessage = {
    id: messageId,
    thread_id: data.thread_id,
    notebook_id: data.notebook_id,
    user_id: data.user_id,
    role: data.role,
    content: data.content,
    active_source_revisions_snapshot: snapshot,
    citations,
    created_at: createdAt,
  };

  messageStore.set(messageId, message);
  return { ...message };
}

/**
 * Clear the chat thread for a user and notebook (FR-GC-06).
 * Atomically increments generation_epoch (cancelling late generation results)
 * and deletes all messages in the thread, leaving all sources and notes untouched.
 */
export async function clearChatThread(
  client: PoolClient | undefined,
  notebookId: string,
  userId: string
): Promise<{ cleared: boolean; generationEpoch: number }> {
  if (client) {
    const updateRes = await client.query(
      `UPDATE chat_threads
       SET generation_epoch = generation_epoch + 1, updated_at = NOW()
       WHERE notebook_id = $1 AND user_id = $2
       RETURNING generation_epoch`,
      [notebookId, userId]
    );

    let generationEpoch = 1;
    if (updateRes.rows.length > 0) {
      generationEpoch = updateRes.rows[0].generation_epoch;
    }

    await client.query(
      `DELETE FROM chat_messages WHERE notebook_id = $1 AND user_id = $2`,
      [notebookId, userId]
    );

    return { cleared: true, generationEpoch };
  }

  const key = `${notebookId}:${userId}`;
  let thread = threadStore.get(key);
  if (!thread) {
    const now = new Date().toISOString();
    thread = {
      id: randomUUID(),
      notebook_id: notebookId,
      user_id: userId,
      generation_epoch: 2,
      created_at: now,
      updated_at: now,
    };
    threadStore.set(key, thread);
  } else {
    thread.generation_epoch += 1;
    thread.updated_at = new Date().toISOString();
  }

  // Delete all messages for this notebook and user
  for (const [id, msg] of messageStore.entries()) {
    if (msg.notebook_id === notebookId && msg.user_id === userId) {
      messageStore.delete(id);
    }
  }

  return { cleared: true, generationEpoch: thread.generation_epoch };
}
