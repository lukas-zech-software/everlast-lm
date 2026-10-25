import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { enqueueJob } from "./jobs.ts";
import { withTransaction } from "./transaction.ts";
import {
  InvalidStudioTransitionError,
  canTransitionStudioStatus,
  type SourceRevisionPair,
  type StudioArtifact,
  type StudioFailure,
  type StudioJobStatus,
  type StudioParamsJson,
  type StudioPayloadJson,
  type StudioPluginType,
  type StudioProgress,
  type StudioSubtype,
} from "@everlast/contracts";

/**
 * Studio artifact repository (C-03, FR-ST-08/09/10/11/18). `PostgresStudioArtifactRepository` (table `studio_artifacts`,
 * migrations 0008 + 0011, specs/013 + specs/011) backs the API and worker; the in-memory implementation is the TEST-ONLY double.
 */

export type StudioArtifactRecord = StudioArtifact & { owner_id: string };
export type StudioArtifactSummary = Omit<StudioArtifactRecord, "payload_json">;

export class StudioRetryNotAllowedError extends Error {
  constructor(message = "Only Failed or Cancelled artifacts can be retried") {
    super(message);
    this.name = "StudioRetryNotAllowedError";
  }
}

export class StudioLeaseFenceError extends Error {
  constructor(message = "Studio job lease is stale or no longer active") {
    super(message);
    this.name = "StudioLeaseFenceError";
  }
}

export interface CreateQueuedStudioArtifactInput {
  notebook_id: string;
  owner_id: string;
  plugin_type?: StudioPluginType | undefined;
  subtype: StudioSubtype;
  title: string;
  params_json: StudioParamsJson;
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
  enqueueOutbox?: boolean | undefined;
}

export interface CreateStudioRetryInput {
  previous_id: string;
  owner_id: string;
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
  enqueueOutbox?: boolean | undefined;
}

export interface StudioClaimResult {
  artifact: StudioArtifactRecord;
  leaseToken: string;
  version: number;
}

export interface StudioArtifactRepository {
  createQueued(input: CreateQueuedStudioArtifactInput): Promise<StudioArtifactRecord>;
  createRetry(input: CreateStudioRetryInput): Promise<StudioArtifactRecord>;
  getById(id: string): Promise<StudioArtifactRecord | null>;
  get(notebookId: string, ownerId: string, id: string): Promise<StudioArtifactRecord | null>;
  list(notebookId: string, ownerId: string): Promise<StudioArtifactSummary[]>;
  markRunning(id: string): Promise<StudioArtifactRecord>;
  claimExecution?(id: string, leaseDurationSeconds?: number): Promise<StudioClaimResult | null>;
  updateProgress(id: string, progress: StudioProgress): Promise<StudioArtifactRecord>;
  complete(id: string, payload: StudioPayloadJson): Promise<StudioArtifactRecord>;
  completeWithFence?(
    id: string,
    payload: StudioPayloadJson,
    options?: { leaseToken?: string | undefined }
  ): Promise<StudioArtifactRecord>;
  fail(id: string, failure: StudioFailure): Promise<StudioArtifactRecord>;
  /** Extends an active lease; false when the lease was lost (cancelled, reclaimed or terminal) (FR-017). */
  renewLease?(id: string, leaseToken: string, leaseDurationSeconds: number): Promise<boolean>;
  /** Fails the attempt only while `leaseToken` still owns it; null when another owner or a terminal state won. */
  failWithFence?(id: string, failure: StudioFailure, leaseToken: string): Promise<StudioArtifactRecord | null>;
  cancel(id: string, message?: string): Promise<StudioArtifactRecord>;
  delete(notebookId: string, ownerId: string, id: string): Promise<boolean>;
  deleteForNotebook(notebookId: string): Promise<void>;
}

export class InMemoryStudioArtifactRepository implements StudioArtifactRepository {
  private readonly rows = new Map<string, StudioArtifactRecord>();
  private readonly leases = new Map<string, { token: string; expiresAt: number; version: number }>();
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
        plugin_type: prev.plugin_type,
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

