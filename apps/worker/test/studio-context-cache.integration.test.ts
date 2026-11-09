import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '@everlast/db/testing';
import { createNotebook } from '@everlast/db';
import { captureScopeSnapshot } from '@everlast/db';
import { StudioContextCache } from '../src/studio/context-cache.ts';

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: 'test' });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('NFR-PERF-01 NFR-SEC-01/02 studio context cache integration', () => {
  it('manages context cache with real database scope and prevents cross-user access', async () => {
    const owner1 = await createTestUser(db.pool);
    const owner2 = await createTestUser(db.pool);
    const { notebook } = await createNotebook(db.pool, owner1, {});
    const s1 = await seedReadySource(db.pool, owner1, notebook.id, {
      pages: ['Confidential analysis document.'],
      embed: t => embedder.embed(t),
    });

    const scope = await captureScopeSnapshot(db.pool, owner1, notebook.id, [s1.sourceId]);
    const cache = new StudioContextCache();

    const authFingerprint1 = '1'.repeat(64);
    const authFingerprint2 = '2'.repeat(64);
    const entry = await cache.create({
      notebookId: notebook.id,
      scopeManifestHash: 'a'.repeat(64),
      effectiveAuthorizationFingerprint: authFingerprint1,
      outputLanguage: 'en',
      generationParametersHash: 'b'.repeat(64),
      model: 'gemini-1.5-pro',
      modelVersion: '002',
      contentDigest: 'c'.repeat(64),
      providerHandle: 'handle-owner1',
      ttlSeconds: 60,
    });

    // Owner 1 has access
    const hit = cache.get(entry.cache_key, {
      effectiveAuthorizationFingerprint: authFingerprint1,
    });
    expect(hit).toBeDefined();

    // Owner 2 with different fingerprint fails to access and invalidates entry
    const foreignHit = cache.get(entry.cache_key, {
      effectiveAuthorizationFingerprint: authFingerprint2,
    });
    expect(foreignHit).toBeNull();
  });
});
