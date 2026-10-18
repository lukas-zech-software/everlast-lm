import { describe, it, expect } from "vitest";
import { verifyAndIndexCitations } from "../src/chat/citations.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";

describe("FR-GC-02: Precise Inline Citations Boundary & Error Tests (US2)", () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const otherSourceId = "22222222-2222-4222-8222-222222222222";

  // Create 8 distinct active chunks for multi-citation boundary testing
  const activeChunks: UnifiedDocumentChunk[] = Array.from({ length: 8 }, (_, i) => ({
    chunk_id: `018f6b40-000${i + 1}-7000-8000-00000000000${i + 1}`,
    source_id: sourceId,
    revision: 1,
    locator: { page_number: i + 1, start_offset: 0, end_offset: 100 },
    token_count: 50,
    text: `Verified piece of evidence ${i + 1}`,
  }));

  const sourceTitles = new Map<string, string>([[sourceId, "Architecture_Design.pdf"]]);

  it("Edge case 1: Conversational meta-responses are exempt from citation badges", async () => {
    const metaResponse = "The selected sources do not contain information on this topic.";

    const result = await verifyAndIndexCitations(metaResponse, activeChunks, {
      sourceTitles,
      allowUncitedMeta: true,
    });

    expect(result.valid).toBe(true);
    expect(result.refusal).toBe(true);
    expect(result.processedContent).toBe(metaResponse);
    expect(result.citations).toHaveLength(0);
    expect(result.distinctChunkCount).toBe(0);
  });

  it("Edge case 2: Single statement supported by 8 distinct chunks indexes 1..8", async () => {
    // Single sentence supported by 8 different chunks
    const citeTags = activeChunks.map((c) => `<cite id="${c.chunk_id}"/>`).join("");
    const draftText = `Distributed consensus protocol guarantees linearizability across all nodes ${citeTags}.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    expect(result.valid).toBe(true);
    expect(result.refusal).toBe(false);
    expect(result.processedContent).toBe(
      "Distributed consensus protocol guarantees linearizability across all nodes [1][2][3][4][5][6][7][8]."
    );
    expect(result.citations).toHaveLength(8);
    expect(result.distinctChunkCount).toBe(8);
    expect(result.citations.map((c) => c.badge_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("Boundary 3: Rejects malformed citation tags with immediate refusal", async () => {
    const malformedCases = [
      'Statement with empty cite id <cite id=""/>.',
      'Statement with non-uuid cite id <cite id="not-a-valid-uuid"/>.',
      "Statement with empty cite tag <cite>.",
      'Statement with unclosed cite tag <cite id="018f6b40-0001-7000-8000-000000000001"',
    ];

    for (const draft of malformedCases) {
      const result = await verifyAndIndexCitations(draft, activeChunks, { sourceTitles });
      expect(result.valid).toBe(false);
      expect(result.refusal).toBe(true);
      expect(result.processedContent).toMatch(/sources do not contain sufficient evidence|refusal/i);
      expect(result.citations).toHaveLength(0);
    }
  });

  it("Boundary 4: Rejects chunk ID from outside active scope (even if valid UUID)", async () => {
    // Valid UUID v7, but belongs to another unselected source / notebook
    const outsideScopeChunkId = "018f6b40-9999-7000-8000-000000009999";
    const draftText = `Factual statement with outside chunk <cite id="${outsideScopeChunkId}"/>.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    expect(result.valid).toBe(false);
    expect(result.refusal).toBe(true);
    expect(result.processedContent).toMatch(/sources do not contain sufficient evidence/i);
    expect(result.processedContent).not.toMatch(/Factual statement with outside chunk/);
    expect(result.citations).toHaveLength(0);
  });

  it("Boundary 5: Mixed claims with one invalid citation triggers immediate refusal of the entire draft (D13)", async () => {
    // Claim 1 is valid, Claim 2 has non-existent chunk
    const invalidChunkId = "018f6b40-0099-7000-8000-000000000099";
    const draftText = `Claim 1 is valid <cite id="${activeChunks[0]!.chunk_id}"/>.\nClaim 2 has fabricated citation <cite id="${invalidChunkId}"/>.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    // D13: Entire draft must be withheld; no stripped citations; no partial rendering
    expect(result.valid).toBe(false);
    expect(result.refusal).toBe(true);
    expect(result.processedContent).toMatch(/sources do not contain sufficient evidence/i);
    expect(result.processedContent).not.toMatch(/Claim 1 is valid/);
    expect(result.processedContent).not.toMatch(/Claim 2/);
    expect(result.citations).toHaveLength(0);
  });

  it("Boundary 6: Factual response without citations triggers refusal (FR-GC-02)", async () => {
    // Uncited factual assertion when not exempt
    const draftText = "The total quarterly revenue was $50M.";

    const result = await verifyAndIndexCitations(draftText, activeChunks, {
      sourceTitles,
      allowUncitedMeta: false,
    });

    expect(result.valid).toBe(false);
    expect(result.refusal).toBe(true);
    expect(result.citations).toHaveLength(0);
  });

  it("Boundary 7: Normalizes tag syntax variations (closing tag, single quotes, whitespace)", async () => {
    const draftText = `Syntax A <cite   id="${activeChunks[0]!.chunk_id}"   />. Syntax B <cite id='${activeChunks[1]!.chunk_id}'></cite>. Syntax C <cite id="${activeChunks[2]!.chunk_id}">.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    expect(result.valid).toBe(true);
    expect(result.refusal).toBe(false);
    expect(result.processedContent).toBe("Syntax A [1]. Syntax B [2]. Syntax C [3].");
    expect(result.citations).toHaveLength(3);
  });

  it("Boundary 8: Repeated chunk citations across multiple sentences reuse badge numbers", async () => {
    const draftText = `Sentence 1 <cite id="${activeChunks[0]!.chunk_id}"/>. Sentence 2 <cite id="${activeChunks[1]!.chunk_id}"/>. Sentence 3 repeating first chunk <cite id="${activeChunks[0]!.chunk_id}"/>. Sentence 4 repeating second chunk <cite id="${activeChunks[1]!.chunk_id}"/>. Sentence 5 with new chunk <cite id="${activeChunks[2]!.chunk_id}"/>.`;

    const result = await verifyAndIndexCitations(draftText, activeChunks, { sourceTitles });

    expect(result.valid).toBe(true);
    expect(result.processedContent).toBe(
      "Sentence 1 [1]. Sentence 2 [2]. Sentence 3 repeating first chunk [1]. Sentence 4 repeating second chunk [2]. Sentence 5 with new chunk [3]."
    );
    expect(result.distinctChunkCount).toBe(3);
    expect(result.citations).toHaveLength(3);
    expect(result.citations.map((c) => c.badge_number)).toEqual([1, 2, 3]);
  });
});
