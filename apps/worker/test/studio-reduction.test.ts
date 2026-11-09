import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reduceOriginalFindings, validateCoverageManifest } from '../src/studio/reduce.ts';

describe('NFR-PERF-01 C-01/C-03 studio recursive reduction and coverage verification', () => {
  it('recursively reduces bounded findings while strictly preserving original chunk citations', async () => {
    const chunkId1 = randomUUID();
    const chunkId2 = randomUUID();
    const findings = [
      { id: 'f1', text: 'Safety coolant limit 142.8 bar', citations: [chunkId1] },
      { id: 'f2', text: 'Turbine efficiency threshold 92%', citations: [chunkId2] },
      { id: 'f3', text: 'Emergency shutdown timing 1.5s', citations: [chunkId1] },
    ];

    const result = await reduceOriginalFindings({
      findings,
      maxBatchFindings: 2,
      reduceBatch: async (batch) => {
        return {
          id: `reduced-${batch.map(b => b.id).join('-')}`,
          text: batch.map(b => b.text).join('; '),
          citations: Array.from(new Set(batch.flatMap(b => b.citations))),
        };
      },
    });

    expect(result.citations).toContain(chunkId1);
    expect(result.citations).toContain(chunkId2);
    expect(result.text).toContain('142.8 bar');
  });

  it('validates original coverage manifest and rejects gaps or missing segments', () => {
    const chunkId = randomUUID();
    const hash = 'a'.repeat(64);
    const attemptId = randomUUID();
    const batchId = randomUUID();

    const validManifest = {
      attempt_id: attemptId,
      originals: [{ chunk_id: chunkId, digest: hash, length: 100 }],
      segments: [
        { parent_chunk_id: chunkId, start_offset: 0, end_offset: 50, token_count: 10 },
        { parent_chunk_id: chunkId, start_offset: 50, end_offset: 100, token_count: 10 },
      ],
      completed_segments: [0, 1],
      expected_batch_ids: [batchId],
      completed_batch_ids: [batchId],
    };

    expect(() => validateCoverageManifest(validManifest)).not.toThrow();

    // Manifest with gap (0..40, 50..100) must fail validation
    const invalidManifest = {
      ...validManifest,
      segments: [
        { parent_chunk_id: chunkId, start_offset: 0, end_offset: 40, token_count: 8 },
        { parent_chunk_id: chunkId, start_offset: 50, end_offset: 100, token_count: 10 },
      ],
    };
    expect(() => validateCoverageManifest(invalidManifest)).toThrow(/gap/i);
  });
});
