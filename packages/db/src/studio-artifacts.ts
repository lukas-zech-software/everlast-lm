import { randomUUID } from "node:crypto";
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
 * Studio artifact repository (C-03, FR-ST-10/11). The in-memory implementation backs tests and
 * local harnesses; the Postgres table is defined in migrations/0004_studio_artifacts.sql.
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
