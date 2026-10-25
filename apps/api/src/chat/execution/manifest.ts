import { createHash } from "node:crypto";
import {
  CanonicalNumberSchema,
  ManifestEntrySchema,
  type ManifestEntry,
  type ManifestValue,
  type SourceRevisionPair,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import type { SandboxFile } from "./runtime.ts";

/**
 * Immutable sandbox input manifest (FR-GC-08, C-01/C-02, NFR-EVAL-04; specs/010 T013).
 * Inputs are built ONLY from chunks the request-bound C-02 provider supplied for the captured snapshot. Every value
 * must literally occur in its cited chunk (no invented, inferred or model-computed numbers), keeps an explicit unit
 * and its C-01 chunk ID. Only those values — never other chunk text, URLs or credentials — are copied into the
 * sandbox as `data.json`. Stored sources are never reachable from the sandbox.
 */

export const MANIFEST_FILENAME = "data.json";
/** Whole-table calculations read the complete snapshot through C-02 up to this bound; beyond it → insufficient. */
export const MAX_COMPUTE_CHUNKS = 400;
export const MAX_DATASET_VALUES = 5_000;

export type ManifestRefusal = "unknown_chunk" | "out_of_snapshot" | "unverified_value" | "unsafe_text" | "insufficient_evidence" | "invalid_value";

export class ManifestError extends Error {
  readonly reason: ManifestRefusal;
  constructor(reason: ManifestRefusal, message: string) {
    super(message);
    this.name = "ManifestError";
    this.reason = reason;
  }
}

export interface DatasetValue {
  label: string;
  value: string;
  unit: string | null;
  chunk_id: string;
}

export interface InputManifest {
  readonly entries: readonly ManifestEntry[];
  readonly files: readonly SandboxFile[];
  readonly values: readonly ManifestValue[];
  /** Citation universe of computed results: chunks that supplied at least one input value. */
  readonly supportingChunkIds: readonly string[];
}

const UNSAFE = /(?:[a-z][a-z0-9+.-]*:\/\/|\.\.[/\\]|^[/\\]|bearer\s|ya29\.|AIza[0-9A-Za-z_-]{10,}|-----BEGIN|password|secret)/i;

/**
 * Numeric literals in source text, as every reading a careful copier could make ("1,200" → 1200, "$1.2B" → 1.2,
 * "-3.5%" → -3.5, "1.234,5" → 1234.5, "3,75" → 3.75). A hyphen counts as a minus sign only when it does not follow a
 * letter or digit, so ranges and IDs ("10-20", "FY2023-2024") keep both numbers positive.
 */
export function numericTokens(text: string): number[] {
  const out = new Set<number>();
  const add = (literal: string) => {
    const value = Number(literal);
    if (Number.isFinite(value)) out.add(value);
  };
  const SIGN = "(?:(?<![\\p{L}\\p{N}])-)?";
  // Dot-decimal with optional comma thousands.
  for (const m of text.matchAll(new RegExp(`${SIGN}(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)`, "gu"))) add(m[0].replace(/,/g, ""));
  // Comma-decimal with optional dot thousands ("1.234,5", "3,75"); a single comma before exactly three digits stays a thousands separator.
  for (const m of text.matchAll(new RegExp(`${SIGN}(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+,(?:\\d{1,2}|\\d{4,})(?!\\d))`, "gu"))) {
    add(m[0].replace(/\./g, "").replace(",", "."));
  }
  return [...out];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export function buildInputManifest(input: {
  snapshot: SourceRevisionPair[];
  /** The exact chunks supplied by the request's C-02 provider (the citation universe). */
  chunks: UnifiedDocumentChunk[];
  dataset: DatasetValue[];
}): InputManifest {
  if (input.dataset.length === 0) throw new ManifestError("insufficient_evidence", "No source values were identified for the calculation");
  if (input.dataset.length > MAX_DATASET_VALUES) throw new ManifestError("insufficient_evidence", "Too many input values");
  const universe = new Map(input.chunks.map((c) => [c.chunk_id, c]));
  const scope = new Set(input.snapshot.map((p) => `${p.source_id}:${p.revision}`));
  const values: ManifestValue[] = [];
  const supporting: string[] = [];
  for (const item of input.dataset) {
    const chunk = universe.get(item.chunk_id);
    if (!chunk) throw new ManifestError("unknown_chunk", "A value cites a chunk that was not supplied for this request");
    if (!scope.has(`${chunk.source_id}:${chunk.revision}`)) throw new ManifestError("out_of_snapshot", "A value cites a chunk outside the captured snapshot");
    if (UNSAFE.test(item.label) || (item.unit !== null && UNSAFE.test(item.unit))) throw new ManifestError("unsafe_text", "Labels and units must be plain text");
    if (!CanonicalNumberSchema.safeParse(item.value).success) throw new ManifestError("invalid_value", "Input values must be finite numbers");
    const numeric = Number(item.value);
    if (!numericTokens(chunk.text).some((t) => t === numeric)) {
      throw new ManifestError("unverified_value", "An input value does not occur in its cited source passage");
    }
    values.push({ label: item.label, value: item.value, unit: item.unit, chunk_id: item.chunk_id });
    if (!supporting.includes(item.chunk_id)) supporting.push(item.chunk_id);
  }
  const content = Buffer.from(
    JSON.stringify({ values: values.map((v) => ({ label: v.label, value: Number(v.value), unit: v.unit, chunk_id: v.chunk_id })) }),
    "utf8"
  );
  const entry = ManifestEntrySchema.parse({
    filename: MANIFEST_FILENAME,
    digest: createHash("sha256").update(content).digest("hex"),
    byte_count: content.length,
    values,
    supporting_chunk_ids: supporting,
  });
  return deepFreeze({
    entries: [entry],
    files: [{ name: MANIFEST_FILENAME, content, mimeType: "application/json" }],
    values,
    supportingChunkIds: supporting,
  });
}

/**
 * Evidence completeness (plan "targeted retrieval is not whole-table evidence"): when the top-k retrieval did not
 * cover every chunk of the captured snapshot, a calculation re-reads the complete snapshot through C-02 (bounded);
 * when even that bound is exceeded the honest answer is insufficient evidence, never a partial calculation.
 */
export function evidencePlan(input: { retrieved: number; snapshotTotal: number }): { kind: "complete" | "expand" | "insufficient" } {
  if (input.snapshotTotal > MAX_COMPUTE_CHUNKS) return { kind: "insufficient" };
  if (input.retrieved >= input.snapshotTotal) return { kind: "complete" };
  return { kind: "expand" };
}
