import {
  type Citation,
  type UnifiedDocumentChunk,
  CitationSchema,
} from "@everlast/contracts";

export interface CitationVerificationSuccess {
  valid: true;
  refusal: boolean;
  reason?: string | undefined;
  processedContent: string;
  citations: Citation[];
  distinctChunkCount: number;
}

export interface CitationVerificationRefusal {
  valid: false;
  refusal: true;
  reason: string;
  processedContent: string;
  citations: Citation[];
  distinctChunkCount: 0;
}

export type CitationVerificationResult =
  | CitationVerificationSuccess
  | CitationVerificationRefusal;

export interface CitationVerifyOptions {
  allowUncitedMeta?: boolean | undefined;
  nliVerifier?: ((statement: string, chunk: UnifiedDocumentChunk) => Promise<boolean> | boolean) | undefined;
  sourceTitles?: Map<string, string> | undefined;
}

export const DEFAULT_REFUSAL_MESSAGE =
  "The selected sources do not contain sufficient evidence to answer this question.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Regular expression to match valid <cite id="UUID"/> or <cite id="UUID"></cite> or <cite id="UUID"> tags
const VALID_CITE_REGEX = /<cite\s+id=["']([^"']+)["']\s*(?:\/>|>(?:<\/cite>)?)/gi;

/**
 * Validates, re-indexes, and formats citations in an LLM draft response.
 * Follows FR-GC-02, D13, CP5:
 * - Deterministic resolution against S_aktiv (Precision_ID = 1.0).
 * - Immediate refusal on invalid chunk IDs or malformed tags without regeneration or citation stripping.
 * - Re-indexes displayed badge numbers sequentially 1..K in order of first appearance.
 * - Reuses existing badge numbers for repeated chunks.
 * - Maps to strict CitationSchema metadata objects.
 */
