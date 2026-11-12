import type {
  SourceRevisionPair,
  StudioFailureCode,
  StudioGenerationOutcome,
  StudioMindmapPayload,
  StudioProgress,
  UnifiedDocumentChunk,
} from "@everlast/contracts";
import { processAllOriginalEvidenceBatches, verifyEvidenceCoverage, type EvidenceBatchLimits } from "../evidence.ts";
import type { MindmapFinding, MindmapModelClient } from "./model.ts";
import { validateMindmapPayload } from "./validation.ts";

/**
 * [011-studio-mindmaps-data-tables] T019 — Mindmap generation pipeline over all original C-02 chunks
 * (FR-ST-08, FR-SI-02, C-02/C-03, NFR-SEC-01; FR-001, FR-002, FR-003, FR-010, FR-011, FR-013, FR-014, SC-001, SC-002, SC-008).
 */

export interface GenerateMindmapInput {
  chunks: readonly UnifiedDocumentChunk[];
  original_chunks?:AsyncIterable<UnifiedDocumentChunk[]>|undefined;
  cached_context?:string|undefined;
  before_model_call?:(()=>Promise<void>)|undefined;
  load_cited_chunks?:((ids:string[])=>Promise<UnifiedDocumentChunk[]>)|undefined;
  snapshot: readonly SourceRevisionPair[];
  model: MindmapModelClient;
  output_language?: string | undefined;
  limits?: EvidenceBatchLimits | undefined;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome<StudioMindmapPayload> => ({
  status: "refused",
  code,
  message,
});

function dedupeFindings(findings: MindmapFinding[]): MindmapFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.chunk_id}|${f.subtopic}|${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateMindmap(input: GenerateMindmapInput): Promise<StudioGenerationOutcome<StudioMindmapPayload>> {
  let chunks=[...input.chunks];
  const { snapshot, model, signal, output_language } = input;
  signal.throwIfAborted();

  if (chunks.length === 0 && !input.original_chunks) {
    return refuse("InsufficientEvidence", "The selected sources contain no readable content to build a mindmap.");
  }

  input.reportProgress("reading", 5);
  const { items: rawFindings, coverage } = await processAllOriginalEvidenceBatches({
    chunks,
    original_chunks:input.original_chunks,
    snapshot,
    limits: input.limits,
    signal,
    onBatchComplete: (done, total) => {
      input.reportProgress("extracting", 10 + Math.round((done / Math.max(1, total)) * 60));
    },
    extractBatch: async (batch) => {
      await input.before_model_call?.();
      return model.extract({
        cached_context:input.cached_context,
        chunks: batch,
        output_language,
        signal,
      });},
  });

  const coverageError = input.original_chunks?null:verifyEvidenceCoverage(coverage, chunks, snapshot);
  if (coverageError) {
    return refuse("CitationValidationFailed", coverageError);
  }

  const findings = dedupeFindings(rawFindings);
  if (findings.length === 0) {
    return refuse("InsufficientEvidence", "The selected sources do not contain enough supported factual topics for a mindmap.");
  }

  if(input.load_cited_chunks) chunks=await input.load_cited_chunks([...new Set(findings.map(f=>f.chunk_id))]);
  if(Buffer.byteLength(JSON.stringify(findings))>16_000_000)throw new Error('Complete model compose envelope exceeds capacity');
  signal.throwIfAborted();
  input.reportProgress("composing", 75);
  await input.before_model_call?.();
  const composed = await model.compose({
    findings,
    chunks,
    output_language,
    signal,
  });

  const payload = {
    ...composed,
    coverage,
  };

  signal.throwIfAborted();
  input.reportProgress("validating", 90);
  const validationError = validateMindmapPayload(payload, chunks, snapshot);
  if (validationError) {
    // Terminal refusal on citation/graph validation failure — no automatic retry (FR-011, T011, T017)
    return refuse("CitationValidationFailed", validationError);
  }

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload,
  };
}
