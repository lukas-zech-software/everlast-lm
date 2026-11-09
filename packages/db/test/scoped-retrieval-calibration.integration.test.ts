import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '../src/testing.ts';
import { createNotebook } from '../src/notebooks.ts';
import { captureScopeSnapshot } from '../src/scope-guard.ts';
import { retrieveScopedChunks } from '../src/scoped-context.ts';
import { toVectorLiteral } from '../src/ingestion.ts';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 C-01/C-02 scoped retrieval calibration', () => {
  async function setupFixture() {
    const owner = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner, {});
    const needle = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Reactor coolant pressure must be 142.8 bar. Operational limits apply.'],
      embed: t => embedder.embed(t),
    });
    const filler = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Turbine exhaust temperature normal parameters.', 'Auxiliary generator standby mode.'],
      embed: t => embedder.embed(t),
    });
    const decoy = await seedReadySource(db.pool, owner, notebook.id, {
      pages: ['Reactor coolant pressure must be 155.0 bar. Test limits apply.'],
      embed: t => embedder.embed(t),
    });
    const scope = await captureScopeSnapshot(db.pool, owner, notebook.id, [needle.sourceId, filler.sourceId]);
    return { owner, notebook, needle, filler, decoy, scope };
  }

  it('recalls needle accurately, excludes unselected decoy and foreign sources', async () => {
    const { scope, needle, decoy } = await setupFixture();
    const query = 'What must the reactor coolant pressure be?';
    const [embedding] = await embedder.embed([query]);

    const retrieved = await retrieveScopedChunks(db.pool, scope, {
      queryText: query,
      queryEmbedding: embedding!,
      limit: 12,
      candidates: 40,
    });

    expect(retrieved.length).toBeGreaterThan(0);
    const chunkIds = retrieved.map(c => c.chunk_id);
    expect(chunkIds).toContain(needle.chunkIds[0]);
    expect(chunkIds).not.toContain(decoy.chunkIds[0]);

    const allowedSourceIds = scope.sources.map(s => s.source_id);
    for (const chunk of retrieved) {
      expect(chunk.text).not.toContain('155.0 bar');
      expect(allowedSourceIds).toContain(chunk.source_id);
    }
  });

  it('preserves deterministic tie order across repeated queries', async () => {
    const { scope } = await setupFixture();
    const query = 'coolant';
    const [embedding] = await embedder.embed([query]);

    const first = await retrieveScopedChunks(db.pool, scope, {
      queryText: query,
      queryEmbedding: embedding!,
      limit: 12,
      candidates: 40,
    });
    const second = await retrieveScopedChunks(db.pool, scope, {
      queryText: query,
      queryEmbedding: embedding!,
      limit: 12,
      candidates: 40,
    });

    expect(first.map(c => c.chunk_id)).toEqual(second.map(c => c.chunk_id));
    expect(first.map(c => c.score)).toEqual(second.map(c => c.score));
  });

  it('rejects mixed revisions or deleted sources and fails closed', async () => {
    const { scope, needle } = await setupFixture();
    await db.pool.query('UPDATE sources SET active_revision=99 WHERE id=$1', [needle.sourceId]);
    const query = 'coolant';
    const [embedding] = await embedder.embed([query]);

    await expect(
      retrieveScopedChunks(db.pool, scope, {
        queryText: query,
        queryEmbedding: embedding!,
      })
    ).rejects.toMatchObject({ code: 'SourceSnapshotInvalid' });
  });

  it('calibrates retrieval against exact distance and includes query plan evidence', async () => {
    const { scope, needle } = await setupFixture();
    const query = 'coolant pressure';
    const [embedding] = await embedder.embed([query]);

    const retrieved = await retrieveScopedChunks(db.pool, scope, {
      queryText: query,
      queryEmbedding: embedding!,
      limit: 12,
      candidates: 40,
    });

    const exactRes = await db.pool.query<{ chunk_id: string }>(
      `SELECT c.chunk_id
       FROM chunks c
       JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
         ON s.source_id = c.source_id AND s.revision = c.revision
       WHERE c.notebook_id = $1
       ORDER BY c.embedding <=> $4::vector, c.chunk_id
       LIMIT 12`,
      [scope.notebook_id, scope.sources.map(s => s.source_id), scope.sources.map(s => s.revision), toVectorLiteral(embedding!)]
    );

    const planRes = await db.pool.query<{ ['QUERY PLAN']: string }>(
      `EXPLAIN
       SELECT c.chunk_id
       FROM chunks c
       JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
         ON s.source_id = c.source_id AND s.revision = c.revision
       WHERE c.notebook_id = $1
       ORDER BY c.embedding <=> $4::vector, c.chunk_id
       LIMIT 40`,
      [scope.notebook_id, scope.sources.map(s => s.source_id), scope.sources.map(s => s.revision), toVectorLiteral(embedding!)]
    );

    const retrievedIds = retrieved.map(c => c.chunk_id);
    expect(retrievedIds).toContain(needle.chunkIds[0]);
    expect(exactRes.rows.map(r => r.chunk_id)).toContain(needle.chunkIds[0]);
    expect(planRes.rows.length).toBeGreaterThan(0);
  });
});
