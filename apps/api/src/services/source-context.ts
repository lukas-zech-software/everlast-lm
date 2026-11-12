import type { OperationalProbePorts, OperationalCachePort, PrivateBenchmarkRecorder } from '../observability/benchmark.ts';
import type { GroundedModel } from '../chat/model.ts';
import { verifyDraft } from '../chat/verifier.ts';
import { hasOperationalExecutionEvidence, verifyScopeSnapshot, streamSnapshotChunks } from '@everlast/db';
import type { Pool } from "@everlast/db";
import { captureScopeSnapshot, listSnapshotChunks, retrieveScopedChunks, type ScopeSnapshot, type RetrievedChunk } from "@everlast/db";
import {
  InvalidScopeError,
  type ScopedContextProvider,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import type { Embedder } from "@everlast/cloud";

/**
 * Request-bound C-02 ScopedContextProvider (C-02, FR-SI-03, NFR-EVAL-04).
 * The provider is bound to one verified principal, one immutable submission snapshot, one query and one
 * purpose. `getScopedContext(notebook_id, active_source_ids)` keeps the public two-argument signature and
 * rejects any notebook/source set that differs from the captured submission.
 */
export class RequestScopedContextProvider implements ScopedContextProvider {
  private readonly pool: Pool;
  private readonly embedder: Embedder;
  readonly snapshot: ScopeSnapshot;
  private readonly query: string;
  private readonly limit: number;
  /** Chunks returned by the last retrieval — the only citation-ID universe for this answer (FR-GC-02). */
  lastRetrieved: RetrievedChunk[] = [];

  constructor(options: { pool: Pool; embedder: Embedder; snapshot: ScopeSnapshot; query: string; limit?: number }) {
    this.pool = options.pool;
    this.embedder = options.embedder;
    this.snapshot = options.snapshot;
    this.query = options.query;
    this.limit = options.limit ?? 12;
  }

  static async capture(options: {
    pool: Pool;
    embedder: Embedder;
    ownerId: string;
    notebookId: string;
    activeSourceIds: unknown;
    query: string;
    limit?: number;
  }): Promise<RequestScopedContextProvider> {
    const snapshot = await captureScopeSnapshot(options.pool, options.ownerId, options.notebookId, options.activeSourceIds);
    return new RequestScopedContextProvider({ ...options, snapshot });
  }

  async getScopedContext(notebook_id: string, active_source_ids: string[]): Promise<UnifiedDocumentChunk[]> {
    const requested = Array.from(new Set(active_source_ids)).sort();
    const captured = this.snapshot.sources.map((p) => p.source_id);
    if (notebook_id !== this.snapshot.notebook_id || requested.join(",") !== captured.join(",")) {
      throw new InvalidScopeError("Requested scope differs from the captured submission snapshot");
    }
    const [queryEmbedding] = await this.embedder.embed([this.query], "RETRIEVAL_QUERY");
    this.lastRetrieved = await retrieveScopedChunks(this.pool, this.snapshot, {
      queryText: this.query,
      queryEmbedding: queryEmbedding!,
      limit: this.limit,
    });
    return this.lastRetrieved.map(({ score: _score, ...chunk }) => chunk);
  }

  async verifySnapshot():Promise<void>{await verifyScopeSnapshot(this.pool,this.snapshot);}
  /** C-02 / NFR-PERF-01: canonical bounded original stream, exact captured Owner/revisions and page fences. */
  async *streamOriginals():AsyncIterable<UnifiedDocumentChunk[]>{
    await this.verifySnapshot();
    for await(const page of streamSnapshotChunks(this.pool,this.snapshot,16)){await this.verifySnapshot();yield page;}
    await this.verifySnapshot();
  }

  /**
   * Complete evidence for whole-table calculations (FR-GC-08, specs/010): every chunk of the SAME captured snapshot
   * through the same hard notebook/(source_id, revision) filter, bounded by `limit`. Never a newer revision.
   */
  async readCompleteSnapshot(limit: number): Promise<UnifiedDocumentChunk[]> {
    return listSnapshotChunks(this.pool, this.snapshot, limit);
  }

  /** Makes the complete snapshot the citation universe for this answer (only chunks actually supplied). */
  useCompleteSnapshot(chunks: UnifiedDocumentChunk[]): void {
    this.lastRetrieved = chunks.map((c) => ({ ...c, score: 0 }));
  }

  /**
   * NFR-PERF-01, FR-SI-02: Reads all ready source guides within the captured snapshot.
   */
  async readScopedGuides(outputLanguage?: string): Promise<import("@everlast/contracts").SourceGuide[]> {
    const { getScopedSourceGuides } = await import("@everlast/db");
    return getScopedSourceGuides(this.pool, this.snapshot.notebook_id, this.snapshot.sources, outputLanguage);
  }
}

const OPERATIONAL_QUESTION='State one fact supported by the selected sources.';
/** Trusted adapter composition. Real calls only occur after signed workflow approval; runtime observation is read-only. */
export function createOperationalProbePorts(input:{pool:Pool;benchmark:PrivateBenchmarkRecorder;model:GroundedModel|undefined;embedder:Embedder|undefined;cache:OperationalCachePort|undefined}):OperationalProbePorts{
 const contexts=new Map<string,RequestScopedContextProvider>();
 const capture=async(actor:Parameters<OperationalProbePorts['retrieval']>[0],signal?:AbortSignal)=>{
  if(!input.embedder)throw new Error('Serving retrieval adapter unavailable');
  const provider=await RequestScopedContextProvider.capture({pool:input.pool,embedder:{model:input.embedder.model,embed:(texts,task)=>input.embedder!.embed(texts,task,{signal,maxAttempts:1})},ownerId:actor.owner_id,notebookId:actor.notebook_id,activeSourceIds:actor.sources.map(s=>s.source_id),query:OPERATIONAL_QUESTION,limit:12});
  if(JSON.stringify(provider.snapshot.sources)!==JSON.stringify(actor.sources))throw new Error('Operational scope/revision mismatch');
  return provider;
 };
 const context=(actor:Parameters<OperationalProbePorts['retrieval']>[0])=>{const provider=contexts.get(actor.notebook_id);if(!provider||provider.snapshot.owner_id!==actor.owner_id||JSON.stringify(provider.snapshot.sources)!==JSON.stringify(actor.sources))throw new Error('Actual operational retrieval observation missing');return provider;};
 return {
  runtime_observation:async(actor,signal)=>{
   signal.throwIfAborted();const identity=input.benchmark.executionIdentity();if(!identity)throw new Error('Actual managed identity unavailable');
   const provider=await capture(actor,signal);
   if(!await hasOperationalExecutionEvidence(input.pool,{...identity,...actor,observed_after:Math.max(input.benchmark.bootedAt,Date.now()-300000)}))throw new Error('Current canonical managed lifecycle/cleanup observation missing');
   await provider.verifySnapshot();if(actor.cache_sources)await capture({...actor,sources:actor.cache_sources},signal);signal.throwIfAborted();
  },
  retrieval:async(actor,signal)=>{
   signal.throwIfAborted();if(!input.embedder)throw new Error('Serving retrieval adapter unavailable');
   const provider=await capture(actor,signal);
   const chunks=await provider.getScopedContext(actor.notebook_id,actor.sources.map(s=>s.source_id));
   if(!chunks.length||Buffer.byteLength(JSON.stringify(chunks))>64000)throw new Error('Operational retrieved model envelope unavailable');
   await provider.verifySnapshot();signal.throwIfAborted();contexts.set(actor.notebook_id,provider);
  },
  model:async(actor,signal)=>{
   signal.throwIfAborted();if(!input.model)throw new Error('Serving model adapter unavailable');const provider=context(actor);
   await provider.verifySnapshot();
   const chunks=provider.lastRetrieved.map(({score:_score,...chunk})=>chunk);
   const draft=await input.model.generate({question:OPERATIONAL_QUESTION,chunks,history:[],signal,operationalProbe:true});
   if(verifyDraft(draft,chunks).kind!=='answer')throw new Error('Serving model factual/citation observation failed');
   await provider.verifySnapshot();signal.throwIfAborted();
  },
  cache:async(actor,signal)=>{
   signal.throwIfAborted();const runtime=input.cache;if(!runtime)throw new Error('Enterprise cache adapter unavailable');const provider=await capture({...actor,sources:actor.cache_sources??actor.sources},signal);
   let handle:string|undefined;
   try{
    await provider.verifySnapshot();
    // Actual original input is bounded before any provider cache is created; never truncate to fit.
    const pages:Awaited<ReturnType<RequestScopedContextProvider['getScopedContext']>>[]=[];let bytes=0;
    for await(const page of provider.streamOriginals()){signal.throwIfAborted();bytes+=Buffer.byteLength(JSON.stringify(page));if(bytes>32000000)throw new Error('Approved operational cache byte cap exceeded');pages.push(page);}
    const created=await runtime.create({pages,signal});handle=created.handle;
    if(!handle||!Number.isFinite(created.expiresAt)||created.expiresAt<=Date.now()||created.expiresAt>Date.now()+65000)throw new Error('Actual provider cache expiry observation invalid');
    signal.throwIfAborted();await provider.verifySnapshot();
   }finally{contexts.delete(actor.notebook_id);if(handle)await runtime.delete(handle);}
  },
 };
}
