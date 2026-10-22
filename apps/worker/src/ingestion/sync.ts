import {
  claimSourceOperation,
  commitSyncReplacement,
  completeSyncUnchanged,
  failSourceOperation,
  getSourceById,
  releaseOperationLease,
  renewOperationLease,
  setOperationProgress,
  MAX_JOB_ATTEMPTS,
} from "@everlast/db";
import { IngestionFailure } from "./extract.ts";
import { normalizeSource, prepareRevision, toPublishPages, type IngestionDeps } from "./pipeline.ts";

/**
 * Re-sync executor (FR-SI-05, FR-SI-02, C-01/C-02, D15; specs/009 T041/T042).
 *
 * Runs one durable sync operation: claim (lease + new fencing token; a live lease is not stolen, a redelivered job
 * resumes the same operation), re-fetch through the same format adapter with the owner's own access, re-screen,
 * validate limits, chunk and embed — all without holding a database transaction — then publish in one short fenced
 * transaction that swaps the Ready revision with fresh UUIDv7 chunk IDs (`commitSyncReplacement`). Byte-identical
 * upstream content only records `last_synced_at`. Every failure (network, HTTP 503, access, size, parse, safety,
 * embedding) marks the operation Failed and leaves the committed revision, its chunks and its quota slot intact.
 */

export type SyncOutcome =
  | { status: "synced"; revision: number; changed: boolean }
  | { status: "failed"; code: string; message: string }
  | { status: "stale"; reason: string }
  | { status: "busy" }
  | { status: "retry"; errorCode: string };

export const SYNC_FAILED_MESSAGE = "Sync failed; the previous version is still available";

export async function processSyncJob(deps: IngestionDeps, payload: { operation_id: string }, attempt = 1): Promise<SyncOutcome> {
  const lease = deps.leaseSeconds ?? 900;
  const claim = await claimSourceOperation(deps.pool, payload.operation_id, { leaseSeconds: lease });
  if (claim.status === "busy") return { status: "busy" };
  if (claim.status !== "claimed") return { status: "stale", reason: `operation_${claim.status}` };
  const op = claim.operation;
  const token = { operationId: op.id, fencingToken: claim.fencingToken };
  if (op.kind !== "sync" || op.expected_revision === null) {
    await failSourceOperation(deps.pool, { ...token, code: "InvalidOperation", message: SYNC_FAILED_MESSAGE });
    return { status: "failed", code: "InvalidOperation", message: SYNC_FAILED_MESSAGE };
  }
  const source = await getSourceById(deps.pool, op.source_id);
  if (!source) return { status: "stale", reason: "source_deleted" };

  const fail = async (code: string, message: string): Promise<SyncOutcome> => {
    await failSourceOperation(deps.pool, { ...token, code, message });
    return { status: "failed", code, message };
  };

  try {
    if (source.status !== "Ready" || source.active_revision !== op.expected_revision) return fail("RevisionChanged", SYNC_FAILED_MESSAGE);
    const progress = async (p: "Fetching" | "Transcribing" | "Parsing" | "Syncing") => {
      await setOperationProgress(deps.pool, { ...token, progress: p });
      await renewOperationLease(deps.pool, { ...token, leaseSeconds: lease });
    };
    const normalized = await normalizeSource(deps, source, progress);
    await progress("Parsing");
    // Refreshed external content is always screened before it can replace indexed evidence (Constitution VI).
    const prepared = await prepareRevision(deps, source, { ...normalized, screen: true }, op.expected_revision + 1);
    if (normalized.mediaType && normalized.mediaType !== source.media_type) {
      return fail("MediaTypeChanged", "The linked document changed type; remove and import it again");
    }

    if (source.content_hash && prepared.contentHash === source.content_hash) {
      const unchanged = await completeSyncUnchanged(deps.pool, { ...token, sourceId: source.id, expectedRevision: op.expected_revision });
      if (!unchanged.published) return { status: "stale", reason: unchanged.reason };
      return { status: "synced", revision: unchanged.revision, changed: false };
    }

    const outcome = await commitSyncReplacement(deps.pool, {
      ...token,
      sourceId: source.id,
      expectedRevision: op.expected_revision,
      byteSize: normalized.byteSize,
      wordCount: prepared.words,
      pageCount: normalized.doc.pageCount,
      embeddingModel: deps.embedder.model,
      contentHash: prepared.contentHash,
      pages: toPublishPages(normalized.doc),
      chunks: prepared.chunks,
      manifest: prepared.manifest,
      canonicalUrl: normalized.canonicalUrl,
    });
    if (!outcome.published) {
      if (outcome.reason === "revision_changed" || outcome.reason === "not_ready") return fail("RevisionChanged", SYNC_FAILED_MESSAGE);
      return { status: "stale", reason: outcome.reason };
    }
    return { status: "synced", revision: outcome.revision, changed: true };
  } catch (err) {
    if (err instanceof IngestionFailure) return fail(err.code, err.message);
    const name = (err as Error).name;
    if (attempt >= MAX_JOB_ATTEMPTS || name === "AdapterUnavailableError") return fail(name === "AdapterUnavailableError" ? "AdapterUnavailable" : "SyncFailed", SYNC_FAILED_MESSAGE);
    console.error(JSON.stringify({ severity: "WARNING", operation_id: op.id, error: name }));
    await releaseOperationLease(deps.pool, token);
    return { status: "retry", errorCode: "SyncFailed" };
  }
}
