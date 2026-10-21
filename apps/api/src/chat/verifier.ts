import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { StoredCitation } from "@everlast/db";
import type { GroundedDraft } from "./draft.ts";

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
  | { kind: "refusal"; content: string; reason: "not_in_sources" | "invalid_citation" | "uncited_claim" | "unverifiable" };

/** Inline badge marker stored in content and rendered as a citation pill by the UI. */
export function badgeMarker(n: number): string {
  return `[[${n}]]`;
}

export function verifyDraft(draft: GroundedDraft, retrieved: UnifiedDocumentChunk[]): VerificationResult {
  const universe = new Map(retrieved.map((c) => [c.chunk_id, c]));
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
