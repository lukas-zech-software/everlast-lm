import type { Pool } from "pg";
import {
  SourceSnapshotInvalidError,
  filterScopedChunks,
  UnifiedDocumentChunkSchema,
  type ChunkLocator,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import { withTransaction, type Queryable } from "./transaction.ts";
import { captureInspectionScope, verifyScopeSnapshot, type ScopeSnapshot } from "./scope-guard.ts";
import { toVectorLiteral } from "./ingestion.ts";
import { isUuid } from "./notebooks.ts";

/**
 * C-02 ScopedContextProvider persistence adapter (FR-SI-03, FR-SI-04, NFR-EVAL-04, D1).
 *
 * Generation retrieval: hybrid pgvector (cosine) + PostgreSQL FTS, both CTEs hard-filtered on notebook_id and
 * the captured (source_id, revision) pairs, merged by Reciprocal Rank Fusion with deterministic tie order.
 * Inspection: authorized singleton read of one Ready source's canonical pages and ordered chunks.
 * Every result passes the shared defense-in-depth membership check before it leaves this module.
 */

export interface RetrievalOptions {
  queryText: string;
  queryEmbedding: number[];
  /** Chunks returned after fusion. */
  limit?: number;
  /** Candidates per ranking path before fusion. */
  candidates?: number;
}

export interface RetrievedChunk extends UnifiedDocumentChunk {
  score: number;
}

const RRF_K = 60;

const STOPWORDS = new Set(
  (
    "the a an and or of to in on for with is are was were be been by at as it its this that these those what which who whom " +
    "how why when where does do did from about into than then there their they them can could should would will shall may " +
    "der die das und oder ist sind war waren ein eine einer eines zu im in auf für mit von wie was wer wann wo warum nicht den dem des"
  ).split(" ")
);

/** Builds an OR tsquery from the question's lexemes (only letters/digits, so injection-safe). */
export function buildOrTsQuery(text: string): string | null {
  const terms = Array.from(new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t))));
  return terms.length ? terms.slice(0, 32).join(" | ") : null;
}

interface ChunkRow {
  chunk_id: string;
  source_id: string;
  revision: number;
  locator: ChunkLocator;
  token_count: number;
  text: string;
  score: number;
}

function toChunk(row: ChunkRow): UnifiedDocumentChunk {
  return UnifiedDocumentChunkSchema.parse({
    chunk_id: row.chunk_id,
    source_id: row.source_id,
    revision: row.revision,
    locator: row.locator,
    token_count: row.token_count,
    text: row.text,
  });
}

/**
 * Retrieves scoped chunks for a captured snapshot. The snapshot is re-verified inside the same transaction
 * that reads, so a deletion or revision replacement after capture fails the request instead of leaking.
 */
