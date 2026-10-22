import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AppError,
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  DELEGATED_ACCESS_DENIED_MESSAGE,
  SourceImportRequestSchema,
  SourceQuotaExceededError,
  SourceRenameInputSchema,
  SyncAlreadyInProgressError,
  VIDEO_MEDIA_TYPE,
  WEB_MEDIA_TYPE,
  isSyncEligible,
  type SourceImportRequest,
  type SourceOperationDto,
  type SourceProgress,
} from "@everlast/contracts";
import { toIso, withTransaction, type Queryable } from "./transaction.ts";
import { isUuid, requireOwnedNotebook } from "./notebooks.ts";
import { enqueueJob } from "./jobs.ts";
import {
  SOURCE_COLUMNS,
  SourceNotFoundError,
  countOccupiedSources,
  failSource,
  lockSourceForTransition,
  toSourceRecord,
  type SourceRecord,
  type SourceRow,
} from "./quota.ts";
import {
  fitDefaultTitle,
  insertRevisionContent,
  recordPublicationEvent,
  validateRevisionContent,
  type PublishChunk,
  type PublishPage,
  type RevisionManifest,
} from "./ingestion.ts";

/**
 * Package 3.1 source operations (FR-SI-01 Subset B, FR-SI-05, FR-WM-07, C-01, C-02, D11, D15).
 *
 * - Linked imports (web, video, Drive) reserve their slot atomically with a Queued import operation and its
 *   ingest job (one transaction, shared notebook lock with uploads and note-sources).
 * - Re-sync admits at most one active operation per source (row lock + partial unique index). A distinct
 *   overlapping manual or webhook request is rejected with "Sync already in progress"; no follow-up is queued.
 *   Same-key replay returns the recorded operation; a mismatched payload under the same key is 409.
 * - Workers claim operations with a lease; each claim increments a fencing token. Publication verifies the token,
 *   the expected revision and the source under the notebook→source fence, so stale or recovered workers and
 *   deleted sources never publish. The committed revision stays Ready and readable until the atomic swap.
 */

export type SyncPage = PublishPage;