export async function verifyAndIndexCitations(
  draftText: string,
  activeChunks: UnifiedDocumentChunk[],
  options?: CitationVerifyOptions
): Promise<CitationVerificationResult> {
  const allowUncitedMeta = options?.allowUncitedMeta ?? true;
  const sourceTitles = options?.sourceTitles;
  const nliVerifier = options?.nliVerifier;

  // 1. Check for conversational meta-responses / refusal exemption
  const isMetaResponse =
    /selected sources do not contain|cannot answer this question|do not have information|I am sorry/i.test(
      draftText
    );

  const hasCiteTags = /<\s*cite\b/i.test(draftText);

  if (!hasCiteTags) {
    if (isMetaResponse || allowUncitedMeta === false && isMetaResponse) {
      return {
        valid: true,
        refusal: true,
        reason: "Conversational meta-response",
        processedContent: draftText,
        citations: [],
        distinctChunkCount: 0,
      };
    }

    // Factual statement without any citations is invalid per FR-GC-02
    return {
      valid: false,
      refusal: true,
      reason: "Factual claim contains no citations",
      processedContent: DEFAULT_REFUSAL_MESSAGE,
      citations: [],
      distinctChunkCount: 0,
    };
  }

  // 2. Validate citation tag syntax: check for malformed tags
  // Count total occurrences of <cite
  const rawCiteMatches = draftText.match(/<\s*cite\b/gi) || [];
  // Find all valid matches
  const validMatches: { fullMatch: string; chunkId: string; index: number }[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(VALID_CITE_REGEX.source, "gi");

  while ((match = regex.exec(draftText)) !== null) {
    const rawId = match[1]?.trim() || "";
    // If id is empty or does not conform to UUID format
    if (!UUID_PATTERN.test(rawId)) {
      return {
        valid: false,
        refusal: true,
        reason: `Malformed citation tag: invalid UUID '${rawId}'`,
        processedContent: DEFAULT_REFUSAL_MESSAGE,
        citations: [],
        distinctChunkCount: 0,
      };
    }
    validMatches.push({
      fullMatch: match[0],
      chunkId: rawId,
      index: match.index,
    });
  }

  // If there are raw <cite tags that did not match the valid tag structure,
  // it means there was an unclosed or malformed tag (e.g. <cite> or <cite id="...")
  if (rawCiteMatches.length !== validMatches.length) {
    return {
      valid: false,
      refusal: true,
      reason: "Malformed citation tag: unclosed or missing attributes",
      processedContent: DEFAULT_REFUSAL_MESSAGE,
      citations: [],
      distinctChunkCount: 0,
    };
  }

  // 3. Resolve chunk IDs against activeChunks (S_aktiv)
  const activeChunkMap = new Map<string, UnifiedDocumentChunk>();
  for (const chunk of activeChunks) {
    activeChunkMap.set(chunk.chunk_id, chunk);
  }

  for (const item of validMatches) {
    if (!activeChunkMap.has(item.chunkId)) {
      // Chunk not found in active context -> D13 immediate refusal
      return {
        valid: false,
        refusal: true,
        reason: `Citation references invalid chunk_id '${item.chunkId}' outside active context`,
        processedContent: DEFAULT_REFUSAL_MESSAGE,
        citations: [],
        distinctChunkCount: 0,
      };
    }
  }

  // 4. Optional NLI semantic entailment verification (NFR-EVAL-02)
  if (nliVerifier) {
    // Extract statement surrounding each citation tag
    // Sentence segmentation by period, newline, or punctuation
    for (const item of validMatches) {
      const chunk = activeChunkMap.get(item.chunkId)!;
      // Get the sentence/line containing this citation
      const beforeText = draftText.slice(0, item.index);
      const afterText = draftText.slice(item.index + item.fullMatch.length);
      const sentenceStart = Math.max(0, beforeText.lastIndexOf(".") + 1, beforeText.lastIndexOf("\n") + 1);
      const sentenceEndRel = afterText.search(/[.\n]/);
      const sentenceEnd = sentenceEndRel === -1 ? draftText.length : item.index + item.fullMatch.length + sentenceEndRel;
      const statement = draftText.slice(sentenceStart, sentenceEnd).replace(VALID_CITE_REGEX, "").trim();

      const isSupported = await nliVerifier(statement, chunk);
      if (!isSupported) {
        return {
          valid: false,
          refusal: true,
          reason: `Semantic support check failed for chunk '${item.chunkId}'`,
          processedContent: DEFAULT_REFUSAL_MESSAGE,
          citations: [],
          distinctChunkCount: 0,
        };
      }
    }
  }

  // 5. Sequential badge re-indexing 1..K in order of first appearance
  const chunkIdToBadgeNumber = new Map<string, number>();
  const citations: Citation[] = [];
  let nextBadgeNumber = 1;

  for (const item of validMatches) {
    if (!chunkIdToBadgeNumber.has(item.chunkId)) {
      const badgeNumber = nextBadgeNumber++;
      chunkIdToBadgeNumber.set(item.chunkId, badgeNumber);
      const chunk = activeChunkMap.get(item.chunkId)!;
      const title = sourceTitles?.get(chunk.source_id) ?? `Source ${chunk.source_id.slice(0, 8)}`;

      const citationData: Citation = {
        badge_number: badgeNumber,
        source_id: chunk.source_id,
        source_title: title,
        chunk_id: chunk.chunk_id,
        snippet: chunk.text,
        locator: chunk.locator,
      };

      CitationSchema.parse(citationData); // Validate against strict contract
      citations.push(citationData);
    }
  }

  // 6. Replace cite tags in text with badge notation [n]
  const processedContent = draftText.replace(VALID_CITE_REGEX, (_full, chunkId) => {
    const rawId = chunkId.trim();
    const badgeNumber = chunkIdToBadgeNumber.get(rawId);
    return `[${badgeNumber}]`;
  });

  return {
    valid: true,
    refusal: false,
    processedContent,
    citations,
    distinctChunkCount: citations.length,
  };
}
