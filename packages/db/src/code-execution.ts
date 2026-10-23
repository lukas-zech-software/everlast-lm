import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AppError,
  type ChartArtifactRecord,
  type CodeExecutionFailureCode,
  type CodeExecutionState,
  type CodeExecutionTrace,
  type SourceRevisionPair,
} from "@everlast/contracts";
import { toIso, withTransaction, type Queryable } from "./transaction.ts";
import type { ChatThreadRecord } from "./chat-history.ts";

/**
 * Durable code-execution records (FR-GC-08, FR-GC-06, C-02, NFR-SEC-02; specs/010 T009/T029/T036).
 * - `code_executions`: per-user/notebook admission with a lease token fence. Every write after admission must
 *   present the lease; Clear chat or reconciliation removes/ends the row, so a late controller is fenced out.
 * - `code_execution_sandboxes`: payload-free ledger of remote sandbox handles until deletion is confirmed.
 * - `chart_artifacts`: private chart objects; only `published` rows of a visible message are ever served.
 * The app pool is always passed explicitly (no process-default pool).
 */

export const EXECUTION_LEASE_MS = 60_000;

export class ExecutionInProgressError extends AppError {
  constructor(message = "A calculation is already running in this notebook. Wait for it to finish, then send again.") {
    super("ExecutionInProgress", 409, message);
    this.name = "ExecutionInProgressError";
  }
}

export class ExecutionFencedError extends AppError {
  constructor(message = "The calculation was cancelled") {
    super("GenerationCancelled", 409, message);
    this.name = "ExecutionFencedError";
  }
}

export interface AdmitCodeExecutionInput {
  thread: ChatThreadRecord;
  requestId: string;
  snapshot: SourceRevisionPair[];
  leaseMs?: number;
}

export interface AdmittedExecution {
  executionId: string;
  leaseToken: string;
}

function isUniqueViolation(err: unknown): err is { code: string; constraint?: string } {
  return (err as { code?: string }).code === "23505";
}

/**
 * Admission (plan "durable per-user/notebook active-request fence"). The thread must belong to its stated user,
 * checked in SQL, so a forged thread record cannot admit work for another principal.
 */
export async function admitCodeExecution(pool: Pool, input: AdmitCodeExecutionInput): Promise<AdmittedExecution> {
  const executionId = randomUUID();
  const leaseToken = randomUUID();
  const emptyTrace: CodeExecutionTrace = {
    schema_version: 1,
    execution_id: executionId,
    state: "CodeGenerating",
    attempts: [],
    final_attempt_id: null,
    published_artifact_ids: [],
    failure_code: null,
    computed_results: [],
  };
  try {
    const result = await pool.query(
      `INSERT INTO code_executions (id, thread_id, notebook_id, user_id, request_id, generation_epoch, state, source_snapshot, trace, lease_token, lease_expires_at)
       SELECT $1, t.id, t.notebook_id, t.user_id, $3, t.generation_epoch, 'CodeGenerating', $4, $5, $6, now() + ($7::int * interval '1 millisecond')
       FROM chat_threads t
       WHERE t.id = $2 AND t.user_id = $8 AND t.notebook_id = $9 AND t.generation_epoch = $10`,
      [
        executionId,
        input.thread.id,
        input.requestId,
        JSON.stringify(input.snapshot),
        JSON.stringify(emptyTrace),
        leaseToken,
        input.leaseMs ?? EXECUTION_LEASE_MS,
        input.thread.user_id,
        input.thread.notebook_id,
        input.thread.generation_epoch,
      ]
    );
    if ((result.rowCount ?? 0) === 0) throw new ExecutionFencedError("The chat changed before the calculation started");
  } catch (err) {
    if (isUniqueViolation(err)) throw new ExecutionInProgressError();
    throw err;
  }
  return { executionId, leaseToken };
}

export interface ExecutionProgress {
  state: CodeExecutionState;
  attemptOrdinal?: number;
  trace?: CodeExecutionTrace;
  runtimeMetadata?: Record<string, unknown>;
  leaseMs?: number;
}

/** Fenced progress write; renews the lease. A lost lease (cleared, reconciled, terminal) → GenerationCancelled. */
export async function recordCodeExecutionProgress(db: Queryable, executionId: string, leaseToken: string, progress: ExecutionProgress): Promise<void> {
  const result = await db.query(
    `UPDATE code_executions
        SET state = $3,
            attempt_ordinal = COALESCE($4, attempt_ordinal),
            trace = COALESCE($5::jsonb, trace),
            runtime_metadata = runtime_metadata || COALESCE($6::jsonb, '{}'::jsonb),
            lease_expires_at = now() + ($7::int * interval '1 millisecond'),
            updated_at = now()
      WHERE id = $1 AND lease_token = $2 AND state IN ('CodeGenerating', 'SandboxRunning')`,
    [
      executionId,
      leaseToken,
      progress.state,
      progress.attemptOrdinal ?? null,
      progress.trace ? JSON.stringify(progress.trace) : null,
      progress.runtimeMetadata ? JSON.stringify(progress.runtimeMetadata) : null,
      progress.leaseMs ?? EXECUTION_LEASE_MS,
    ]
  );
  if ((result.rowCount ?? 0) === 0) throw new ExecutionFencedError();
}

