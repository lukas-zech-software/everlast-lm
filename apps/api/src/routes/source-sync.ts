import { createHash } from "node:crypto";
import { AppError, SourceSyncRequestSchema } from "@everlast/contracts";
import {
  admitLinkedImport,
  deleteSource,
  getNotebook,
  getSource,
  getSourceOperation,
  renameSource,
  requestSourceSync,
  resolveSyncChannel,
} from "@everlast/db";
import { readJson, sendJson, sendNoContent, validationError } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";
import { toSourceDto } from "./sources.ts";

/**
 * Package 3.1 source management routes (FR-SI-01 Subset B, FR-SI-05, FR-WM-07, NFR-SEC-02; specs/009):
 * linked imports (202), rename (1–200 code points), authoritative removal (204), manual re-sync (202 / 409
 * "Sync already in progress"), operation status, and the provider webhook that maps a signed channel to the same
 * sync admission. Every route is Owner-checked in PostgreSQL (403 foreign notebook, 404 absent).
 */

export function registerSourceSyncRoutes(router: Router, deps: AppDeps): void {
  const written = async (userId: string, notebookId: string) => {
    if (deps.v2) await deps.v2.notebookModified(userId, await getNotebook(deps.pool, userId, notebookId));
  };

  router.add("POST", "/api/notebooks/:id/sources/imports", async ({ req, res, user, params }) => {
    const body = await readJson(req, 16_384);
    const result = await admitLinkedImport(deps.pool, user.userId, params.id!, body, { sourceLimit: deps.config.sourceLimit });
    if (!result.replayed) {
      deps.notifyJobs();
      await written(user.userId, params.id!);
    }
    sendJson(res, 202, { source_id: result.source.id, operation_id: result.operation.operation_id, status: "Processing" });
  });

  router.add("PATCH", "/api/notebooks/:id/sources/:sourceId", async ({ req, res, user, params }) => {
    await getSource(deps.pool, user.userId, params.id!, params.sourceId!);
    const source = await renameSource(deps.pool, user.userId, params.id!, params.sourceId!, await readJson(req, 16_384));
    await written(user.userId, params.id!);
    sendJson(res, 200, { source: toSourceDto(source) });
  });

  router.add("DELETE", "/api/notebooks/:id/sources/:sourceId", async ({ res, user, params }) => {
    await deleteSource(deps.pool, user.userId, params.id!, params.sourceId!);
    deps.notifyJobs();
    await written(user.userId, params.id!);
    sendNoContent(res);
  });

  router.add("POST", "/api/notebooks/:id/sources/:sourceId/sync", async ({ req, res, user, params }) => {
    const parsed = SourceSyncRequestSchema.safeParse(await readJson(req, 16_384));
    if (!parsed.success) throw validationError("Body must be {attempt_id}");
    await getSource(deps.pool, user.userId, params.id!, params.sourceId!);
    const { operation, replayed } = await requestSourceSync(deps.pool, user.userId, params.id!, params.sourceId!, { attemptId: parsed.data.attempt_id, trigger: "manual" });
    if (!replayed) deps.notifyJobs();
    sendJson(res, 202, { operation_id: operation.operation_id, source_id: operation.source_id, committed_revision: operation.committed_revision });
  });

  router.add("GET", "/api/notebooks/:id/sources/:sourceId/operations/:operationId", async ({ res, user, params }) => {
    sendJson(res, 200, { operation: await getSourceOperation(deps.pool, user.userId, params.id!, params.sourceId!, params.operationId!) });
  });
}

/**
 * Provider push notification (Drive `changes`/`files.watch`): `X-Goog-Channel-ID` + `X-Goog-Channel-Token` must match
 * a registered channel (token compared as a hash). The mapped source goes through the same Owner-scoped sync
 * admission as a manual click; an overlap answers 409 and nothing is queued. Unknown channels get 404 without detail.
 */
export async function handleDriveWebhook(deps: AppDeps, headers: Record<string, string | string[] | undefined>): Promise<{ status: number; body?: unknown }> {
  const channelId = String(headers["x-goog-channel-id"] ?? "");
  const token = String(headers["x-goog-channel-token"] ?? "");
  const state = String(headers["x-goog-resource-state"] ?? "");
  const messageNumber = String(headers["x-goog-message-number"] ?? "");
  if (!channelId || !token) return { status: 404 };
  const mapped = await resolveSyncChannel(deps.pool, channelId, token);
  if (!mapped) return { status: 404 };
  if (state === "sync") return { status: 204 }; // channel handshake
  try {
    // A redelivered notification carries the same message number → same idempotency key → replay, not a new sync.
    const attemptId = webhookAttemptId(channelId, messageNumber);
    await requestSourceSync(deps.pool, mapped.ownerId, mapped.notebookId, mapped.sourceId, { attemptId, trigger: "webhook" });
    deps.notifyJobs();
    return { status: 202 };
  } catch (err) {
    if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
    throw err;
  }
}

/** Deterministic UUID (v8-style layout) from channel + message number for webhook idempotency. */
export function webhookAttemptId(channelId: string, messageNumber: string): string {
  const hex = createHash("sha256").update(`${channelId}:${messageNumber}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
