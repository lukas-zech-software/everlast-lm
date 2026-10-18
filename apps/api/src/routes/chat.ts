import type { IncomingMessage, ServerResponse } from "node:http";
import { parseJsonBody, sendJson } from "../http.js";
import { GroundedChatAgent, ChatGroundingError } from "../chat/agent.js";
import { filterEligibleHistory, createSubmissionSnapshot } from "../chat/context.js";
import {
  UserMessageInputSchema,
  type ChatMessage,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";

export interface ChatServiceDependencies {
  agent?: GroundedChatAgent;
  getChunksForSources?: (notebookId: string, sourceIds: string[]) => Promise<UnifiedDocumentChunk[]>;
  getThreadMessages?: (notebookId: string, userId: string) => Promise<ChatMessage[]>;
  persistTurn?: (params: {
    notebookId: string;
    userId: string;
    userMessage: string;
    assistantMessage: string;
    activeSourceRevisionsSnapshot: { source_id: string; revision: number }[];
    citations: any[];
  }) => Promise<{ userMessageId: string; assistantMessageId: string }>;
  clearChat?: (notebookId: string, userId: string) => Promise<{ generationEpoch: number }>;
  searchThread?: (notebookId: string, userId: string, query: string) => Promise<any[]>;
}

/**
 * Chat HTTP API Route Dispatcher (FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06).
 */
export async function handleChatRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ChatServiceDependencies,
  userId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase();

  // Route 1: POST /api/notebooks/:id/chat/turns
  const turnsMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/chat\/turns$/);
  if (method === "POST" && turnsMatch) {
    const notebookId = turnsMatch[1]!;

    let body: any;
    try {
      body = await parseJsonBody<any>(req);
    } catch {
      sendJson(res, 400, { error: { code: "InvalidJson", message: "Malformed JSON body." } });
      return true;
    }

    if (!body || !body.active_source_ids || body.active_source_ids.length === 0) {
      sendJson(res, 400, {
        error: {
          code: "EmptyScopeError",
          message: "active_source_ids must contain at least one source UUID.",
        },
      });
      return true;
    }

    const validationResult = UserMessageInputSchema.safeParse({
      notebook_id: notebookId,
      message: body.message,
      active_source_ids: body.active_source_ids,
    });

    if (!validationResult.success) {
      sendJson(res, 422, {
        error: {
          code: "ValidationError",
          message: validationResult.error.errors.map((e) => e.message).join("; "),
        },
      });
      return true;
    }

    try {
      const activeSourceIds: string[] = validationResult.data.active_source_ids;
      const chunks = deps.getChunksForSources
        ? await deps.getChunksForSources(notebookId, activeSourceIds)
        : [];

      const rawHistory = deps.getThreadMessages
        ? await deps.getThreadMessages(notebookId, userId)
        : [];

      const activeSourceRevisions = new Map<string, number>();
      for (const ch of chunks) {
        activeSourceRevisions.set(ch.source_id, ch.revision);
      }
      for (const sId of activeSourceIds) {
        if (!activeSourceRevisions.has(sId)) {
          activeSourceRevisions.set(sId, 1);
        }
      }

      const eligibleHistory = filterEligibleHistory(
        rawHistory,
        activeSourceIds,
        activeSourceRevisions
      );

      const agent = deps.agent ?? new GroundedChatAgent();
      const turnResult = await agent.generateTurn({
        notebookId,
        threadId: notebookId, // 1 thread per notebook in v1.0
        userId,
        message: validationResult.data.message,
        activeSourceIds,
        chunks,
        history: eligibleHistory,
      });

      let persistedIds = { userMessageId: "generated-user-id", assistantMessageId: "generated-asst-id" };
      if (deps.persistTurn) {
        persistedIds = await deps.persistTurn({
          notebookId,
          userId,
          userMessage: validationResult.data.message,
          assistantMessage: turnResult.content,
          activeSourceRevisionsSnapshot: turnResult.activeSourceRevisionsSnapshot ?? [],
          citations: turnResult.citations ?? [],
        });
      }

      sendJson(res, 200, {
        grounded: turnResult.grounded,
        refusal: turnResult.refusal,
        turn: {
          id: persistedIds.assistantMessageId,
          role: "assistant",
          content: turnResult.content,
          citations: turnResult.citations ?? [],
          active_source_revisions_snapshot: turnResult.activeSourceRevisionsSnapshot,
          created_at: new Date().toISOString(),
        },
      });
      return true;
    } catch (err: any) {
      if (err instanceof ChatGroundingError) {
        sendJson(res, 422, { error: { code: "GroundingError", message: err.message } });
        return true;
      }
      sendJson(res, 500, { error: { code: "InternalError", message: err.message } });
      return true;
    }
  }

  // Route 2: GET /api/notebooks/:id/chat
  const chatMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/chat$/);
  if (method === "GET" && chatMatch) {
    const notebookId = chatMatch[1]!;
    const messages = deps.getThreadMessages
      ? await deps.getThreadMessages(notebookId, userId)
      : [];
    sendJson(res, 200, { messages });
    return true;
  }

  // Route 3: DELETE /api/notebooks/:id/chat (Clear chat)
  if (method === "DELETE" && chatMatch) {
    const notebookId = chatMatch[1]!;
    const clearResult = deps.clearChat
      ? await deps.clearChat(notebookId, userId)
      : { generationEpoch: 1 };
    sendJson(res, 200, { cleared: true, generation_epoch: clearResult.generationEpoch });
    return true;
  }

  // Route 4: GET /api/notebooks/:id/chat/search?q=...
  const searchMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/chat\/search$/);
  if (method === "GET" && searchMatch) {
    const notebookId = searchMatch[1]!;
    const query = url.searchParams.get("q") || "";
    const results = deps.searchThread
      ? await deps.searchThread(notebookId, userId, query)
      : [];
    sendJson(res, 200, { results });
    return true;
  }

  return false;
}