export interface SourceOperationRecord {
  id: string;
  notebook_id: string;
  source_id: string;
  kind: "import" | "sync";
  trigger: "import" | "manual" | "webhook";
  initiator_id: string | null;
  idempotency_key: string | null;
  request_hash: string | null;
  state: "Queued" | "Running" | "Succeeded" | "Failed" | "Cancelled";
  progress: SourceProgress | null;
  expected_revision: number | null;
  committed_revision: number | null;
  fencing_token: number;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const OP_COLUMNS = `id, notebook_id, source_id, kind, trigger, initiator_id, idempotency_key, request_hash, state, progress,
  expected_revision, committed_revision, fencing_token, attempts, error_code, error_message, created_at, updated_at`;

interface OpRow extends Omit<SourceOperationRecord, "created_at" | "updated_at" | "fencing_token"> {
  fencing_token: string | number;
  created_at: Date;
  updated_at: Date;
}

function toOp(row: OpRow): SourceOperationRecord {
  return { ...row, fencing_token: Number(row.fencing_token), created_at: toIso(row.created_at), updated_at: toIso(row.updated_at) };
}

export function toOperationDto(op: SourceOperationRecord): SourceOperationDto {
  return {
    operation_id: op.id,
    source_id: op.source_id,
    kind: op.kind,
    state: op.state,
    progress: op.progress,
    committed_revision: op.committed_revision ?? op.expected_revision,
    error: op.error_code ? { code: op.error_code, message: op.error_message ?? "" } : null,
    created_at: op.created_at,
    updated_at: op.updated_at,
  };
}

export class OperationNotFoundError extends AppError {
  constructor() {
    super("NotFound", 404, "Source operation not found");
    this.name = "OperationNotFoundError";
  }
}

export class DelegatedAccessDeniedError extends AppError {
  constructor(message = DELEGATED_ACCESS_DENIED_MESSAGE) {
    super("DelegatedAccessDenied", 403, message);
    this.name = "DelegatedAccessDeniedError";
  }
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadOperationByKey(db: Queryable, sourceId: string, key: string): Promise<SourceOperationRecord | null> {
  const result = await db.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE source_id = $1 AND idempotency_key = $2`, [sourceId, key]);
  return result.rows[0] ? toOp(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------------------------------------
// Delegated connections (D11)
// ---------------------------------------------------------------------------------------------------------

export interface DelegatedConnection {
  id: string;
  user_id: string;
  provider: "google";
  secret_ref: string;
  scopes: string[];
  account_label: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface ConnectionRow extends Omit<DelegatedConnection, "created_at" | "revoked_at"> {
  created_at: Date;
  revoked_at: Date | null;
}

const toConnection = (row: ConnectionRow): DelegatedConnection => ({
  ...row,
  created_at: toIso(row.created_at),
  revoked_at: row.revoked_at ? toIso(row.revoked_at) : null,
});

export async function createDelegatedConnection(
  db: Queryable,
  input: { userId: string; secretRef: string; scopes: string[]; accountLabel?: string | null }
): Promise<DelegatedConnection> {
  const result = await db.query<ConnectionRow>(
    `INSERT INTO delegated_connections (id, user_id, provider, secret_ref, scopes, account_label)
     VALUES ($1, $2, 'google', $3, $4, $5) RETURNING id, user_id, provider, secret_ref, scopes, account_label, created_at, revoked_at`,
    [randomUUID(), input.userId, input.secretRef, input.scopes, input.accountLabel ?? null]
  );
  return toConnection(result.rows[0]!);
}

export async function listDelegatedConnections(db: Queryable, userId: string): Promise<DelegatedConnection[]> {
  const result = await db.query<ConnectionRow>(
    `SELECT id, user_id, provider, secret_ref, scopes, account_label, created_at, revoked_at FROM delegated_connections
     WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [userId]
  );
  return result.rows.map(toConnection);
}

/** The caller's own active connection, or null (another user's or a revoked connection never resolves). */
export async function getActiveDelegatedConnection(db: Queryable, userId: string, connectionId: string | null | undefined): Promise<DelegatedConnection | null> {
  if (!connectionId || !isUuid(connectionId)) return null;
  const result = await db.query<ConnectionRow>(
    `SELECT id, user_id, provider, secret_ref, scopes, account_label, created_at, revoked_at FROM delegated_connections
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [connectionId, userId]
  );
  return result.rows[0] ? toConnection(result.rows[0]) : null;
}

export async function revokeDelegatedConnection(db: Queryable, userId: string, connectionId: string): Promise<boolean> {
  if (!isUuid(connectionId)) return false;
  const result = await db.query("UPDATE delegated_connections SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [connectionId, userId]);
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------------------
// Linked imports (FR-SI-01, FR-WM-07)
// ---------------------------------------------------------------------------------------------------------

export interface LinkedImportResult {
  source: SourceRecord;
  operation: SourceOperationDto;
  replayed: boolean;
}

function provisionalTitle(request: SourceImportRequest): string {
  if (request.kind === "drive") return "Google document";
  const url = new URL(request.url);
  return fitDefaultTitle(`${url.hostname}${url.pathname === "/" ? "" : url.pathname}`);
}

/**
 * Atomic linked-source admission: notebook lock → occupancy check → Processing source + Queued import operation +
 * ingest job. Owner-only (403 foreign, 404 absent). Drive imports require the caller's own active delegation.
 */
export async function admitLinkedImport(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  rawRequest: unknown,
  options: { sourceLimit?: number } = {}
): Promise<LinkedImportResult> {
  const parsed = SourceImportRequestSchema.safeParse(rawRequest);
  if (!parsed.success) throw new AppError("ValidationFailed", 422, "Import must be {attempt_id, kind, ...} with fields for that kind");
  const request = parsed.data;
  const { attempt_id: attemptId, ...payload } = request;
  const hash = requestHash(payload);
  const sourceLimit = options.sourceLimit ?? DEFAULT_MAX_SOURCES_PER_NOTEBOOK;

  return withTransaction(pool, async (tx) => {
    await requireOwnedNotebook(tx, ownerId, notebookId, "update");
    const prior = await tx.query<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE attempt_id = $1`, [attemptId]);
    if (prior.rows[0]) {
      const source = toSourceRecord(prior.rows[0]);
      if (source.notebook_id !== notebookId) throw new AppError("InvalidScope", 409, "attempt_id belongs to another notebook");
      const op = await loadOperationByKey(tx, source.id, attemptId);
      if (!op || op.request_hash !== hash) throw new AppError("ValidationFailed", 409, "attempt_id was already used for a different request");
      return { source, operation: toOperationDto(op), replayed: true };
    }

    let connectionId: string | null = null;
    if (request.kind === "drive" || (request.kind === "video" && request.connection_id)) {
      const connection = await getActiveDelegatedConnection(tx, ownerId, request.connection_id);
      if (!connection) throw new DelegatedAccessDeniedError();
      connectionId = connection.id;
    }

    if ((await countOccupiedSources(tx, notebookId)) >= sourceLimit) throw new SourceQuotaExceededError(`Source limit of ${sourceLimit} reached`);

    const mediaType = request.kind === "web" ? WEB_MEDIA_TYPE : request.kind === "video" ? VIDEO_MEDIA_TYPE : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const inserted = await tx.query<SourceRow>(
      `INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes, link_kind, external_url,
                            external_document_id, delegated_connection_id, progress)
       VALUES ($1, $2, $3, $4, $5, 'Processing', 0, $6, $7, $8, $9, 'Fetching')
       RETURNING ${SOURCE_COLUMNS}`,
      [
        randomUUID(),
        notebookId,
        attemptId,
        provisionalTitle(request),
        mediaType,
        request.kind,
        request.kind === "drive" ? null : request.url,
        request.kind === "drive" ? request.external_document_id : null,
        connectionId,
      ]
    );
    const source = toSourceRecord(inserted.rows[0]!);
    const op = await tx.query<OpRow>(
      `INSERT INTO source_operations (id, notebook_id, source_id, kind, trigger, initiator_id, idempotency_key, request_hash, state, progress)
       VALUES ($1, $2, $3, 'import', 'import', $4, $5, $6, 'Queued', 'Fetching') RETURNING ${OP_COLUMNS}`,
      [randomUUID(), notebookId, source.id, ownerId, attemptId, hash]
    );
    const operation = toOp(op.rows[0]!);
    await enqueueJob(tx, "ingest", { source_id: source.id, attempt_id: attemptId, operation_id: operation.id });
    return { source, operation: toOperationDto(operation), replayed: false };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Re-sync admission (FR-SI-05)
// ---------------------------------------------------------------------------------------------------------

export interface SyncRequestInput {
  attemptId: string;
  trigger: "manual" | "webhook";
}

/**
 * Owner-checked sync admission: one Queued sync operation plus its outbox job, atomically. Linked Ready sources only;
 * a Drive source requires the owner's still-active delegation (revoked → 403, never a service account).
 */
export async function requestSourceSync(
  pool: Pool,
  ownerId: string,
  notebookId: string,
  sourceId: string,
  input: SyncRequestInput
): Promise<{ operation: SourceOperationDto; replayed: boolean }> {
  if (!isUuid(input.attemptId)) throw new AppError("ValidationFailed", 422, "attempt_id must be a UUID");
  const hash = requestHash({ trigger: input.trigger, source_id: sourceId });
  try {
    return await withTransaction(pool, async (tx) => {
      await requireOwnedNotebook(tx, ownerId, notebookId, "share");
      if (!isUuid(sourceId)) throw new SourceNotFoundError();
      const row = await tx.query<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE notebook_id = $1 AND id = $2 FOR UPDATE`, [notebookId, sourceId]);
      if (!row.rows[0]) throw new SourceNotFoundError();
      const source = toSourceRecord(row.rows[0]);

      const prior = await loadOperationByKey(tx, sourceId, input.attemptId);
      if (prior) {
        if (prior.request_hash !== hash) throw new AppError("ValidationFailed", 409, "attempt_id was already used for a different request");
        return { operation: toOperationDto(prior), replayed: true };
      }
      if (source.status !== "Ready" || source.active_revision === null || !isSyncEligible(source.link_kind)) {
        throw new AppError("ValidationFailed", 409, "Only linked Web URL or Drive sources that are Ready can be re-synced");
      }
      if (source.link_kind === "drive" && !(await getActiveDelegatedConnection(tx, ownerId, source.delegated_connection_id))) {
        throw new DelegatedAccessDeniedError();
      }
      const active = await tx.query("SELECT 1 FROM source_operations WHERE source_id = $1 AND state IN ('Queued', 'Running')", [sourceId]);
      if ((active.rowCount ?? 0) > 0) throw new SyncAlreadyInProgressError();

      const op = await tx.query<OpRow>(
        `INSERT INTO source_operations (id, notebook_id, source_id, kind, trigger, initiator_id, idempotency_key, request_hash, state, progress, expected_revision)
         VALUES ($1, $2, $3, 'sync', $4, $5, $6, $7, 'Queued', 'Syncing', $8) RETURNING ${OP_COLUMNS}`,
        [randomUUID(), notebookId, sourceId, input.trigger, ownerId, input.attemptId, hash, source.active_revision]
      );
      await tx.query("UPDATE sources SET progress = 'Syncing' WHERE id = $1", [sourceId]);
      const operation = toOp(op.rows[0]!);
      await enqueueJob(tx, "sync", { operation_id: operation.id, source_id: sourceId });
      return { operation: toOperationDto(operation), replayed: false };
    });
  } catch (err) {
    // The partial unique index is the cross-instance backstop for the row-locked check above.
    if ((err as { code?: string }).code === "23505") throw new SyncAlreadyInProgressError();
    throw err;
  }
}

export async function getSourceOperation(
  db: Queryable,
  ownerId: string,
  notebookId: string,
  sourceId: string,
  operationId: string
): Promise<SourceOperationDto> {
  await requireOwnedNotebook(db, ownerId, notebookId);
  if (!isUuid(sourceId) || !isUuid(operationId)) throw new OperationNotFoundError();
  const result = await db.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE id = $1 AND source_id = $2 AND notebook_id = $3`, [
    operationId,
    sourceId,
    notebookId,
  ]);
  if (!result.rows[0]) throw new OperationNotFoundError();
  return toOperationDto(toOp(result.rows[0]));
}

/** Active (Queued/Running) operation per source of a notebook, for the source list DTO. */
export async function listActiveOperations(db: Queryable, notebookId: string): Promise<Map<string, SourceOperationRecord>> {
  const result = await db.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE notebook_id = $1 AND state IN ('Queued', 'Running')`, [notebookId]);
  return new Map(result.rows.map((r) => [r.source_id, toOp(r)]));
}

export async function getSourceProgress(db: Queryable, sourceId: string): Promise<SourceProgress | null> {
  const result = await db.query<{ progress: SourceProgress | null }>("SELECT progress FROM sources WHERE id = $1", [sourceId]);
  return result.rows[0]?.progress ?? null;
}

/** Trusted worker read of an operation (no owner context; publication re-verifies under the fence). */
export async function getOperationById(db: Queryable, operationId: string): Promise<SourceOperationRecord | null> {
  if (!isUuid(operationId)) return null;
  const result = await db.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE id = $1`, [operationId]);
  return result.rows[0] ? toOp(result.rows[0]) : null;
}

/** Most recent finished sync operation of a source (Inspector sync error / last result). */
export async function getLatestSyncOperation(db: Queryable, sourceId: string): Promise<SourceOperationRecord | null> {
  const result = await db.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE source_id = $1 AND kind = 'sync' ORDER BY created_at DESC LIMIT 1`, [sourceId]);
  return result.rows[0] ? toOp(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------------------------------------
// Worker claim, lease and fencing
// ---------------------------------------------------------------------------------------------------------

export type ClaimOutcome =
  | { status: "claimed"; fencingToken: number; operation: SourceOperationRecord }
  | { status: "busy" }
  | { status: "terminal"; operation: SourceOperationRecord }
  | { status: "missing" };

/**
 * Claims an operation for one worker attempt. Queued, or Running with an expired lease (crashed worker), becomes
 * Running under a new fencing token; a live lease is reported busy so a redelivered job never runs twice at once.
 */
export async function claimSourceOperation(db: Queryable, operationId: string, options: { leaseSeconds: number }): Promise<ClaimOutcome> {
  const claimed = await db.query<OpRow>(
    `UPDATE source_operations SET state = 'Running', fencing_token = fencing_token + 1, attempts = attempts + 1,
            lease_expires_at = now() + make_interval(secs => $2), updated_at = now()
     WHERE id = $1 AND (state = 'Queued' OR (state = 'Running' AND (lease_expires_at IS NULL OR lease_expires_at < now())))
     RETURNING ${OP_COLUMNS}`,
    [operationId, options.leaseSeconds]
  );
  if (claimed.rows[0]) {
    const operation = toOp(claimed.rows[0]);
    return { status: "claimed", fencingToken: operation.fencing_token, operation };
  }
  const current = await getOperationById(db, operationId);
  if (!current) return { status: "missing" };
  if (current.state === "Running" || current.state === "Queued") return { status: "busy" };
  return { status: "terminal", operation: current };
}

export async function renewOperationLease(db: Queryable, input: { operationId: string; fencingToken: number; leaseSeconds: number }): Promise<boolean> {
  const result = await db.query(
    `UPDATE source_operations SET lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
     WHERE id = $1 AND fencing_token = $2 AND state = 'Running'`,
    [input.operationId, input.fencingToken, input.leaseSeconds]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Gives up the lease after a retryable error so the next delivery can reclaim the same operation at once. */
export async function releaseOperationLease(db: Queryable, input: { operationId: string; fencingToken: number }): Promise<void> {
  await db.query("UPDATE source_operations SET lease_expires_at = now(), updated_at = now() WHERE id = $1 AND fencing_token = $2 AND state = 'Running'", [
    input.operationId,
    input.fencingToken,
  ]);
}

/** Records a progress substate (Fetching/Transcribing/Parsing); a re-syncing Ready source keeps showing Syncing. */
export async function setOperationProgress(db: Queryable, input: { operationId: string; fencingToken: number; progress: SourceProgress }): Promise<void> {
  const result = await db.query<{ source_id: string; kind: string }>(
    `UPDATE source_operations SET progress = $3, updated_at = now() WHERE id = $1 AND fencing_token = $2 AND state = 'Running'
     RETURNING source_id, kind`,
    [input.operationId, input.fencingToken, input.progress]
  );
  const row = result.rows[0];
  if (row && row.kind === "import") await db.query("UPDATE sources SET progress = $2 WHERE id = $1 AND status = 'Processing'", [row.source_id, input.progress]);
}

/** Upload/receipt progress for a Processing source without an operation (FR-SI-01 progress substates). */
export async function setSourceProgress(db: Queryable, sourceId: string, attemptId: string, progress: SourceProgress | null): Promise<void> {
  await db.query("UPDATE sources SET progress = $3 WHERE id = $1 AND attempt_id = $2 AND status = 'Processing'", [sourceId, attemptId, progress]);
}

/** A Drive import learns its exact Office type (Docs → DOCX, Slides → PPTX) after reading file metadata. */
export async function setImportedMediaType(db: Queryable, sourceId: string, attemptId: string, mediaType: string): Promise<void> {
  await db.query("UPDATE sources SET media_type = $3 WHERE id = $1 AND attempt_id = $2 AND status = 'Processing'", [sourceId, attemptId, mediaType]);
}

/**
 * Terminal failure of the claimed attempt. An import fails its source (slot released exactly once, dismissible
 * error row); a sync keeps the committed Ready revision and slot untouched. Returns false when fenced.
 */
export async function failSourceOperation(
  db: Queryable,
  input: { operationId: string; fencingToken: number; code: string; message: string }
): Promise<boolean> {
  const result = await db.query<{ source_id: string; kind: string }>(
    `UPDATE source_operations SET state = 'Failed', progress = NULL, error_code = $3, error_message = $4, lease_expires_at = NULL,
            finished_at = now(), updated_at = now()
     WHERE id = $1 AND fencing_token = $2 AND state = 'Running' RETURNING source_id, kind`,
    [input.operationId, input.fencingToken, input.code, input.message]
  );
  const row = result.rows[0];
  if (!row) return false;
  if (row.kind === "import") {
    const src = await db.query<{ attempt_id: string }>("SELECT attempt_id FROM sources WHERE id = $1", [row.source_id]);
    if (src.rows[0]) await failSource(db, { sourceId: row.source_id, attemptId: src.rows[0].attempt_id, code: input.code, message: input.message });
  } else {
    await db.query("UPDATE sources SET progress = NULL WHERE id = $1", [row.source_id]);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Ready-preserving fenced replacement (FR-SI-05, D15)
// ---------------------------------------------------------------------------------------------------------

export interface CommitSyncInput {
  operationId: string;
  fencingToken: number;
  sourceId: string;
  expectedRevision: number;
  byteSize: number;
  wordCount: number;
  pageCount: number;
  embeddingModel: string;
  contentHash: string;
  pages: SyncPage[];
  chunks: PublishChunk[];
  manifest?: RevisionManifest | undefined;
  canonicalUrl?: string | undefined;
}

export type CommitOutcome =
  | { published: true; revision: number }
  | { published: false; reason: "fenced" | "stale_token" | "not_ready" | "revision_changed" };

/**
 * Atomically installs a fully validated replacement revision. One short transaction: notebook (share) → source
 * (update) → operation (update); compares fencing token, expected revision and Ready state; writes pages, chunks
 * and embeddings of the new revision; swaps `active_revision`, hash and `last_synced_at`; completes the operation
 * and records the publication event. No network call happens inside. Older revisions remain only as historical
 * evidence (C-02 reads filter the exact active revision).
 */
export async function commitSyncReplacement(pool: Pool, input: CommitSyncInput): Promise<CommitOutcome> {
  const revision = input.expectedRevision + 1;
  validateRevisionContent({ ...input, revision });

  return withTransaction(pool, async (tx) => {
    const source = await lockSourceForTransition(tx, input.sourceId);
    if (!source) return { published: false, reason: "fenced" };
    const op = await tx.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE id = $1 AND source_id = $2 FOR UPDATE`, [input.operationId, input.sourceId]);
    const operation = op.rows[0] ? toOp(op.rows[0]) : null;
    if (!operation) return { published: false, reason: "fenced" };
    if (operation.state !== "Running" || operation.fencing_token !== input.fencingToken) return { published: false, reason: "stale_token" };
    if (source.status !== "Ready") return { published: false, reason: "not_ready" };
    if (source.active_revision !== input.expectedRevision || operation.expected_revision !== input.expectedRevision) {
      return { published: false, reason: "revision_changed" };
    }

    await insertRevisionContent(tx, source.notebook_id, {
      ...input,
      revision,
      manifest: { ...input.manifest, contentHash: input.contentHash, canonicalUrl: input.canonicalUrl ?? input.manifest?.canonicalUrl },
    });
    await tx.query(
      `UPDATE sources SET active_revision = $2, word_count = $3, actual_bytes = $4, content_hash = $5,
              canonical_url = coalesce($6, canonical_url), last_synced_at = now(), progress = NULL, updated_at = now()
       WHERE id = $1`,
      [input.sourceId, revision, input.wordCount, input.byteSize, input.contentHash, input.canonicalUrl ?? null]
    );
    await tx.query(
      `UPDATE source_operations SET state = 'Succeeded', progress = NULL, committed_revision = $2, lease_expires_at = NULL,
              finished_at = now(), updated_at = now() WHERE id = $1`,
      [input.operationId, revision]
    );
    await recordPublicationEvent(tx, source.notebook_id, input.sourceId, revision);
    return { published: true, revision };
  });
}

