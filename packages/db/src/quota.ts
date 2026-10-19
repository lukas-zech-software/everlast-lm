import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AppError,
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  MAX_NOTEBOOKS_PER_USER,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  SourceQuotaExceededError,
  SourceOversizedBytesError,
  SourceMediaTypeSchema,
  type QuotaSummary,
  type SourceMediaType,
} from "@everlast/contracts";
import { toIso, withTransaction, type Queryable } from "./transaction.ts";
import { isUuid, requireOwnedNotebook } from "./notebooks.ts";
import { enqueueJob } from "./jobs.ts";

export { SourceQuotaExceededError, SourceOversizedBytesError };

/**
 * Atomic source admission ledger (FR-WM-07, FR-SI-01).
 * Occupancy = rows in Uploading/Processing/Ready counted under the notebook row lock. Failed releases its
 * slot exactly once via a conditional transition; dismissing a Failed row never changes occupancy.
 */

export type SourceStatus = "Uploading" | "Processing" | "Ready" | "Failed";

export const OCCUPYING_STATUSES: readonly SourceStatus[] = ["Uploading", "Processing", "Ready"];

export class SourceNotFoundError extends AppError {
  constructor(message = "Source not found in this notebook") {
    super("SourceNotFound", 404, message);
    this.name = "SourceNotFoundError";
  }
}

