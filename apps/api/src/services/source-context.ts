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
}