/** Upstream content is byte-identical to the committed revision: record the sync time, keep the revision. */
export async function completeSyncUnchanged(
  pool: Pool,
  input: { operationId: string; fencingToken: number; sourceId: string; expectedRevision: number }
): Promise<CommitOutcome> {
  return withTransaction(pool, async (tx) => {
    const source = await lockSourceForTransition(tx, input.sourceId);
    if (!source) return { published: false, reason: "fenced" };
    const op = await tx.query<OpRow>(`SELECT ${OP_COLUMNS} FROM source_operations WHERE id = $1 AND source_id = $2 FOR UPDATE`, [input.operationId, input.sourceId]);
    const operation = op.rows[0] ? toOp(op.rows[0]) : null;
    if (!operation) return { published: false, reason: "fenced" };
    if (operation.state !== "Running" || operation.fencing_token !== input.fencingToken) return { published: false, reason: "stale_token" };
    if (source.active_revision !== input.expectedRevision) return { published: false, reason: "revision_changed" };
    await tx.query("UPDATE sources SET last_synced_at = now(), progress = NULL WHERE id = $1", [input.sourceId]);
    await tx.query(
      `UPDATE source_operations SET state = 'Succeeded', progress = NULL, committed_revision = $2, lease_expires_at = NULL,
              finished_at = now(), updated_at = now() WHERE id = $1`,
      [input.operationId, input.expectedRevision]
    );
    return { published: true, revision: input.expectedRevision };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Rename and removal (FR-SI-05, FR-WM-07, NFR-EVAL-04)
// ---------------------------------------------------------------------------------------------------------

export async function renameSource(pool: Pool, ownerId: string, notebookId: string, sourceId: string, raw: unknown): Promise<SourceRecord> {
  const parsed = SourceRenameInputSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("InvalidTitle", 422, "Source title must be 1–200 Unicode code points after trimming");
  return withTransaction(pool, async (tx) => {
    await requireOwnedNotebook(tx, ownerId, notebookId, "share");
    if (!isUuid(sourceId)) throw new SourceNotFoundError();
    const updated = await tx.query<SourceRow>(
      `UPDATE sources SET title = $3 WHERE notebook_id = $1 AND id = $2 RETURNING ${SOURCE_COLUMNS}`,
      [notebookId, sourceId, parsed.data.title]
    );
    if (!updated.rows[0]) throw new SourceNotFoundError();
    return toSourceRecord(updated.rows[0]);
  });
}

export function sourceObjectPrefixOf(notebookId: string, sourceId: string): string {
  return `notebooks/${notebookId}/sources/${sourceId}/`;
}

/**
 * Authoritative removal: one transaction under notebook (share) → source (update) deletes the source row, which
 * cascades revisions, canonical pages, chunks, operations (fencing any worker), events, channels, guides and
 * note provenance; the slot is released and the next C-02 read cannot see it (0 ms staleness). Object purge runs
 * afterwards through the durable cleanup ledger (waits for any outstanding upload capability).
 */
export async function deleteSource(pool: Pool, ownerId: string, notebookId: string, sourceId: string): Promise<{ deletion_id: string }> {
  return withTransaction(pool, async (tx) => {
    await requireOwnedNotebook(tx, ownerId, notebookId, "share");
    if (!isUuid(sourceId)) throw new SourceNotFoundError();
    const row = await tx.query<{ upload_expires_at: Date | null }>("SELECT upload_expires_at FROM sources WHERE notebook_id = $1 AND id = $2 FOR UPDATE", [notebookId, sourceId]);
    if (!row.rows[0]) throw new SourceNotFoundError();
    const deletionId = randomUUID();
    await tx.query(
      `INSERT INTO cleanup_operations (id, notebook_id, owner_id, object_prefix, status, quiescent_after)
       VALUES ($1, $2, $3, $4, 'Pending', greatest(now(), coalesce($5::timestamptz, now())))`,
      [deletionId, notebookId, ownerId, sourceObjectPrefixOf(notebookId, sourceId), row.rows[0].upload_expires_at]
    );
    await enqueueJob(tx, "cleanup", { deletion_id: deletionId });
    await tx.query("DELETE FROM sources WHERE notebook_id = $1 AND id = $2", [notebookId, sourceId]);
    await tx.query("UPDATE notebooks SET updated_at = greatest(clock_timestamp(), created_at) WHERE id = $1", [notebookId]);
    return { deletion_id: deletionId };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Durable publication events (FR-SI-02 Source Guide trigger, D16)
// ---------------------------------------------------------------------------------------------------------

export interface PublicationEvent {
  id: string;
  notebook_id: string;
  source_id: string;
  revision: number;
  attempts: number;
}

/** Pending events whose revision is still the source's active Ready revision; superseded ones are closed. */
export async function claimPendingPublicationEvents(db: Queryable, limit = 50): Promise<PublicationEvent[]> {
  await db.query(
    `UPDATE source_publication_events e SET status = 'Done', processed_at = now()
     FROM sources s WHERE e.status = 'Pending' AND s.id = e.source_id AND (s.status <> 'Ready' OR s.active_revision <> e.revision)`
  );
  const result = await db.query<PublicationEvent>(
    `UPDATE source_publication_events SET attempts = attempts + 1
     WHERE id IN (SELECT id FROM source_publication_events WHERE status = 'Pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, notebook_id, source_id, revision, attempts`,
    [limit]
  );
  return result.rows;
}

export async function completePublicationEvent(db: Queryable, eventId: string): Promise<void> {
  await db.query("UPDATE source_publication_events SET status = 'Done', processed_at = now() WHERE id = $1", [eventId]);
}

// ---------------------------------------------------------------------------------------------------------
// Provider notification channels (webhook re-sync)
// ---------------------------------------------------------------------------------------------------------

export const hashChannelToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function registerSyncChannel(
  db: Queryable,
  input: { channelId: string; notebookId: string; sourceId: string; token: string; expiresAt: Date }
): Promise<void> {
  await db.query(
    `INSERT INTO source_sync_channels (channel_id, notebook_id, source_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (channel_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at`,
    [input.channelId, input.notebookId, input.sourceId, hashChannelToken(input.token), input.expiresAt]
  );
}

/**
 * Maps an authenticated provider notification to its source and owner. The channel token is compared as a hash;
 * an unknown, expired or mismatched channel resolves to null (the caller answers without revealing why).
 */
export async function resolveSyncChannel(
  db: Queryable,
  channelId: string,
  token: string
): Promise<{ notebookId: string; sourceId: string; ownerId: string } | null> {
  const result = await db.query<{ notebook_id: string; source_id: string; owner_id: string; token_hash: string }>(
    `SELECT c.notebook_id, c.source_id, n.owner_id, c.token_hash FROM source_sync_channels c JOIN notebooks n ON n.id = c.notebook_id
     WHERE c.channel_id = $1 AND c.expires_at > now()`,
    [channelId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const a = Buffer.from(row.token_hash);
  const b = Buffer.from(hashChannelToken(token));
  if (a.length !== b.length || !a.equals(b)) return null;
  return { notebookId: row.notebook_id, sourceId: row.source_id, ownerId: row.owner_id };
}

// ---------------------------------------------------------------------------------------------------------
// Delegated OAuth authorization state (D11; security review 2026-10-23)
// ---------------------------------------------------------------------------------------------------------

export async function createOAuthState(
  db: Queryable,
  input: { nonceHash: string; userId: string; codeVerifier: string; returnTo: string; ttlSeconds: number }
): Promise<void> {
  await db.query("DELETE FROM oauth_states WHERE expires_at < now()");
  await db.query(
    `INSERT INTO oauth_states (nonce_hash, user_id, code_verifier, return_to, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [input.nonceHash, input.userId, input.codeVerifier, input.returnTo, input.ttlSeconds]
  );
}

/** Atomically consumes a pending authorization: exactly once, for that browser nonce and that user, unexpired. */
export async function consumeOAuthState(db: Queryable, nonceHash: string, userId: string): Promise<{ codeVerifier: string; returnTo: string } | null> {
  if (!isUuid(userId)) return null;
  const result = await db.query<{ code_verifier: string; return_to: string }>(
    "DELETE FROM oauth_states WHERE nonce_hash = $1 AND user_id = $2 AND expires_at > now() RETURNING code_verifier, return_to",
    [nonceHash, userId]
  );
  const row = result.rows[0];
  return row ? { codeVerifier: row.code_verifier, returnTo: row.return_to } : null;
}
