import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { StoredCitation } from "@everlast/db";
import type { CodeExecutionFailureCode, ComputedResult } from "@everlast/contracts";
import type { Computation, GroundedDraft } from "./draft.ts";
import { numericTokens } from "./execution/manifest.ts";

/**
 * Deterministic citation verifier (FR-GC-01, FR-GC-02, D13, NFR-EVAL-02). Runs on every draft, cited or not.
 * The retrieved chunk set for this answer is the only valid citation universe. Any invalid or missing citation
 * on a factual claim withholds the whole draft and yields the refusal — no stripping, no regeneration.
 */

export const REFUSAL_UNVERIFIED = "I can't give a verified answer to this from the selected sources.";

export function notInSourcesMessage(topic?: string): string {
  const clean = sanitizeTopic(topic);
  return clean
    ? `The selected sources do not contain information about ${clean}.`
    : "The selected sources do not contain information to answer this question.";
}

function sanitizeTopic(topic?: string): string {
  const clean = (topic ?? "").replace(/\[\[/g, "[").replace(/\s+/g, " ").trim();
  // Trailing punctuation removed in linear time (no backtracking regex on model output).
  let end = clean.length;
  while (end > 0 && ".?!".includes(clean[end - 1]!)) end--;
  return clean.slice(0, end).slice(0, 120);
}

export type VerificationResult =
  | { kind: "answer"; content: string; citations: StoredCitation[] }
  | { kind: "refusal"; content: string; reason: "not_in_sources" | "invalid_citation" | "uncited_claim" | "unverifiable" | "insufficient_evidence" }
  /** FR-GC-08 FR-014: a focused follow-up question; carries no source-derived claim and starts no execution. */
  | { kind: "clarification"; content: string }
  /** FR-GC-08 FR-001: verified preamble + computation to run; becomes an answer only after sandbox validation. */
  | { kind: "compute"; preamble: { text: string; chunkIds: string[] }[]; computation: Computation };

export const REFUSAL_INSUFFICIENT_VALUES =
  "I can't calculate this from the selected sources: the values the calculation needs could not be verified in them.";
export const REFUSAL_TOO_LARGE_FOR_COMPLETE_DATA =
  "I can't calculate this from complete data: the selected sources are too large to read in full for one calculation. Select fewer sources and ask again.";

/** Inline badge marker stored in content and rendered as a citation pill by the UI. */
export function badgeMarker(n: number): string {
  return `[[${n}]]`;
}

export function verifyDraft(draft: GroundedDraft, retrieved: UnifiedDocumentChunk[]): VerificationResult {
  const universe = new Map(retrieved.map((c) => [c.chunk_id, c]));
  if (draft.status === "clarify") {
    return { kind: "clarification", content: (draft.clarification_question ?? "").replace(/\[\[/g, "[").replace(/\]\]/g, "]").trim().slice(0, 500) };
  }
  if (draft.status === "compute") return verifyComputeDraft(draft, universe);
  const claims = draft.sentences.filter((s) => s.kind === "claim");

  if (draft.status === "not_in_sources" || claims.length === 0) {
    return { kind: "refusal", content: notInSourcesMessage(draft.missing_topic), reason: "not_in_sources" };
  }

  const badgeOf = new Map<string, number>();
  const citations: StoredCitation[] = [];
  const parts: string[] = [];
  for (const sentence of draft.sentences) {
    const ids = Array.from(new Set(sentence.citations));
    if (sentence.kind === "claim" && ids.length === 0) {
      return { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "uncited_claim" };
    }
    for (const id of ids) {
      const chunk = universe.get(id);
      if (!chunk) return { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "invalid_citation" };
      if (!badgeOf.has(id)) {
        badgeOf.set(id, badgeOf.size + 1);
        citations.push({ badge_number: badgeOf.size, source_id: chunk.source_id, chunk_id: id, revision: chunk.revision });
      }
    }
    const text = sentence.text.replace(/\[\[/g, "[").trim();
    parts.push(`${text}${ids.map((id) => badgeMarker(badgeOf.get(id)!)).join("")}`);
  }
  return { kind: "answer", content: parts.join(" "), citations };
}

/** Plain-text rendering of a stored answer for history context (markers removed). */
export function stripBadges(content: string): string {
  return content.replace(/\[\[\d+\]\]/g, "");
}

/**
 * Compute drafts (FR-GC-08, FR-012): preamble claims follow the ordinary citation rules and, in addition, may not
 * contain any number that their cited chunks do not literally contain — the model never publishes its own
 * arithmetic. The computation itself is validated by the manifest builder against the same universe.
 */
function verifyComputeDraft(draft: GroundedDraft, universe: Map<string, UnifiedDocumentChunk>): VerificationResult {
  const preamble: { text: string; chunkIds: string[] }[] = [];
  for (const sentence of draft.sentences) {
    if (sentence.kind !== "claim") continue;
    const ids = Array.from(new Set(sentence.citations));
    if (ids.length === 0) return { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "uncited_claim" };
    const chunks = ids.map((id) => universe.get(id));
    if (chunks.some((c) => !c)) return { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "invalid_citation" };
    const supported = new Set(chunks.flatMap((c) => numericTokens(c!.text)));
    if (numericTokens(sentence.text).some((n) => !supported.has(n))) return { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "unverifiable" };
    preamble.push({ text: sentence.text.replace(/\[\[/g, "[").trim(), chunkIds: ids });
  }
  return { kind: "compute", preamble, computation: draft.computation! };
}

/**
 * Final computed answer (FR-005, FR-012): verified preamble claims, then one sentence per sandbox result with the
 * exact returned value text, its unit, an individual "(Computed)" label and badges for its input chunks.
 */
export function composeComputedAnswer(input: {
  preamble: { text: string; chunkIds: string[] }[];
  results: ComputedResult[];
  retrieved: UnifiedDocumentChunk[];
}): { kind: "answer"; content: string; citations: StoredCitation[] } {
  const universe = new Map(input.retrieved.map((c) => [c.chunk_id, c]));
  const badgeOf = new Map<string, number>();
  const citations: StoredCitation[] = [];
  const badges = (ids: string[]) =>
    ids
      .map((id) => {
        const chunk = universe.get(id);
        if (!chunk) throw new Error("computed citation outside the supplied universe");
        if (!badgeOf.has(id)) {
          badgeOf.set(id, badgeOf.size + 1);
          citations.push({ badge_number: badgeOf.size, source_id: chunk.source_id, chunk_id: id, revision: chunk.revision });
        }
        return badgeMarker(badgeOf.get(id)!);
      })
      .join("");
  const parts = input.preamble.map((p) => `${p.text}${badges(p.chunkIds)}`);
  for (const r of input.results) parts.push(`${r.label}: ${r.value}${r.unit ? ` ${r.unit}` : ""} (Computed)${badges(r.citations)}`);
  return { kind: "answer", content: parts.join(" "), citations };
}

/** Transparent terminal error text (FR-006): what failed, never a guessed number. */
export function computationFailureMessage(code: CodeExecutionFailureCode): string {
  const prefix = "The calculation could not be completed, so no computed result is shown.";
  switch (code) {
    case "ExecutionTimeout":
      return `${prefix} The code ran longer than the 15 seconds allowed and was stopped.`;
    case "MemoryLimitExceeded":
      return `${prefix} The code exceeded the sandbox memory limit and was stopped.`;
    case "PythonException":
      return `${prefix} The generated code failed with an error, also after one automatic correction attempt. See "View executed code" for details.`;
    case "TemporaryStorageLimit":
      return `${prefix} The input or output files exceeded the sandbox file limit.`;
    case "SecurityViolation":
      return `${prefix} The sandbox did not meet the required isolation settings, so nothing was run.`;
    case "InvalidOutput":
      return `${prefix} The code did not return a valid numerical result or chart.`;
    case "CitationInvalid":
      return `${prefix} The result referred to data outside the selected sources.`;
    case "ProviderUnavailable":
    case "ExecutionOutcomeUnknown":
      return `${prefix} The code execution service did not respond reliably. Please try again.`;
    default:
      return `${prefix} The request was cancelled or its sources changed.`;
  }
}
