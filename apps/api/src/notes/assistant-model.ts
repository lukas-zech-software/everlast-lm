import type { Citation, UnifiedDocumentChunk } from "@everlast/contracts";
import type { GroundedModel } from "../chat/model.ts";
import { verifyDraft, REFUSAL_UNVERIFIED } from "../chat/verifier.ts";

/**
 * Note Assistant answer port (FR-NM-04). Production uses the same grounded model and deterministic citation
 * verifier as chat (FR-GC-01, FR-GC-02, D13): any invalid or missing citation withholds the draft.
 */
export interface NoteAssistantAnswer {
  content: string;
  citations: Citation[];
  refusal: boolean;
}

export interface NoteAssistantModel {
  answer(input: { question: string; chunks: UnifiedDocumentChunk[]; titles: Map<string, string> }): Promise<NoteAssistantAnswer>;
}

export class GroundedNoteAssistant implements NoteAssistantModel {
  private readonly model: GroundedModel;
  constructor(model: GroundedModel) {
    this.model = model;
  }

  async answer(input: { question: string; chunks: UnifiedDocumentChunk[]; titles: Map<string, string> }): Promise<NoteAssistantAnswer> {
    let result;
    try {
      result = verifyDraft(await this.model.generate({ question: input.question, chunks: input.chunks, history: [] }), input.chunks);
    } catch {
      return { content: REFUSAL_UNVERIFIED, citations: [], refusal: true };
    }
    if (result.kind === "refusal") return { content: result.content, citations: [], refusal: true };
    const byId = new Map(input.chunks.map((c) => [c.chunk_id, c]));
    const citations: Citation[] = result.citations.map((c) => {
      const chunk = byId.get(c.chunk_id)!;
      return {
        badge_number: c.badge_number,
        source_id: c.source_id,
        source_title: input.titles.get(c.source_id) ?? "Source",
        chunk_id: c.chunk_id,
        snippet: chunk.text,
        locator: chunk.locator,
      };
    });
    return { content: result.content, citations, refusal: false };
  }
}
