import type { ObjectStorage } from "@everlast/cloud";
import {
  invalidateChartsOfUnavailableSources,
  listArtifactsToPurge,
  listSandboxesToDestroy,
  markArtifactObjectDeleted,
  markSandboxDestroyed,
  markSandboxDestroyPending,
  reconcileExpiredExecutions,
  type Pool,
} from "@everlast/db";
import type { SandboxRuntime } from "./runtime.ts";

/**
 * Durable unknown-outcome reconciliation and idempotent cleanup (FR-GC-08 FR-006/FR-011, NFR-SEC-02; specs/010
 * T029/T039). Runs at API start and periodically. It NEVER executes code: expired executions are ended (an
 * attempt in flight becomes ExecutionOutcomeUnknown), remote sandboxes recorded in the ledger are deleted until the
 * deletion is confirmed, and invalidated/stale chart objects are removed from storage. A sandbox whose creation
 * was never confirmed has no handle; it is closed in the ledger and its short provider TTL (D20) is the backstop.
 */

export interface ReconcileDeps {
  pool: Pool;
  runtime: SandboxRuntime;
  storage: ObjectStorage;
  /** Sandboxes of live executions older than this are considered abandoned (default 5 min). */
  sandboxMinAgeMs?: number;
  /** Unpublished candidates of finished executions older than this are purged (default 10 min). */
  candidateAgeMs?: number;
}

export interface ReconcileReport {
  reconciled: number;
  destroyed: number;
  destroyFailed: number;
  invalidated: number;
  purged: number;
}

export async function reconcileCodeExecutions(deps: ReconcileDeps): Promise<ReconcileReport> {
  const report: ReconcileReport = { reconciled: 0, destroyed: 0, destroyFailed: 0, invalidated: 0, purged: 0 };
  report.reconciled = (await reconcileExpiredExecutions(deps.pool)).length;
  report.invalidated = await invalidateChartsOfUnavailableSources(deps.pool);
  for (const sandbox of await listSandboxesToDestroy(deps.pool, { minAgeMs: deps.sandboxMinAgeMs ?? 5 * 60_000 })) {
    if (!sandbox.provider_handle) {
      await markSandboxDestroyed(deps.pool, sandbox.attempt_id);
      continue;
    }
    try {
      await deps.runtime.destroy({ name: sandbox.provider_handle });
      await markSandboxDestroyed(deps.pool, sandbox.attempt_id);
      report.destroyed++;
    } catch {
      await markSandboxDestroyPending(deps.pool, sandbox.attempt_id, "DeleteFailed");
      report.destroyFailed++;
    }
  }
  for (const artifact of await listArtifactsToPurge(deps.pool, { candidateAgeMs: deps.candidateAgeMs ?? 10 * 60_000 })) {
    try {
      await deps.storage.deleteVersion(artifact.object_key, artifact.object_generation);
      await markArtifactObjectDeleted(deps.pool, artifact.artifact_id);
      report.purged++;
    } catch {
      // retried on the next pass
    }
  }
  return report;
}

/** Start-up pass plus a periodic sweep (unref'd timer); returns a stop function. */
export function startCodeExecutionReconciler(deps: ReconcileDeps, intervalMs = 60_000): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    reconcileCodeExecutions(deps)
      .then((r) => {
        if (r.reconciled + r.destroyed + r.destroyFailed + r.purged > 0) console.info(JSON.stringify({ severity: "INFO", message: "code execution reconcile", ...r }));
      })
      .catch((err) => console.warn(JSON.stringify({ severity: "WARNING", message: `code execution reconcile failed: ${(err as Error).message}` })))
      .finally(() => (running = false));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
