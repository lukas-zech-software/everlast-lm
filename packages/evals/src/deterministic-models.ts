import type { GroundedModel, GroundedModelInput } from "@everlast/api/chat/model";
import type { GroundedDraft } from "@everlast/api/chat/draft";

/**
 * TEST DOUBLES for the deterministic suite (NFR-EVAL-02 ID precision, NFR-EVAL-04 leakage). They make the
 * model-independent guarantees measurable on every PR without a cloud endpoint. They say nothing about answer
 * quality, which only the judged suite on the real model measures.
 */

const STOP = new Set("what which when where who whom does with that this from about have there their the and for are was were is of to in on by repeat earlier mentioned figure tell please service".split(" "));

function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));
}

/** Cites prompt chunks that share at least two question keywords; otherwise refuses. */
/** Drops trailing "?", "." and "!" in linear time (no backtracking regex on untrusted input). */
function trimEndPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && "?.!".includes(text[end - 1]!)) end--;
  return text.slice(0, end);
}

export class LexicalCitingModel implements GroundedModel {
  readonly id = "deterministic-lexical-citing-model";

  async generate({ question, chunks }: GroundedModelInput): Promise<GroundedDraft> {
    const words = keywords(question);
    const hits = chunks.filter((c) => {
      const text = c.text.toLowerCase();
      return words.filter((w) => text.includes(w)).length >= Math.min(2, words.length);
    });
    if (hits.length === 0) return { status: "not_in_sources", missing_topic: trimEndPunctuation(question), sentences: [] };
    return {
      status: "answered",
      sentences: hits.slice(0, 4).map((c) => ({ text: c.text.split("\n")[0]!.slice(0, 400), citations: [c.chunk_id], kind: "claim" as const })),
    };
  }
}

/**
 * Adversarial model: answers with one valid citation plus one chunk ID that was NOT in its prompt (a
 * deselected/foreign chunk or a fabricated ID). The D13 verifier must withhold every such draft.
 */
export class AdversarialCitingModel implements GroundedModel {
  readonly id = "deterministic-adversarial-model";
  private readonly foreignIds: () => string[];
  attempts = 0;

  constructor(foreignIds: () => string[]) {
    this.foreignIds = foreignIds;
  }

  async generate({ chunks }: GroundedModelInput): Promise<GroundedDraft> {
    const inPrompt = new Set(chunks.map((c) => c.chunk_id));
    const foreign = this.foreignIds().find((id) => !inPrompt.has(id)) ?? "chk_99999";
    this.attempts++;
    return {
      status: "answered",
      sentences: [
        { text: chunks[0] ? chunks[0].text.slice(0, 200) : "Claim.", citations: chunks[0] ? [chunks[0].chunk_id] : [], kind: "claim" },
        { text: "A fact taken from a source outside the selection.", citations: [foreign], kind: "claim" },
      ],
    };
  }
}
