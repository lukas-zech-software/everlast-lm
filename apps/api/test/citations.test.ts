import { describe, it, expect } from "vitest";
import { verifyAndIndexCitations } from "../src/chat/citations.js";
import { CitationSchema, type UnifiedDocumentChunk } from "@everlast/contracts";

describe("FR-GC-02: Precise Inline Citations Acceptance Tests (US2)", () => {
  const source1Id = "11111111-1111-4111-8111-111111111111";
  const source2Id = "22222222-2222-4222-8222-222222222222";
  const source3Id = "33333333-3333-4333-8333-333333333333";

  const chunk1Id = "018f6b40-0001-7000-8000-000000000001";
  const chunk2Id = "018f6b40-0002-7000-8000-000000000002";
  const chunk3Id = "018f6b40-0003-7000-8000-000000000003";

  const activeChunks: UnifiedDocumentChunk[] = [
    {
      chunk_id: chunk1Id,
      source_id: source1Id,
      revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 100 },
      token_count: 30,
      text: "Q1 revenue reached $10M with strong Enterprise expansion.",
    },
    {
      chunk_id: chunk2Id,
      source_id: source2Id,
      revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 110 },
      token_count: 35,
      text: "Q2 revenue accelerated to $12M due to new product line launch.",
    },
    {
      chunk_id: chunk3Id,
      source_id: source3Id,
      revision: 1,
      locator: { page_number: 1, start_offset: 0, end_offset: 105 },
      token_count: 32,
      text: "Q3 revenue culminated at $15M marking record quarterly performance.",
    },
  ];

  const sourceTitles = new Map<string, string>([
    [source1Id, "Q1_Report.pdf"],
    [source2Id, "Q2_Report.pdf"],
    [source3Id, "Q3_Report.pdf"],
  ]);

  it("Scenario: Every factual sentence includes a valid citation badge", async () => {
    // Given active sources describing 3 quarterly revenue figures
    // When the user asks "Summarize the quarterly revenue figures"
    const draftText = `In Q1, revenue was $10M <cite id="${chunk1Id}"/>.\nIn Q2, revenue increased to $12M <cite id="${chunk2Id}"/>.\nIn Q3, revenue reached $15M <cite id="${chunk3Id}"/>.`;

    let nliCheckedCount = 0;
    const nliVerifier = (statement: string, chunk: UnifiedDocumentChunk) => {
      nliCheckedCount++;
      return statement.includes("$10M") || statement.includes("$12M") || statement.includes("$15M");
    };

    const result = await verifyAndIndexCitations(draftText, activeChunks, {
      sourceTitles,
      nliVerifier,
    });

    // Then each revenue figure in the answer is followed by an inline citation badge [1], [2], [3]
    expect(result.valid).toBe(true);
    expect(result.refusal).toBe(false);
    expect(result.processedContent).toBe(
      "In Q1, revenue was $10M [1].\nIn Q2, revenue increased to $12M [2].\nIn Q3, revenue reached $15M [3]."
    );

    // And every badge maps to an existing chunk_id in the active sources
    expect(result.citations).toHaveLength(3);
    expect(result.distinctChunkCount).toBe(3);

    expect(result.citations[0]).toMatchObject({
      badge_number: 1,
      source_id: source1Id,
      source_title: "Q1_Report.pdf",
      chunk_id: chunk1Id,
      snippet: activeChunks[0]!.text,
      locator: activeChunks[0]!.locator,
    });

    expect(result.citations[1]).toMatchObject({
      badge_number: 2,
      source_id: source2Id,
      source_title: "Q2_Report.pdf",
      chunk_id: chunk2Id,
      snippet: activeChunks[1]!.text,
      locator: activeChunks[1]!.locator,
    });

    expect(result.citations[2]).toMatchObject({
      badge_number: 3,
      source_id: source3Id,
      source_title: "Q3_Report.pdf",
      chunk_id: chunk3Id,
      snippet: activeChunks[2]!.text,
      locator: activeChunks[2]!.locator,
    });

    // And NLI verification confirms the cited chunk semantically supports the sentence
    expect(nliCheckedCount).toBe(3);

    // Verify structured citation contracts compliance
    for (const citation of result.citations) {
      expect(() => CitationSchema.parse(citation)).not.toThrow();
    }
  });

  it("Scenario: Invalid chunk ID immediately produces a refusal", async () => {
    // Given an internal LLM draft output containing a reference to non-existent chunk "chk_99999"
    const nonexistentChunkId = "018f6b40-0099-7000-8000-000000000099";
    const draftWithInvalidChunk = `In Q1, revenue was $10M <cite id="${nonexistentChunkId}"/>.`;

    // When the citation verification pipeline processes the response
    const result = await verifyAndIndexCitations(draftWithInvalidChunk, activeChunks, {
      sourceTitles,
    });

    // Then the draft is not rendered
    expect(result.valid).toBe(false);
    expect(result.refusal).toBe(true);

    // And the refusal response is rendered instead of the answer without regeneration
    expect(result.processedContent).toMatch(
      /sources do not contain sufficient evidence|do not contain information/i
    );
    expect(result.processedContent).not.toMatch(/\$10M/);

    // And no citation badge is rendered
    expect(result.citations).toHaveLength(0);
    expect(result.distinctChunkCount).toBe(0);
  });

  it("EARS: sequential re-indexing 1..K in order of first appearance and repeated chunk reuse", async () => {
    // Draft references chunk1, then chunk2, then chunk1 again, then chunk3
    const draftText = `Statement A <cite id="${chunk1Id}"/>. Statement B <cite id="${chunk2Id}"/>. Statement C re-referencing chunk 1 <cite id="${chunk1Id}"/>. Statement D <cite id="${chunk3Id}"/>.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    expect(result.valid).toBe(true);
    // Chunk 1 is badge [1], chunk 2 is [2], chunk 1 repeated is [1], chunk 3 is [3]
    expect(result.processedContent).toBe(
      "Statement A [1]. Statement B [2]. Statement C re-referencing chunk 1 [1]. Statement D [3]."
    );

    // Distinct chunk count is K = 3
    expect(result.distinctChunkCount).toBe(3);
    expect(result.citations).toHaveLength(3);
    expect(result.citations.map((c) => c.badge_number)).toEqual([1, 2, 3]);
    expect(result.citations.map((c) => c.chunk_id)).toEqual([chunk1Id, chunk2Id, chunk3Id]);
  });
});
