import type { Pool } from "pg";
import {
  SourceSnapshotInvalidError,
  filterScopedChunks,
  formatDisplayTime,
  type TranscriptSegmentView,
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

/**
 * Loads EVERY chunk of a captured snapshot in reading order (source_id, sequence) through keyset-paged queries of
 * `pageSize` rows (Constitution IV, D12: large-context Studio jobs process all original scoped chunks; callers bound
 * model work with batches). Each page is hard-filtered on notebook and (source_id, revision) and passes the shared
 * membership check. Chat, Source Guide and Note Assistant keep their bounded `listSnapshotChunks` reads.
 */
export async function* streamSnapshotChunks(db: Queryable, captured: ScopeSnapshot, pageSize = 500): AsyncGenerator<UnifiedDocumentChunk[], void, unknown> {
  // Freeze caller-owned arrays before the first read; never prefetch ahead of the consumer.
  const snapshot: ScopeSnapshot = { ...captured, sources: captured.sources.map(p => ({ ...p })) };
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new RangeError("pageSize must be 1..500");
  await verifyScopeSnapshot(db, snapshot);
  const size = Math.max(1, Math.floor(pageSize));
  let cursor: { source_id: string; sequence: number } | null = null;
  for (;;) {
    await verifyScopeSnapshot(db, snapshot);
    const result: { rows: (ChunkRow & { sequence: number })[] } = await db.query<ChunkRow & { sequence: number }>(
      `SELECT c.chunk_id, c.source_id, c.revision, c.locator, c.token_count, c.text, c.sequence, 0::float8 AS score
       FROM chunks c JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
         ON s.source_id = c.source_id AND s.revision = c.revision
       WHERE c.notebook_id = $1 AND ($4::uuid IS NULL OR (c.source_id, c.sequence) > ($4::uuid, $5::int))
       ORDER BY c.source_id, c.sequence
       LIMIT $6`,
      [
        snapshot.notebook_id,
        snapshot.sources.map((p) => p.source_id),
        snapshot.sources.map((p) => p.revision),
        cursor?.source_id ?? null,
        cursor?.sequence ?? 0,
        size,
      ]
    );
    await verifyScopeSnapshot(db, snapshot);
    const page = filterScopedChunks(snapshot.sources, result.rows.map(toChunk));
    if (page.length) yield page;
    const last = result.rows.at(-1);
    if (!last || result.rows.length < size) break;
    cursor = { source_id: last.source_id, sequence: last.sequence };
  }
  await verifyScopeSnapshot(db, snapshot);
}

/** C-02 compatibility adapter. Consumers requiring bounded memory use streamSnapshotChunks. */
export async function listAllSnapshotChunks(db: Queryable, snapshot: ScopeSnapshot, pageSize = 500): Promise<UnifiedDocumentChunk[]> {
  const chunks: UnifiedDocumentChunk[] = [];
  for await (const page of streamSnapshotChunks(db, snapshot, pageSize)) chunks.push(...page);
  return chunks;
}

export interface InspectorPage {
  page_number: number;
  physical_page?: number;
  text: string;
  /** Article section selector (web sources; specs/009). */
  dom_selector?: string;
  /** Transcript segment interval (audio/video; specs/009). */
  start_ms?: number;
  end_ms?: number;
}

export interface InspectorHighlight {
  chunk_id: string;
  page_number: number;
  start_offset?: number;
  end_offset?: number;
  /** time_span chunks: seek target and its derived `mm:ss` label (view metadata, never part of C-01). */
  start_ms?: number;
  end_ms?: number;
  display_time?: string;
  selector?: string;
}

export interface InspectorContent {
  source: {
    id: string;
    title: string;
    media_type: string;
    revision: number;
    page_count: number;
    /** v3 additive fields (specs/009). */
    viewer_kind: "pages" | "article" | "transcript";
    link_kind: string | null;
    external_url: string | null;
    canonical_url: string | null;
    last_synced_at: string | null;
    media_duration_ms: number | null;
  };
  pages: InspectorPage[];
  chunks: UnifiedDocumentChunk[];
  highlight: InspectorHighlight | null;
  next_cursor: string | null;
  /** Transcript sources: segments with derived display_time (specs/009 T030). */
  transcript?: TranscriptSegmentView[];
  /** Player descriptor stored with the revision; the API turns `audio` into an authorized proxy URL. */
  player?: { type: string; [key: string]: unknown } | null;
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

    const meta = await tx.query<{
      title: string;
      media_type: string;
      page_count: number | null;
      viewer_kind: string | null;
      media_duration_ms: number | null;
      player: { type: string } | null;
      link_kind: string | null;
      external_url: string | null;
      canonical_url: string | null;
      last_synced_at: Date | null;
    }>(
      `SELECT s.title, s.media_type, r.page_count, r.viewer_kind, r.media_duration_ms, r.player, s.link_kind, s.external_url,
              s.canonical_url, s.last_synced_at FROM sources s
       JOIN source_revisions r ON r.notebook_id = s.notebook_id AND r.source_id = s.id AND r.revision = $3
       WHERE s.notebook_id = $1 AND s.id = $2`,
      [notebookId, sourceId, revision]
    );

    let highlight: InspectorContent["highlight"] = null;
    if (options.highlightChunkId && isUuid(options.highlightChunkId)) {
      const h = await tx.query<{ chunk_id: string; anchor_page: number | null; locator: Record<string, number | string> }>(
        "SELECT chunk_id, anchor_page, locator FROM chunks WHERE notebook_id = $1 AND source_id = $2 AND revision = $3 AND chunk_id = $4",
        [notebookId, sourceId, revision, options.highlightChunkId]
      );
      if (h.rows[0]) {
        const loc = h.rows[0].locator;
        const page = h.rows[0].anchor_page ?? Number(loc.page_number);
        if ("start_ms" in loc) {
          const start = Number(loc.start_ms);
          highlight = { chunk_id: h.rows[0].chunk_id, page_number: page, start_ms: start, end_ms: Number(loc.end_ms), display_time: formatDisplayTime(start) };
        } else if ("selector" in loc) {
          highlight = { chunk_id: h.rows[0].chunk_id, page_number: page, selector: String(loc.selector), start_offset: Number(loc.start_offset), end_offset: Number(loc.end_offset) };
        } else {
          highlight = { chunk_id: h.rows[0].chunk_id, page_number: page, start_offset: Number(loc.start_offset), end_offset: Number(loc.end_offset) };
        }
        if (!options.cursor) fromPage = 1;
      }
    }

    const pageRows = await tx.query<{ page_number: number; physical_page: number | null; text: string; dom_selector: string | null; start_ms: number | null; end_ms: number | null }>(
      `SELECT page_number, physical_page, text, dom_selector, start_ms, end_ms FROM source_pages
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
      pages.push({
        page_number: row.page_number,
        ...(row.physical_page ? { physical_page: row.physical_page } : {}),
        text: row.text,
        ...(row.dom_selector ? { dom_selector: row.dom_selector } : {}),
        ...(row.start_ms !== null && row.end_ms !== null ? { start_ms: row.start_ms, end_ms: row.end_ms } : {}),
      });
      chars += row.text.length;
    }
    const lastPage = pages.at(-1)?.page_number ?? fromPage;
    const chunkRows = await tx.query<ChunkRow>(
      `SELECT chunk_id, source_id, revision, locator, token_count, text, 0::float8 AS score FROM chunks
       WHERE notebook_id = $1 AND source_id = $2 AND revision = $3
         AND coalesce(anchor_page, (locator->>'page_number')::int) BETWEEN $4 AND $5
       ORDER BY sequence`,
      [notebookId, sourceId, revision, fromPage, lastPage]
    );
    const chunks = filterScopedChunks(snapshot.sources, chunkRows.rows.map(toChunk));
    const m = meta.rows[0];
    const viewerKind = (m?.viewer_kind ?? "pages") as InspectorContent["source"]["viewer_kind"];
    return {
      source: {
        id: sourceId,
        title: m?.title ?? "",
        media_type: m?.media_type ?? "",
        revision,
        page_count: m?.page_count ?? pages.length,
        viewer_kind: viewerKind,
        link_kind: m?.link_kind ?? null,
        external_url: m?.external_url ?? null,
        canonical_url: m?.canonical_url ?? null,
        last_synced_at: m?.last_synced_at ? m.last_synced_at.toISOString() : null,
        media_duration_ms: m?.media_duration_ms ?? null,
      },
      pages,
      chunks,
      highlight,
      next_cursor: nextCursor,
      ...(viewerKind === "transcript"
        ? {
            transcript: pages
              .filter((p) => p.start_ms !== undefined && p.end_ms !== undefined)
              .map((p) => ({ page_number: p.page_number, start_ms: p.start_ms!, end_ms: p.end_ms!, display_time: formatDisplayTime(p.start_ms!), text: p.text })),
          }
        : {}),
      player: m?.player ?? null,
    };
  });
}
