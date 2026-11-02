import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '@everlast/db/testing';
import { createNotebook, saveSourceGuide, runWithV2Persistence } from '@everlast/db';
import { RequestScopedContextProvider } from '../src/services/source-context.ts';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 C-02 RequestScopedContextProvider guide integration', () => {
  it('reads scoped guides matching exactly the captured snapshot', async () => {
    await runWithV2Persistence(db.pool, async () => {
      const owner = await createTestUser(db.pool);
      const { notebook } = await createNotebook(db.pool, owner, {});
      const s1 = await seedReadySource(db.pool, owner, notebook.id, {
        pages: ['Source 1 text'],
        embed: t => embedder.embed(t),
      });

      await saveSourceGuide({
        notebook_id: notebook.id,
        source_id: s1.sourceId,
        revision: 1,
        output_language: 'en',
        status: 'GuideReady',
        source_word_count: 50,
        summary_md: 'Guide 1',
        key_topics: ['t1'],
        supporting_chunk_ids: [s1.chunkIds[0]!],
      });

      const provider = await RequestScopedContextProvider.capture({
        pool: db.pool,
        embedder,
        ownerId: owner,
        notebookId: notebook.id,
        activeSourceIds: [s1.sourceId],
        query: 'test query',
      });

      const guides = await provider.readScopedGuides('en');
      expect(guides).toHaveLength(1);
      expect(guides[0]!.source_id).toBe(s1.sourceId);
      expect(guides[0]!.summary_md).toBe('Guide 1');
    });
  });
});
