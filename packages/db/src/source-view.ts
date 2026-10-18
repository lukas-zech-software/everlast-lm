import type { PoolClient } from "pg";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { getChunksForInspector } from "./ingestion.js";

/**
 * Storage and query service for Source Inspector singleton reads (FR-SI-04, C-02).
 */

export interface SourceViewRecord {
  id: string;
  notebook_id: string;
  title: string;
  status: string;
  media_type: string;
  revision_id: number;
}

/**
 * Validates notebook ownership and status for a source being inspected.
 */
export async function getSourceForInspection(
  client: PoolClient,
  notebookId: string,
  sourceId: string
): Promise<SourceViewRecord | null> {
  const result = await client.query(
    `SELECT id, notebook_id, title, status, media_type, revision_id
     FROM sources
     WHERE notebook_id = $1 AND id = $2`,
    [notebookId, sourceId]
  );

  if (result.rowCount === 0 || !result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    notebook_id: row.notebook_id,
    title: row.title,
    status: row.status,
    media_type: row.media_type,
    revision_id: row.revision_id,
  };
}

export { getChunksForInspector };
