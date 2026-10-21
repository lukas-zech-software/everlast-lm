import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "./transaction.ts";
import {
  InvalidStudioTransitionError,
  canTransitionStudioStatus,
  type SourceRevisionPair,
  type StudioArtifact,
  type StudioFailure,
  type StudioJobStatus,
  type StudioProgress,
  type StudioReportParams,
  type StudioReportPayload,
  type ReportSubtype,
} from "@everlast/contracts";

/**
 * Studio artifact repository (C-03, FR-ST-10/11). `PostgresStudioArtifactRepository` (table `studio_artifacts`,
 * migration 0008, specs/013) backs the API; the in-memory implementation is the TEST-ONLY double.
 */

export type StudioArtifactRecord = StudioArtifact & { owner_id: string };
export type StudioArtifactSummary = Omit<StudioArtifactRecord, "payload_json">;

export class StudioRetryNotAllowedError extends Error {
  constructor(message = "Only Failed or Cancelled artifacts can be retried") {
    super(message);
    this.name = "StudioRetryNotAllowedError";
  }
}

export interface CreateQueuedStudioArtifactInput {
  notebook_id: string;
  owner_id: string;
  subtype: ReportSubtype;
  title: string;
  params_json: StudioReportParams;
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
}

export interface CreateStudioRetryInput {
  previous_id: string;
  owner_id: string;
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
}

export interface StudioArtifactRepository {
  createQueued(input: CreateQueuedStudioArtifactInput): Promise<StudioArtifactRecord>;
  createRetry(input: CreateStudioRetryInput): Promise<StudioArtifactRecord>;
  getById(id: string): Promise<StudioArtifactRecord | null>;
  get(notebookId: string, ownerId: string, id: string): Promise<StudioArtifactRecord | null>;
  list(notebookId: string, ownerId: string): Promise<StudioArtifactSummary[]>;
  markRunning(id: string): Promise<StudioArtifactRecord>;
  updateProgress(id: string, progress: StudioProgress): Promise<StudioArtifactRecord>;
  complete(id: string, payload: StudioReportPayload): Promise<StudioArtifactRecord>;
  fail(id: string, failure: StudioFailure): Promise<StudioArtifactRecord>;
  cancel(id: string, message?: string): Promise<StudioArtifactRecord>;
  delete(notebookId: string, ownerId: string, id: string): Promise<boolean>;
  deleteForNotebook(notebookId: string): Promise<void>;
}

export class InMemoryStudioArtifactRepository implements StudioArtifactRepository {
  private readonly rows = new Map<string, StudioArtifactRecord>();
  private readonly order: string[] = [];

  async createQueued(input: CreateQueuedStudioArtifactInput): Promise<StudioArtifactRecord> {
    return this.insert(input, 1, null);
  }

  async createRetry(input: CreateStudioRetryInput): Promise<StudioArtifactRecord> {
    const prev = this.rows.get(input.previous_id);
    if (!prev || prev.owner_id !== input.owner_id) {
      throw new StudioRetryNotAllowedError("Artifact not found");
    }
    if (prev.status !== "Failed" && prev.status !== "Cancelled") {
      throw new StudioRetryNotAllowedError();
    }
    return this.insert(
      {
        notebook_id: prev.notebook_id,
        owner_id: prev.owner_id,
        subtype: prev.subtype,
        title: prev.title,
        params_json: prev.params_json,
        snapshot: input.snapshot,
        output_language: input.output_language ?? prev.output_language ?? undefined,
      },
      prev.attempt + 1,
      prev.id
    );
  }

  async getById(id: string): Promise<StudioArtifactRecord | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async get(notebookId: string, ownerId: string, id: string): Promise<StudioArtifactRecord | null> {
    const row = this.rows.get(id);
    if (!row || row.notebook_id !== notebookId || row.owner_id !== ownerId) return null;
    return structuredClone(row);
  }