export async function retrieveScopedChunks(
  pool: Pool,
  snapshot: ScopeSnapshot,
  options: RetrievalOptions
): Promise<RetrievedChunk[]> {
  const limit = options.limit ?? 12;
  const candidates = options.candidates ?? 40;
  const sourceIds = snapshot.sources.map((p) => p.source_id);
  const revisions = snapshot.sources.map((p) => p.revision);
  const tsquery = buildOrTsQuery(options.queryText);

  const rows = await withTransaction(pool, async (tx) => {
    await verifyScopeSnapshot(tx, snapshot);
    await tx.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    await tx.query("SET LOCAL hnsw.ef_search = 100");
    const result = await tx.query<ChunkRow>(
      `WITH scope AS (
         SELECT * FROM unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
       ),
       vec AS (
         SELECT c.chunk_id, row_number() OVER (ORDER BY c.embedding <=> $4::vector, c.chunk_id) AS rank
         FROM chunks c JOIN scope s ON s.source_id = c.source_id AND s.revision = c.revision
         WHERE c.notebook_id = $1
         ORDER BY c.embedding <=> $4::vector, c.chunk_id
         LIMIT $5
       ),
       fts AS (
         SELECT c.chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, q) DESC, c.chunk_id) AS rank
         FROM chunks c JOIN scope s ON s.source_id = c.source_id AND s.revision = c.revision,
              to_tsquery('simple', $6) AS q
         WHERE c.notebook_id = $1 AND $6 IS NOT NULL AND c.tsv @@ q
         ORDER BY ts_rank_cd(c.tsv, q) DESC, c.chunk_id
         LIMIT $5
       ),
       fused AS (
         SELECT chunk_id, sum(1.0 / ($7 + rank)) AS score
         FROM (SELECT * FROM vec UNION ALL SELECT * FROM fts) ranked
         GROUP BY chunk_id
       )
       SELECT c.chunk_id, c.source_id, c.revision, c.locator, c.token_count, c.text, f.score::float8 AS score
       FROM fused f JOIN chunks c ON c.chunk_id = f.chunk_id
       WHERE c.notebook_id = $1
       ORDER BY f.score DESC, c.chunk_id
       LIMIT $8`,
      [snapshot.notebook_id, sourceIds, revisions, toVectorLiteral(options.queryEmbedding), candidates, tsquery, RRF_K, limit]
    );
    return result.rows;
  });

  const chunks = rows.map(toChunk);
  filterScopedChunks(snapshot.sources, chunks);
  return chunks.map((chunk, i) => ({ ...chunk, score: rows[i]!.score }));
}

/** Loads specific chunks of a snapshot by ID (citation hydration); foreign IDs are simply not returned. */
export async function getSnapshotChunksByIds(
  db: Queryable,
  snapshot: ScopeSnapshot,
  chunkIds: string[]
): Promise<UnifiedDocumentChunk[]> {
  const ids = chunkIds.filter(isUuid);
  if (ids.length === 0) return [];
  const result = await db.query<ChunkRow>(
    `SELECT c.chunk_id, c.source_id, c.revision, c.locator, c.token_count, c.text, 0::float8 AS score
     FROM chunks c JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
       ON s.source_id = c.source_id AND s.revision = c.revision
     WHERE c.notebook_id = $1 AND c.chunk_id = ANY($4::uuid[])`,
    [snapshot.notebook_id, snapshot.sources.map((p) => p.source_id), snapshot.sources.map((p) => p.revision), ids]
  );
  return filterScopedChunks(snapshot.sources, result.rows.map(toChunk));
}

/**
 * Loads every chunk of a captured snapshot in reading order (whole-source generation such as Source Guides and
 * Studio reports, D12). Hard-filtered on notebook and (source_id, revision) like retrieval; `limit` bounds work.
 */
export async function listSnapshotChunks(db: Queryable, snapshot: ScopeSnapshot, limit = 2000): Promise<UnifiedDocumentChunk[]> {
  if (snapshot.sources.length === 0) return [];
  const result = await db.query<ChunkRow>(
    `SELECT c.chunk_id, c.source_id, c.revision, c.locator, c.token_count, c.text, 0::float8 AS score
     FROM chunks c JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
       ON s.source_id = c.source_id AND s.revision = c.revision
     WHERE c.notebook_id = $1
     ORDER BY c.source_id, c.sequence
     LIMIT $4`,
    [snapshot.notebook_id, snapshot.sources.map((p) => p.source_id), snapshot.sources.map((p) => p.revision), limit]
  );
  return filterScopedChunks(snapshot.sources, result.rows.map(toChunk));
}

export interface InspectorPage {
  page_number: number;
  physical_page?: number;
  text: string;
}

export interface InspectorContent {
  source: { id: string; title: string; media_type: string; revision: number; page_count: number };
  pages: InspectorPage[];
  chunks: UnifiedDocumentChunk[];
  highlight: { chunk_id: string; page_number: number; start_offset: number; end_offset: number } | null;
  next_cursor: string | null;
}

