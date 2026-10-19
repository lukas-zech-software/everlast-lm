import type { UnifiedDocumentChunk } from "@everlast/contracts";

export interface BatchLimits {
  maxTokens: number;
  maxChunks: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxTokens: 8000, maxChunks: 40 };

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