  async list(notebookId: string, ownerId: string): Promise<StudioArtifactSummary[]> {
    return this.order
      .map((id) => this.rows.get(id)!)
      .filter((r) => r.notebook_id === notebookId && r.owner_id === ownerId)
      .map(({ payload_json: _payload, ...summary }) => structuredClone(summary));
  }

  markRunning(id: string): Promise<StudioArtifactRecord> {
    return this.transition(id, "Running", () => ({ progress: { stage: "reading", percent: 0 } }));
  }

  async updateProgress(id: string, progress: StudioProgress): Promise<StudioArtifactRecord> {
    const row = this.require(id);
    if (row.status !== "Running") {
      throw new InvalidStudioTransitionError(row.status, "Running");
    }
    row.progress = progress;
    row.updated_at = new Date().toISOString();
    return structuredClone(row);
  }

  complete(id: string, payload: StudioReportPayload): Promise<StudioArtifactRecord> {
    return this.transition(id, "Completed", () => ({ payload_json: payload, progress: null }));
  }

  fail(id: string, failure: StudioFailure): Promise<StudioArtifactRecord> {
    return this.transition(id, "Failed", () => ({ failure, progress: null }));
  }

  cancel(id: string, message = "Cancelled by the owner."): Promise<StudioArtifactRecord> {
    return this.transition(id, "Cancelled", () => ({
      failure: { code: "Cancelled", message },
      progress: null,
    }));
  }