export interface ExecutionTerminal {
  state: "Succeeded" | "TimedOut" | "Failed";
  failureCode: CodeExecutionFailureCode | null;
  trace: CodeExecutionTrace;
  messageId?: string | null;
}

/** Fenced terminal write (used for unpublished terminal outcomes; publication uses `publishTurn`). */
export async function finishCodeExecution(db: Queryable, executionId: string, leaseToken: string, terminal: ExecutionTerminal): Promise<void> {
  const result = await db.query(
    `UPDATE code_executions
        SET state = $3, failure_code = $4, trace = $5, message_id = COALESCE($6, message_id), finished_at = now(), updated_at = now()
      WHERE id = $1 AND lease_token = $2 AND state IN ('CodeGenerating', 'SandboxRunning')`,
    [executionId, leaseToken, terminal.state, terminal.failureCode, JSON.stringify(terminal.trace), terminal.messageId ?? null]
  );
  if ((result.rowCount ?? 0) === 0) throw new ExecutionFencedError();
}

/** Locks the execution for publication inside the publishing transaction; lost lease → GenerationCancelled. */
export async function lockExecutionForPublication(tx: Queryable, executionId: string, leaseToken: string): Promise<void> {
  const result = await tx.query(
    "SELECT id FROM code_executions WHERE id = $1 AND lease_token = $2 AND state IN ('CodeGenerating', 'SandboxRunning') FOR UPDATE",
    [executionId, leaseToken]
  );
  if ((result.rowCount ?? 0) === 0) throw new ExecutionFencedError();
}

/** Inside `publishTurn`: terminal state, message link and chart publication commit with the answer. */
export async function completeExecutionPublication(
  tx: Queryable,
  input: { executionId: string; messageId: string; trace: CodeExecutionTrace; publishArtifactIds: string[] }
): Promise<void> {
  await tx.query(
    `UPDATE code_executions SET state = $2, failure_code = $3, trace = $4, message_id = $5, finished_at = now(), updated_at = now() WHERE id = $1`,
    [input.executionId, input.trace.state, input.trace.failure_code, JSON.stringify(input.trace), input.messageId]
  );
  if (input.publishArtifactIds.length > 0) {
    const published = await tx.query(
      `UPDATE chart_artifacts SET state = 'published', message_id = $2, updated_at = now()
        WHERE execution_id = $1 AND id = ANY($3::uuid[]) AND state = 'candidate'`,
      [input.executionId, input.messageId, input.publishArtifactIds]
    );
    if ((published.rowCount ?? 0) !== input.publishArtifactIds.length) throw new ExecutionFencedError("Chart artifacts changed before publication");
  }
  // Candidates that were not selected for publication (e.g. a failed attempt's) stay private and are purged.
  await tx.query(
    `UPDATE chart_artifacts SET state = 'invalidated', updated_at = now() WHERE execution_id = $1 AND state = 'candidate'`,
    [input.executionId]
  );
}

// ---- Sandbox cleanup ledger (FR-006, FR-011) ---------------------------------------------------------------

export async function registerSandbox(db: Queryable, input: { attemptId: string; executionId: string | null; notebookId: string }): Promise<void> {
  await db.query(
    `INSERT INTO code_execution_sandboxes (attempt_id, execution_id, notebook_id, state) VALUES ($1, $2, $3, 'Creating')`,
    [input.attemptId, input.executionId, input.notebookId]
  );
}

export async function markSandboxActive(db: Queryable, attemptId: string, providerHandle: string): Promise<void> {
  await db.query(
    `UPDATE code_execution_sandboxes SET provider_handle = $2, state = CASE WHEN state = 'Creating' THEN 'Active' ELSE state END, updated_at = now()
      WHERE attempt_id = $1 AND state <> 'Destroyed'`,
    [attemptId, providerHandle]
  );
}

export async function markSandboxDestroyPending(db: Queryable, attemptId: string, errorCode: string): Promise<void> {
  await db.query(
    `UPDATE code_execution_sandboxes SET state = 'DestroyPending', destroy_attempts = destroy_attempts + 1, last_error_code = $2, updated_at = now()
      WHERE attempt_id = $1 AND state <> 'Destroyed'`,
    [attemptId, errorCode.slice(0, 64)]
  );
}

