import {
  EmptyScopeError,
  InvalidScopeError,
  SourceNotReadyError,
  SourceSnapshotInvalidError,
  type SourceRevisionPair,
} from "@everlast/contracts";
import type { Queryable } from "./transaction.ts";
import { isUuid, requireOwnedNotebook } from "./notebooks.ts";

export { EmptyScopeError, InvalidScopeError, SourceNotReadyError, SourceSnapshotInvalidError };

/**
 * C-02 scope guard (FR-WM-04, FR-SI-03, NFR-EVAL-04).
 * Capture validates owner + explicit Ready selection and freezes exact (source_id, revision) pairs.
 * Verify re-checks the same snapshot before reads and under the publication fence; it never recaptures.
 */

export interface ScopeSnapshot {
  notebook_id: string;
  owner_id: string;
  sources: SourceRevisionPair[];
}

interface SourceScopeRow {
  id: string;
  status: string;
  active_revision: number | null;
}

export function normalizeSourceIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0) throw new EmptyScopeError();
  const unique = Array.from(new Set(ids));
  for (const id of unique) {
    if (!isUuid(id)) throw new InvalidScopeError("active_source_ids must contain UUIDs");
  }
  return (unique as string[]).sort();
}

export async function captureScopeSnapshot(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  activeSourceIds: unknown
): Promise<ScopeSnapshot> {
  const ids = normalizeSourceIds(activeSourceIds);
  await requireOwnedNotebook(db, ownerId, notebookId);
  const rows = await db.query<SourceScopeRow>(
    "SELECT id, status, active_revision FROM sources WHERE notebook_id = $1 AND id = ANY($2::uuid[])",
    [notebookId, ids]
  );
  if (rows.rows.length !== ids.length) {
    // Unknown, foreign-notebook or foreign-owner source: reject the entire request, never filter.
    throw new InvalidScopeError("One or more selected sources do not belong to this notebook");
  }
  const pairs: SourceRevisionPair[] = [];
  for (const row of rows.rows) {
    if (row.status !== "Ready" || row.active_revision === null) {
      throw new SourceNotReadyError(`Source ${row.id} is ${row.status}`);
    }
    pairs.push({ source_id: row.id, revision: row.active_revision });
  }
  pairs.sort((a, b) => a.source_id.localeCompare(b.source_id));
  return { notebook_id: notebookId, owner_id: ownerId, sources: pairs };
}

/**
 * Re-verifies a captured snapshot. With `lock: "share"` (inside a transaction) this is the short publication
 * fence: notebook deletion (FOR UPDATE) and source mutation serialize against it.
 */
export async function verifyScopeSnapshot(
  db: Queryable,
  snapshot: ScopeSnapshot,
  options: { lock?: "none" | "share" } = {}
): Promise<void> {
  if (snapshot.sources.length === 0) throw new EmptyScopeError();
  const lock = options.lock ?? "none";
  try {
    await requireOwnedNotebook(db, snapshot.owner_id, snapshot.notebook_id, lock);
  } catch {
    throw new SourceSnapshotInvalidError("Notebook was deleted or access was revoked");
  }
  const ids = snapshot.sources.map((pair) => pair.source_id);
  const rows = await db.query<SourceScopeRow>(
    `SELECT id, status, active_revision FROM sources WHERE notebook_id = $1 AND id = ANY($2::uuid[])${
      lock === "share" ? " FOR SHARE" : ""
    }`,
    [snapshot.notebook_id, ids]
  );
  const current = new Map(rows.rows.map((row) => [row.id, row]));
  for (const pair of snapshot.sources) {
    const row = current.get(pair.source_id);
    if (!row || row.status !== "Ready" || row.active_revision !== pair.revision) {
      throw new SourceSnapshotInvalidError(`Source ${pair.source_id} revision ${pair.revision} is no longer current`);
    }
  }
}

/**
 * Authorized singleton inspector scope (FR-SI-04): one Ready source of an owned notebook. It never touches
 * the generation selection.
 */
export async function captureInspectionScope(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  sourceId: string
): Promise<ScopeSnapshot> {
  return captureScopeSnapshot(db, ownerId, notebookId, [sourceId]);
}
