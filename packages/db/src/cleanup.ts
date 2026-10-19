import type { Queryable } from "./transaction.ts";
import { toIso } from "./transaction.ts";
import { AppError } from "@everlast/contracts";
import { isUuid } from "./notebooks.ts";

/**
 * Durable notebook cleanup ledger (FR-WM-01, FR-WM-04). Rows are payload-free: notebook namespace prefix,
 * status, attempts and an error code. Status is never Purged until a quiescent final sweep succeeded.
 */

export type CleanupStatus = "Pending" | "Running" | "Purged";

export interface CleanupOperation {
  id: string;
  notebook_id: string;
  owner_id: string;
  object_prefix: string;
  status: CleanupStatus;
  attempts: number;
  last_error_code: string | null;
  quiescent_after: string;
  purged_at: string | null;
}

interface CleanupRow extends Omit<CleanupOperation, "quiescent_after" | "purged_at"> {
  quiescent_after: Date;
  purged_at: Date | null;
}

const COLUMNS = "id, notebook_id, owner_id, object_prefix, status, attempts, last_error_code, quiescent_after, purged_at";

function toOperation(row: CleanupRow): CleanupOperation {
  return {
    ...row,
    quiescent_after: toIso(row.quiescent_after),
    purged_at: row.purged_at ? toIso(row.purged_at) : null,
  };
}

export class DeletionNotFoundError extends AppError {
  constructor() {
    super("DeletionNotFound", 404, "Deletion operation not found");
    this.name = "DeletionNotFoundError";
  }
}

/** Owner-only status read (403 for another owner's operation, 404 when unknown). */
export async function getCleanupStatus(
  db: Queryable,
  ownerId: string,
  deletionId: string
): Promise<{ deletion_id: string; status: CleanupStatus; last_error_code?: string }> {
  if (!isUuid(deletionId)) throw new DeletionNotFoundError();
  const result = await db.query<CleanupRow>(`SELECT ${COLUMNS} FROM cleanup_operations WHERE id = $1`, [deletionId]);
  const row = result.rows[0];
  if (!row) throw new DeletionNotFoundError();
  if (row.owner_id !== ownerId) throw new AppError("Forbidden", 403, "Deletion belongs to another owner");
  return {
    deletion_id: row.id,
    status: row.status,
    ...(row.last_error_code ? { last_error_code: row.last_error_code } : {}),
  };
}

export async function lockCleanupOperation(db: Queryable, deletionId: string): Promise<CleanupOperation | null> {
  const result = await db.query<CleanupRow>(
    `SELECT ${COLUMNS} FROM cleanup_operations WHERE id = $1 FOR UPDATE SKIP LOCKED`,
    [deletionId]
  );
  return result.rows[0] ? toOperation(result.rows[0]) : null;
}

export async function getCleanupOperation(db: Queryable, deletionId: string): Promise<CleanupOperation | null> {
  const result = await db.query<CleanupRow>(`SELECT ${COLUMNS} FROM cleanup_operations WHERE id = $1`, [deletionId]);
  return result.rows[0] ? toOperation(result.rows[0]) : null;
}

export async function markCleanupRunning(db: Queryable, deletionId: string): Promise<void> {
  await db.query(
    `UPDATE cleanup_operations SET status = 'Running', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND status <> 'Purged'`,
    [deletionId]
  );
}

export async function markCleanupRetry(db: Queryable, deletionId: string, errorCode: string): Promise<void> {
  await db.query(
    `UPDATE cleanup_operations SET status = 'Pending', last_error_code = $2, updated_at = now()
     WHERE id = $1 AND status <> 'Purged'`,
    [deletionId, errorCode]
  );
}

export async function markCleanupPurged(db: Queryable, deletionId: string): Promise<void> {
  await db.query(
    `UPDATE cleanup_operations SET status = 'Purged', last_error_code = NULL, purged_at = now(), updated_at = now()
     WHERE id = $1`,
    [deletionId]
  );
}
