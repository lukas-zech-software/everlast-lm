import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { UnifiedDocumentChunk } from '@everlast/contracts';
import { planStudioContext } from '../src/studio/context-plan.ts';

describe('NFR-PERF-01 C-02/C-03 studio context planning and token boundaries', () => {
  const dummyChunk = (tokenCount: number, text = 'dummy text'): UnifiedDocumentChunk => ({
    chunk_id: randomUUID(),
    source_id: randomUUID(),
    revision: 1,
    locator: { page_number: 1, start_offset: 0, end_offset: 10 },
    token_count: tokenCount,
    text,
  });

  it('selects CachedFullContext when source tokens are <= 1,000,000 and within model envelope', () => {
    const chunk = dummyChunk(500);
    const planUnder = planStudioContext({
      attemptId: randomUUID(),
      sourceTokenTotal: 999_999,
      modelInputLimit: 1_050_000,
      outputReserve: 4096,
      instructionTokens: 1000,
      chunks: [chunk],
    });
    expect(planUnder.mode).toBe('CachedFullContext');

    const planBoundary = planStudioContext({
      attemptId: randomUUID(),
      sourceTokenTotal: 1_000_000,
      modelInputLimit: 1_050_000,
      outputReserve: 4096,
      instructionTokens: 1000,
      chunks: [chunk],
    });
    expect(planBoundary.mode).toBe('CachedFullContext');
  });

  it('selects ChunkMapReduce when source tokens exceed 1,000,000', () => {
    const chunk = dummyChunk(500);
    const planOver = planStudioContext({
      attemptId: randomUUID(),
      sourceTokenTotal: 1_000_001,
      modelInputLimit: 1_050_000,
      outputReserve: 4096,
      instructionTokens: 1000,
      chunks: [chunk],
    });
    expect(planOver.mode).toBe('ChunkMapReduce');
  });

  it('segments oversized chunks without exceeding batch budgets and preserves parent linkage', () => {
    const hugeText = 'Word '.repeat(3000);
    const oversizedChunk = dummyChunk(6000, hugeText);
    const plan = planStudioContext({
      attemptId: randomUUID(),
      sourceTokenTotal: 6000,
      modelInputLimit: 10_000,
      outputReserve: 1000,
      instructionTokens: 500,
      chunks: [oversizedChunk],
      maxBatchTokens: 2000,
    });

    expect(plan.segments.length).toBeGreaterThan(1);
    for (const segment of plan.segments) {
      expect(segment.parent_chunk_id).toBe(oversizedChunk.chunk_id);
      expect(segment.end_offset).toBeGreaterThan(segment.start_offset);
    }
  });

  it('fails with explicit capacity error when model input limit cannot fit required instructions and reserve', () => {
    const chunk = dummyChunk(100);
    expect(() =>
      planStudioContext({
        attemptId: randomUUID(),
        sourceTokenTotal: 100,
        modelInputLimit: 500,
        outputReserve: 1000, // reserve alone exceeds limit
        instructionTokens: 500,
        chunks: [chunk],
      })
    ).toThrow(/capacity/i);
  });
});
