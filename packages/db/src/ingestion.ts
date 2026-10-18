import type { PoolClient } from "pg";
import type { UnifiedDocumentChunk } from "@everlast/contracts";

/**
 * Ingestion Persistence and Scoped Context Retrieval Operations (FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02).
 */

export interface SaveIngestionResultInput {
  notebookId: string;
  sourceId: string;
  revision: number;
  byteSize: number;
  wordCount: number;
  chunks: UnifiedDocumentChunk[];
}

/**
 * Records an ingestion attempt into the idempotency fence table.
 * Returns true if inserted, false if already exists.
 */
export async function recordIngestionAttempt(
  client: PoolClient,
  attemptId: string,
  notebookId: string,
  sourceId: string
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO ingestion_attempts (attempt_id, notebook_id, source_id, status, created_at)
     VALUES ($1, $2, $3, 'Processing', NOW())
     ON CONFLICT (attempt_id) DO NOTHING
     RETURNING attempt_id`,
    [attemptId, notebookId, sourceId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Atomically publishes source revision and document chunks in a single transaction.
 */
export async function saveIngestionResult(
  client: PoolClient,
  input: SaveIngestionResultInput
): Promise<void> {
  const { notebookId, sourceId, revision, byteSize, wordCount, chunks } = input;

  // Insert Source Revision record
  await client.query(
    `INSERT INTO source_revisions (notebook_id, source_id, revision, byte_size, word_count, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (notebook_id, source_id, revision) DO UPDATE
     SET byte_size = EXCLUDED.byte_size, word_count = EXCLUDED.word_count`,
    [notebookId, sourceId, revision, byteSize, wordCount]
  );

  // Insert UnifiedDocumentChunk records
  for (let seq = 0; seq < chunks.length; seq++) {
    const chunk = chunks[seq];
    if (!chunk) continue;
    await client.query(
      `INSERT INTO document_chunks (chunk_id, notebook_id, source_id, revision, sequence, token_count, text, locator, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (chunk_id) DO NOTHING`,
      [
        chunk.chunk_id,
        notebookId,
        sourceId,
        revision,
        seq,
        chunk.token_count,
        chunk.text,
        JSON.stringify(chunk.locator),
      ]
    );
  }
}

/**
 * Retrieves chunks belonging strictly to active (source_id, revision) pairs for the notebook.
 * Enforces zero leakage (NFR-EVAL-04) by filtering candidates server-side.
 */
export async function getChunksByScope(
  client: PoolClient,
  notebookId: string,
  activeSourceRevisions: { sourceId: string; revision: number }[]
): Promise<UnifiedDocumentChunk[]> {
  if (activeSourceRevisions.length === 0) {
    return [];
  }

  // Construct parameterized query for (source_id, revision) pairs
  const sourceIds = activeSourceRevisions.map((r) => r.sourceId);
  const result = await client.query(
    `SELECT chunk_id, source_id, revision, token_count, text, locator
     FROM document_chunks
     WHERE notebook_id = $1 AND source_id = ANY($2::uuid[])
     ORDER BY sequence ASC`,
    [notebookId, sourceIds]
  );

  // Filter against exact revisions
  const revisionMap = new Map(activeSourceRevisions.map((r) => [r.sourceId, r.revision]));
  const chunks: UnifiedDocumentChunk[] = [];

  for (const row of result.rows) {
    const requiredRev = revisionMap.get(row.source_id);
    if (requiredRev !== undefined && row.revision === requiredRev) {
      chunks.push({
        chunk_id: row.chunk_id,
        source_id: row.source_id,
        revision: row.revision,
        token_count: row.token_count,
        text: row.text,
        locator: typeof row.locator === "string" ? JSON.parse(row.locator) : row.locator,
      });
    }
  }

  return chunks;
}

/**
 * Singleton source inspection read for a source without modifying chat scope (FR-SI-04).
 */
export async function getChunksForInspector(
  client: PoolClient,
  notebookId: string,
  sourceId: string
): Promise<UnifiedDocumentChunk[]> {
  const result = await client.query(
    `SELECT chunk_id, source_id, revision, token_count, text, locator
     FROM document_chunks
     WHERE notebook_id = $1 AND source_id = $2
     ORDER BY sequence ASC`,
    [notebookId, sourceId]
  );

  return result.rows.map((row) => ({
    chunk_id: row.chunk_id,
    source_id: row.source_id,
    revision: row.revision,
    token_count: row.token_count,
    text: row.text,
    locator: typeof row.locator === "string" ? JSON.parse(row.locator) : row.locator,
  }));
}
