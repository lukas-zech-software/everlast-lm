import { z } from "zod";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { getChunksForInspector, type PoolClient } from "@everlast/db";


const RouteParamsSchema = z.object({
  notebookId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

const QueryParamsSchema = z.object({
  chunk_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
});

export interface SourceContentResponse {
  status: number;
  body: {
    source_id?: string;
    chunks?: UnifiedDocumentChunk[];
    highlight_chunk_id?: string | null;
    error?: string;
  };
}

/**
 * GET /api/notebooks/{id}/sources/{source}/content?chunk_id=...&cursor=...
 * Enforces singleton read scope without mutating active chat selection (FR-SI-04, C-02).
 */
export async function handleSourceContentRoute(
  req: {
    params: { notebookId?: string | undefined; sourceId?: string | undefined };
    query?: { chunk_id?: string | undefined; cursor?: string | undefined } | undefined;
  },
  db: PoolClient
): Promise<SourceContentResponse> {
  // 1. Validate route params
  const paramParse = RouteParamsSchema.safeParse(req.params);
  if (!paramParse.success) {
    return {
      status: 400,
      body: { error: "Invalid path parameters: notebookId and sourceId must be valid UUIDs" },
    };
  }

  // 2. Validate query params
  const queryParse = QueryParamsSchema.safeParse(req.query ?? {});
  if (!queryParse.success) {
    return {
      status: 400,
      body: { error: "Invalid query parameters: chunk_id must be a valid UUID" },
    };
  }

  const { notebookId, sourceId } = paramParse.data;
  const { chunk_id } = queryParse.data;

  // 3. Check source exists in notebook and is in Ready state
  const sourceResult = await db.query(
    `SELECT id, notebook_id, status
     FROM sources
     WHERE notebook_id = $1 AND id = $2`,
    [notebookId, sourceId]
  );

  if ((sourceResult.rowCount ?? 0) === 0 || !sourceResult.rows[0]) {
    return {
      status: 404,
      body: { error: "SourceNotFoundError: Source does not exist in notebook" },
    };
  }

  const sourceRow = sourceResult.rows[0];
  if (sourceRow.status !== "Ready") {
    return {
      status: 409,
      body: { error: "SourceNotReadyError: Source is not in Ready state" },
    };
  }

  // 4. Fetch ordered document chunks (singleton full-source read)
  const chunks = await getChunksForInspector(db, notebookId, sourceId);

  // 5. Validate highlight chunk if requested
  let highlightChunkId: string | null = null;
  if (chunk_id) {
    const chunkFound = chunks.some((c) => c.chunk_id === chunk_id);
    if (chunkFound) {
      highlightChunkId = chunk_id;
    }
  }

  return {
    status: 200,
    body: {
      source_id: sourceId,
      chunks,
      highlight_chunk_id: highlightChunkId,
    },
  };
}

/**
 * Native Node HTTP route adapter for Source Content / Inspector endpoint.
 * GET /api/notebooks/:notebookId/sources/:sourceId/content?chunk_id=...
 */
export async function handleSourceContentHttpRoute(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  db: PoolClient
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");
  const match = url.pathname.match(
    /^\/api\/notebooks\/([0-9a-f-]{36})\/sources\/([0-9a-f-]{36})\/content$/i
  );

  if (req.method === "GET" && match) {
    const notebookId = match[1];
    const sourceId = match[2];
    const chunk_id = url.searchParams.get("chunk_id") || undefined;
    const cursor = url.searchParams.get("cursor") || undefined;

    const result = await handleSourceContentRoute(
      {
        params: { notebookId, sourceId },
        query: { chunk_id, cursor },
      },
      db
    );

    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
    return true;
  }

  return false;
}
