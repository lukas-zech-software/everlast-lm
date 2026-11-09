import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '@everlast/db/testing';
import { createNotebook } from '@everlast/db';
import { captureScopeSnapshot } from '@everlast/db';
import { calibrateScopedRetrieval } from '../src/retrieval-calibration.ts';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 C-02 retrieval calibration evaluation', () => {
  it('returns calibration result with query plan and scope verification', async () => {
    const owner = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner, {});
    const needle = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Reactor coolant pressure must be 142.8 bar.'],
      embed: t => embedder.embed(t),
    });
    const scope = await captureScopeSnapshot(db.pool, owner, notebook.id, [needle.sourceId]);
    const query = 'coolant pressure';
    const [embedding] = await embedder.embed([query]);

    const res = await calibrateScopedRetrieval(db.pool, scope, {
      queryText: query,
      queryEmbedding: embedding!,
      needleChunkId: needle.chunkIds[0]!,
    });

    expect(res.scopePreserved).toBe(true);
    expect(res.needleRecalled).toBe(true);
    expect(res.queryPlan.length).toBeGreaterThan(0);
    expect(res.recallVsExact).toBeGreaterThan(0);
  });
});