export interface SourceRecord {
  id: string;
  notebook_id: string;
  attempt_id: string;
  title: string;
  media_type: SourceMediaType;
  status: SourceStatus;
  declared_bytes: number;
  actual_bytes: number | null;
  word_count: number | null;
  active_revision: number | null;
  object_name: string | null;
  object_generation: string | null;
  upload_expires_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCE_COLUMNS = `id, notebook_id, attempt_id, title, media_type, status, declared_bytes, actual_bytes,
  word_count, active_revision, object_name, object_generation, upload_expires_at, failure_code,
  failure_message, created_at, updated_at`;

interface SourceRow extends Omit<SourceRecord, "created_at" | "updated_at" | "upload_expires_at"> {
  created_at: Date;
  updated_at: Date;
  upload_expires_at: Date | null;
}

function toSourceRecord(row: SourceRow): SourceRecord {
  return {
    ...row,
    upload_expires_at: row.upload_expires_at ? toIso(row.upload_expires_at) : null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export interface AdmissionEntry {
  attempt_id: string;
  title: string;
  media_type: string;
  declared_bytes: number;
}

export interface AdmissionResult {
  attempt_id: string;
  admitted: boolean;
  source?: SourceRecord;
  error?: { code: string; message: string };
}

export interface ReserveOptions {
  sourceLimit?: number;
  /** Lifetime of the upload capability issued for an admitted file (null for server-side copied text). */
  uploadTtlSeconds?: number | null;
}

async function countOccupied(db: Queryable, notebookId: string): Promise<number> {
  const result = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM sources WHERE notebook_id = $1 AND status = ANY($2::text[])",
    [notebookId, OCCUPYING_STATUSES]
  );
  return result.rows[0]!.count;
}

function validateEntry(entry: AdmissionEntry): { code: string; message: string } | null {
  if (!isUuid(entry.attempt_id)) return { code: "ValidationFailed", message: "attempt_id must be a UUID" };
  if (!SourceMediaTypeSchema.safeParse(entry.media_type).success) {
    return { code: "UnsupportedMediaType", message: "Only PDF, .txt, Markdown and copied text are supported" };
  }
  if (!Number.isSafeInteger(entry.declared_bytes) || entry.declared_bytes < 0) {
    return { code: "ValidationFailed", message: "declared_bytes must be a non-negative integer" };
  }
  if (entry.declared_bytes > MAX_SOURCE_BYTES) {
    return { code: "SourceOversized", message: "Source exceeds 200,000,000 bytes limit" };
  }
  const titleLength = Array.from(entry.title.trim()).length;
  if (titleLength < 1 || titleLength > 100) {
    return { code: "InvalidTitle", message: "Source title must be 1–100 Unicode code points" };
  }
  return null;
}

/**
 * Ordered batch admission in one notebook-locked transaction: the first entries that fit receive
 * Uploading rows, the rest get a per-entry quota rejection. Replaying an attempt returns its existing row.
 */
export async function reserveSources(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  entries: AdmissionEntry[],
  options: ReserveOptions = {}
): Promise<AdmissionResult[]> {
  const sourceLimit = options.sourceLimit ?? DEFAULT_MAX_SOURCES_PER_NOTEBOOK;
  const ttl = options.uploadTtlSeconds === undefined ? 3600 : options.uploadTtlSeconds;

  return withTransaction(pool, async (tx) => {
    await requireOwnedNotebook(tx, ownerId, notebookId, "update");
    let occupied = await countOccupied(tx, notebookId);
    const results: AdmissionResult[] = [];

    for (const entry of entries) {
      const invalid = validateEntry(entry);
      if (invalid) {
        results.push({ attempt_id: entry.attempt_id, admitted: false, error: invalid });
        continue;
      }

      const prior = await tx.query<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE attempt_id = $1`, [
        entry.attempt_id,
      ]);
      if (prior.rows[0]) {
        const record = toSourceRecord(prior.rows[0]);
        if (record.notebook_id !== notebookId) {
          results.push({
            attempt_id: entry.attempt_id,
            admitted: false,
            error: { code: "InvalidScope", message: "attempt_id belongs to another notebook" },
          });
        } else {
          results.push({ attempt_id: entry.attempt_id, admitted: record.status !== "Failed", source: record });
        }
        continue;
      }

      if (occupied >= sourceLimit) {
        results.push({
          attempt_id: entry.attempt_id,
          admitted: false,
          error: { code: "SourceQuotaExceeded", message: `Source limit of ${sourceLimit} reached` },
        });
        continue;
      }

      const inserted = await tx.query<SourceRow>(
        `INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes, upload_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'Uploading', $6,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(secs => $7::int) END)
         RETURNING ${SOURCE_COLUMNS}`,
        [randomUUID(), notebookId, entry.attempt_id, entry.title.trim(), entry.media_type, entry.declared_bytes, ttl]
      );
      occupied++;
      results.push({ attempt_id: entry.attempt_id, admitted: true, source: toSourceRecord(inserted.rows[0]!) });
    }
    return results;
  });
}

/** Locks notebook (share) then source (update) for a trusted worker transition; returns null when fenced. */
export async function lockSourceForTransition(db: Queryable, sourceId: string): Promise<SourceRecord | null> {
  const parent = await db.query<{ notebook_id: string }>("SELECT notebook_id FROM sources WHERE id = $1", [sourceId]);
  if (!parent.rows[0]) return null;
  const nb = await db.query("SELECT id FROM notebooks WHERE id = $1 FOR SHARE", [parent.rows[0].notebook_id]);
  if ((nb.rowCount ?? 0) === 0) return null;
  const row = await db.query<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = $1 FOR UPDATE`, [sourceId]);
  return row.rows[0] ? toSourceRecord(row.rows[0]) : null;
}

export interface ReceiveInput {
  sourceId: string;
  attemptId: string;
  actualBytes: number;
  objectName: string;
  objectGeneration: string;
}

export type ReceiveOutcome =
  | { outcome: "processing"; source: SourceRecord; jobId: string }
  | { outcome: "failed"; source: SourceRecord }
  | { outcome: "rejected"; reason: "fenced" | "attempt_mismatch" | "not_uploading" };

/**
 * Trusted receipt (FR-WM-07): verifies the actual object size against the inclusive byte limit and moves
 * Uploading → Processing on the same slot, enqueuing ingestion atomically. Oversize fails and releases the slot.
 */
export async function acceptReceivedSource(pool: Pool, input: ReceiveInput): Promise<ReceiveOutcome> {
  return withTransaction(pool, async (tx) => {
    const source = await lockSourceForTransition(tx, input.sourceId);
    if (!source) return { outcome: "rejected", reason: "fenced" };
    if (source.attempt_id !== input.attemptId) return { outcome: "rejected", reason: "attempt_mismatch" };
    if (source.status !== "Uploading") return { outcome: "rejected", reason: "not_uploading" };

    if (!Number.isSafeInteger(input.actualBytes) || input.actualBytes < 0 || input.actualBytes > MAX_SOURCE_BYTES) {
      const failed = await tx.query<SourceRow>(
        `UPDATE sources SET status = 'Failed', actual_bytes = $2, object_name = $3, object_generation = $4,
                failure_code = 'SourceOversized', failure_message = 'Exceeds 200,000,000 bytes limit',
                updated_at = now()
         WHERE id = $1 RETURNING ${SOURCE_COLUMNS}`,
        [input.sourceId, Math.max(0, Math.trunc(input.actualBytes)), input.objectName, input.objectGeneration]
      );
      return { outcome: "failed", source: toSourceRecord(failed.rows[0]!) };
    }

    if (input.actualBytes === 0) {
      const failed = await tx.query<SourceRow>(
        `UPDATE sources SET status = 'Failed', actual_bytes = 0, object_name = $2, object_generation = $3,
                failure_code = 'EmptyFile', failure_message = 'File is empty', updated_at = now()
         WHERE id = $1 RETURNING ${SOURCE_COLUMNS}`,
        [input.sourceId, input.objectName, input.objectGeneration]
      );
      return { outcome: "failed", source: toSourceRecord(failed.rows[0]!) };
    }

    const updated = await tx.query<SourceRow>(
      `UPDATE sources SET status = 'Processing', actual_bytes = $2, object_name = $3, object_generation = $4,
              updated_at = now()
       WHERE id = $1 RETURNING ${SOURCE_COLUMNS}`,
      [input.sourceId, input.actualBytes, input.objectName, input.objectGeneration]
    );
    const jobId = await enqueueJob(tx, "ingest", { source_id: input.sourceId, attempt_id: input.attemptId });
    return { outcome: "processing", source: toSourceRecord(updated.rows[0]!), jobId };
  });
}

/**
 * Conditional failure transition: releases the slot once. A duplicate failure or a failure for a deleted,
 * Ready or already Failed attempt is a no-op and returns false.
 */
export async function failSource(
  db: Queryable,
  input: { sourceId: string; attemptId: string; code: string; message: string }
): Promise<boolean> {
  const result = await db.query(
    `UPDATE sources SET status = 'Failed', failure_code = $3, failure_message = $4, updated_at = now()
     WHERE id = $1 AND attempt_id = $2 AND status IN ('Uploading', 'Processing')`,
    [input.sourceId, input.attemptId, input.code, input.message]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Removes a Failed error row. Occupancy is unchanged because Failed never occupied a slot. */
export async function dismissSourceError(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  sourceId: string
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await requireOwnedNotebook(tx, ownerId, notebookId, "update");
    if (!isUuid(sourceId)) throw new SourceNotFoundError();
    const deleted = await tx.query("DELETE FROM sources WHERE notebook_id = $1 AND id = $2 AND status = 'Failed'", [
      notebookId,
      sourceId,
    ]);
    if ((deleted.rowCount ?? 0) > 0) return;
    const exists = await tx.query("SELECT status FROM sources WHERE notebook_id = $1 AND id = $2", [
      notebookId,
      sourceId,
    ]);
    if ((exists.rowCount ?? 0) === 0) throw new SourceNotFoundError();
    throw new AppError("ValidationFailed", 409, "Only failed sources can be dismissed");
  });
}

export async function listSources(db: Queryable, ownerId: string, notebookId: string): Promise<SourceRecord[]> {
  await requireOwnedNotebook(db, ownerId, notebookId);
  const result = await db.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM sources WHERE notebook_id = $1 ORDER BY created_at, id`,
    [notebookId]
  );
  return result.rows.map(toSourceRecord);
}

export async function getSource(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  sourceId: string
): Promise<SourceRecord> {
  await requireOwnedNotebook(db, ownerId, notebookId);
  if (!isUuid(sourceId)) throw new SourceNotFoundError();
  const result = await db.query<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE notebook_id = $1 AND id = $2`, [
    notebookId,
    sourceId,
  ]);
  if (!result.rows[0]) throw new SourceNotFoundError();
  return toSourceRecord(result.rows[0]);
}

/** Trusted (worker) read without owner context; callers must re-verify the fence before publishing. */
export async function getSourceById(db: Queryable, sourceId: string): Promise<SourceRecord | null> {
  if (!isUuid(sourceId)) return null;
  const result = await db.query<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = $1`, [sourceId]);
  return result.rows[0] ? toSourceRecord(result.rows[0]) : null;
}

export async function getQuotaSummary(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  sourceLimit: number = DEFAULT_MAX_SOURCES_PER_NOTEBOOK
): Promise<QuotaSummary> {
  await requireOwnedNotebook(db, ownerId, notebookId);
  const notebooks = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM notebooks WHERE owner_id = $1",
    [ownerId]
  );
  return {
    notebooks_used: notebooks.rows[0]!.count,
    notebook_limit: MAX_NOTEBOOKS_PER_USER,
    sources_used: await countOccupied(db, notebookId),
    source_limit: sourceLimit,
    max_source_bytes: MAX_SOURCE_BYTES,
    max_source_words: MAX_SOURCE_WORDS,
  };
}
