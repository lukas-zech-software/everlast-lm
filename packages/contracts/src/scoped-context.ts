import { z } from "zod";
import type { UnifiedDocumentChunk } from "./document-chunk.ts";
import { AppError } from "./errors.ts";

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * C-02: Scoped Context Provider Interface & Request Envelope (C-02, FR-WM-04, NFR-EVAL-04).
 * Single shared contract boundary for request-bound context retrieval,
 * submission snapshots, and provenance eligibility validation.
 */

export class EmptyScopeError extends AppError {
  constructor(message = "active_source_ids must contain at least one Ready source ID") {
    super("EmptyScope", 400, message);
    this.name = "EmptyScopeError";
  }
}

export class InvalidScopeError extends AppError {
  constructor(message = "Invalid scope: cross-notebook or unauthorized source ID") {
    super("InvalidScope", 403, message);
    this.name = "InvalidScopeError";
  }
}

export class SourceNotReadyError extends AppError {
  constructor(message = "Selected source is not Ready") {
    super("SourceNotReady", 409, message);
    this.name = "SourceNotReadyError";
  }
}

export class SourceSnapshotInvalidError extends AppError {
  constructor(message = "Source snapshot invalid: source revision has changed or was deleted") {
    super("SourceSnapshotInvalid", 409, message);
    this.name = "SourceSnapshotInvalidError";
  }
}

export const SourceRevisionPairSchema = z
  .object({
    source_id: z.uuid("source_id must be a valid UUID"),
    revision: z.number().int().positive("revision must be a positive integer"),
  })
  .strict();

export type SourceRevisionPair = z.infer<typeof SourceRevisionPairSchema>;

export const ScopedContextRequestSchema = z
  .object({
    notebook_id: z.uuid("notebook_id must be a valid UUID"),
    active_source_ids: z
      .array(z.uuid("source ID must be a valid UUID"))
      .min(1, "active_source_ids must contain at least 1 source ID"),
    source_revisions: z.array(SourceRevisionPairSchema).optional(),
    query: z.string().optional(),
    purpose: z.enum(["inspection", "generation"]).default("generation"),
  })
  .strict();

export type ScopedContextRequest = z.input<typeof ScopedContextRequestSchema>;
export type ScopedContextRequestOutput = z.output<typeof ScopedContextRequestSchema>;

export interface ScopedContextEnvelope extends ScopedContextRequestOutput {
  principal: { subject: string };
}

export interface ScopedContextProvider {
  getScopedContext: (
    notebook_id: string,
    active_source_ids: string[],
  ) => Promise<UnifiedDocumentChunk[]>;
}

export interface CreateEnvelopeInput {
  notebook_id: string;
  active_source_ids: string[];
  principal: { subject: string };
  purpose?: "inspection" | "generation";
  query?: string;
  source_revisions?: SourceRevisionPair[];
}

/**
 * Creates and validates a request-bound scoped context envelope.
 * Enforces non-empty active sources (no "all Ready" server fallback) and normalizes source IDs to a sorted unique set.
 */
export function createScopedContextEnvelope(input: CreateEnvelopeInput): ScopedContextEnvelope {
  if (!Array.isArray(input.active_source_ids) || input.active_source_ids.length === 0) {
    throw new EmptyScopeError();
  }

  // Normalize duplicate source IDs into a unique sorted set
  const normalizedSourceIds = [...new Set(input.active_source_ids)].sort();

  const validated = ScopedContextRequestSchema.parse({
    notebook_id: input.notebook_id,
    active_source_ids: normalizedSourceIds,
    source_revisions: input.source_revisions,
    query: input.query,
    purpose: input.purpose ?? "generation",
  });

  return {
    ...validated,
    principal: input.principal,
  };
}

export interface CacheKeyParams {
  notebook_id: string;
  source_revisions: SourceRevisionPair[];
  subject: string;
  language?: string;
  generation_parameters?: Record<string, unknown>;
}

/**
 * Deterministically computes a context cache key across notebook, sorted revisions, authorization, and parameters.
 */
export function computeContextCacheKey(params: CacheKeyParams): string {
  const sortedRevisions = [...params.source_revisions].sort((a, b) =>
    a.source_id.localeCompare(b.source_id),
  );

  const payload = {
    notebook_id: params.notebook_id,
    source_revisions: sortedRevisions,
    subject: params.subject,
    language: params.language ?? "default",
    generation_parameters: params.generation_parameters ?? {},
  };

  return sha256Hex(JSON.stringify(payload));
}

/**
 * Validates whether a prior turn's provenance is eligible under current active sources.
 * If any source or revision used in the prior turn is not present in activeSnapshot, returns false (both Q&A excluded).
 * Empty or missing provenance is strictly ineligible.
 */
