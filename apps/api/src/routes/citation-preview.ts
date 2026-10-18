import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import { checkCitationAccess, CitationAccessError } from "../chat/citation-access.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";

export interface CitationPreviewRouteDependencies {
  verifyOwnership?: (notebookId: string, userId: string) => Promise<boolean> | boolean;
  getSourceStatus?: (sourceId: string) => Promise<string | null> | (string | null);
  getChunk?: (chunkId: string) => Promise<UnifiedDocumentChunk | null> | (UnifiedDocumentChunk | null);
  getSourceTitle?: (sourceId: string) => Promise<string | null> | (string | null);
}

/**
 * HTTP route handler for citation previews (FR-GC-03, C-02).
 * GET /api/notebooks/:notebookId/sources/:sourceId/chunks/:chunkId/preview
 */
export async function handleCitationPreviewRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CitationPreviewRouteDependencies,
  userId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase();

  const previewMatch = pathname.match(
    /^\/api\/notebooks\/([^/]+)\/sources\/([^/]+)\/chunks\/([^/]+)\/preview$/
  );

  if (method === "GET" && previewMatch) {
    const notebookId = previewMatch[1]!;
    const sourceId = previewMatch[2]!;
    const chunkId = previewMatch[3]!;

    try {
      const result = await checkCitationAccess({
        notebookId,
        userId,
        sourceId,
        chunkId,
        verifyOwnership: deps.verifyOwnership,
        getSourceStatus: deps.getSourceStatus,
        getChunk: deps.getChunk,
        getSourceTitle: deps.getSourceTitle,
      });

      sendJson(res, 200, result);
      return true;
    } catch (err) {
      if (err instanceof CitationAccessError) {
        sendJson(res, 403, {
          error: { code: "Forbidden", message: err.message },
        });
        return true;
      }
      sendJson(res, 500, {
        error: { code: "InternalError", message: (err as any).message },
      });
      return true;
    }
  }

  return false;
}
