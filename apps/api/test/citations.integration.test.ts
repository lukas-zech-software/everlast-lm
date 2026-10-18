import { describe, it, expect, vi } from "vitest";
import { verifyAndIndexCitations } from "../src/chat/citations.js";
import { publishTurn } from "../src/chat/publication.js";
import { BufferedTurnTransport } from "../src/chat/transport.js";
import type { UnifiedDocumentChunk, Citation } from "@everlast/contracts";

describe("FR-GC-02, C-02, NFR-EVAL-02, D13: Citations Integration & Publication Gate (US2)", () => {
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const userId = "usr_alice_123";
  const threadId = "88888888-8888-4888-8888-888888888888";
  const source1Id = "11111111-1111-4111-8111-111111111111";
  const source2Id = "22222222-2222-4222-8222-222222222222";

  const activeChunks: UnifiedDocumentChunk[] = [
    {
      chunk_id: "018f6b40-0001-7000-8000-000000000001",
      source_id: source1Id,
      revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 150 },
      token_count: 50,
      text: "Port 8080 requires mTLS client certificates for all inbound connections.",
    },
    {
      chunk_id: "018f6b40-0002-7000-8000-000000000002",
      source_id: source2Id,
      revision: 1,
      locator: { page_number: 2, start_offset: 0, end_offset: 140 },
      token_count: 45,
      text: "Server Alpha runs on port 8080 with TLS 1.3 encryption enabled.",
    },
  ];

  const sourceTitles = new Map<string, string>([
    [source1Id, "Security_Architecture.pdf"],
    [source2Id, "Deployment_Guide.pdf"],
  ]);

  it("NFR-EVAL-02: Precision_ID = 1.00 on verified citations", async () => {
    // Generate drafts across multiple scenarios
    const draftText = `Server Alpha runs on port 8080 <cite id="${activeChunks[1]!.chunk_id}"/>. Inbound connections require mTLS client certificates <cite id="${activeChunks[0]!.chunk_id}"/>.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    expect(result.valid).toBe(true);

    // Compute Citation ID Precision:
    // Precision_ID = (number of cited chunk_ids existing in activeChunks) / (total citations)
    const activeChunkIds = new Set(activeChunks.map((c) => c.chunk_id));
    const totalBadges = result.citations.length;
    expect(totalBadges).toBeGreaterThan(0);

    const validBadges = result.citations.filter((c: Citation) =>
      activeChunkIds.has(c.chunk_id)
    ).length;

    const precisionId = validBadges / totalBadges;
    expect(precisionId).toBe(1.0); // Exact 1.00 requirement per NFR-EVAL-02
  });

  it("NFR-EVAL-02: NLI semantic support verification rejects unsupported claims", async () => {
    // Draft cites chunk 1, but claim is semantically unsupported (hallucinated port 9090)
    const draftText = `Server Alpha runs on port 9090 <cite id="${activeChunks[0]!.chunk_id}"/>.`;

    const nliVerifier = vi.fn().mockImplementation((statement: string, chunk: UnifiedDocumentChunk) => {
      // Chunk specifies port 8080; statement says port 9090 -> contradiction/not entailed
      return !statement.includes("port 9090");
    });

    const result = await verifyAndIndexCitations(draftText, activeChunks, {
      sourceTitles,
      nliVerifier,
    });

    expect(nliVerifier).toHaveBeenCalled();
    expect(result.valid).toBe(false);
    expect(result.refusal).toBe(true);
    expect(result.citations).toHaveLength(0);
  });

  it("D13, CP5: Publication gate buffers draft and persists only verified answers", async () => {
    let persistedTurn: any = null;
    const mockPersist = vi.fn().mockImplementation(async (turn) => {
      persistedTurn = turn;
      return { id: "asst-msg-123" };
    });

    // 1. Valid draft publication
    const validDraft = `Server Alpha requires mTLS <cite id="${activeChunks[0]!.chunk_id}"/>.`;
    const publishResult = await publishTurn({
      notebookId,
      userId,
      threadId,
      expectedEpoch: 1,
      draftText: validDraft,
      activeChunks,
      activeSourceIds: [source1Id, source2Id],
      sourceTitles,
      getThreadEpoch: async () => 1,
      checkAuthorization: async () => true,
      persistMessage: mockPersist,
    });

    expect(publishResult.success).toBe(true);
    expect(publishResult.refusal).toBe(false);
    expect(publishResult.content).toBe("Server Alpha requires mTLS [1].");
    expect(publishResult.citations).toHaveLength(1);
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(persistedTurn.content).toBe("Server Alpha requires mTLS [1].");

    // 2. Invalid draft publication (D13)
    mockPersist.mockClear();
    const invalidDraft = `Server Alpha has fake chunk <cite id="018f6b40-0099-7000-8000-000000000099"/>.`;
    const invalidPublishResult = await publishTurn({
      notebookId,
      userId,
      threadId,
      expectedEpoch: 1,
      draftText: invalidDraft,
      activeChunks,
      activeSourceIds: [source1Id, source2Id],
      sourceTitles,
      getThreadEpoch: async () => 1,
      checkAuthorization: async () => true,
      persistMessage: mockPersist,
    });

    expect(invalidPublishResult.success).toBe(true);
    expect(invalidPublishResult.refusal).toBe(true);
    // Draft factual content is withheld; refusal response is persisted instead
    expect(invalidPublishResult.content).toMatch(/sources do not contain sufficient evidence/i);
    expect(invalidPublishResult.content).not.toMatch(/fake chunk/);
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(persistedTurn.content).toMatch(/sources do not contain sufficient evidence/i);
    expect(persistedTurn.citations).toEqual([]);
  });

  it("CP2, FR-GC-06: Thread epoch invalidation rejects late response after Clear Chat", async () => {
    const mockPersist = vi.fn();
    const validDraft = `Valid statement <cite id="${activeChunks[0]!.chunk_id}"/>.`;

    // Thread epoch advanced from 1 to 2 because user clicked "Clear chat"
    const result = await publishTurn({
      notebookId,
      userId,
      threadId,
      expectedEpoch: 1, // request was started at epoch 1
      draftText: validDraft,
      activeChunks,
      activeSourceIds: [source1Id, source2Id],
      sourceTitles,
      getThreadEpoch: async () => 2, // current DB epoch is 2
      checkAuthorization: async () => true,
      persistMessage: mockPersist,
    });

    expect(result.success).toBe(false);
    expect(result.rejectedDueToEpoch).toBe(true);
    // Crucial: Late response cannot resurrect or write to the cleared thread
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("Status-only streaming: Draft factual tokens are buffered and never emitted over transport before verification", () => {
    const transport = new BufferedTurnTransport();

    // 1. Progress events emitted during retrieval and synthesis
    transport.sendProgress("retrieving", "Retrieving chunks...");
    transport.sendProgress("synthesizing", "Synthesizing answer...");

    // 2. Draft tokens are buffered internally
    transport.bufferDraftToken("Server ");
    transport.bufferDraftToken("Alpha ");
    transport.bufferDraftToken("port ");
    transport.bufferDraftToken("8080.");

    // Verify events so far contain NO draft factual text
    const intermediateEvents = transport.getEmittedEvents();
    expect(intermediateEvents).toHaveLength(2);
    expect(intermediateEvents.every((e) => e.type !== "content")).toBe(true);

    // 3. Only after verification passes, published answer is emitted
    transport.publishFinalAnswer({
      success: true,
      refusal: false,
      content: "Server Alpha port 8080. [1]",
      citations: [
        {
          badge_number: 1,
          source_id: source1Id,
          source_title: "Security.pdf",
          chunk_id: activeChunks[0]!.chunk_id,
          snippet: "Port 8080 text",
          locator: { page_number: 1, start_offset: 0, end_offset: 50 },
        },
      ],
      generationEpoch: 1,
    });

    const finalEvents = transport.getEmittedEvents();
    expect(finalEvents).toHaveLength(3);
    const lastEvent = finalEvents[2]!;
    expect(lastEvent.type).toBe("completed");
    if (lastEvent.type === "completed") {
      expect(lastEvent.data.content).toBe("Server Alpha port 8080. [1]");
      expect(lastEvent.data.citations).toHaveLength(1);
    }
  });
});
