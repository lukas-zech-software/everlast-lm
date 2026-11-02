import { createHash } from 'node:crypto';
import { ContextCacheEntrySchema, type ContextCacheEntry } from '@everlast/contracts';

export interface CreateCacheOptions {
  notebookId: string;
  scopeManifestHash: string;
  effectiveAuthorizationFingerprint: string;
  outputLanguage: string;
  generationParametersHash: string;
  model: string;
  modelVersion: string;
  contentDigest: string;
  providerHandle: string;
  ttlSeconds: number;
  now?: number;
}

export interface CacheAuthCheck {
  effectiveAuthorizationFingerprint: string;
}

export class StudioContextCache {
  private readonly entries = new Map<string, ContextCacheEntry>();
  private readonly cleanupProvider?: ((handle: string) => Promise<void>) | undefined;

  constructor(options?: { cleanupProvider?: ((handle: string) => Promise<void>) | undefined }) {
    this.cleanupProvider = options?.cleanupProvider;
  }

  static computeCacheKey(input: {
    notebookId: string;
    scopeManifestHash: string;
    effectiveAuthorizationFingerprint: string;
    outputLanguage: string;
    model: string;
    modelVersion: string;
    generationParametersHash: string;
    contentDigest: string;
  }): string {
    const raw = `${input.notebookId}:${input.scopeManifestHash}:${input.effectiveAuthorizationFingerprint}:${input.outputLanguage}:${input.model}:${input.modelVersion}:${input.generationParametersHash}:${input.contentDigest}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  async create(options: CreateCacheOptions): Promise<ContextCacheEntry> {
    if (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) {
      throw new Error('Finite positive ttlSeconds required');
    }

    const created_at = options.now ?? Date.now();
    const expires_at = created_at + options.ttlSeconds * 1000;
    const cache_key = StudioContextCache.computeCacheKey(options);

    const entry = ContextCacheEntrySchema.parse({
      provider_handle: options.providerHandle,
      cache_key,
      notebook_id: options.notebookId,
      scope_manifest_hash: options.scopeManifestHash,
      effective_authorization_fingerprint: options.effectiveAuthorizationFingerprint,
      output_language: options.outputLanguage,
      generation_parameters_hash: options.generationParametersHash,
      model: options.model,
      model_version: options.modelVersion,
      content_digest: options.contentDigest,
      created_at,
      expires_at,
      ttl_seconds: options.ttlSeconds,
      status: 'Ready',
    });

    this.entries.set(cache_key, entry);
    return entry;
  }

  get(cacheKey: string, auth: CacheAuthCheck, now = Date.now()): ContextCacheEntry | null {
    const entry = this.entries.get(cacheKey);
    if (!entry) return null;

    if (entry.status !== 'Ready') return null;

    if (now >= entry.expires_at) {
      this.entries.set(cacheKey, { ...entry, status: 'Expired' });
      return null;
    }

    if (auth.effectiveAuthorizationFingerprint !== entry.effective_authorization_fingerprint) {
      this.entries.set(cacheKey, { ...entry, status: 'Invalidated' });
      return null;
    }

    return entry;
  }

  async invalidate(cacheKey: string): Promise<void> {
    const entry = this.entries.get(cacheKey);
    if (!entry) return;

    this.entries.set(cacheKey, { ...entry, status: 'Invalidated' });
    try {
      await this.cleanupProvider?.(entry.provider_handle);
    } catch {
      // Best-effort provider cleanup
    }
  }

  sweepExpired(now = Date.now()): number {
    let swept = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.expires_at || entry.status === 'Expired' || entry.status === 'Invalidated') {
        this.entries.delete(key);
        swept++;
      }
    }
    return swept;
  }
}
