import { describe, it, expect, vi } from "vitest";
import {
  GroundedChatAgent,
  type GroundedTurnInput,
  type ModelCompletionAdapter,
} from "../src/chat/agent.js";
import { filterEligibleHistory } from "../src/chat/context.js";
import type { UnifiedDocumentChunk, ChatMessage } from "@everlast/contracts";

describe("FR-GC-01: Grounded Chat Agent Acceptance Tests (US1)", () => {
  const source1Id = "11111111-1111-4111-8111-111111111111";
  const source2Id = "22222222-2222-4222-8222-222222222222";
  const sourceAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sourceBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const threadId = "88888888-8888-4888-8888-888888888888";
  const userId = "usr_alice_123";

  it("Scenario: Negative rejection of pre-trained world knowledge", async () => {
    // Given a notebook with 1 active source containing only an internal Python style guide
    const chunks: UnifiedDocumentChunk[] = [
      {
        chunk_id: "018f6b40-0001-7000-8000-000000000001",
        source_id: source1Id,
        revision: 1,
        locator: { page_number: 1, start_offset: 0, end_offset: 150 },
        token_count: 50,
        text: "Everlast Python Style Guide: Follow PEP 8 with 100 character line limit. Use type hints for all public functions.",
      },
    ];

    const mockModel: ModelCompletionAdapter = {
      complete: vi.fn().mockResolvedValue({
        grounded: false,
        refusal: true,
        answer: "The provided sources do not contain information about the FIFA World Cup.",
        missingContextTopic: "FIFA World Cup in 2022",
      }),
    };

    const agent = new GroundedChatAgent({ modelAdapter: mockModel });

    // When the user asks "Who won the FIFA World Cup in 2022?"
    const result = await agent.generateTurn({
      notebookId,
      threadId,
      userId,
      message: "Who won the FIFA World Cup in 2022?",
      activeSourceIds: [source1Id],
      chunks,
      history: [],
    });

    // Then the assistant refuses to answer the factual question
    expect(result.refusal).toBe(true);
    expect(result.grounded).toBe(false);
    // And explicitly states that the provided sources do not contain information about the FIFA World Cup
    expect(result.content).toMatch(/sources do not contain information about (the )?FIFA World Cup/i);
    // Verifies no world knowledge fallback
    expect(result.content).not.toMatch(/Argentina/i);
  });

  it("Scenario: Grounded synthesis across multiple active sources", async () => {
    // Given Source 1 states "Server Alpha runs on port 8080"
    // And Source 2 states "Port 8080 requires mTLS client certificates"
    // And both Source 1 and Source 2 are selected
    const chunks: UnifiedDocumentChunk[] = [
      {
        chunk_id: "018f6b40-0001-7000-8000-000000000001",
        source_id: source1Id,
        revision: 1,
        locator: { page_number: 1, start_offset: 0, end_offset: 100 },
        token_count: 30,
        text: "Infrastructure specification: Server Alpha runs on port 8080.",
      },
      {
        chunk_id: "018f6b40-0002-7000-8000-000000000002",
        source_id: source2Id,
        revision: 1,
        locator: { page_number: 2, start_offset: 50, end_offset: 160 },
        token_count: 35,
        text: "Network Security Policy: Port 8080 requires mTLS client certificates for all incoming traffic.",
      },
    ];

    const mockModel: ModelCompletionAdapter = {
      complete: vi.fn().mockResolvedValue({
        grounded: true,
        refusal: false,
        answer: "Server Alpha runs on port 8080 and requires mTLS client certificates.",
        citedChunkIds: [
          "018f6b40-0001-7000-8000-000000000001",
          "018f6b40-0002-7000-8000-000000000002",
        ],
      }),
    };

    const agent = new GroundedChatAgent({ modelAdapter: mockModel });

    // When the user asks "What security requirement applies to Server Alpha?"
    const result = await agent.generateTurn({
      notebookId,
      threadId,
      userId,
      message: "What security requirement applies to Server Alpha?",
      activeSourceIds: [source1Id, source2Id],
      chunks,
      history: [],
    });

    // Then the assistant answers that Server Alpha runs on port 8080 and requires mTLS client certificates
    expect(result.grounded).toBe(true);
    expect(result.refusal).toBe(false);
    expect(result.content).toMatch(/Server Alpha runs on port 8080/i);
    expect(result.content).toMatch(/requires mTLS client certificates/i);

    // And cites both Source 1 and Source 2
    expect(result.citedSourceIds).toContain(source1Id);
    expect(result.citedSourceIds).toContain(source2Id);
    expect(result.activeSourceRevisionsSnapshot).toEqual([
      { source_id: source1Id, revision: 1 },
      { source_id: source2Id, revision: 1 },
    ]);
  });

  it("Scenario: Uncited historical context cannot bypass deselection", () => {
    // Given a previous turn used Sources A and B but cited only A
    const previousTurn: ChatMessage = {
      id: "33333333-3333-4333-8333-333333333333",
      thread_id: threadId,
      notebook_id: notebookId,
      user_id: userId,
      role: "assistant",
      content: "Summary of architecture based on active documentation.",
      active_source_revisions_snapshot: [
        { source_id: sourceAId, revision: 1 },
        { source_id: sourceBId, revision: 1 },
      ],
      citations: [
        {
          badge_number: 1,
          source_id: sourceAId,
          source_title: "Doc A",
          chunk_id: "018f6b40-0001-7000-8000-000000000001",
          snippet: "Doc A excerpt",
          locator: { page_number: 1, start_offset: 0, end_offset: 50 },
        },
      ],
      created_at: "2026-10-18T12:00:00.000Z",
    };

    const history: ChatMessage[] = [previousTurn];

    // When B is deselected before the next question (only Source A remains active)
    const activeSourceIds = [sourceAId];
    const activeSourceRevisions = new Map([[sourceAId, 1]]);

    const eligibleHistory = filterEligibleHistory(
      history,
      activeSourceIds,
      activeSourceRevisions
    );

    // Then that turn and its context are excluded from the new prompt
    expect(eligibleHistory).toHaveLength(0);
  });

  it("Partial evidence answering: answers supported part and explicitly states unsupported aspect", async () => {
    const chunks: UnifiedDocumentChunk[] = [
      {
        chunk_id: "018f6b40-0001-7000-8000-000000000001",
        source_id: source1Id,
        revision: 1,
        locator: { page_number: 1, start_offset: 0, end_offset: 100 },
        token_count: 30,
        text: "The frontend stack is built with TypeScript and Vite SPA.",
      },
    ];

    const mockModel: ModelCompletionAdapter = {
      complete: vi.fn().mockResolvedValue({
        grounded: true,
        refusal: false,
        answer: "The frontend is built with TypeScript and Vite SPA. However, the selected sources do not contain information regarding the database engine.",
        citedChunkIds: ["018f6b40-0001-7000-8000-000000000001"],
        unsupportedAspect: "database engine",
      }),
    };

    const agent = new GroundedChatAgent({ modelAdapter: mockModel });

    const result = await agent.generateTurn({
      notebookId,
      threadId,
      userId,
      message: "What frontend framework and what database engine are used?",
      activeSourceIds: [source1Id],
      chunks,
      history: [],
    });

    expect(result.grounded).toBe(true);
    expect(result.content).toMatch(/TypeScript and Vite SPA/i);
    expect(result.content).toMatch(/sources do not contain information regarding the database engine/i);
  });
});