export async function markSandboxDestroyed(db: Queryable, attemptId: string): Promise<void> {
  await db.query(
    `UPDATE code_execution_sandboxes SET state = 'Destroyed', destroyed_at = now(), updated_at = now() WHERE attempt_id = $1`,
    [attemptId]
  );
}

export interface OpenSandbox {
  attempt_id: string;
  execution_id: string | null;
  notebook_id: string;
  provider_handle: string | null;
  state: "Creating" | "Active" | "DestroyPending";
  destroy_attempts: number;
}

/**
 * Sandboxes still to delete: any not confirmed Destroyed whose execution is no longer live (terminal, cleared or
 * lease-expired), or older than `minAgeMs`. Live attempts are owned by their controller.
 */
export async function listSandboxesToDestroy(db: Queryable, options: { minAgeMs?: number; limit?: number } = {}): Promise<OpenSandbox[]> {
  const result = await db.query<OpenSandbox>(
    `SELECT s.attempt_id, s.execution_id, s.notebook_id, s.provider_handle, s.state, s.destroy_attempts
       FROM code_execution_sandboxes s
       LEFT JOIN code_executions e ON e.id = s.execution_id
      WHERE s.state <> 'Destroyed'
        AND (e.id IS NULL OR e.state NOT IN ('CodeGenerating', 'SandboxRunning') OR e.lease_expires_at < now()
             OR s.updated_at < now() - ($1::int * interval '1 millisecond'))
      ORDER BY s.updated_at
      LIMIT $2`,
    [options.minAgeMs ?? 5 * 60_000, options.limit ?? 100]
  );
  return result.rows;
}

// ---- Crash reconciliation (T029) -----------------------------------------------------------------------------

/**
 * Ends executions whose lease expired (controller crash/restart) WITHOUT replaying Python: an attempt that was
 * submitted becomes ExecutionOutcomeUnknown with a null exit code; nothing submitted → Failed, zero attempts.
 * Returns the reconciled execution IDs. Their sandboxes are then destroyed via the ledger.
 */
export async function reconcileExpiredExecutions(pool: Pool): Promise<string[]> {
  return withTransaction(pool, async (tx) => {
    const rows = await tx.query<{ id: string; trace: CodeExecutionTrace }>(
      `SELECT id, trace FROM code_executions
        WHERE state IN ('CodeGenerating', 'SandboxRunning') AND lease_expires_at < now()
        ORDER BY lease_expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`
    );
    const now = new Date().toISOString();
    for (const row of rows.rows) {
      const attempts = (row.trace.attempts ?? []).map((a) =>
        a.terminal_reason === null ? { ...a, exit_code: null, ended_at: now, terminal_reason: "ExecutionOutcomeUnknown" as const, artifacts: [] } : a
      );
      const unknown = attempts.some((a) => a.terminal_reason === "ExecutionOutcomeUnknown");
      const failure: CodeExecutionFailureCode = unknown ? "ExecutionOutcomeUnknown" : "GenerationCancelled";
      const trace: CodeExecutionTrace = {
        ...row.trace,
        state: "Failed",
        attempts,
        final_attempt_id: attempts.at(-1)?.attempt_id ?? null,
        published_artifact_ids: [],
        failure_code: failure,
        computed_results: [],
      };
      await tx.query(
        `UPDATE code_executions SET state = 'Failed', failure_code = $2, trace = $3, lease_token = $4, finished_at = now(), updated_at = now() WHERE id = $1`,
        [row.id, failure, JSON.stringify(trace), randomUUID()]
      );
      await tx.query(`UPDATE chart_artifacts SET state = 'invalidated', updated_at = now() WHERE execution_id = $1 AND state = 'candidate'`, [row.id]);
    }
    return rows.rows.map((r) => r.id);
  });
}

// ---- Chart artifacts (FR-005, FR-011, NFR-SEC-02) -----------------------------------------------------------

export interface ChartArtifactInsert extends ChartArtifactRecord {
  user_id: string;
}

export async function insertChartCandidate(db: Queryable, record: ChartArtifactInsert): Promise<void> {
  await db.query(
    `INSERT INTO chart_artifacts (id, execution_id, attempt_id, notebook_id, user_id, message_id, object_key, object_generation, mime_type, digest, byte_size, source_snapshot, citation_chunk_ids, state)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, 'candidate')`,
    [
      record.artifact_id,
      record.execution_id,
      record.attempt_id,
      record.notebook_id,
      record.user_id,
      record.object_key,
      record.object_generation,
      record.mime_type,
      record.digest,
      record.byte_size,
      JSON.stringify(record.source_snapshot),
      JSON.stringify(record.citation_chunk_ids),
    ]
  );
}

export interface PublishedChart {
  artifact_id: string;
  message_id: string;
  notebook_id: string;
  object_key: string;
  object_generation: string;
  mime_type: "image/png" | "image/svg+xml";
  digest: string;
  byte_size: number;
  source_snapshot: SourceRevisionPair[];
}

