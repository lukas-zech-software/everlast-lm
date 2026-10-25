import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError, DELEGATED_ACCESS_DENIED_MESSAGE, MAX_SOURCE_BYTES, MAX_SOURCE_WORDS, UnifiedDocumentChunkSchema, type UnifiedDocumentChunk } from "@everlast/contracts";
import { withTransaction, type Queryable } from "./transaction.ts";
import { lockSourceForTransition, type SourceRecord } from "./quota.ts";

/**
 * Atomic Ready publication (FR-SI-01, FR-WM-07, C-01, D1, D15). Revision, canonical pages, chunks, embeddings and
 * the Ready transition commit in one transaction under the notebook→source fence. A deleted notebook,
 * replaced attempt or non-Processing source is rejected and nothing is written.
 *
 * v3 (specs/009): pages may carry article selectors or transcript intervals, chunks a database-only viewer page,
 * revisions a manifest (hash, viewer kind, media reference); a linked import also completes its fenced
 * source operation. Every publication records a durable publication event in the same transaction.
 */

export interface PublishPage {
  page_number: number;
  physical_page?: number | undefined;
  text: string;
  /** Article section selector into the sanitized viewer DOM (`dom_path` chunks). */
  dom_selector?: string | undefined;
  /** Transcript segment interval in integer milliseconds (`time_span` chunks). */
  start_ms?: number | undefined;
  end_ms?: number | undefined;
}

export interface PublishChunk {
  chunk: UnifiedDocumentChunk;
  embedding: number[];
  /** Viewer page the chunk is displayed on; defaults to the page_span page number. */
  anchorPage?: number | undefined;
}

export interface RevisionManifest {
  contentHash?: string | null | undefined;
  viewerKind?: "pages" | "article" | "transcript" | undefined;
  mediaDurationMs?: number | null | undefined;
  mediaObjectName?: string | null | undefined;
  mediaObjectGeneration?: string | null | undefined;
  player?: Record<string, unknown> | null | undefined;
  canonicalUrl?: string | null | undefined;
  upstreamVersion?: string | null | undefined;
}

export interface PublishInput {
  sourceId: string;
  attemptId: string;
  revision: number;
  byteSize: number;
  wordCount: number;
  pageCount: number;
  embeddingModel: string;
  pages: PublishPage[];
  chunks: PublishChunk[];
  manifest?: RevisionManifest | undefined;
  /** Linked imports: the fenced operation that must still own the source (FR-SI-05). */
  operation?: { id: string; fencingToken: number } | undefined;
  /** System default title from the fetched document (page `<title>`, Drive file name). */
  title?: string | undefined;
}

export type PublishOutcome =
  | { published: true; revision: number }
  | { published: false; reason: "fenced" | "attempt_mismatch" | "not_processing" | "revision_changed" | "stale_token" };

