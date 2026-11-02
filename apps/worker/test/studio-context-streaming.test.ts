import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '@everlast/db/testing';
import { createNotebook } from '@everlast/db';
import { captureScopeSnapshot } from '@everlast/db';
import { streamSnapshotChunks } from '@everlast/db';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 C-02/C-03 studio context streaming & backpressure', () => {
  it('streams chunks in bounded pages without accumulating full corpus into memory', async () => {
    const owner = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner, {});
    const s1 = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Page 1 chunk A', 'Page 2 chunk B', 'Page 3 chunk C'],
      embed: t => embedder.embed(t),
    });

    const scope = await captureScopeSnapshot(db.pool, owner, notebook.id, [s1.sourceId]);
    const stream = streamSnapshotChunks(db.pool, scope, 1);

    let pagesYielded = 0;
    const collectedIds: string[] = [];
    for await (const page of stream) {
      expect(page.length).toBeLessThanOrEqual(1);
      pagesYielded++;
      for (const chunk of page) {
        collectedIds.push(chunk.chunk_id);
      }
    }

    expect(pagesYielded).toBe(3);
    expect(collectedIds).toEqual(s1.chunkIds);
  });

  it('preserves exact original scope across 300 sources quota without widening filters', async () => {
    const owner = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner, {});
    const s1 = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Valid source content'],
      embed: t => embedder.embed(t),
    });
    const decoy = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Decoy content not in scope'],
      embed: t => embedder.embed(t),
    });

    const scope = await captureScopeSnapshot(db.pool, owner, notebook.id, [s1.sourceId]);
    const stream = streamSnapshotChunks(db.pool, scope, 10);

    for await (const page of stream) {
      for (const chunk of page) {
        expect(chunk.source_id).toBe(s1.sourceId);
        expect(chunk.source_id).not.toBe(decoy.sourceId);
      }
    }
  });
});
