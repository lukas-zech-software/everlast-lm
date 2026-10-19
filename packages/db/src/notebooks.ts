import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AppError,
  DEFAULT_NOTEBOOK_TITLE,
  MAX_NOTEBOOKS_PER_USER,
  validateNotebookTitle,
  type NotebookDto,
} from "@everlast/contracts";
import { toIso, withTransaction, type Queryable } from "./transaction.ts";
import { enqueueJob } from "./jobs.ts";

/**
 * Notebook repository (FR-WM-01, FR-WM-04, FR-WM-07).
 * Owner row lock serializes create/delete admission; every read and mutation is owner-checked in SQL.
 */

export const MAX_NOTEBOOKS_PER_OWNER = MAX_NOTEBOOKS_PER_USER;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NotebookQuotaExceededError extends AppError {
  constructor(message = `Notebook limit of ${MAX_NOTEBOOKS_PER_OWNER} reached`) {
    super("NotebookQuotaExceeded", 409, message);
    this.name = "NotebookQuotaExceededError";
  }
}

export class NotebookNotFoundError extends AppError {
  constructor(message = "Notebook no longer exists") {
    super("NotebookNotFound", 404, message);
    this.name = "NotebookNotFoundError";
  }
}

export class NotebookForbiddenError extends AppError {
  constructor(message = "Notebook is not owned by the caller") {
    super("Forbidden", 403, message);
    this.name = "NotebookForbiddenError";
  }
}

export class InvalidTitleError extends AppError {
  constructor(message: string) {
    super("InvalidTitle", 422, message);
    this.name = "InvalidTitleError";
  }
}

