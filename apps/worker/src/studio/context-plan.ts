import { createHash } from 'node:crypto';
import { ContextModeSchema, EvidenceSegmentSchema, type EvidenceSegment, type UnifiedDocumentChunk } from '@everlast/contracts';
import type { z } from 'zod';

export type ContextMode = z.infer<typeof ContextModeSchema>;

export interface PlanStudioContextInput {
  attemptId: string;
  sourceTokenTotal: number;
  chunks: readonly UnifiedDocumentChunk[];
  modelInputLimit?: number;
  outputReserve?: number;
  instructionTokens?: number;
  maxBatchTokens?: number;
  maxBatchChunks?: number;
}

export interface StudioContextPlan {
  mode: ContextMode;
  sourceTokenTotal: number;
  segments: EvidenceSegment[];
  originals: { chunk_id: string; digest: string; length: number }[];
  modelInputLimit: number;
  outputReserve: number;
}

export function planStudioContext(input: PlanStudioContextInput): StudioContextPlan {
  const modelInputLimit = input.modelInputLimit ?? 1_000_000;
  const outputReserve = input.outputReserve ?? 4096;
  const instructionTokens = input.instructionTokens ?? 1000;
  const maxBatchTokens = input.maxBatchTokens ?? 4000;

  if (outputReserve + instructionTokens >= modelInputLimit) {
    throw new Error('Complete model envelope exceeds capacity: output reserve and instructions exceed model input limit');
  }

  const fitsInCache =
    input.sourceTokenTotal <= 1_000_000 &&
    input.sourceTokenTotal + outputReserve + instructionTokens <= modelInputLimit;

  const mode: ContextMode = fitsInCache ? 'CachedFullContext' : 'ChunkMapReduce';

  const segments: EvidenceSegment[] = [];
  const originals = input.chunks.map((c) => {
    const textLen = c.text.length || 1;
    const digest = createHash('sha256').update(c.text).digest('hex');

    if (c.token_count > maxBatchTokens && c.text.length > 1) {
      // Oversized chunk: segment into continuous, non-overlapping parts
      const partCount = Math.ceil(c.token_count / maxBatchTokens);
      const charsPerPart = Math.ceil(textLen / partCount);
      let offset = 0;
      while (offset < textLen) {
        const end = Math.min(textLen, offset + charsPerPart);
        const ratio = (end - offset) / textLen;
        const partTokens = Math.max(1, Math.round(c.token_count * ratio));
        segments.push(
          EvidenceSegmentSchema.parse({
            parent_chunk_id: c.chunk_id,
            start_offset: offset,
            end_offset: end,
            token_count: partTokens,
          })
        );
        offset = end;
      }
    } else {
      segments.push(
        EvidenceSegmentSchema.parse({
          parent_chunk_id: c.chunk_id,
          start_offset: 0,
          end_offset: textLen,
          token_count: c.token_count,
        })
      );
    }

    return {
      chunk_id: c.chunk_id,
      digest,
      length: textLen,
    };
  });

  return {
    mode,
    sourceTokenTotal: input.sourceTokenTotal,
    segments,
    originals,
    modelInputLimit,
    outputReserve,
  };
}
