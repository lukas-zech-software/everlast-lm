import type { Pool } from "@everlast/db";
import {
  getCleanupOperation,
  markCleanupPurged,
  markCleanupRetry,
  markCleanupRunning,
} from "@everlast/db";
import { RetainedObjectError, type ObjectStorage } from "@everlast/cloud";

/**
 * Idempotent notebook cleanup (FR-WM-01, FR-WM-04). Deletes every live and noncurrent generation under the
 * notebook namespace, waits until outstanding upload capabilities expire, then performs a final sweep.
 * `Purged` is recorded only after a quiescent sweep finds nothing left. Logs carry IDs and codes only.
 */

export type CleanupOutcome =
  | { status: "purged"; deleted: number }
  | { status: "deferred"; retryAfterSeconds: number; deleted: number }
  | { status: "retry"; errorCode: string; deleted: number }
  | { status: "missing" };

export interface CleanupDeps {
  pool: Pool;
  storage: ObjectStorage;
  now?: () => Date;
}

async function purgeAll(storage: ObjectStorage, prefix: string): Promise<{ deleted: number; retained: number }> {
  let deleted = 0;
  let retained = 0;
  for (const version of await storage.listVersions(prefix)) {
    if (version.retained) {
      retained++;
      continue;
    }
    try {
      await storage.deleteVersion(version.name, version.generation);
      deleted++;
    } catch (err) {
      if (err instanceof RetainedObjectError) retained++;
      else throw err;
    }
  }
  return { deleted, retained };
}

export async function processNotebookCleanup(deps: CleanupDeps, deletionId: string): Promise<CleanupOutcome> {
  const operation = await getCleanupOperation(deps.pool, deletionId);
  if (!operation) return { status: "missing" };
  if (operation.status === "Purged") return { status: "purged", deleted: 0 };

  await markCleanupRunning(deps.pool, deletionId);
  let deleted = 0;
  try {
    const first = await purgeAll(deps.storage, operation.object_prefix);
    deleted += first.deleted;
    if (first.retained > 0) {
      await markCleanupRetry(deps.pool, deletionId, "RetainedObject");
      return { status: "retry", errorCode: "RetainedObject", deleted };
    }

    const now = (deps.now ?? (() => new Date()))();
    const quiescentAt = new Date(operation.quiescent_after);
    if (now < quiescentAt) {
      // Signed upload capabilities may still land objects; stay Pending and sweep again after expiry.
      await markCleanupRetry(deps.pool, deletionId, "AwaitingUploadExpiry");
      return { status: "deferred", retryAfterSeconds: Math.ceil((quiescentAt.getTime() - now.getTime()) / 1000) + 1, deleted };
    }

    const final = await purgeAll(deps.storage, operation.object_prefix);
    deleted += final.deleted;
    const remaining = await deps.storage.listVersions(operation.object_prefix);
    if (remaining.length > 0 || final.retained > 0) {
      await markCleanupRetry(deps.pool, deletionId, "ObjectsRemaining");
      return { status: "retry", errorCode: "ObjectsRemaining", deleted };
    }
    await markCleanupPurged(deps.pool, deletionId);
    return { status: "purged", deleted };
  } catch (err) {
    const errorCode = (err as { code?: string | number }).code ? `Storage${(err as { code: string | number }).code}` : "StorageError";
    await markCleanupRetry(deps.pool, deletionId, errorCode);
    return { status: "retry", errorCode, deleted };
  }
}