/**
 * Published chart of one message in the caller's own thread. Ownership of the notebook is checked by the caller
 * (404/403); this additionally binds artifact → message → caller's thread, so a guessed ID reveals nothing.
 */
export async function findPublishedChart(
  db: Queryable,
  input: { ownerId: string; notebookId: string; messageId: string; artifactId: string }
): Promise<PublishedChart | null> {
  const result = await db.query<PublishedChart>(
    `SELECT a.id AS artifact_id, a.message_id, a.notebook_id, a.object_key, a.object_generation, a.mime_type, a.digest, a.byte_size, a.source_snapshot
       FROM chart_artifacts a
       JOIN chat_messages m ON m.id = a.message_id
      WHERE a.id = $1 AND a.message_id = $2 AND a.notebook_id = $3 AND a.state = 'published'
        AND m.notebook_id = $3 AND m.user_id = $4 AND a.user_id = $4 AND a.object_deleted_at IS NULL`,
    [input.artifactId, input.messageId, input.notebookId, input.ownerId]
  );
  return result.rows[0] ?? null;
}

/** Clear chat (FR-GC-06): synchronously revokes chart delivery for the thread before messages are removed. */
export async function invalidateThreadCodeExecutions(tx: Queryable, input: { threadId: string; notebookId: string; userId: string }): Promise<void> {
  await tx.query(
    `UPDATE chart_artifacts SET state = 'invalidated', updated_at = now() WHERE notebook_id = $1 AND user_id = $2 AND state <> 'invalidated'`,
    [input.notebookId, input.userId]
  );
  // Executions (with code/stdout) are removed; any in-flight controller loses its lease and is fenced.
  await tx.query("DELETE FROM code_executions WHERE thread_id = $1", [input.threadId]);
}

/**
 * Source deletion/revocation (FR-011): published charts whose snapshot includes a source revision that is no
 * longer Ready (and not merely replaced by a newer revision of the same accessible source) are invalidated.
 * The chart route already refuses them synchronously; this frees the objects.
 */
export async function invalidateChartsOfUnavailableSources(db: Queryable): Promise<number> {
  const result = await db.query(
    `UPDATE chart_artifacts a SET state = 'invalidated', updated_at = now()
      WHERE a.state <> 'invalidated' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.source_snapshot) p
        LEFT JOIN sources s ON s.id = (p ->> 'source_id')::uuid AND s.notebook_id = a.notebook_id
        WHERE s.id IS NULL OR s.status <> 'Ready' OR s.active_revision IS NULL OR s.active_revision < (p ->> 'revision')::int)`
  );
  return result.rowCount ?? 0;
}

export interface ArtifactToPurge {
  artifact_id: string;
  object_key: string;
  object_generation: string;
}

/** Invalidated artifacts and stale unpublished candidates whose object generation still exists. */
export async function listArtifactsToPurge(db: Queryable, options: { candidateAgeMs?: number; limit?: number } = {}): Promise<ArtifactToPurge[]> {
  const result = await db.query<ArtifactToPurge>(
    `SELECT a.id AS artifact_id, a.object_key, a.object_generation FROM chart_artifacts a
       LEFT JOIN code_executions e ON e.id = a.execution_id
      WHERE a.object_deleted_at IS NULL
        AND (a.state = 'invalidated'
             OR (a.state = 'candidate' AND (e.id IS NULL OR e.state NOT IN ('CodeGenerating', 'SandboxRunning'))
                 AND a.created_at < now() - ($1::int * interval '1 millisecond')))
      ORDER BY a.updated_at LIMIT $2`,
    [options.candidateAgeMs ?? 0, options.limit ?? 100]
  );
  return result.rows;
}

export async function markArtifactObjectDeleted(db: Queryable, artifactId: string): Promise<void> {
  await db.query(
    "UPDATE chart_artifacts SET state = 'invalidated', object_deleted_at = now(), updated_at = now() WHERE id = $1",
    [artifactId]
  );
}

export interface CodeExecutionRow {
  id: string;
  state: CodeExecutionState;
  failure_code: CodeExecutionFailureCode | null;
  attempt_ordinal: number;
  trace: CodeExecutionTrace;
  message_id: string | null;
  updated_at: string;
}

export async function getCodeExecution(db: Queryable, executionId: string): Promise<CodeExecutionRow | null> {
  const result = await db.query<Omit<CodeExecutionRow, "updated_at"> & { updated_at: Date }>(
    "SELECT id, state, failure_code, attempt_ordinal, trace, message_id, updated_at FROM code_executions WHERE id = $1",
    [executionId]
  );
  const row = result.rows[0];
  return row ? { ...row, updated_at: toIso(row.updated_at) } : null;
}
