import type { Pool } from "pg";
import { MAX_SOURCE_BYTES, MAX_SOURCE_WORDS, UnifiedDocumentChunkSchema, type UnifiedDocumentChunk } from "@everlast/contracts";
import { withTransaction } from "./transaction.ts";
import { lockSourceForTransition } from "./quota.ts";

/**
 * Atomic Ready publication (FR-SI-01, FR-WM-07, C-01, D1). Revision, canonical pages, chunks, embeddings and
 * the Ready transition commit in one transaction under the notebook→source fence. A deleted notebook,
 * replaced attempt or non-Processing source is rejected and nothing is written.
 */

export interface PublishPage {
  page_number: number;
  physical_page?: number | undefined;
  text: string;
}

export interface PublishChunk {
  chunk: UnifiedDocumentChunk;
  embedding: number[];
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
}

export type PublishOutcome =
  | { published: true; revision: number }
  | { published: false; reason: "fenced" | "attempt_mismatch" | "not_processing" | "revision_changed" };

const CHUNK_BATCH = 200;

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(7) : "0")).join(",")}]`;
}

export async function publishReadySource(pool: Pool, input: PublishInput): Promise<PublishOutcome> {
  if (input.byteSize > MAX_SOURCE_BYTES || input.wordCount > MAX_SOURCE_WORDS) {
    throw new Error("publishReadySource called with over-limit content");
  }
  if (input.chunks.length === 0) throw new Error("publishReadySource requires at least one chunk");
  for (const { chunk } of input.chunks) {
    UnifiedDocumentChunkSchema.parse(chunk);
    if (chunk.source_id !== input.sourceId || chunk.revision !== input.revision) {
      throw new Error("Chunk provenance does not match the published revision");
    }
  }

  return withTransaction(pool, async (tx) => {
    const source = await lockSourceForTransition(tx, input.sourceId);
    if (!source) return { published: false, reason: "fenced" };
    if (source.attempt_id !== input.attemptId) return { published: false, reason: "attempt_mismatch" };
    if (source.status !== "Processing") return { published: false, reason: "not_processing" };
    if ((source.active_revision ?? 0) + 1 !== input.revision) return { published: false, reason: "revision_changed" };

    const notebookId = source.notebook_id;
    await tx.query(
      `INSERT INTO source_revisions (notebook_id, source_id, revision, byte_size, word_count, page_count, embedding_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [notebookId, input.sourceId, input.revision, input.byteSize, input.wordCount, input.pageCount, input.embeddingModel]
    );
    for (const page of input.pages) {
      await tx.query(
        `INSERT INTO source_pages (notebook_id, source_id, revision, page_number, physical_page, text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [notebookId, input.sourceId, input.revision, page.page_number, page.physical_page ?? null, page.text]
      );
    }
    for (let i = 0; i < input.chunks.length; i += CHUNK_BATCH) {
      const batch = input.chunks.slice(i, i + CHUNK_BATCH);
      await tx.query(
        `INSERT INTO chunks (chunk_id, notebook_id, source_id, revision, sequence, text, token_count, locator, embedding)
         SELECT c.chunk_id, $1, $2, $3, c.sequence, c.text, c.token_count, c.locator, c.embedding::vector
         FROM unnest($4::uuid[], $5::int[], $6::text[], $7::int[], $8::jsonb[], $9::text[])
           AS c(chunk_id, sequence, text, token_count, locator, embedding)`,
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
        ]
      );
    }
    await tx.query(
      `UPDATE sources SET status = 'Ready', word_count = $2, actual_bytes = $3, active_revision = $4,
              failure_code = NULL, failure_message = NULL, upload_expires_at = NULL, updated_at = now()
       WHERE id = $1`,
      [input.sourceId, input.wordCount, input.byteSize, input.revision]
    );
    return { published: true, revision: input.revision };
  });
}