  async delete(notebookId: string, ownerId: string, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.notebook_id !== notebookId || row.owner_id !== ownerId) return false;
    this.rows.delete(id);
    this.order.splice(this.order.indexOf(id), 1);
    return true;
  }

  async deleteForNotebook(notebookId: string): Promise<void> {
    for (const [id, row] of [...this.rows]) {
      if (row.notebook_id === notebookId) {
        this.rows.delete(id);
        this.order.splice(this.order.indexOf(id), 1);
      }
    }
  }

  private insert(
    input: CreateQueuedStudioArtifactInput,
    attempt: number,
    retryOf: string | null
  ): StudioArtifactRecord {
    const now = new Date().toISOString();
    const row: StudioArtifactRecord = {
      id: randomUUID(),
      notebook_id: input.notebook_id,
      owner_id: input.owner_id,
      plugin_type: "report",
      subtype: input.subtype,
      status: "Queued",
      title: input.title,
      params_json: structuredClone(input.params_json),
      payload_json: null,
      source_revisions_snapshot: structuredClone(input.snapshot),
      output_language: input.output_language ?? null,
      progress: null,
      failure: null,
      attempt,
      retry_of: retryOf,
      created_at: now,
      updated_at: now,
    };
    this.rows.set(row.id, row);
    this.order.push(row.id);
    return structuredClone(row);
  }

  private require(id: string): StudioArtifactRecord {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Studio artifact ${id} not found`);
    return row;
  }

  private async transition(
    id: string,
    to: StudioJobStatus,
    patch: () => Partial<StudioArtifactRecord>
  ): Promise<StudioArtifactRecord> {
    const row = this.require(id);
    if (!canTransitionStudioStatus(row.status, to)) {
      throw new InvalidStudioTransitionError(row.status, to);
    }
    Object.assign(row, patch(), { status: to, updated_at: new Date().toISOString() });
    return structuredClone(row);
  }
}

// ---- PostgreSQL (specs/013, DEV-04 closed) ---------------------------------------------------------------------

interface StudioRow {
  id: string;
  notebook_id: string;
  owner_id: string;
  plugin_type: "report";
  subtype: ReportSubtype;
  status: StudioJobStatus;
  title: string;
  params_json: StudioReportParams;
  payload_json: StudioReportPayload | null;
  source_revisions_snapshot: SourceRevisionPair[];
  output_language: string | null;
  progress_json: StudioProgress | null;
  failure_json: StudioFailure | null;
  attempt: number;
  retry_of: string | null;
  created_at: Date;
  updated_at: Date;
}
const STUDIO_COLUMNS =
  "id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, payload_json, source_revisions_snapshot, output_language, progress_json, failure_json, attempt, retry_of, created_at, updated_at";

function toRecord(r: StudioRow): StudioArtifactRecord {
  return {
    id: r.id,
    notebook_id: r.notebook_id,
    owner_id: r.owner_id,
    plugin_type: r.plugin_type,
    subtype: r.subtype,
    status: r.status,
    title: r.title,
    params_json: r.params_json,
    payload_json: r.payload_json,
    source_revisions_snapshot: r.source_revisions_snapshot,
    output_language: r.output_language,
    progress: r.progress_json,
    failure: r.failure_json,
    attempt: r.attempt,
    retry_of: r.retry_of,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  } as StudioArtifactRecord;
}

/** Same C-03 behaviour, errors and transition checks as `InMemoryStudioArtifactRepository`. */
export class PostgresStudioArtifactRepository implements StudioArtifactRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  createQueued(input: CreateQueuedStudioArtifactInput): Promise<StudioArtifactRecord> {
    return this.insert(this.pool, input, 1, null);
  }

  async createRetry(input: CreateStudioRetryInput): Promise<StudioArtifactRecord> {
    return withTransaction(this.pool, async (client) => {
      const prev = await this.locked(client, input.previous_id);
      if (!prev || prev.owner_id !== input.owner_id) throw new StudioRetryNotAllowedError("Artifact not found");
      if (prev.status !== "Failed" && prev.status !== "Cancelled") throw new StudioRetryNotAllowedError();
      return this.insert(
        client,
        {
          notebook_id: prev.notebook_id,
          owner_id: prev.owner_id,
          subtype: prev.subtype,
          title: prev.title,
          params_json: prev.params_json,
          snapshot: input.snapshot,
          output_language: input.output_language ?? prev.output_language ?? undefined,
        },
        prev.attempt + 1,
        prev.id
      );
    }, { retries: 0 });
  }

  async getById(id: string): Promise<StudioArtifactRecord | null> {
    const { rows } = await this.pool.query<StudioRow>(`SELECT ${STUDIO_COLUMNS} FROM studio_artifacts WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async get(notebookId: string, ownerId: string, id: string): Promise<StudioArtifactRecord | null> {
    const { rows } = await this.pool.query<StudioRow>(
      `SELECT ${STUDIO_COLUMNS} FROM studio_artifacts WHERE id = $1 AND notebook_id = $2 AND owner_id = $3`,
      [id, notebookId, ownerId]
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async list(notebookId: string, ownerId: string): Promise<StudioArtifactSummary[]> {
    const { rows } = await this.pool.query<StudioRow>(
      `SELECT ${STUDIO_COLUMNS} FROM studio_artifacts WHERE notebook_id = $1 AND owner_id = $2 ORDER BY seq`,
      [notebookId, ownerId]
    );
    return rows.map((r) => {
      const { payload_json: _payload, ...summary } = toRecord(r);
      return summary;
    });
  }

  markRunning(id: string): Promise<StudioArtifactRecord> {
    return this.transition(id, "Running", { progress_json: { stage: "reading", percent: 0 } });
  }

  async updateProgress(id: string, progress: StudioProgress): Promise<StudioArtifactRecord> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.require(client, id);
      if (row.status !== "Running") throw new InvalidStudioTransitionError(row.status, "Running");
      const { rows } = await client.query<StudioRow>(
        `UPDATE studio_artifacts SET progress_json = $2, updated_at = now() WHERE id = $1 RETURNING ${STUDIO_COLUMNS}`,
        [id, JSON.stringify(progress)]
      );
      return toRecord(rows[0]!);
    }, { retries: 0 });
  }

  complete(id: string, payload: StudioReportPayload): Promise<StudioArtifactRecord> {
    return this.transition(id, "Completed", { payload_json: payload, progress_json: null });
  }

  fail(id: string, failure: StudioFailure): Promise<StudioArtifactRecord> {
    return this.transition(id, "Failed", { failure_json: failure, progress_json: null });
  }

  cancel(id: string, message = "Cancelled by the owner."): Promise<StudioArtifactRecord> {
    return this.transition(id, "Cancelled", { failure_json: { code: "Cancelled", message }, progress_json: null });
  }

  async delete(notebookId: string, ownerId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM studio_artifacts WHERE id = $1 AND notebook_id = $2 AND owner_id = $3", [id, notebookId, ownerId]);
    return (rowCount ?? 0) > 0;
  }

  async deleteForNotebook(notebookId: string): Promise<void> {
    await this.pool.query("DELETE FROM studio_artifacts WHERE notebook_id = $1", [notebookId]);
  }

  private async insert(db: Pool | PoolClient, input: CreateQueuedStudioArtifactInput, attempt: number, retryOf: string | null): Promise<StudioArtifactRecord> {
    const { rows } = await db.query<StudioRow>(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot, output_language, attempt, retry_of)
       VALUES ($1, $2, $3, 'report', $4, 'Queued', $5, $6, $7, $8, $9, $10)
       RETURNING ${STUDIO_COLUMNS}`,
      [
        randomUUID(),
        input.notebook_id,
        input.owner_id,
        input.subtype,
        input.title,
        JSON.stringify(input.params_json),
        JSON.stringify(input.snapshot),
        input.output_language ?? null,
        attempt,
        retryOf,
      ]
    );
    return toRecord(rows[0]!);
  }

  private async locked(client: PoolClient, id: string): Promise<StudioRow | undefined> {
    return (await client.query<StudioRow>(`SELECT ${STUDIO_COLUMNS} FROM studio_artifacts WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  }

  private async require(client: PoolClient, id: string): Promise<StudioRow> {
    const row = await this.locked(client, id);
    if (!row) throw new Error(`Studio artifact ${id} not found`);
    return row;
  }

  private transition(
    id: string,
    to: StudioJobStatus,
    patch: { payload_json?: StudioReportPayload; progress_json?: StudioProgress | null; failure_json?: StudioFailure }
  ): Promise<StudioArtifactRecord> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.require(client, id);
      if (!canTransitionStudioStatus(row.status, to)) throw new InvalidStudioTransitionError(row.status, to);
      const { rows } = await client.query<StudioRow>(
        `UPDATE studio_artifacts SET status = $2,
           payload_json = CASE WHEN $3::boolean THEN $4::jsonb ELSE payload_json END,
           progress_json = CASE WHEN $5::boolean THEN $6::jsonb ELSE progress_json END,
           failure_json = CASE WHEN $7::boolean THEN $8::jsonb ELSE failure_json END,
           updated_at = now()
         WHERE id = $1 RETURNING ${STUDIO_COLUMNS}`,
        [
          id,
          to,
          "payload_json" in patch,
          JSON.stringify(patch.payload_json ?? null),
          "progress_json" in patch,
          patch.progress_json === null || patch.progress_json === undefined ? null : JSON.stringify(patch.progress_json),
          "failure_json" in patch,
          JSON.stringify(patch.failure_json ?? null),
        ]
      );
      return toRecord(rows[0]!);
    }, { retries: 0 });
  }
}

export const INTERRUPTED_REPORT_MESSAGE = "Report generation was interrupted by a service restart. Retry to generate it again.";

/**
 * R5 restart sweep (FR-010, C-03; specs/013): with one API instance, every Queued/Running artifact last updated
 * before this statement belongs to a stopped process. It becomes Failed with no payload, so Retry applies. This is
 * the only path from Queued to Failed.
 */
export async function sweepInterruptedStudioArtifacts(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE studio_artifacts SET status = 'Failed', progress_json = NULL, failure_json = $1, updated_at = now()
     WHERE status IN ('Queued', 'Running') AND updated_at < now()`,
    [JSON.stringify({ code: "GenerationError", message: INTERRUPTED_REPORT_MESSAGE })]
  );
  return rowCount ?? 0;
}
