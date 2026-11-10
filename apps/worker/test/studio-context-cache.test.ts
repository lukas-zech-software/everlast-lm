import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StudioContextCache } from '../src/studio/context-cache.ts';

describe('NFR-PERF-01 NFR-SEC-01/02 Studio context cache lifecycle', () => {
  const notebookId = randomUUID();
  const authFingerprint = 'a'.repeat(64);
  const scopeHash = 'b'.repeat(64);
  const contentDigest = 'c'.repeat(64);
  const genParamsHash = 'd'.repeat(64);

  const baseInput = {
    notebookId,
    scopeManifestHash: scopeHash,
    effectiveAuthorizationFingerprint: authFingerprint,
    outputLanguage: 'en',
    generationParametersHash: genParamsHash,
    model: 'gemini-1.5-pro',
    modelVersion: '002',
    contentDigest,
    ttlSeconds: 300,
    providerExpiresAt:Date.now()+300000,
  };

  it('creates entry with finite positive TTL and transitions from Creating to Ready', async () => {
    const cache = new StudioContextCache();
    const entry = await cache.create({
      ...baseInput,
      providerHandle: 'cache-handle-123',
    });

    expect(entry.status).toBe('Ready');
    expect(entry.ttl_seconds).toBe(300);
    expect(entry.expires_at).toBeGreaterThan(entry.created_at);

    const hit = cache.get(entry.cache_key, {
      effectiveAuthorizationFingerprint: authFingerprint,
    });
    expect(hit).toBeDefined();
    expect(hit?.provider_handle).toBe('cache-handle-123');
  });

  it('rejects invalid, nonpositive or non-finite TTL', async () => {
    const cache = new StudioContextCache();
    await expect(
      cache.create({
        ...baseInput,
        providerHandle: 'handle',
        ttlSeconds: -10,
      })
    ).rejects.toThrow();

    await expect(
      cache.create({
        ...baseInput,
        providerHandle: 'handle',
        ttlSeconds: Infinity,
      })
    ).rejects.toThrow();
  });

  it('requires reauthorization on every get and rejects changed ACL fingerprint', async () => {
    const cache = new StudioContextCache();
    const entry = await cache.create({
      ...baseInput,
      providerHandle: 'handle-456',
    });

    // Mismatched authorization fingerprint immediately invalidates eligibility
    const hit = cache.get(entry.cache_key, {
      effectiveAuthorizationFingerprint: 'f'.repeat(64),
    });
    expect(hit).toBeNull();
  });

  it('expires entries past expires_at and treats restart as cache miss without orphan reattachment', async () => {
    const cache = new StudioContextCache();
    const entry = await cache.create({
      ...baseInput,
      providerHandle: 'handle-expire',
      providerExpiresAt:Date.now()+1,
      ttlSeconds: 0.001, // 1 ms
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(
      cache.get(entry.cache_key, {
        effectiveAuthorizationFingerprint: authFingerprint,
      })
    ).toBeNull();

    // Fresh process-local instance starts empty (restart = cache miss)
    const restartedCache = new StudioContextCache();
    expect(
      restartedCache.get(entry.cache_key, {
        effectiveAuthorizationFingerprint: authFingerprint,
      })
    ).toBeNull();
  });

  it('invalidates cache entry immediately and cleans up provider handle idempotently', async () => {
    let deletedHandle: string | null = null;
    const cache = new StudioContextCache({
      cleanupProvider: async (h) => {
        deletedHandle = h;
      },
    });

    const entry = await cache.create({
      ...baseInput,
      providerHandle: 'handle-to-delete',
    });

    await cache.invalidate(entry.cache_key);
    expect(deletedHandle).toBe('handle-to-delete');

    // Ineligible after invalidation
    expect(
      cache.get(entry.cache_key, {
        effectiveAuthorizationFingerprint: authFingerprint,
      })
    ).toBeNull();

    // Idempotent deletion
    await expect(cache.invalidate(entry.cache_key)).resolves.not.toThrow();
  });
});

it('NFR-PERF-01 rejects missing provider-confirmed expiry rather than inventing it from requested TTL',async()=>{
 const cache=new StudioContextCache();
 await expect(cache.create({notebookId:crypto.randomUUID(),scopeManifestHash:'a'.repeat(64),effectiveAuthorizationFingerprint:'b'.repeat(64),outputLanguage:'en',generationParametersHash:'c'.repeat(64),model:'m',modelVersion:'1',contentDigest:'d'.repeat(64),providerHandle:'h',ttlSeconds:60})).rejects.toThrow(/provider.*expiry/i);
});
