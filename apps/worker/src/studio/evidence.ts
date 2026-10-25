import type { SourceRevisionPair, StudioCoverageManifest, UnifiedDocumentChunk } from "@everlast/contracts";
import { batchChunks, DEFAULT_BATCH_LIMITS } from "./reports/batching.ts";

/**
 * [011-studio-mindmaps-data-tables] T018 — Common original-evidence batching and coverage helper
 * (FR-ST-08/18, FR-SI-02/05, C-01/C-02/C-03; FR-003, FR-010, FR-011, FR-013, SC-007, SC-008).
 *
 * Ensures Mindmap and Data Table pipelines consume ALL original C-02 chunks across bounded batches
 * rather than substituting Source Guide summaries or top-k retrieval subsets.
 */

export interface EvidenceBatchLimits {
  maxTokensPerBatch?: number;
  maxChunksPerBatch?: number;
  maxTokens?: number;
  maxChunks?: number;
}

export interface ProcessOriginalEvidenceInput<T> {
  chunks: readonly UnifiedDocumentChunk[];
  snapshot: readonly SourceRevisionPair[];
  limits?: EvidenceBatchLimits | undefined;
  concurrency?: number | undefined;
  signal: AbortSignal;
  onBatchComplete?(completedBatches: number, totalBatches: number): void;
  extractBatch(batch: UnifiedDocumentChunk[], batchIndex: number): Promise<T[]>;
}

export interface ProcessOriginalEvidenceResult<T> {
  items: T[];
  coverage: StudioCoverageManifest;
}

export const DEFAULT_EVIDENCE_CONCURRENCY = 4;

export async function processAllOriginalEvidenceBatches<T>(
  input: ProcessOriginalEvidenceInput<T>
): Promise<ProcessOriginalEvidenceResult<T>> {
  input.signal.throwIfAborted();
  const maxTokens = input.limits?.maxTokensPerBatch ?? input.limits?.maxTokens ?? DEFAULT_BATCH_LIMITS.maxTokens;
  const maxChunks = input.limits?.maxChunksPerBatch ?? input.limits?.maxChunks ?? DEFAULT_BATCH_LIMITS.maxChunks;
  const batches = batchChunks(input.chunks, { maxTokens, maxChunks });

  const perBatch: T[][] = new Array(batches.length);
  let nextIndex = 0;
  let completed = 0;
  let failed = false;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? DEFAULT_EVIDENCE_CONCURRENCY, batches.length || 1));

  const worker = async (): Promise<void> => {
    while (nextIndex < batches.length && !failed) {
      const idx = nextIndex++;
      input.signal.throwIfAborted();
      try {
        perBatch[idx] = await input.extractBatch(batches[idx]!, idx);
        completed += 1;
        input.onBatchComplete?.(completed, batches.length);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };

  if (batches.length > 0) {
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  const coverage: StudioCoverageManifest = {
    total_sources: input.snapshot.length,
    total_chunks: input.chunks.length,
    batch_count: batches.length,
    processed_batch_count: completed,
    all_original_chunks_visited: true,
  };

  return {
    items: perBatch.flat(),
    coverage,
  };
}

/**
 * Verifies that the coverage manifest visited all original chunks and that every chunk matches the captured snapshot.
 * Returns null when valid, or an error explanation string when invalid.
 */
export function verifyEvidenceCoverage(
  coverage: StudioCoverageManifest | undefined,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[]
): string | null {
  if (!coverage) {
    return "Coverage manifest is missing.";
  }
  if (!coverage.all_original_chunks_visited) {
    return "Not all original chunks were visited.";
  }
  if (coverage.processed_batch_count !== coverage.batch_count) {
    return `Incomplete batch coverage: processed ${coverage.processed_batch_count} of ${coverage.batch_count} batches.`;
  }
  if (coverage.total_chunks !== chunks.length) {
    return `Chunk count mismatch in coverage manifest (${coverage.total_chunks} vs ${chunks.length}).`;
  }
  const revisionBySource = new Map(snapshot.map((s) => [s.source_id, s.revision]));
  for (const chunk of chunks) {
    const expectedRev = revisionBySource.get(chunk.source_id);
    if (expectedRev === undefined) {
      return `Chunk ${chunk.chunk_id} belongs to out-of-snapshot source ${chunk.source_id}.`;
    }
    if (chunk.revision !== expectedRev) {
      return `Chunk ${chunk.chunk_id} has stale revision ${chunk.revision} (expected ${expectedRev}).`;
    }
  }
  return null;
}