  async claimExecution(id: string, leaseDurationSeconds = 120): Promise<StudioClaimResult | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const now = Date.now();
    const currentLease = this.leases.get(id);
    if (row.status === "Queued" || (row.status === "Running" && (!currentLease || currentLease.expiresAt <= now))) {
      row.status = "Running";
      row.progress ??= { stage: "reading", percent: 0 };
      row.updated_at = new Date(now).toISOString();
      const token = randomUUID();
      const version = (currentLease?.version ?? 1) + 1;
      this.leases.set(id, { token, expiresAt: now + leaseDurationSeconds * 1000, version });
      return { artifact: structuredClone(row), leaseToken: token, version };
    }
    return null;
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

  complete(id: string, payload: StudioPayloadJson): Promise<StudioArtifactRecord> {
    return this.transition(id, "Completed", () => ({ payload_json: payload as any, progress: null }));
  }

  async completeWithFence(
    id: string,
    payload: StudioPayloadJson,
    options?: { leaseToken?: string | undefined }
  ): Promise<StudioArtifactRecord> {
    const lease = this.leases.get(id);
    if (options?.leaseToken && lease && lease.token !== options.leaseToken) {
      throw new StudioLeaseFenceError();
    }
    this.leases.delete(id);
    return this.complete(id, payload);
  }

  fail(id: string, failure: StudioFailure): Promise<StudioArtifactRecord> {
    this.leases.delete(id);
    return this.transition(id, "Failed", () => ({ failure, progress: null }));
  }

  async renewLease(id: string, leaseToken: string, leaseDurationSeconds: number): Promise<boolean> {
    const lease = this.leases.get(id);
    if (!lease || lease.token !== leaseToken || this.rows.get(id)?.status !== "Running") return false;
    lease.expiresAt = Date.now() + leaseDurationSeconds * 1000;
    return true;
  }

  async failWithFence(id: string, failure: StudioFailure, leaseToken: string): Promise<StudioArtifactRecord | null> {
    const lease = this.leases.get(id);
    if (!lease || lease.token !== leaseToken || this.rows.get(id)?.status !== "Running") return null;
    return this.fail(id, failure);
  }

  cancel(id: string, message = "Cancelled by the owner."): Promise<StudioArtifactRecord> {
    this.leases.delete(id);
    return this.transition(id, "Cancelled", () => ({
      failure: { code: "Cancelled", message },
      progress: null,
    }));
  }

