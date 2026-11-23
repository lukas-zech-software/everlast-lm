import type {
  FlashcardCountInput,
  PedagogyDifficulty,
  SourceRevisionPair,
  StudioFailureCode,
  StudioFlashcardsPayload,
  StudioGenerationOutcome,
  StudioProgress,
  UnifiedDocumentChunk,
} from "@everlast/contracts";
import { processAllOriginalEvidenceBatches, verifyEvidenceCoverage, type EvidenceBatchLimits } from "../evidence.ts";
import type { FlashcardCandidate, FlashcardsModelClient } from "./model.ts";
import { validateFlashcardsPayload } from "./validation.ts";

/**
 * [014-studio-active-learning-suite] T010 — Flashcards generation pipeline over all original C-02 chunks
 * (FR-ST-13, C-02, C-03, D12).
 */

export interface GenerateFlashcardsInput {
  chunks: readonly UnifiedDocumentChunk[];
  original_chunks?: AsyncIterable<UnifiedDocumentChunk[]> | undefined;
  cached_context?: string | undefined;
  before_model_call?: (() => Promise<void>) | undefined;
  load_cited_chunks?: ((ids: string[]) => Promise<UnifiedDocumentChunk[]>) | undefined;
  snapshot: readonly SourceRevisionPair[];
  model: FlashcardsModelClient;
  difficulty?: PedagogyDifficulty | undefined;
  card_count?: FlashcardCountInput | undefined;
  focus_prompt?: string | undefined;
  output_language?: string | undefined;
  limits?: EvidenceBatchLimits | undefined;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome<StudioFlashcardsPayload> => ({
  status: "refused",
  code,
  message,
});

function dedupeCandidates(items: FlashcardCandidate[]): FlashcardCandidate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.chunk_id}|${item.back_text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateFlashcards(
  input: GenerateFlashcardsInput
): Promise<StudioGenerationOutcome<StudioFlashcardsPayload>> {
  let chunks = [...input.chunks];
  const { snapshot, model, signal, output_language, focus_prompt } = input;
  const difficulty: PedagogyDifficulty = input.difficulty ?? "medium";
  signal.throwIfAborted();

  if (chunks.length === 0 && !input.original_chunks) {
    return refuse("InsufficientEvidence", "The selected sources contain no readable content to generate flashcards.");
  }

  input.reportProgress("reading", 5);
  const { items: rawCandidates, coverage } = await processAllOriginalEvidenceBatches({
    chunks,
    original_chunks: input.original_chunks,
    snapshot,
    limits: input.limits,
    signal,
    onBatchComplete: (done, total) => {
      input.reportProgress("extracting", 10 + Math.round((done / Math.max(1, total)) * 60));
    },
    extractBatch: async (batch) => {
      await input.before_model_call?.();
      return model.extract({
        cached_context: input.cached_context,
        chunks: batch,
        difficulty,
        focus_prompt,
        output_language,
        signal,
      });
    },
  });

  const coverageError = input.original_chunks ? null : verifyEvidenceCoverage(coverage, chunks, snapshot);
  if (coverageError) {
    return refuse("CitationValidationFailed", coverageError);
  }

  const candidates = dedupeCandidates(rawCandidates);
  if (candidates.length === 0) {
    return refuse(
      "InsufficientEvidence",
      "The selected sources do not contain enough supported factual topics for flashcards."
    );
  }

  if (input.load_cited_chunks) {
    chunks = await input.load_cited_chunks([...new Set(candidates.map((c) => c.chunk_id))]);
  }
  signal.throwIfAborted();
  input.reportProgress("composing", 75);
  await input.before_model_call?.();
  const composed = await model.compose({
    candidates,
    difficulty,
    card_count: input.card_count,
    focus_prompt,
    output_language,
    signal,
  });

  const payload: StudioFlashcardsPayload = {
    ...composed,
    coverage,
  };

  signal.throwIfAborted();
  input.reportProgress("validating", 90);
  const validationError = validateFlashcardsPayload(payload, chunks, snapshot);
  if (validationError) {
    return refuse("CitationValidationFailed", validationError);
  }

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload,
  };
}
