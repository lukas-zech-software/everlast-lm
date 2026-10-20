import type { UnifiedDocumentChunk } from "@everlast/contracts";

export interface BatchLimits {
  maxTokens: number;
  maxChunks: number;
}

/** Small enough that the map step runs in parallel (`EXTRACT_CONCURRENCY`, Gate v2.0 #3 P95 ≤ 25 s); revised 2026-10-20 from 8,000 / 40. */
export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxTokens: 4000, maxChunks: 8 };

/** Partitions ALL chunks, in order, into bounded batches; an oversized chunk gets its own batch (D12). */
export function batchChunks(
  chunks: readonly UnifiedDocumentChunk[],
  limits: BatchLimits = DEFAULT_BATCH_LIMITS
): UnifiedDocumentChunk[][] {
  const batches: UnifiedDocumentChunk[][] = [];
  let current: UnifiedDocumentChunk[] = [];
  let tokens = 0;
  for (const chunk of chunks) {
    const overflow = current.length >= limits.maxChunks || tokens + chunk.token_count > limits.maxTokens;
    if (current.length > 0 && overflow) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(chunk);
    tokens += chunk.token_count;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