const CHUNK_BATCH = 200;

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(7) : "0")).join(",")}]`;
}

/** Shared validation of a complete staged revision (inclusive limits, C-01 schema, provenance). */
export function validateRevisionContent(input: { sourceId: string; revision: number; byteSize: number; wordCount: number; chunks: PublishChunk[] }): void {
  if (input.byteSize > MAX_SOURCE_BYTES || input.wordCount > MAX_SOURCE_WORDS) {
    throw new Error("Revision content exceeds the inclusive 200,000,000-byte / 500,000-word source limit");
  }
  if (input.chunks.length === 0) throw new Error("A published revision requires at least one chunk");
  for (const { chunk } of input.chunks) {
    UnifiedDocumentChunkSchema.parse(chunk);
    if (chunk.source_id !== input.sourceId || chunk.revision !== input.revision) {
      throw new Error("Chunk provenance does not match the published revision");
    }
  }
}

function anchorPageOf(entry: PublishChunk): number | null {
  if (entry.anchorPage !== undefined) return entry.anchorPage;
  const locator = entry.chunk.locator as { page_number?: number };
  return locator.page_number ?? null;
}

/** Inserts revision manifest, canonical pages and chunks (the caller holds the source fence). */
export async function insertRevisionContent(
  tx: Queryable,
  notebookId: string,
  input: Pick<PublishInput, "sourceId" | "revision" | "byteSize" | "wordCount" | "pageCount" | "embeddingModel" | "pages" | "chunks" | "manifest">
): Promise<void> {
  const m = input.manifest ?? {};
  await tx.query(
    `INSERT INTO source_revisions (notebook_id, source_id, revision, byte_size, word_count, page_count, embedding_model,
       content_hash, viewer_kind, media_duration_ms, media_object_name, media_object_generation, player, canonical_url, upstream_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      notebookId,
      input.sourceId,
      input.revision,
      input.byteSize,
      input.wordCount,
      input.pageCount,
      input.embeddingModel,
      m.contentHash ?? null,
      m.viewerKind ?? null,
      m.mediaDurationMs ?? null,
      m.mediaObjectName ?? null,
      m.mediaObjectGeneration ?? null,
      m.player ? JSON.stringify(m.player) : null,
      m.canonicalUrl ?? null,
      m.upstreamVersion ?? null,
    ]
  );
  for (const page of input.pages) {
    await tx.query(
      `INSERT INTO source_pages (notebook_id, source_id, revision, page_number, physical_page, text, dom_selector, start_ms, end_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [notebookId, input.sourceId, input.revision, page.page_number, page.physical_page ?? null, page.text, page.dom_selector ?? null, page.start_ms ?? null, page.end_ms ?? null]
    );
  }
  for (let i = 0; i < input.chunks.length; i += CHUNK_BATCH) {
    const batch = input.chunks.slice(i, i + CHUNK_BATCH);
    await tx.query(
      `INSERT INTO chunks (chunk_id, notebook_id, source_id, revision, sequence, text, token_count, locator, embedding, anchor_page)
       SELECT c.chunk_id, $1, $2, $3, c.sequence, c.text, c.token_count, c.locator, c.embedding::vector, c.anchor_page
       FROM unnest($4::uuid[], $5::int[], $6::text[], $7::int[], $8::jsonb[], $9::text[], $10::int[])
         AS c(chunk_id, sequence, text, token_count, locator, embedding, anchor_page)`,
      [
        notebookId,
        input.sourceId,
        input.revision,
        batch.map((c) => c.chunk.chunk_id),
        batch.map((_, j) => i + j),
        batch.map((c) => c.chunk.text),
        batch.map((c) => c.chunk.token_count),
        batch.map((c) => JSON.stringify(c.chunk.locator)),
        batch.map((c) => toVectorLiteral(c.embedding)),
        batch.map(anchorPageOf),
      ]
    );
  }
}

/** Durable publication event for the exact committed revision (Source Guide trigger, FR-SI-02, D16). */
export async function recordPublicationEvent(tx: Queryable, notebookId: string, sourceId: string, revision: number): Promise<void> {
  await tx.query(
    "INSERT INTO source_publication_events (id, notebook_id, source_id, revision, status) VALUES ($1, $2, $3, $4, 'Pending')",
    [randomUUID(), notebookId, sourceId, revision]
  );
}

/** System-generated default titles are shortened (never user input) so they fit the 200-code-point limit. */
export function fitDefaultTitle(title: string): string {
  const trimmed = title.replace(/\s+/g, " ").trim();
  const cps = Array.from(trimmed);
  return cps.length <= 200 ? trimmed : `${cps.slice(0, 199).join("")}…`;
}

/** FR-SI-01/05, NFR-SEC-02: serialize publication with local delegation revocation. */
export async function requirePublicationDelegation(tx: Queryable, source: SourceRecord): Promise<void> {
  if (source.link_kind !== "drive") return;
  const grant = await tx.query(
    `SELECT c.id FROM delegated_connections c JOIN notebooks n ON n.owner_id = c.user_id
      WHERE n.id = $1 AND c.id = $2 AND c.revoked_at IS NULL FOR SHARE OF c`,
    [source.notebook_id, source.delegated_connection_id]
  );
  if (grant.rowCount !== 1) throw new AppError("DelegatedAccessDenied", 403, DELEGATED_ACCESS_DENIED_MESSAGE);
}

export async function publishReadySource(pool: Pool, input: PublishInput): Promise<PublishOutcome> {
  validateRevisionContent(input);

  return withTransaction(pool, async (tx) => {
    const source = await lockSourceForTransition(tx, input.sourceId);
    if (!source) return { published: false, reason: "fenced" };
    if (source.attempt_id !== input.attemptId) return { published: false, reason: "attempt_mismatch" };
    if (source.status !== "Processing") return { published: false, reason: "not_processing" };
    if ((source.active_revision ?? 0) + 1 !== input.revision) return { published: false, reason: "revision_changed" };
    if (input.operation) {
      const op = await tx.query<{ state: string; fencing_token: string | number }>(
        "SELECT state, fencing_token FROM source_operations WHERE id = $1 AND source_id = $2 FOR UPDATE",
        [input.operation.id, input.sourceId]
      );
      const row = op.rows[0];
      if (!row) return { published: false, reason: "fenced" };
      if (row.state !== "Running" || Number(row.fencing_token) !== input.operation.fencingToken) return { published: false, reason: "stale_token" };
    }

    await requirePublicationDelegation(tx, source);
    const notebookId = source.notebook_id;
    await insertRevisionContent(tx, notebookId, input);
    const m = input.manifest ?? {};
    const title = input.title?.trim() ? fitDefaultTitle(input.title) : null;
    await tx.query(
      `UPDATE sources SET status = 'Ready', word_count = $2, actual_bytes = $3, active_revision = $4,
              failure_code = NULL, failure_message = NULL, upload_expires_at = NULL, progress = NULL,
              content_hash = coalesce($5, content_hash), canonical_url = coalesce($6, canonical_url),
              title = coalesce($7, title),
              last_synced_at = CASE WHEN link_kind IS NULL THEN last_synced_at ELSE now() END,
              updated_at = now()
       WHERE id = $1`,
      [input.sourceId, input.wordCount, input.byteSize, input.revision, m.contentHash ?? null, m.canonicalUrl ?? null, title]
    );
    if (input.operation) {
      await tx.query(
        `UPDATE source_operations SET state = 'Succeeded', progress = NULL, committed_revision = $2, lease_expires_at = NULL,
                finished_at = now(), updated_at = now() WHERE id = $1`,
        [input.operation.id, input.revision]
      );
    }
    await recordPublicationEvent(tx, notebookId, input.sourceId, input.revision);
    return { published: true, revision: input.revision };
  });
}