interface NotebookRow {
  id: string;
  owner_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export function toNotebookDto(row: NotebookRow): NotebookDto {
  return {
    id: row.id,
    title: row.title,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

/** Storage namespace for every object belonging to a notebook (raw uploads, derived files). */
export function notebookObjectPrefix(notebookId: string): string {
  return `notebooks/${notebookId}/`;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Loads a notebook and enforces ownership: absent → 404, foreign → 403 (workspace API contract).
 * `lock` takes a row lock inside the caller's transaction.
 */
export async function requireOwnedNotebook(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  lock: "none" | "share" | "update" = "none"
): Promise<NotebookRow> {
  if (!isUuid(notebookId)) throw new NotebookNotFoundError();
  const suffix = lock === "update" ? " FOR UPDATE" : lock === "share" ? " FOR SHARE" : "";
  const result = await db.query<NotebookRow>(
    `SELECT id, owner_id, title, created_at, updated_at FROM notebooks WHERE id = $1${suffix}`,
    [notebookId]
  );
  const row = result.rows[0];
  if (!row) throw new NotebookNotFoundError();
  if (row.owner_id !== ownerId) throw new NotebookForbiddenError();
  return row;
}

async function lockOwner(db: Queryable, ownerId: string): Promise<void> {
  const owner = await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [ownerId]);
  if ((owner.rowCount ?? 0) === 0) {
    throw new AppError("Unauthenticated", 401, "Unknown principal");
  }
}

export interface CreateNotebookOptions {
  idempotencyKey?: string | undefined;
}

export interface CreateNotebookResult {
  notebook: NotebookDto;
  replayed: boolean;
}

function normalizeCreateTitle(title: unknown): string {
  if (title === undefined || title === null) return DEFAULT_NOTEBOOK_TITLE;
  if (typeof title !== "string") throw new InvalidTitleError("Title must be a string");
  if (title.trim().length === 0) return DEFAULT_NOTEBOOK_TITLE;
  const validation = validateNotebookTitle(title);
  if (!validation.valid) throw new InvalidTitleError(validation.error ?? "Invalid title");
  return validation.normalized!;
}

export async function createNotebook(
  pool: Pool,
  ownerId: string,
  input: { title?: unknown },
  options: CreateNotebookOptions = {}
): Promise<CreateNotebookResult> {
  const title = normalizeCreateTitle(input.title);
  const key = options.idempotencyKey;
  if (key !== undefined && !isUuid(key)) {
    throw new AppError("ValidationFailed", 422, "Idempotency-Key must be a UUID");
  }

  return withTransaction(pool, async (tx) => {
    await lockOwner(tx, ownerId);

    if (key) {
      const prior = await tx.query<{ notebook_id: string }>(
        "SELECT notebook_id FROM notebook_create_requests WHERE owner_id = $1 AND idempotency_key = $2",
        [ownerId, key]
      );
      if (prior.rows[0]) {
        const existing = await tx.query<NotebookRow>(
          "SELECT id, owner_id, title, created_at, updated_at FROM notebooks WHERE id = $1",
          [prior.rows[0].notebook_id]
        );
        if (!existing.rows[0]) {
          // The notebook this request created was deleted; a replay must never resurrect it.
          throw new NotebookNotFoundError("The notebook created by this request no longer exists");
        }
        return { notebook: toNotebookDto(existing.rows[0]), replayed: true };
      }
    }

    const count = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM notebooks WHERE owner_id = $1",
      [ownerId]
    );
    if (count.rows[0]!.count >= MAX_NOTEBOOKS_PER_OWNER) {
      throw new NotebookQuotaExceededError();
    }

    const inserted = await tx.query<NotebookRow>(
      `INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, $3)
       RETURNING id, owner_id, title, created_at, updated_at`,
      [randomUUID(), ownerId, title]
    );
    const notebook = inserted.rows[0]!;
    if (key) {
      await tx.query(
        "INSERT INTO notebook_create_requests (owner_id, idempotency_key, notebook_id) VALUES ($1, $2, $3)",
        [ownerId, key, notebook.id]
      );
    }
    return { notebook: toNotebookDto(notebook), replayed: false };
  });
}

export async function getNotebook(db: Queryable, ownerId: string, notebookId: string): Promise<NotebookDto> {
  return toNotebookDto(await requireOwnedNotebook(db, ownerId, notebookId));
}

export async function listNotebooks(
  db: Queryable,
  ownerId: string
): Promise<{ notebooks: NotebookDto[]; notebooks_used: number; notebook_limit: number }> {
  const result = await db.query<NotebookRow>(
    `SELECT id, owner_id, title, created_at, updated_at FROM notebooks
     WHERE owner_id = $1 ORDER BY created_at DESC, id`,
    [ownerId]
  );
  return {
    notebooks: result.rows.map(toNotebookDto),
    notebooks_used: result.rows.length,
    notebook_limit: MAX_NOTEBOOKS_PER_OWNER,
  };
}

export async function renameNotebook(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  rawTitle: unknown
): Promise<NotebookDto> {
  if (typeof rawTitle !== "string") throw new InvalidTitleError("Title must be a string");
  const validation = validateNotebookTitle(rawTitle);
  if (!validation.valid) throw new InvalidTitleError(validation.error ?? "Invalid title");

  return withTransaction(pool, async (tx) => {
    await requireOwnedNotebook(tx, ownerId, notebookId, "update");
    const updated = await tx.query<NotebookRow>(
      `UPDATE notebooks SET title = $2, updated_at = greatest(clock_timestamp(), created_at)
       WHERE id = $1 RETURNING id, owner_id, title, created_at, updated_at`,
      [notebookId, validation.normalized]
    );
    return toNotebookDto(updated.rows[0]!);
  });
}

export interface DeleteNotebookResult {
  deletion_id: string;
}

/**
 * Logical deletion fence + cascade (FR-WM-01, FR-WM-04): one transaction locks owner then notebook,
 * records a payload-free cleanup operation and its outbox job, and deletes every notebook-owned row.
 * Object purge happens later in the worker; content reads 404 as soon as this commits.
 */
export async function deleteNotebook(
  pool: Pool,
  ownerId: string,
  notebookId: string
): Promise<DeleteNotebookResult> {
  return withTransaction(pool, async (tx) => {
    await lockOwner(tx, ownerId);
    await requireOwnedNotebook(tx, ownerId, notebookId, "update");

    // Pending signed-upload capabilities keep the operation non-terminal until they expire.
    const uploads = await tx.query<{ quiescent_after: Date | null }>(
      "SELECT max(upload_expires_at) AS quiescent_after FROM sources WHERE notebook_id = $1",
      [notebookId]
    );
    const quiescentAfter = uploads.rows[0]?.quiescent_after ?? null;

    const deletionId = randomUUID();
    await tx.query(
      `INSERT INTO cleanup_operations (id, notebook_id, owner_id, object_prefix, status, quiescent_after)
       VALUES ($1, $2, $3, $4, 'Pending', greatest(now(), coalesce($5::timestamptz, now())))`,
      [deletionId, notebookId, ownerId, notebookObjectPrefix(notebookId), quiescentAfter]
    );
    await enqueueJob(tx, "cleanup", { deletion_id: deletionId });
    await tx.query("DELETE FROM notebooks WHERE id = $1", [notebookId]);
    return { deletion_id: deletionId };
  });
}
