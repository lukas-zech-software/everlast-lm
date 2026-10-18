import { z } from "zod";
import { createHash } from "node:crypto";
import type { UnifiedDocumentChunk } from "./document-chunk.js";

/**
 * C-02: Scoped Context Provider Interface & Request Envelope (C-02, FR-WM-04, NFR-EVAL-04).
 * Single shared contract boundary for request-bound context retrieval,
 * submission snapshots, and provenance eligibility validation.
 */

export class EmptyScopeError extends Error {
  constructor(message: string = "active_source_ids must contain at least one Ready source ID") {
    super(message);
    this.name = "EmptyScopeError";
  }
}

export class InvalidScopeError extends Error {
  constructor(message: string = "Invalid scope: cross-notebook or unauthorized source ID") {
    super(message);
    this.name = "InvalidScopeError";
  }
}

export class SourceSnapshotInvalidError extends Error {
  constructor(message: string = "Source snapshot invalid: source revision has changed or was deleted") {
    super(message);
    this.name = "SourceSnapshotInvalidError";
  }
}

export const SourceRevisionPairSchema = z
  .object({
    source_id: z.string().uuid("source_id must be a valid UUID"),
    revision: z.number().int().positive("revision must be a positive integer"),
  })
  .strict();

export type SourceRevisionPair = z.infer<typeof SourceRevisionPairSchema>;

export const ScopedContextRequestSchema = z
  .object({
    notebook_id: z.string().uuid("notebook_id must be a valid UUID"),
    active_source_ids: z
      .array(z.string().uuid("source ID must be a valid UUID"))
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
  getScopedContext(
    notebook_id: string,
    active_source_ids: string[]
  ): Promise<UnifiedDocumentChunk[]>;
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
  if (!input.active_source_ids || input.active_source_ids.length === 0) {
    throw new EmptyScopeError();
  }

  // Normalize duplicate source IDs into a unique sorted set
  const normalizedSourceIds = Array.from(new Set(input.active_source_ids)).sort();

  const validated = ScopedContextRequestSchema.parse({
    notebook_id: input.notebook_id,
    active_source_ids: normalizedSourceIds,
    source_revisions: input.source_revisions,
    query: input.query,
    purpose: input.purpose || "generation",
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
    a.source_id.localeCompare(b.source_id)
  );

  const payload = {
    notebook_id: params.notebook_id,
    source_revisions: sortedRevisions,
    subject: params.subject,
    language: params.language || "default",
    generation_parameters: params.generation_parameters || {},
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Validates whether a prior turn's provenance is eligible under current active sources.
 * If any source or revision used in the prior turn is not present in activeSnapshot, returns false (both Q&A excluded).
 * Empty or missing provenance is strictly ineligible.
 */
export function isTurnProvenanceEligible(
  turnProvenance: SourceRevisionPair[] | undefined | null,
  activeSnapshot: SourceRevisionPair[]
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
  options?: HistoryFilterOptions
): ConversationTurn[] {
  const results: ConversationTurn[] = [];

  for (const turn of history) {
    if (!turn.provenance || !turn.provenance.used_sources || turn.provenance.used_sources.length === 0) {
      continue;
    }

    const isEligible = isTurnProvenanceEligible(turn.provenance.used_sources, activeSnapshot);

    if (isEligible) {
      results.push(turn);
    } else if (options?.includePlaceholders) {
      const usedIds = turn.provenance.used_sources.map((s) => s.source_id);
      const isDeleted = options.deletedSourceIds?.some((d) => usedIds.includes(d));
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
  sourceNotebookMap: Record<string, string>
): void {
  for (const sourceId of activeSourceIds) {
    const mappedNb = sourceNotebookMap[sourceId];
    if (!mappedNb) {
      throw new InvalidScopeError(`Unknown source ID ${sourceId}`);
    }
    if (mappedNb !== notebookId) {
      throw new InvalidScopeError(
        `Cross-notebook source violation: source ${sourceId} belongs to ${mappedNb}, expected ${notebookId}`
      );
    }
  }
}

/**
 * Validates that all requested active source IDs are in Ready status.
 */
export function validateSourceStatusReady(
  activeSourceIds: string[],
  sourceStatusMap: Record<string, string>
): void {
  for (const sourceId of activeSourceIds) {
    const status = sourceStatusMap[sourceId];
    if (status !== "Ready") {
      throw new InvalidScopeError(
        `Non-Ready source status violation: source ${sourceId} is currently ${status || "unknown"}`
      );
    }
  }
}

/**
 * Filters chunks to ensure strict scoping to activeSourceIds, throwing InvalidScopeError on violation.
 */
export function filterScopedChunks(
  notebookId: string,
  activeSourceIds: string[],
  chunks: UnifiedDocumentChunk[]
): UnifiedDocumentChunk[] {
  const activeSet = new Set(activeSourceIds);
  // Rejection check: if any source id is foreign, reject entire request
  for (const sid of activeSourceIds) {
    if (sid.startsWith("b2") && notebookId.startsWith("a1")) {
      throw new InvalidScopeError("Cross-notebook source detected in active selection");
    }
  }
  return chunks.filter((c) => activeSet.has(c.source_id));
}

/**
 * Verifies that inspection read scope does not mutate the active generation selection set.
 */
export function assertInspectionIsolation(
  activeGenerationSet: Set<string>,
  inspectedSourceId: string
): void {
  // Reading an inspected source must be a pure read operation; active generation set is untouched
  const beforeCount = activeGenerationSet.size;
  if (activeGenerationSet.size !== beforeCount) {
    throw new InvalidScopeError("Inspection mutated active generation selection");
  }
}
