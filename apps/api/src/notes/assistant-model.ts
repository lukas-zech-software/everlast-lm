import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { StoredCitation } from "@everlast/db";
import { ModelUnavailableError, type GroundedModel } from "../chat/model.ts";
import { verifyDraft, REFUSAL_UNVERIFIED } from "../chat/verifier.ts";

/**
 * Note Assistant answer port (FR-NM-04). Production uses the same grounded model and deterministic citation
 * verifier as chat (FR-GC-01, FR-GC-02, D13): any invalid or missing citation withholds the draft. The verified
 * result is published like a chat turn (question + answer or refusal, citations as references).
 */
export interface NoteAssistantAnswer {
  kind: "answer" | "refusal";
  content: string;
  citations: StoredCitation[];
}

export interface NoteAssistantModel {
  answer(input: { question: string; chunks: UnifiedDocumentChunk[] }): Promise<NoteAssistantAnswer>;
}

export class GroundedNoteAssistant implements NoteAssistantModel {
  private readonly model: GroundedModel;
  constructor(model: GroundedModel) {
    this.model = model;
  }

  async answer(input: { question: string; chunks: UnifiedDocumentChunk[] }): Promise<NoteAssistantAnswer> {
    if (input.chunks.length === 0) return { kind: "refusal", content: REFUSAL_UNVERIFIED, citations: [] };
    try {
      const result = verifyDraft(await this.model.generate({ question: input.question, chunks: input.chunks, history: [] }), input.chunks);
      return result.kind === "answer"
        ? { kind: "answer", content: result.content, citations: result.citations }
        : { kind: "refusal", content: result.content, citations: [] };
    } catch (err) {
      // An unavailable model publishes nothing (503); an unusable draft becomes the verified refusal.
      if (err instanceof ModelUnavailableError) throw err;
      return { kind: "refusal", content: REFUSAL_UNVERIFIED, citations: [] };
    }
  }
}
