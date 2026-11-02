import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '../src/testing.ts';
import { createNotebook } from '../src/notebooks.ts';
import { captureScopeSnapshot } from '../src/scope-guard.ts';
import { saveSourceGuide, getScopedSourceGuides } from '../src/package-v2-2.ts';
import { runWithV2Persistence } from '../src/v2-persistence.ts';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 FR-SI-02 scoped guides integration', () => {
  it('reads all matching source guides within captured snapshot and excludes foreign/deselected guides', async () => {
    await runWithV2Persistence(db.pool, async () => {
      const owner = await createTestUser(db.pool);
      const { notebook } = await createNotebook(db.pool, owner, {});
      const s1 = await seedReadySource(db.pool, owner, notebook.id, {
        pages: ['Source 1 contents'],
        embed: t => embedder.embed(t),
      });
      const s2 = await seedReadySource(db.pool, owner, notebook.id, {
        pages: ['Source 2 contents'],
        embed: t => embedder.embed(t),
      });
      const foreignSource = await seedReadySource(db.pool, owner, notebook.id, {
        pages: ['Deselected source contents'],
        embed: t => embedder.embed(t),
      });

      await saveSourceGuide({
        notebook_id: notebook.id,
        source_id: s1.sourceId,
        revision: 1,
        output_language: 'en',
        status: 'GuideReady',
        source_word_count: 100,
        summary_md: 'Summary for source 1',
        key_topics: ['topic1'],
        supporting_chunk_ids: [s1.chunkIds[0]!],
      });

      await saveSourceGuide({
        notebook_id: notebook.id,
        source_id: s2.sourceId,
        revision: 1,
        output_language: 'en',
        status: 'GuideReady',
        source_word_count: 100,
        summary_md: 'Summary for source 2',
        key_topics: ['topic2'],
        supporting_chunk_ids: [s2.chunkIds[0]!],
      });

      await saveSourceGuide({
        notebook_id: notebook.id,
        source_id: foreignSource.sourceId,
        revision: 1,
        output_language: 'en',
        status: 'GuideReady',
        source_word_count: 100,
        summary_md: 'Deselected guide summary',
        key_topics: ['decoy'],
        supporting_chunk_ids: [foreignSource.chunkIds[0]!],
      });

      const scope = await captureScopeSnapshot(db.pool, owner, notebook.id, [s1.sourceId, s2.sourceId]);
      const guides = await getScopedSourceGuides(db.pool, notebook.id, scope.sources, 'en');

      expect(guides).toHaveLength(2);
      const ids = guides.map(g => g.source_id);
      expect(ids).toContain(s1.sourceId);
      expect(ids).toContain(s2.sourceId);
      expect(ids).not.toContain(foreignSource.sourceId);
    });
  });
});
