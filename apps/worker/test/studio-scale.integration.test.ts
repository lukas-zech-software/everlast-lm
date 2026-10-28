import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '@everlast/db/testing';
import { createNotebook } from '@everlast/db';
import { captureScopeSnapshot } from '@everlast/db';
import { processAllOriginalEvidenceBatches } from '../src/studio/evidence.ts';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 C-02/C-03 studio scale & mode integration', () => {
  it('processes all original evidence batches and retains coverage manifest with all original chunks', async () => {
    const owner = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner, {});
    const s1 = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Section 1 text', 'Section 2 text'],
      embed: t => embedder.embed(t),
    });

    const scope = await captureScopeSnapshot(db.pool, owner, notebook.id, [s1.sourceId]);
    const { listSnapshotChunks } = await import('@everlast/db');
    const chunks = await listSnapshotChunks(db.pool, scope);

    const controller = new AbortController();
    const result = await processAllOriginalEvidenceBatches({
      chunks,
      snapshot: scope.sources,
      signal: controller.signal,
      extractBatch: async (batch) => batch.map(c => ({ id: c.chunk_id, words: c.token_count })),
    });

    expect(result.coverage.all_original_chunks_visited).toBe(true);
    expect(result.coverage.total_chunks).toBe(2);
    expect(result.items).toHaveLength(2);
  });
});
