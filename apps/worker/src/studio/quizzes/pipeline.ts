import type {
  PedagogyDifficulty,
  SourceRevisionPair,
  StudioFailureCode,
  StudioGenerationOutcome,
  StudioProgress,
  StudioQuizPayload,
  UnifiedDocumentChunk,
} from "@everlast/contracts";
import { processAllOriginalEvidenceBatches, verifyEvidenceCoverage, type EvidenceBatchLimits } from "../evidence.ts";
import type { QuizFactCandidate, QuizModelClient } from "./model.ts";
import { validateQuizPayload } from "./validation.ts";

/**
 * [014-studio-active-learning-suite] T017 — Quiz generation pipeline over all original C-02 chunks
 * (FR-ST-14, C-02, C-03, D12).
 */

export interface GenerateQuizInput {
  chunks: readonly UnifiedDocumentChunk[];
  original_chunks?: AsyncIterable<UnifiedDocumentChunk[]> | undefined;
  cached_context?: string | undefined;
  before_model_call?: (() => Promise<void>) | undefined;
  load_cited_chunks?: ((ids: string[]) => Promise<UnifiedDocumentChunk[]>) | undefined;
  snapshot: readonly SourceRevisionPair[];
  model: QuizModelClient;
  question_count?: number | undefined;
  difficulty?: PedagogyDifficulty | undefined;
  focus_prompt?: string | undefined;
  output_language?: string | undefined;
  limits?: EvidenceBatchLimits | undefined;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome<StudioQuizPayload> => ({
  status: "refused",
  code,
  message,
});

function dedupeCandidates(items: QuizFactCandidate[]): QuizFactCandidate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.chunk_id}|${item.sentence.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateQuiz(input: GenerateQuizInput): Promise<StudioGenerationOutcome<StudioQuizPayload>> {
  let chunks = [...input.chunks];
  const { snapshot, model, signal, output_language, focus_prompt } = input;
  const difficulty: PedagogyDifficulty = input.difficulty ?? "medium";
  signal.throwIfAborted();

  if (chunks.length === 0 && !input.original_chunks) {
    return refuse("InsufficientEvidence", "The selected sources contain no readable content to generate a quiz.");
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
      "The selected sources do not contain enough supported factual topics for a quiz."
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
    question_count: input.question_count,
    difficulty,
    focus_prompt,
    output_language,
    signal,
  });

  const payload: StudioQuizPayload = {
    ...composed,
    coverage,
  };

  signal.throwIfAborted();
  input.reportProgress("validating", 90);
  const validationError = validateQuizPayload(payload, chunks, snapshot);
  if (validationError) {
    return refuse("CitationValidationFailed", validationError);
  }

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload,
  };
}