  async delete(notebookId: string, ownerId: string, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.notebook_id !== notebookId || row.owner_id !== ownerId) return false;
    this.rows.delete(id);
    this.leases.delete(id);
    this.order.splice(this.order.indexOf(id), 1);
    return true;
  }

  async deleteForNotebook(notebookId: string): Promise<void> {
    for (const [id, row] of [...this.rows]) {
      if (row.notebook_id === notebookId) {
        this.rows.delete(id);
        this.leases.delete(id);
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
      plugin_type: input.plugin_type ?? "report",
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

// ---- PostgreSQL (specs/013 + specs/011, migrations 0008 + 0011) -----------------------------------------------

interface StudioRow {
  id: string;
  notebook_id: string;
  owner_id: string;
  plugin_type: StudioPluginType;
  subtype: StudioSubtype;
  status: StudioJobStatus;
  title: string;
  params_json: StudioParamsJson;
  payload_json: StudioPayloadJson | null;
  source_revisions_snapshot: SourceRevisionPair[];
  output_language: string | null;
  progress_json: StudioProgress | null;
  failure_json: StudioFailure | null;
  attempt: number;
  retry_of: string | null;
  version: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const STUDIO_COLUMNS =
  "id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, payload_json, source_revisions_snapshot, output_language, progress_json, failure_json, attempt, retry_of, version, lease_token, lease_expires_at, created_at, updated_at";

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
    payload_json: r.payload_json as any,
    source_revisions_snapshot: r.source_revisions_snapshot,
    output_language: r.output_language,
    progress: r.progress_json,
    failure: r.failure_json,
    attempt: r.attempt,
    retry_of: r.retry_of,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/** Same C-03 behaviour, errors and transition checks as `InMemoryStudioArtifactRepository`, plus atomic outbox and lease/source fences. */
export class PostgresStudioArtifactRepository implements StudioArtifactRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async createQueued(input: CreateQueuedStudioArtifactInput): Promise<StudioArtifactRecord> {
    const pluginType = input.plugin_type ?? "report";
    const shouldEnqueueOutbox = input.enqueueOutbox ?? pluginType !== "report";
    if (!shouldEnqueueOutbox) {
      return this.insert(this.pool, input, 1, null);
    }
    return withTransaction(
      this.pool,
      async (client) => {
        const record = await this.insert(client, input, 1, null);
        await enqueueJob(client, "studio", {
          artifact_id: record.id,
          notebook_id: record.notebook_id,
        });
        return record;
      },
      { retries: 0 }
    );
  }

  async createRetry(input: CreateStudioRetryInput): Promise<StudioArtifactRecord> {
    return withTransaction(
      this.pool,
      async (client) => {
        const prev = await this.locked(client, input.previous_id);
        if (!prev || prev.owner_id !== input.owner_id) throw new StudioRetryNotAllowedError("Artifact not found");
        if (prev.status !== "Failed" && prev.status !== "Cancelled") throw new StudioRetryNotAllowedError();
        const record = await this.insert(
          client,
          {
            notebook_id: prev.notebook_id,
            owner_id: prev.owner_id,
            plugin_type: prev.plugin_type,
            subtype: prev.subtype,
            title: prev.title,
            params_json: prev.params_json,
            snapshot: input.snapshot,
            output_language: input.output_language ?? prev.output_language ?? undefined,
          },
          prev.attempt + 1,
          prev.id
        );
        const shouldEnqueueOutbox = input.enqueueOutbox ?? prev.plugin_type !== "report";
        if (shouldEnqueueOutbox) {
          await enqueueJob(client, "studio", {
            artifact_id: record.id,
            notebook_id: record.notebook_id,
          });
        }
        return record;
      },
      { retries: 0 }
    );
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

  /**
   * Claims a Queued artifact or recovers an expired Running lease on the SAME attempt (`FR-017`).
   * Returns `null` when the artifact is already terminal or leased by another active worker.
   */
  async claimExecution(id: string, leaseDurationSeconds = 120): Promise<StudioClaimResult | null> {
    return withTransaction(
      this.pool,
      async (client) => {
        const row = await this.locked(client, id);
        if (!row) return null;
        if (row.status !== "Queued" && row.status !== "Running") return null;
        if (row.status === "Running" && row.lease_token !== null && row.lease_expires_at !== null) {
          const { rows: check } = await client.query<{ expired: boolean }>(
            "SELECT ($1::timestamptz <= now()) AS expired",
            [row.lease_expires_at]
          );
          if (!check[0]?.expired) return null;
        }
        const token = randomUUID();
        const { rows } = await client.query<StudioRow>(
          `UPDATE studio_artifacts
              SET status = 'Running',
                  progress_json = COALESCE(progress_json, '{"stage":"reading","percent":0}'::jsonb),
                  lease_token = $2,
                  lease_expires_at = now() + make_interval(secs => $3),
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1
            RETURNING ${STUDIO_COLUMNS}`,
          [id, token, leaseDurationSeconds]
        );
        const updated = rows[0]!;
        return { artifact: toRecord(updated), leaseToken: token, version: updated.version };
      },
      { retries: 0 }
    );
  }

  async updateProgress(id: string, progress: StudioProgress): Promise<StudioArtifactRecord> {
    return withTransaction(
      this.pool,
      async (client) => {
        const row = await this.require(client, id);
        if (row.status !== "Running") throw new InvalidStudioTransitionError(row.status, "Running");
        const { rows } = await client.query<StudioRow>(
          `UPDATE studio_artifacts SET progress_json = $2, updated_at = now() WHERE id = $1 RETURNING ${STUDIO_COLUMNS}`,
          [id, JSON.stringify(progress)]
        );
        return toRecord(rows[0]!);
      },
      { retries: 0 }
    );
  }

  complete(id: string, payload: StudioPayloadJson): Promise<StudioArtifactRecord> {
    return this.transition(id, "Completed", { payload_json: payload, progress_json: null });
  }

  /**
   * Commits a Completed payload only after verifying the active lease token, notebook ownership, and
   * that every captured `(source_id, revision)` still exists in `sources` with `status = 'Ready'` and
   * `active_revision = revision` under a `FOR SHARE` lock (`FR-010`, `FR-017`, `NFR-SEC-02`).
   */
  async completeWithFence(
    id: string,
    payload: StudioPayloadJson,
    options?: { leaseToken?: string | undefined }
  ): Promise<StudioArtifactRecord> {
    return withTransaction(
      this.pool,
      async (client) => {
        const row = await this.require(client, id);
        if (row.status !== "Running") {
          throw new InvalidStudioTransitionError(row.status, "Completed");
        }
        if (options?.leaseToken && row.lease_token !== null && row.lease_token !== options.leaseToken) {
          throw new StudioLeaseFenceError("Studio job lease token does not match the active worker lease.");
        }

        // Verify notebook ownership under FOR SHARE
        const nbRes = await client.query<{ owner_id: string }>(
          "SELECT owner_id FROM notebooks WHERE id = $1 FOR SHARE",
          [row.notebook_id]
        );
        if (nbRes.rows[0]?.owner_id !== row.owner_id) {
          const { rows: failedRows } = await client.query<StudioRow>(
            `UPDATE studio_artifacts
                SET status = 'Failed',
                    payload_json = NULL,
                    progress_json = NULL,
                    failure_json = $2,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1
              RETURNING ${STUDIO_COLUMNS}`,
            [id, JSON.stringify({ code: "Unauthorized", message: "Access to the selected sources was revoked." })]
          );
          return toRecord(failedRows[0]!);
        }

        // Lock captured sources FOR SHARE in deterministic order to prevent deadlocks with re-sync/delete
        const sourceIds = row.source_revisions_snapshot.map((s) => s.source_id).sort();
        const srcRes = await client.query<{ id: string; status: string; active_revision: number | null }>(
          `SELECT id, status, active_revision
             FROM sources
            WHERE notebook_id = $1 AND id = ANY($2::uuid[])
            ORDER BY id
            FOR SHARE`,
          [row.notebook_id, sourceIds]
        );
        const bySourceId = new Map(srcRes.rows.map((s) => [s.id, s]));
        for (const pair of row.source_revisions_snapshot) {
          const live = bySourceId.get(pair.source_id);
          if (!live || live.status !== "Ready" || live.active_revision !== pair.revision) {
            const { rows: failedRows } = await client.query<StudioRow>(
              `UPDATE studio_artifacts
                  SET status = 'Failed',
                      payload_json = NULL,
                      progress_json = NULL,
                      failure_json = $2,
                      lease_token = NULL,
                      lease_expires_at = NULL,
                      version = version + 1,
                      updated_at = now()
                WHERE id = $1
                RETURNING ${STUDIO_COLUMNS}`,
              [
                id,
                JSON.stringify({
                  code: "SourceChanged",
                  message: `Source ${pair.source_id} changed or is no longer Ready before publication.`,
                }),
              ]
            );
            return toRecord(failedRows[0]!);
          }
        }

        const { rows } = await client.query<StudioRow>(
          `UPDATE studio_artifacts
              SET status = 'Completed',
                  payload_json = $2::jsonb,
                  progress_json = NULL,
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1
            RETURNING ${STUDIO_COLUMNS}`,
          [id, JSON.stringify(payload)]
        );
        return toRecord(rows[0]!);
      },
      { retries: 0 }
    );
  }

  fail(id: string, failure: StudioFailure): Promise<StudioArtifactRecord> {
    return this.transition(id, "Failed", { failure_json: failure, progress_json: null });
  }

  async renewLease(id: string, leaseToken: string, leaseDurationSeconds: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE studio_artifacts SET lease_expires_at = now() + make_interval(secs => $3)
        WHERE id = $1 AND lease_token = $2 AND status = 'Running'`,
      [id, leaseToken, leaseDurationSeconds]
    );
    return (rowCount ?? 0) > 0;
  }

  async failWithFence(id: string, failure: StudioFailure, leaseToken: string): Promise<StudioArtifactRecord | null> {
    const { rows } = await this.pool.query<StudioRow>(
      `UPDATE studio_artifacts
          SET status = 'Failed', failure_json = $3, progress_json = NULL, lease_token = NULL, lease_expires_at = NULL,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND lease_token = $2 AND status = 'Running'
        RETURNING ${STUDIO_COLUMNS}`,
      [id, leaseToken, JSON.stringify(failure)]
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  cancel(id: string, message = "Cancelled by the owner."): Promise<StudioArtifactRecord> {
    return this.transition(id, "Cancelled", { failure_json: { code: "Cancelled", message }, progress_json: null });
  }

  async delete(notebookId: string, ownerId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM studio_artifacts WHERE id = $1 AND notebook_id = $2 AND owner_id = $3",
      [id, notebookId, ownerId]
    );
    return (rowCount ?? 0) > 0;
  }

  async deleteForNotebook(notebookId: string): Promise<void> {
    await this.pool.query("DELETE FROM studio_artifacts WHERE notebook_id = $1", [notebookId]);
  }

  private async insert(
    db: Pool | PoolClient,
    input: CreateQueuedStudioArtifactInput,
    attempt: number,
    retryOf: string | null
  ): Promise<StudioArtifactRecord> {
    const { rows } = await db.query<StudioRow>(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot, output_language, attempt, retry_of)
       VALUES ($1, $2, $3, $4, $5, 'Queued', $6, $7, $8, $9, $10, $11)
       RETURNING ${STUDIO_COLUMNS}`,
      [
        randomUUID(),
        input.notebook_id,
        input.owner_id,
        input.plugin_type ?? "report",
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
    patch: { payload_json?: StudioPayloadJson; progress_json?: StudioProgress | null; failure_json?: StudioFailure }
  ): Promise<StudioArtifactRecord> {
    return withTransaction(
      this.pool,
      async (client) => {
        const row = await this.require(client, id);
        if (!canTransitionStudioStatus(row.status, to)) throw new InvalidStudioTransitionError(row.status, to);
        const { rows } = await client.query<StudioRow>(
          `UPDATE studio_artifacts SET status = $2,
             payload_json = CASE WHEN $3::boolean THEN $4::jsonb ELSE payload_json END,
             progress_json = CASE WHEN $5::boolean THEN $6::jsonb ELSE progress_json END,
             failure_json = CASE WHEN $7::boolean THEN $8::jsonb ELSE failure_json END,
             lease_token = NULL,
             lease_expires_at = NULL,
             version = version + 1,
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
      },
      { retries: 0 }
    );
  }
}

export const INTERRUPTED_REPORT_MESSAGE = "Report generation was interrupted by a service restart. Retry to generate it again.";

/**
 * R5 restart sweep (FR-010, C-03; specs/013 + specs/011 FR-017): with one API instance, legacy `report` rows
 * left Queued/Running before startup belong to a stopped process and become Failed (Retry applies).
 * Durable new-kind jobs (`mindmap`, `data_table`) are excluded from this sweep so their outbox/lease recovery
 * resumes the same attempt (`CHK037`, `T005`, `T012`).
 */
export async function sweepInterruptedStudioArtifacts(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE studio_artifacts
        SET status = 'Failed',
            progress_json = NULL,
            failure_json = $1,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = now()
      WHERE plugin_type = 'report'
        AND status IN ('Queued', 'Running')
        AND updated_at < now()`,
    [JSON.stringify({ code: "GenerationError", message: INTERRUPTED_REPORT_MESSAGE })]
  );
  return rowCount ?? 0;
}
