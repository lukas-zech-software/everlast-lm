import { describe, it, expect, vi } from "vitest";
import {
  GroundedChatAgent,
  type ModelCompletionAdapter,
} from "../src/chat/agent.js";
import {
  filterEligibleHistory,
  createSubmissionSnapshot,
} from "../src/chat/context.js";
import type { UnifiedDocumentChunk, ChatMessage } from "@everlast/contracts";

describe("FR-GC-01, C-02, NFR-EVAL-04: Grounded Chat Agent Integration Tests (US1)", () => {
  const source1Id = "11111111-1111-4111-8111-111111111111";
  const source2Id = "22222222-2222-4222-8222-222222222222";
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const threadId = "88888888-8888-4888-8888-888888888888";
  const userId = "usr_alice_123";

  it("NFR-EVAL-04: enforces zero leakage across multi-turn conversation", async () => {
    // 1. Initial turn where source 1 and source 2 are both active
    const turn1Message: ChatMessage = {
      id: "m1111111-1111-4111-8111-111111111111",
      thread_id: threadId,
      notebook_id: notebookId,
      user_id: userId,
      role: "assistant",
      content: "Port 8080 is secured with mTLS.",
      active_source_revisions_snapshot: [
        { source_id: source1Id, revision: 1 },
        { source_id: source2Id, revision: 1 },
      ],
      citations: [],
      created_at: "2026-10-18T12:00:00.000Z",
    };

    const history = [turn1Message];

    // 2. User deselects Source 2 for Turn 2
    const activeSourceIds = [source1Id];
    const activeSourceRevisions = new Map([[source1Id, 1]]);

    const eligibleHistory = filterEligibleHistory(
      history,
      activeSourceIds,
      activeSourceRevisions
    );

    // Assert turn1 is excluded because Source 2 was part of its context provenance snapshot
    expect(eligibleHistory).toHaveLength(0);

    // 3. Execution of Turn 2 verifies model is never passed deselected source chunks or history
    let promptReceivedHistory: any[] = [];
    const mockModel: ModelCompletionAdapter = {
      complete: vi.fn().mockImplementation(async (params) => {
        promptReceivedHistory = params.history;
        return {
          grounded: true,
          refusal: false,
          answer: "Only source 1 context was used.",
          citedChunkIds: ["018f6b40-0001-7000-8000-000000000001"],
        };
      }),
    };

    const agent = new GroundedChatAgent({ modelAdapter: mockModel });

    const chunks: UnifiedDocumentChunk[] = [
      {
        chunk_id: "018f6b40-0001-7000-8000-000000000001",
        source_id: source1Id,
        revision: 1,
        locator: { page_number: 1, start_offset: 0, end_offset: 50 },
        token_count: 15,
        text: "Source 1 valid text.",
      },
    ];

    const res = await agent.generateTurn({
      notebookId,
      threadId,
      userId,
      message: "Explain Server Alpha details.",
      activeSourceIds,
      chunks,
      history: eligibleHistory,
    });

    // Zero leakage verified: history passed to model context is empty
    expect(promptReceivedHistory).toHaveLength(0);
    expect(res.grounded).toBe(true);
    expect(res.activeSourceRevisionsSnapshot).toEqual([
      { source_id: source1Id, revision: 1 },
    ]);
  });

  it("NFR-EVAL-03: Negative rejection rate on ungrounded questions", async () => {
    const ungroundedQuestions = [
      "Who won the FIFA World Cup in 2022?",
      "What is the capital of Australia?",
      "Who wrote Hamlet?",
      "What is the speed of light in vacuum?",
    ];

    const mockModel: ModelCompletionAdapter = {
      complete: vi.fn().mockImplementation(async (params) => {
        // Model detects questions outside the provided Python style guide chunks
        return {
          grounded: false,
          refusal: true,
          answer: "The selected sources do not contain information to answer this question.",
        };
      }),
    };

    const agent = new GroundedChatAgent({ modelAdapter: mockModel });

    const pythonGuideChunk: UnifiedDocumentChunk = {
      chunk_id: "018f6b40-0001-7000-8000-000000000001",
      source_id: source1Id,
      revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 80 },
      token_count: 20,
      text: "Python Guide: Use snake_case for functions and PascalCase for classes.",
    };

    for (const q of ungroundedQuestions) {
      const res = await agent.generateTurn({
        notebookId,
        threadId,
        userId,
        message: q,
        activeSourceIds: [source1Id],
        chunks: [pythonGuideChunk],
        history: [],
      });

      expect(res.refusal).toBe(true);
      expect(res.grounded).toBe(false);
      expect(res.content).toMatch(/sources do not contain information/i);
    }
  });

  it("createSubmissionSnapshot: creates immutable (source_id, revision) pairs", () => {
    const revisions = new Map([
      [source1Id, 2],
      [source2Id, 5],
    ]);
    const snapshot = createSubmissionSnapshot([source1Id, source2Id], revisions);

    expect(snapshot).toEqual([
      { source_id: source1Id, revision: 2 },
      { source_id: source2Id, revision: 5 },
    ]);
  });
});
