import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyQuery, planChatContext } from '../src/chat/context-plan.ts';

describe('NFR-PERF-01 FR-SI-02 chat context planning', () => {
  it('deterministically classifies broad whole-collection queries vs detailed queries', () => {
    expect(classifyQuery('Summarize the main themes across all 40 sources')).toBe('broad');
    expect(classifyQuery('Provide an overview across all sources')).toBe('broad');
    expect(classifyQuery('Compare the central themes of all sources')).toBe('broad');
    expect(classifyQuery('What must the reactor coolant pressure be?')).toBe('detailed');
    expect(classifyQuery('Explain section 3.2 of source 4')).toBe('detailed');
  });

  it('builds a valid context plan for broad queries with all 40 guides and detail chunks', () => {
    const guideIds = Array.from({ length: 40 }, () => randomUUID());
    const detailIds = [randomUUID(), randomUUID()];
    const plan = planChatContext({
      requestId: randomUUID(),
      scopeManifestHash: 'a'.repeat(64),
      question: 'Summarize the main themes across all 40 sources',
      model: 'gemini-1.5-pro',
      modelVersion: '002',
      inputLimit: 1_000_000,
      outputReserve: 4096,
      instructionTokens: 500,
      historyTokens: 200,
      guideTokens: 12000,
      chunkMarkerTokens: 100,
      evidenceTokens: 3000,
      requiredGuideIds: guideIds,
      detailChunkIds: detailIds,
    });

    expect(plan.query_class).toBe('broad');
    expect(plan.required_guide_ids).toHaveLength(40);
    expect(plan.detail_chunk_ids).toHaveLength(2);
    expect(plan.mode).toBe('retrieval');
  });

  it('fails safely with capacity error when required context exceeds model envelope without truncation', () => {
    const guideIds = Array.from({ length: 40 }, () => randomUUID());
    expect(() =>
      planChatContext({
        requestId: randomUUID(),
        scopeManifestHash: 'a'.repeat(64),
        question: 'Summarize the main themes across all 40 sources',
        model: 'gemini-1.5-pro',
        modelVersion: '002',
        inputLimit: 10_000,
        outputReserve: 4096,
        instructionTokens: 1000,
        historyTokens: 2000,
        guideTokens: 8000, // 4096 + 1000 + 2000 + 8000 = 15096 > 10000
        chunkMarkerTokens: 500,
        evidenceTokens: 2000,
        requiredGuideIds: guideIds,
        detailChunkIds: [randomUUID()],
      })
    ).toThrow(/exceeds capacity/i);
  });
});
