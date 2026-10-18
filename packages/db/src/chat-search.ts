import type { PoolClient } from "pg";
import { getChatMessages } from "./chat-history.js";

export interface ChatSearchResult {
  id: string;
  content: string;
  role: "user" | "assistant";
  created_at: string;
  match?: string;
}

/**
 * Search chat messages for a specific user and notebook thread (FR-GC-06).
 * Enforces thread boundary, user isolation, and case-insensitive matching.
 */
export async function searchChatMessages(
  client: PoolClient | undefined,
  notebookId: string,
  userId: string,
  query: string
): Promise<ChatSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  if (client) {
    const res = await client.query(
      `SELECT id, content, role, created_at
       FROM chat_messages
       WHERE notebook_id = $1 AND user_id = $2 AND content ILIKE $3
       ORDER BY created_at ASC`,
      [notebookId, userId, `%${trimmed}%`]
    );

    return res.rows.map((row) => ({
      id: row.id,
      content: row.content,
      role: row.role,
      created_at: new Date(row.created_at).toISOString(),
      match: trimmed,
    }));
  }

  const messages = await getChatMessages(undefined, notebookId, userId);
  const lowerQuery = trimmed.toLowerCase();

  return messages
    .filter((msg) => msg.content.toLowerCase().includes(lowerQuery))
    .map((msg) => ({
      id: msg.id,
      content: msg.content,
      role: msg.role,
      created_at: msg.created_at,
      match: trimmed,
    }));
}