/**
 * Authorized singleton inspection read (FR-SI-04, C-02). Pages are returned in bounded batches; the cursor
 * binds the immutable revision so pagination never mixes revisions. A highlight chunk that does not belong
 * to this source revision is ignored and never resolved.
 */
export async function readSourceForInspection(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  sourceId: string,
  options: { highlightChunkId?: string | undefined; cursor?: string | undefined; maxChars?: number } = {}
): Promise<InspectorContent> {
  const maxChars = options.maxChars ?? 1_500_000;
  return withTransaction(pool, async (tx) => {
    const snapshot = await captureInspectionScope(tx, ownerId, notebookId, sourceId);
    const revision = snapshot.sources[0]!.revision;

    let fromPage = 1;
    if (options.cursor) {
      const m = /^r(\d+)p(\d+)$/.exec(options.cursor);
      if (!m || Number(m[1]) !== revision) throw new SourceSnapshotInvalidError("Source revision changed; reopen the source");
      fromPage = Number(m[2]);
    }

    const meta = await tx.query<{ title: string; media_type: string; page_count: number | null }>(
      `SELECT s.title, s.media_type, r.page_count FROM sources s
       JOIN source_revisions r ON r.notebook_id = s.notebook_id AND r.source_id = s.id AND r.revision = $3
       WHERE s.notebook_id = $1 AND s.id = $2`,
      [notebookId, sourceId, revision]
    );

    let highlight: InspectorContent["highlight"] = null;
    if (options.highlightChunkId && isUuid(options.highlightChunkId)) {
      const h = await tx.query<{ chunk_id: string; locator: { page_number: number; start_offset: number; end_offset: number } }>(
        "SELECT chunk_id, locator FROM chunks WHERE notebook_id = $1 AND source_id = $2 AND revision = $3 AND chunk_id = $4",
        [notebookId, sourceId, revision, options.highlightChunkId]
      );
      if (h.rows[0]) {
        const loc = h.rows[0].locator;
        highlight = { chunk_id: h.rows[0].chunk_id, page_number: loc.page_number, start_offset: loc.start_offset, end_offset: loc.end_offset };
        if (!options.cursor) fromPage = 1;
      }
    }

    const pageRows = await tx.query<{ page_number: number; physical_page: number | null; text: string }>(
      `SELECT page_number, physical_page, text FROM source_pages
       WHERE notebook_id = $1 AND source_id = $2 AND revision = $3 AND page_number >= $4
       ORDER BY page_number`,
      [notebookId, sourceId, revision, fromPage]
    );
    const pages: InspectorPage[] = [];
    let chars = 0;
    let nextCursor: string | null = null;
    for (const row of pageRows.rows) {
      const mustInclude = highlight && row.page_number <= highlight.page_number;
      if (pages.length > 0 && chars + row.text.length > maxChars && !mustInclude) {
        nextCursor = `r${revision}p${row.page_number}`;
        break;
      }
      pages.push({ page_number: row.page_number, ...(row.physical_page ? { physical_page: row.physical_page } : {}), text: row.text });
      chars += row.text.length;
    }
    const lastPage = pages.at(-1)?.page_number ?? fromPage;
    const chunkRows = await tx.query<ChunkRow>(
      `SELECT chunk_id, source_id, revision, locator, token_count, text, 0::float8 AS score FROM chunks
       WHERE notebook_id = $1 AND source_id = $2 AND revision = $3
         AND (locator->>'page_number')::int BETWEEN $4 AND $5
       ORDER BY sequence`,
      [notebookId, sourceId, revision, fromPage, lastPage]
    );
    const chunks = filterScopedChunks(snapshot.sources, chunkRows.rows.map(toChunk));
    return {
      source: {
        id: sourceId,
        title: meta.rows[0]?.title ?? "",
        media_type: meta.rows[0]?.media_type ?? "",
        revision,
        page_count: meta.rows[0]?.page_count ?? pages.length,
      },
      pages,
      chunks,
      highlight,
      next_cursor: nextCursor,
    };
  });
}
