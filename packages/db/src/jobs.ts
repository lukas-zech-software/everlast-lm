import { randomUUID } from "node:crypto";
import type { Queryable } from "./transaction.ts";

/**
 * Durable job outbox (FR-WM-01, FR-SI-01). Jobs commit atomically with the state change that needs them,
 * so a crash between commit and dispatch is recovered by the next drain. Payloads carry identifiers only.
 */

/** `sync` (specs/009): re-sync operations ride the same outbox; the payload carries the operation ID only. */
export type JobKind = "ingest" | "cleanup" | "sync";

export interface JobRecord {
  id: string;
  kind: JobKind;
  payload: Record<string, string>;
  attempts: number;
}

export const MAX_JOB_ATTEMPTS = 8;

export async function enqueueJob(
  db: Queryable,
  kind: JobKind,
  payload: Record<string, string>,
  options: { delaySeconds?: number } = {}
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO jobs (id, kind, payload, status, next_attempt_at)
     VALUES ($1, $2, $3, 'Pending', now() + make_interval(secs => $4))`,
    [id, kind, JSON.stringify(payload), options.delaySeconds ?? 0]
  );
  return id;
}

/**
 * Claims due jobs with SKIP LOCKED so concurrent drains never double-process. Jobs left `Running` by a
 * crashed worker become due again after `staleAfterSeconds`.
 */
export async function claimDueJobs(
  db: Queryable,
  kinds: JobKind[],
  limit = 10,
  staleAfterSeconds = 300
): Promise<JobRecord[]> {
  const result = await db.query<JobRecord>(
    `UPDATE jobs SET status = 'Running', attempts = attempts + 1, updated_at = now(),
            next_attempt_at = now() + make_interval(secs => $3)
     WHERE id IN (
       SELECT id FROM jobs
       WHERE kind = ANY($1::text[])
         AND status IN ('Pending', 'Running')
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED)
     RETURNING id, kind, payload, attempts`,
    [kinds, limit, staleAfterSeconds]
  );
  return result.rows;
}

export async function completeJob(db: Queryable, jobId: string): Promise<void> {
  await db.query("UPDATE jobs SET status = 'Done', updated_at = now() WHERE id = $1", [jobId]);
}

/** Records a retryable failure with exponential backoff; gives up (Dead, operator-visible) after the cap. */
export async function failJob(db: Queryable, jobId: string, errorCode: string, retryable = true): Promise<void> {
  await db.query(
    `UPDATE jobs SET
       status = CASE WHEN $3::boolean AND attempts < $4 THEN 'Pending' ELSE 'Dead' END,
       last_error_code = $2,
       next_attempt_at = now() + make_interval(secs => least(600, power(2, attempts)::int)),
       updated_at = now()
     WHERE id = $1`,
    [jobId, errorCode, retryable, MAX_JOB_ATTEMPTS]
  );
}

/** Delays a job without counting it as a failure (e.g. waiting for upload quiescence). */
export async function deferJob(db: Queryable, jobId: string, delaySeconds: number): Promise<void> {
  await db.query(
    `UPDATE jobs SET status = 'Pending', attempts = greatest(attempts - 1, 0),
            next_attempt_at = now() + make_interval(secs => $2), updated_at = now()
     WHERE id = $1`,
    [jobId, delaySeconds]
  );
}

export async function countPendingJobs(db: Queryable, kind?: JobKind): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM jobs WHERE status IN ('Pending', 'Running')
     AND ($1::text IS NULL OR kind = $1)`,
    [kind ?? null]
  );
  return result.rows[0]!.count;
}
