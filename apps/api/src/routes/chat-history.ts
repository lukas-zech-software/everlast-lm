import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import {
  getChatMessages,
  clearChatThread,
  searchChatMessages,
} from "@everlast/db";
import type { ChatMessage } from "@everlast/contracts";

export interface ChatHistoryRouteDependencies {
  verifyOwnership?: (notebookId: string, userId: string) => Promise<boolean> | boolean;
  getChatMessages?: (notebookId: string, userId: string) => Promise<ChatMessage[]>;
  clearChatThread?: (notebookId: string, userId: string) => Promise<{ cleared: boolean; generationEpoch: number }>;
  searchChatMessages?: (notebookId: string, userId: string, query: string) => Promise<any[]>;
}

/**
 * Chat History & Search HTTP Route Dispatcher (FR-GC-06, C-01, C-02).
 * Handles:
 *   - GET /api/notebooks/:id/chat (chronological thread messages)
 *   - DELETE /api/notebooks/:id/chat (confirmed clear, increment epoch, delete messages)
 *   - GET /api/notebooks/:id/chat/search?q=... (search user thread)
 */
export async function handleChatHistoryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ChatHistoryRouteDependencies = {},
  userId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase();

  // Pattern 1: /api/notebooks/:id/chat
  const chatMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/chat$/);
  if (chatMatch) {
    const notebookId = chatMatch[1]!;

    if (deps.verifyOwnership) {
      const isOwner = await deps.verifyOwnership(notebookId, userId);
      if (!isOwner) {
        sendJson(res, 403, {
          error: { code: "Forbidden", message: "User is not authorized for this notebook." },
        });
        return true;
      }
    }

    if (method === "GET") {
      const messages = deps.getChatMessages
        ? await deps.getChatMessages(notebookId, userId)
        : await getChatMessages(undefined, notebookId, userId);

      sendJson(res, 200, { messages });
      return true;
    }

    if (method === "DELETE") {
      const clearResult = deps.clearChatThread
        ? await deps.clearChatThread(notebookId, userId)
        : await clearChatThread(undefined, notebookId, userId);

      sendJson(res, 200, {
        cleared: clearResult.cleared,
        generation_epoch: clearResult.generationEpoch,
      });
      return true;
    }
  }

  // Pattern 2: /api/notebooks/:id/chat/search
  const searchMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/chat\/search$/);
  if (method === "GET" && searchMatch) {
    const notebookId = searchMatch[1]!;

    if (deps.verifyOwnership) {
      const isOwner = await deps.verifyOwnership(notebookId, userId);
      if (!isOwner) {
        sendJson(res, 403, {
          error: { code: "Forbidden", message: "User is not authorized for this notebook." },
        });
        return true;
      }
    }

    const query = url.searchParams.get("q") || "";
    const results = deps.searchChatMessages
      ? await deps.searchChatMessages(notebookId, userId, query)
      : await searchChatMessages(undefined, notebookId, userId, query);

    sendJson(res, 200, { results });
    return true;
  }

  return false;
}