export function isTurnProvenanceEligible(
  turnProvenance: SourceRevisionPair[] | undefined | null,
  activeSnapshot: SourceRevisionPair[],
): boolean {
  if (!turnProvenance || turnProvenance.length === 0) {
    return false;
  }

  const activeMap = new Map<string, number>();
  for (const pair of activeSnapshot) {
    activeMap.set(pair.source_id, pair.revision);
  }

  for (const used of turnProvenance) {
    const activeRevision = activeMap.get(used.source_id);
    if (activeRevision === undefined || activeRevision !== used.revision) {
      return false;
    }
  }

  return true;
}

export interface TurnProvenanceRecord {
  used_sources: SourceRevisionPair[];
  cited_sources?: SourceRevisionPair[];
}

export interface ConversationTurn {
  turn_id: string;
  question: string;
  answer: string;
  provenance?: TurnProvenanceRecord | null;
  is_placeholder?: boolean;
  placeholder_reason?: "deleted" | "deselected" | "revoked";
}

export interface HistoryFilterOptions {
  includePlaceholders?: boolean;
  deletedSourceIds?: string[];
}

/**
 * Filters conversation history so that both question and answer are excluded if any used source is ineligible.
 */
export function filterConversationHistoryByProvenance(
  history: ConversationTurn[],
  activeSnapshot: SourceRevisionPair[],
  options?: HistoryFilterOptions,
): ConversationTurn[] {
  const results: ConversationTurn[] = [];

  for (const turn of history) {
    if (!turn.provenance?.used_sources || turn.provenance.used_sources.length === 0) {
      continue;
    }

    const isEligible = isTurnProvenanceEligible(turn.provenance.used_sources, activeSnapshot);

    if (isEligible) {
      results.push(turn);
    } else if (options?.includePlaceholders) {
      const usedIds = new Set(turn.provenance.used_sources.map((s) => s.source_id));
      const isDeleted = options.deletedSourceIds?.some((d) => usedIds.has(d));
      results.push({
        ...turn,
        is_placeholder: true,
        placeholder_reason: isDeleted ? "deleted" : "deselected",
      });
    }
  }

  return results;
}

/**
 * Validates that all requested active source IDs belong to the given notebook.
 */
export function validateScopeSourceOwnership(
  notebookId: string,
  activeSourceIds: string[],
  sourceNotebookMap: Record<string, string>,
): void {
  for (const sourceId of activeSourceIds) {
    const mappedNb = sourceNotebookMap[sourceId];
    if (!mappedNb) {
      throw new InvalidScopeError(`Unknown source ID ${sourceId}`);
    }
    if (mappedNb !== notebookId) {
      throw new InvalidScopeError(
        `Cross-notebook source violation: source ${sourceId} belongs to ${mappedNb}, expected ${notebookId}`,
      );
    }
  }
}

/**
 * Validates that all requested active source IDs are in Ready status.
 */
export function validateSourceStatusReady(
  activeSourceIds: string[],
  sourceStatusMap: Record<string, string>,
): void {
  for (const sourceId of activeSourceIds) {
    const status = sourceStatusMap[sourceId];
    if (status !== "Ready") {
      throw new InvalidScopeError(
        `Non-Ready source status violation: source ${sourceId} is currently ${status ?? "unknown"}`,
      );
    }
  }
}

/**
 * Defense-in-depth result check (C-02, NFR-EVAL-04): every returned chunk must belong to the captured
 * (source_id, revision) snapshot. A single foreign or stale chunk rejects the entire result.
 */
export function filterScopedChunks(
  snapshot: SourceRevisionPair[],
  chunks: UnifiedDocumentChunk[],
): UnifiedDocumentChunk[] {
  if (snapshot.length === 0) {
    throw new EmptyScopeError();
  }
  const allowed = new Map(snapshot.map((pair) => [pair.source_id, pair.revision]));
  for (const chunk of chunks) {
    if (allowed.get(chunk.source_id) !== chunk.revision) {
      throw new InvalidScopeError(
        `Scoped result contained chunk ${chunk.chunk_id} outside the captured snapshot`,
      );
    }
  }
  return chunks;
}

/**
 * Inspection reads are pure (FR-SI-04, C-02): returns a frozen copy of the generation selection so callers
 * can prove an inspector read left it untouched.
 */
export function assertInspectionIsolation(
  activeGenerationSet: ReadonlySet<string>,
  inspectedSourceId: string,
): ReadonlySet<string> {
  const snapshot = new Set(activeGenerationSet);
  if (!inspectedSourceId) {
    throw new InvalidScopeError("Inspection requires an explicit source ID");
  }
  return snapshot;
}
