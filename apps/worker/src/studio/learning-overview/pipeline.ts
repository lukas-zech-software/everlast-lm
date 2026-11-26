import type {
  SourceRevisionPair,
  StudioFailureCode,
  StudioGenerationOutcome,
  StudioLearningOverviewPayload,
  StudioProgress,
  UnifiedDocumentChunk,
} from "@everlast/contracts";
import {
  processAllOriginalEvidenceBatches,
  verifyEvidenceCoverage,
  type EvidenceBatchLimits,
} from "../evidence.ts";
import type { LearningOverviewFact, LearningOverviewModelClient } from "./model.ts";
import { validateLearningOverviewPayload } from "./validation.ts";

/**
 * [014-studio-active-learning-suite] T027 — Composite Learning Overview pipeline
 * (FR-ST-12, C-02, C-03, D9, D12). Atomically refuses if any required block fails.
 */

export interface GenerateLearningOverviewInput {
  chunks: readonly UnifiedDocumentChunk[];
  original_chunks?: AsyncIterable<UnifiedDocumentChunk[]> | undefined;
  cached_context?: string | undefined;
  before_model_call?: (() => Promise<void>) | undefined;
  load_cited_chunks?: ((ids: string[]) => Promise<UnifiedDocumentChunk[]>) | undefined;
  snapshot: readonly SourceRevisionPair[];
  model: LearningOverviewModelClient;
  section_count?: number | undefined;
  focus_prompt?: string | undefined;
  output_language?: string | undefined;
  limits?: EvidenceBatchLimits | undefined;
  signal: AbortSignal;
  reportProgress: (stage: StudioProgress["stage"], percent: number) => void;
}

const refuse = (
  code: StudioFailureCode,
  message: string,
): StudioGenerationOutcome<StudioLearningOverviewPayload> => ({
  status: "refused",
  code,
  message,
});

function dedupeFacts(items: LearningOverviewFact[]): LearningOverviewFact[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.chunk_id}|${item.fact_text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateLearningOverview(
  input: GenerateLearningOverviewInput,
): Promise<StudioGenerationOutcome<StudioLearningOverviewPayload>> {
  let chunks = [...input.chunks];
  const { snapshot, model, signal, output_language, focus_prompt } = input;
  signal.throwIfAborted();

  if (chunks.length === 0 && !input.original_chunks) {
    return refuse(
      "InsufficientEvidence",
      "The selected sources contain no readable content to build a learning overview.",
    );
  }

  input.reportProgress("reading", 5);
  const { items: rawFacts, coverage } = await processAllOriginalEvidenceBatches({
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
        focus_prompt,
        output_language,
        signal,
      });
    },
  });

  const coverageError = input.original_chunks
    ? null
    : verifyEvidenceCoverage(coverage, chunks, snapshot);
  if (coverageError) {
    return refuse("CitationValidationFailed", coverageError);
  }

  const facts = dedupeFacts(rawFacts);
  if (facts.length === 0) {
    return refuse(
      "InsufficientEvidence",
      "The selected sources do not contain enough supported factual content for a learning overview.",
    );
  }

  if (input.load_cited_chunks) {
    chunks = await input.load_cited_chunks([...new Set(facts.map((f) => f.chunk_id))]);
  }
  signal.throwIfAborted();
  input.reportProgress("composing", 75);
  await input.before_model_call?.();

  let composed: StudioLearningOverviewPayload;
  try {
    composed = await model.compose({
      facts,
      section_count: input.section_count,
      focus_prompt,
      output_language,
      signal,
    });
  } catch (err) {
    return refuse(
      "GenerationError",
      err instanceof Error ? err.message : "Composite learning overview block generation failed.",
    );
  }

  const payload: StudioLearningOverviewPayload = {
    ...composed,
    coverage,
  };

  signal.throwIfAborted();
  input.reportProgress("validating", 90);
  const validationError = validateLearningOverviewPayload(payload, chunks, snapshot);
  if (validationError) {
    // Atomic composite failure: incomplete or invalid block fails the job instead of publishing partial lesson (FR-ST-12)
    return refuse("GenerationError", validationError);
  }

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload,
  };
}
