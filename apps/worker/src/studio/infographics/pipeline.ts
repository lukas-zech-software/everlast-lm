import type {
  InfographicStyle,
  SourceRevisionPair,
  StudioFailureCode,
  StudioGenerationOutcome,
  StudioInfographicPayload,
  StudioProgress,
  UnifiedDocumentChunk,
} from "@everlast/contracts";
import { processAllOriginalEvidenceBatches, verifyEvidenceCoverage, type EvidenceBatchLimits } from "../evidence.ts";
import type { InfographicFactCandidate, InfographicModelClient } from "./model.ts";
import { validateInfographicPayload } from "./validation.ts";

/**
 * [015-studio-visuals-presentations] T018 — Infographic generation pipeline over all original C-02 chunks
 * (FR-ST-17, D9, C-02, C-03, D12).
 */

export interface GenerateInfographicInput {
  chunks: readonly UnifiedDocumentChunk[];
  original_chunks?: AsyncIterable<UnifiedDocumentChunk[]> | undefined;
  cached_context?: string | undefined;
  before_model_call?: (() => Promise<void>) | undefined;
  load_cited_chunks?: ((ids: string[]) => Promise<UnifiedDocumentChunk[]>) | undefined;
  snapshot: readonly SourceRevisionPair[];
  model: InfographicModelClient;
  style?: InfographicStyle | undefined;
  focus_prompt?: string | undefined;
  output_language?: string | undefined;
  limits?: EvidenceBatchLimits | undefined;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome<StudioInfographicPayload> => ({
  status: "refused",
  code,
  message,
});

function dedupeCandidates(items: InfographicFactCandidate[]): InfographicFactCandidate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.chunk_id}|${item.sentence.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateInfographic(
  input: GenerateInfographicInput
): Promise<StudioGenerationOutcome<StudioInfographicPayload>> {
  let chunks = [...input.chunks];
  const { snapshot, model, signal, output_language, focus_prompt } = input;
  const style: InfographicStyle = input.style ?? "auto";
  signal.throwIfAborted();

  if (chunks.length === 0 && !input.original_chunks) {
    return refuse("InsufficientEvidence", "The selected sources contain no readable content to generate an infographic.");
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
        style,
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
      "The selected sources do not contain enough grounded facts for a visual infographic."
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
    style,
    focus_prompt,
    output_language,
    signal,
  });

  const payload: StudioInfographicPayload = {
    ...composed,
    coverage,
  };

  signal.throwIfAborted();
  input.reportProgress("validating", 90);
  const validationError = validateInfographicPayload(payload, chunks, snapshot);
  if (validationError) {
    return refuse("CitationValidationFailed", validationError);
  }

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload,
  };
}
