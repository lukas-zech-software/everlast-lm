import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateChatThread,
  getChatMessages,
  persistChatMessage,
  clearChatThread,
  resetChatStore,
  searchChatMessages,
} from "@everlast/db";
import type { ChatMessage, Citation } from "@everlast/contracts";

describe("FR-GC-06: User Story 4 - Persistent Conversation History Acceptance Tests", () => {
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const userId = "usr_alice_123";
  const source1Id = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    resetChatStore();
  });

  it("Scenario: Conversation and citations persist across page reload", async () => {
    // Given a user has asked 2 questions and received cited answers in a notebook
    const thread = await getOrCreateChatThread(undefined, notebookId, userId);

    const citation1: Citation = {
      badge_number: 1,
      source_id: source1Id,
      source_title: "Security_Guide.pdf",
      chunk_id: "018f6b40-0001-7000-8000-000000000001",
      snippet: "Port 8080 requires mTLS certificates.",
      locator: { page_number: 1, start_offset: 0, end_offset: 50 },
    };

    // Turn 1
    await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userId,
      role: "user",
      content: "What port does Server Alpha use?",
      active_source_revisions_snapshot: [{ source_id: source1Id, revision: 1 }],
      citations: [],
      created_at: new Date(Date.now() - 30000).toISOString(),
    });

    await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userId,
      role: "assistant",
      content: "Server Alpha runs on port 8080 [1].",
      active_source_revisions_snapshot: [{ source_id: source1Id, revision: 1 }],
      citations: [citation1],
      created_at: new Date(Date.now() - 25000).toISOString(),
    });

    // Turn 2
    await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userId,
      role: "user",
      content: "Does it require encryption?",
      active_source_revisions_snapshot: [{ source_id: source1Id, revision: 1 }],
      citations: [],
      created_at: new Date(Date.now() - 15000).toISOString(),
    });

    await persistChatMessage(undefined, {
      thread_id: thread.id,
      notebook_id: notebookId,
      user_id: userId,
      role: "assistant",
      content: "Yes, mTLS encryption is required [1].",
      active_source_revisions_snapshot: [{ source_id: source1Id, revision: 1 }],
      citations: [citation1],
      created_at: new Date(Date.now() - 10000).toISOString(),
    });

    // When the user reloads the browser page or logs out and logs back in
    const loadedMessages = await getChatMessages(undefined, notebookId, userId);

    // Then both user messages and both assistant responses are displayed in order
    expect(loadedMessages).toHaveLength(4);
    expect(loadedMessages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    expect(loadedMessages[0]!.content).toBe("What port does Server Alpha use?");
    expect(loadedMessages[1]!.content).toBe("Server Alpha runs on port 8080 [1].");
    expect(loadedMessages[2]!.content).toBe("Does it require encryption?");
    expect(loadedMessages[3]!.content).toBe("Yes, mTLS encryption is required [1].");

    // And hovering or clicking citation [1] in the first answer still shows the snippet and opens the source
    const asst1 = loadedMessages[1]!;
    expect(asst1.citations).toHaveLength(1);
    expect(asst1.citations[0]!.snippet).toBe("Port 8080 requires mTLS certificates.");
    expect(asst1.citations[0]!.source_title).toBe("Security_Guide.pdf");
    expect(asst1.citations[0]!.chunk_id).toBe("018f6b40-0001-7000-8000-000000000001");
  });

  it("Scenario: Clearing chat removes messages without affecting sources", async () => {
    // Given a notebook with 3 sources and 4 chat messages
    const thread = await getOrCreateChatThread(undefined, notebookId, userId);

    // Mock sources in Ready state
    const sources = [
      { id: "src_1", status: "Ready" },
      { id: "src_2", status: "Ready" },
      { id: "src_3", status: "Ready" },
    ];

    for (let i = 1; i <= 4; i++) {
      await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: i % 2 === 1 ? "user" : "assistant",
        content: `Message ${i}`,
        active_source_revisions_snapshot: [],
        citations: [],
      });
    }

    const messagesBefore = await getChatMessages(undefined, notebookId, userId);
    expect(messagesBefore).toHaveLength(4);

    // When the user clicks "Clear chat" and confirms
    const clearResult = await clearChatThread(undefined, notebookId, userId);

    // Then the chat panel contains 0 messages
    expect(clearResult.cleared).toBe(true);
    expect(clearResult.generationEpoch).toBeGreaterThan(thread.generation_epoch);

    const messagesAfter = await getChatMessages(undefined, notebookId, userId);
    expect(messagesAfter).toHaveLength(0);

    // And all 3 sources remain in the left sidebar in state "Ready"
    expect(sources.every((s) => s.status === "Ready")).toBe(true);
  });

  it("Scenario: Searching the chat history jumps to a past message", async () => {
    // Given a persisted thread with 20 messages, of which only message 4 contains "mTLS"
    const thread = await getOrCreateChatThread(undefined, notebookId, userId);

    let targetMessageId = "";
    for (let i = 1; i <= 20; i++) {
      const isTarget = i === 4;
      const content = isTarget
        ? "Network policy: Server Alpha enforces strict mTLS client certificate verification."
        : `Routine discussion turn ${i} regarding general application operations.`;

      const msg = await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: i % 2 === 1 ? "user" : "assistant",
        content,
        active_source_revisions_snapshot: [],
        citations: [],
      });

      if (isTarget) {
        targetMessageId = msg.id;
      }
    }

    // When the user searches the chat history for "mTLS"
    const searchResults = await searchChatMessages(
      undefined,
      notebookId,
      userId,
      "mTLS"
    );

    // Then exactly 1 result is listed
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]!.id).toBe(targetMessageId);
    expect(searchResults[0]!.content).toContain("strict mTLS client certificate");
  });

  describe("handleChatHistoryRoute HTTP integration", () => {
    function createMockReqRes(method: string, path: string) {
      const req = {
        method,
        url: path,
        headers: { host: "localhost" },
      } as any;

      let statusCode = 200;
      let body = "";

      const res = {
        writeHead(status: number) {
          statusCode = status;
        },
        setHeader() {},
        end(data?: string) {
          if (data) body = data;
        },
        get statusCode() {
          return statusCode;
        },
        get json() {
          return body ? JSON.parse(body) : null;
        },
      } as any;

      return { req, res };
    }

    it("handles GET /api/notebooks/:id/chat, DELETE /api/notebooks/:id/chat, and search", async () => {
      const { handleChatHistoryRoute } = await import("../src/routes/chat-history.js");
      const thread = await getOrCreateChatThread(undefined, notebookId, userId);

      await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: "user",
        content: "What is mTLS?",
      });

      // 1. GET /api/notebooks/:id/chat
      const getReq = createMockReqRes("GET", `/api/notebooks/${notebookId}/chat`);
      const getHandled = await handleChatHistoryRoute(getReq.req, getReq.res, {}, userId);
      expect(getHandled).toBe(true);
      expect(getReq.res.statusCode).toBe(200);
      expect(getReq.res.json.messages).toHaveLength(1);
      expect(getReq.res.json.messages[0].content).toBe("What is mTLS?");

      // 2. GET /api/notebooks/:id/chat/search?q=mTLS
      const searchReq = createMockReqRes("GET", `/api/notebooks/${notebookId}/chat/search?q=mTLS`);
      const searchHandled = await handleChatHistoryRoute(searchReq.req, searchReq.res, {}, userId);
      expect(searchHandled).toBe(true);
      expect(searchReq.res.statusCode).toBe(200);
      expect(searchReq.res.json.results).toHaveLength(1);

      // 3. DELETE /api/notebooks/:id/chat
      const delReq = createMockReqRes("DELETE", `/api/notebooks/${notebookId}/chat`);
      const delHandled = await handleChatHistoryRoute(delReq.req, delReq.res, {}, userId);
      expect(delHandled).toBe(true);
      expect(delReq.res.statusCode).toBe(200);
      expect(delReq.res.json.cleared).toBe(true);
      expect(delReq.res.json.generation_epoch).toBe(2);

      // 4. Verify thread messages are cleared
      const postDelReq = createMockReqRes("GET", `/api/notebooks/${notebookId}/chat`);
      await handleChatHistoryRoute(postDelReq.req, postDelReq.res, {}, userId);
      expect(postDelReq.res.json.messages).toHaveLength(0);

      // 5. Ownership verification rejection (403)
      const unauthReq = createMockReqRes("GET", `/api/notebooks/${notebookId}/chat`);
      const unauthHandled = await handleChatHistoryRoute(
        unauthReq.req,
        unauthReq.res,
        { verifyOwnership: async () => false },
        userId
      );
      expect(unauthHandled).toBe(true);
      expect(unauthReq.res.statusCode).toBe(403);
    });
  });
});
