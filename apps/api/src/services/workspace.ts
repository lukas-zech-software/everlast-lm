import type { Pool } from "@everlast/db";
import {
  createNotebook,
  getNotebookById,
  getNotebookRaw,
  listNotebooksByOwner,
  updateNotebookTitle,
  deleteNotebook,
  getCleanupStatus,
  getCleanupOperationRaw,
  getLatestCleanupOperationForNotebook,
  validateRequestScope,
  reserveSourceSlot,
  dismissSourceError,
  getOccupiedSourceCount,
  type CleanupOperation,
  type ScopeValidationResult,
  type AdmissionResult,
} from "@everlast/db";
import {
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  MAX_NOTEBOOKS_PER_USER,
  type Notebook,
  type CreateNotebookInput,
  type UpdateNotebookInput,
  type ScopedContextRequest,
  type SourceAdmissionAttempt,
} from "@everlast/contracts";

export interface QuotaSummary {
  notebooks_used: number;
  notebook_limit: number;
  sources_used: number;
  source_limit: number;
  max_source_bytes: number;
  max_source_words: number;
}

export class WorkspaceService {
  constructor(private pool?: Pool) {}

  async createNotebook(
    ownerId: string,
    input: CreateNotebookInput,
    options?: { idempotencyKey?: string }
  ): Promise<Notebook> {
    return createNotebook(undefined, ownerId, input, options);
  }

  async getNotebook(
    ownerId: string,
    notebookId: string
  ): Promise<{ notebook: Notebook; quota: QuotaSummary } | null> {
    const notebook = await getNotebookById(undefined, notebookId, ownerId);
    if (!notebook) {
      return null;
    }
    const quota = await this.getNotebookQuota(ownerId, notebookId);
    return { notebook, quota };
  }

  getNotebookRaw(notebookId: string): Notebook | null {
    return getNotebookRaw(notebookId);
  }

  async listNotebooks(
    ownerId: string
  ): Promise<{ notebooks: Notebook[]; notebooks_used: number; notebook_limit: number }> {
    return listNotebooksByOwner(undefined, ownerId);
  }

  async updateNotebookTitle(
    ownerId: string,
    notebookId: string,
    input: UpdateNotebookInput
  ): Promise<Notebook> {
    return updateNotebookTitle(undefined, notebookId, ownerId, input.title);
  }

  async deleteNotebook(
    ownerId: string,
    notebookId: string
  ): Promise<{ deleted: boolean; deletionId?: string }> {
    const deleted = await deleteNotebook(undefined, notebookId, ownerId);
    if (!deleted) {
      return { deleted: false };
    }
    const op = getLatestCleanupOperationForNotebook(notebookId);
    return {
      deleted: true,
      deletionId: op?.operation_id || `del-${notebookId}`,
    };
  }

  async getDeletionStatus(
    ownerId: string,
    deletionId: string
  ): Promise<CleanupOperation | null> {
    const raw = getCleanupOperationRaw(deletionId);
    if (!raw) {
      // Also allow del-<notebookId> synthetic format
      if (deletionId.startsWith("del-")) {
        return {
          id: deletionId,
          operation_id: deletionId,
          notebook_id: deletionId.replace("del-", ""),
          owner_id: ownerId,
          status: "Pending",
          created_at: new Date(),
          updated_at: new Date(),
        };
      }
      return null;
    }
    if (raw.owner_id !== ownerId) {
      const forbiddenError: any = new Error("Forbidden: cross-owner deletion status rejected");
      forbiddenError.statusCode = 403;
      throw forbiddenError;
    }
    return raw;
  }

  async getNotebookQuota(ownerId: string, notebookId: string): Promise<QuotaSummary> {
    const list = await listNotebooksByOwner(undefined, ownerId);
    const sourcesUsed = await getOccupiedSourceCount(notebookId);
    return {
      notebooks_used: list.notebooks_used,
      notebook_limit: MAX_NOTEBOOKS_PER_USER,
      sources_used: sourcesUsed,
      source_limit: DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
      max_source_bytes: MAX_SOURCE_BYTES,
      max_source_words: MAX_SOURCE_WORDS,
    };
  }

  async reserveSource(
    ownerId: string,
    notebookId: string,
    attempt: SourceAdmissionAttempt
  ): Promise<AdmissionResult> {
    const nb = await getNotebookById(this.pool, notebookId, ownerId);
    if (!nb) {
      throw new Error(`Notebook ${notebookId} not found or foreign`);
    }
    return reserveSourceSlot(this.pool, attempt);
  }

  async dismissSourceError(
    ownerId: string,
    notebookId: string,
    attemptId: string
  ): Promise<void> {
    const nb = await getNotebookById(this.pool, notebookId, ownerId);
    if (!nb) {
      throw new Error(`Notebook ${notebookId} not found or foreign`);
    }
    await dismissSourceError(this.pool, notebookId, attemptId);
  }

  async validateScope(
    ownerId: string,
    request: ScopedContextRequest
  ): Promise<ScopeValidationResult> {
    return validateRequestScope(this.pool, ownerId, request);
  }
}
