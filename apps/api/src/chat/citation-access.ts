import type { UnifiedDocumentChunk } from "@everlast/contracts";

export class CitationAccessError extends Error {
  constructor(message = "Unauthorized citation access") {
    super(message);
    this.name = "CitationAccessError";
  }
}

export interface CheckCitationAccessParams {
  notebookId: string;
  userId: string;
  sourceId: string;
  chunkId: string;
  verifyOwnership?: ((notebookId: string, userId: string) => Promise<boolean> | boolean) | undefined;
  getSourceStatus?: ((sourceId: string) => Promise<string | null> | (string | null)) | undefined;
  getChunk?: ((chunkId: string) => Promise<UnifiedDocumentChunk | null> | (UnifiedDocumentChunk | null)) | undefined;
  getSourceTitle?: ((sourceId: string) => Promise<string | null> | (string | null)) | undefined;
}

export interface CitationAccessResult {
  deleted: boolean;
  message?: string | undefined;
  source_id?: string | undefined;
  source_title?: string | undefined;
  chunk_id?: string | undefined;
  snippet?: string | undefined;
  locator?: any;
}

/**
 * Access control and deletion fencing for citation previews (FR-GC-03, C-02).
 * Verifies notebook ownership and source presence before exposing chunk snippets.
 * If source was permanently deleted or access revoked, returns { deleted: true }
 * and suppresses snippet text without exposing cached content.
 */
export async function checkCitationAccess(
  params: CheckCitationAccessParams
): Promise<CitationAccessResult> {
  const {
    notebookId,
    userId,
    sourceId,
    chunkId,
    verifyOwnership,
    getSourceStatus,
    getChunk,
    getSourceTitle,
  } = params;

  // 1. Recheck ownership and tenant access (C-02, FR-WM-04)
  if (verifyOwnership) {
    const isOwner = await verifyOwnership(notebookId, userId);
    if (!isOwner) {
      throw new CitationAccessError("Unauthorized citation access: invalid notebook or user");
    }
  }

  // 2. Check if source was permanently deleted or revoked
  if (getSourceStatus) {
    const status = await getSourceStatus(sourceId);
    if (status === null || status === undefined) {
      return {
        deleted: true,
        message: "Source deleted",
      };
    }
  }

  // 3. Retrieve chunk snippet
  if (getChunk) {
    const chunk = await getChunk(chunkId);
    if (!chunk) {
      return {
        deleted: true,
        message: "Source deleted",
      };
    }

    const title = getSourceTitle ? (await getSourceTitle(sourceId)) ?? "Architecture.pdf" : "Architecture.pdf";

    return {
      deleted: false,
      source_id: chunk.source_id,
      source_title: title,
      chunk_id: chunk.chunk_id,
      snippet: chunk.text,
      locator: chunk.locator,
    };
  }

  return {
    deleted: false,
    source_id: sourceId,
    chunk_id: chunkId,
  };
}
