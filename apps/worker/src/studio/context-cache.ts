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
  providerExpiresAt?:number;
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
    const expires_at = options.providerExpiresAt;
    if(expires_at===undefined||!Number.isFinite(expires_at)||expires_at<=created_at)throw new Error('Finite provider-confirmed expiry required');
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

import type { ScopedCorpusManifest, UnifiedDocumentChunk } from '@everlast/contracts';
import type { CorpusTokenizer } from '@everlast/db';
export interface StudioCacheProvider{
 create(input:{chunks:AsyncIterable<UnifiedDocumentChunk[]>;model:string;ttlSeconds:number;signal:AbortSignal}):Promise<{handle:string;expiresAt:number}>;
 delete(handle:string):Promise<void>;
}
export interface StudioContextRuntime{
 tokenizer:CorpusTokenizer;provider:StudioCacheProvider;model:string;modelVersion:string;inputLimit:number;outputReserve:number;instructionTokens:number;ttlSeconds:number;
 clock?:()=>number;
 onObservation?:(observation:{source_tokens:number;mode:'CachedFullContext'|'ChunkMapReduce';cache_hit:boolean;original_chunks:number;cache_create_error?:string})=>void;
}
/** NFR-PERF-01 C-02/C-03: process-local metadata; no orphan reattachment or alternate source corpus. */
export class StudioContextSessions{
 private readonly cache:StudioContextCache;private readonly runtime:StudioContextRuntime;
 constructor(runtime:StudioContextRuntime){this.runtime=runtime;this.cache=new StudioContextCache({cleanupProvider:h=>runtime.provider.delete(h)});}
 get tokenizer(){return this.runtime.tokenizer;}
 async acquire(input:{ledger:ScopedCorpusManifest;language:string;parameters:unknown;chunks:()=>AsyncIterable<UnifiedDocumentChunk[]>;verify:()=>Promise<void>;signal:AbortSignal}){
  const {runtime:r}=this,ledger=input.ledger;
  await input.verify();
  const identity={notebookId:ledger.notebook_id,scopeManifestHash:ledger.manifest_hash,effectiveAuthorizationFingerprint:ledger.effective_authorization_fingerprint,outputLanguage:input.language,generationParametersHash:createHash('sha256').update(JSON.stringify(input.parameters)).digest('hex'),model:r.model,modelVersion:r.modelVersion,contentDigest:createHash('sha256').update(JSON.stringify(ledger.pages.map(p=>p.digest))).digest('hex')};
  // Token ledger is canonical original text, overhead accounts for every chunk marker plus all fixed instructions/reserves.
  const full=ledger.source_token_total<=1_000_000&&ledger.source_token_total+r.outputReserve+r.instructionTokens+ledger.chunks.length*64<=r.inputLimit;
  const key=StudioContextCache.computeCacheKey(identity);
  let entry=full?this.cache.get(key,{effectiveAuthorizationFingerprint:ledger.effective_authorization_fingerprint},r.clock?.()??Date.now()):null;
  const hit=!!entry;let cacheError:string|undefined;
  if(full&&!entry){
   try{
    const created=await r.provider.create({chunks:input.chunks(),model:r.model,ttlSeconds:r.ttlSeconds,signal:input.signal});
    try{
     await input.verify();
     entry=await this.cache.create({...identity,providerHandle:created.handle,ttlSeconds:r.ttlSeconds,providerExpiresAt:created.expiresAt,now:r.clock?.()??Date.now()});
    }catch(error){await r.provider.delete(created.handle).catch(()=>undefined);throw error;}
   }catch{cacheError='provider_create_or_expiry_unavailable';await input.verify();input.signal.throwIfAborted();entry=null;}
  }
  r.onObservation?.({source_tokens:ledger.source_token_total,mode:entry?'CachedFullContext':'ChunkMapReduce',cache_hit:hit,original_chunks:ledger.chunks.length,...(cacheError?{cache_create_error:cacheError}:{})});
  return {
   handle:entry?.provider_handle,
   beforeCall:async()=>{
    input.signal.throwIfAborted();
    try{await input.verify();if(entry&&!this.cache.get(key,{effectiveAuthorizationFingerprint:ledger.effective_authorization_fingerprint},r.clock?.()??Date.now()))throw new Error('Context cache expired; retry with fresh original scope');}
    catch(error){await this.cache.invalidate(key);throw error;}
   },
   invalidate:()=>this.cache.invalidate(key),
  };
 }
}
