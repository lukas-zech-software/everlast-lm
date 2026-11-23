import {
  EmptyScopeError,
  StudioExplainRequestSchema,
  StudioParamsError,
  verifyExplainSupportingSources,
  type FlashcardItem,
  type QuizQuestion,
  type StudioExplainResponse,
  type StudioFlashcardsPayload,
  type StudioLearningOverviewPayload,
  type StudioQuizPayload,
} from "@everlast/contracts";
import type { StoredCitation, StudioArtifactRecord } from "@everlast/db";
import { StudioSupportingSourcesRequiredError, type StudioDrilldownPort } from "./drilldown.ts";

/**
 * [014-studio-active-learning-suite] T012, T028 — Server-side S_aktiv scope guard & chat handoff
 * for Flashcard and Quiz "Explain" actions (FR-ST-13, FR-ST-14, FR-GC-01/02, C-02, NFR-EVAL-04, Gate v4.0 #1).
 *
 * Rules:
 * 1. Never trusts client-supplied card/question text; resolves `item_id` exclusively from the authorized
 *    Completed `flashcards`, `quiz`, or `learning_overview` artifact.
 * 2. Requires non-empty `active_source_ids` (`400 EmptyScopeError` if empty).
 * 3. Verifies every supporting `(source_id, revision)` referenced by the item is present in the caller's
 *    current Ready `active_source_ids` BEFORE building any prompt or invoking the chat model.
 * 4. Throws `StudioSupportingSourcesRequiredError` (`409 SupportingSourcesRequired`) when any supporting
 *    source/revision is missing or replaced.
 */

type TargetItem =
  | { kind: "flashcard"; item: FlashcardItem }
  | { kind: "quiz_question"; item: QuizQuestion };

function findTargetItem(artifact: StudioArtifactRecord, itemId: string, expectedKind?: "flashcard" | "quiz_question"): TargetItem | null {
  const payload = artifact.payload_json;
  if (!payload || typeof payload !== "object") return null;

  if (artifact.plugin_type === "flashcards" && "cards" in payload) {
    if (expectedKind && expectedKind !== "flashcard") return null;
    const card = (payload as unknown as StudioFlashcardsPayload).cards.find((c) => c.id === itemId);
    return card ? { kind: "flashcard", item: card } : null;
  }

  if (artifact.plugin_type === "quiz" && "questions" in payload) {
    if (expectedKind && expectedKind !== "quiz_question") return null;
    const question = (payload as unknown as StudioQuizPayload).questions.find((q) => q.id === itemId);
    return question ? { kind: "quiz_question", item: question } : null;
  }

  if (artifact.plugin_type === "learning_overview" && "modules" in payload) {
    const overview = payload as unknown as StudioLearningOverviewPayload;
    for (const mod of overview.modules) {
      if (!expectedKind || expectedKind === "flashcard") {
        const card = mod.flashcards.find((c) => c.id === itemId);
        if (card) return { kind: "flashcard", item: card };
      }
      if (!expectedKind || expectedKind === "quiz_question") {
        const question = mod.checkpoint_quiz.find((q) => q.id === itemId);
        if (question) return { kind: "quiz_question", item: question };
      }
    }
  }
  return null;
}

function buildExplainPrompt(target: TargetItem): string {
  if (target.kind === "flashcard") {
    return `Explain the flashcard concept "${target.item.front_text}" and its answer ("${target.item.back_text}") in detail using only the selected sources, with inline citations.`;
  }
  return `Explain the quiz question "${target.item.prompt}" and the grounded reasoning behind "${target.item.explanation}" using only the selected sources, with inline citations.`;
}

export async function executeStudioItemExplain(input: {
  ownerId: string;
  notebookId: string;
  artifact: StudioArtifactRecord;
  rawRequest: unknown;
  port: StudioDrilldownPort;
}): Promise<StudioExplainResponse> {
  const rawIds = (input.rawRequest as { active_source_ids?: unknown } | null)?.active_source_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new EmptyScopeError("active_source_ids must contain at least one source UUID.");
  }

  const req = StudioExplainRequestSchema.parse(input.rawRequest);
  const target = findTargetItem(input.artifact, req.item_id, req.item_kind);
  if (!target) {
    throw new StudioParamsError(`Learning item ${req.item_id} does not exist in this artifact.`);
  }

  const { snapshot, chunks } = await input.port.readScope(input.ownerId, input.notebookId, req.active_source_ids);
  const scopeCheck = verifyExplainSupportingSources(target.item.citations, snapshot);
  if (!scopeCheck.ok) {
    throw new StudioSupportingSourcesRequiredError(
      scopeCheck.missingSources,
      "Select all supporting sources for this learning item before explaining in chat."
    );
  }

  // Only AFTER S_aktiv verification succeeds do we construct the prompt containing item text
  const prompt = buildExplainPrompt(target);

  let answer: { kind: "answer" | "refusal"; content: string; citations: StoredCitation[] };
  if (input.port.answer) {
    answer = await input.port.answer.answer({ question: prompt, chunks });
  } else {
    const validCitations: StoredCitation[] = [];
    const seenChunks = new Set<string>();
    for (const c of target.item.citations) {
      if (seenChunks.has(c.chunk_id)) continue;
      seenChunks.add(c.chunk_id);
      validCitations.push({
        badge_number: validCitations.length + 1,
        chunk_id: c.chunk_id,
        source_id: c.source_id,
        revision: c.revision,
      });
    }
    const markers = validCitations.map((c) => `[${c.badge_number}]`).join("");
    const bodyText = target.kind === "flashcard" ? target.item.back_text : target.item.explanation;
    answer = {
      kind: "answer",
      content: `${bodyText} ${markers}`.trim(),
      citations: validCitations,
    };
  }

  const messages = await input.port.publishTurn({
    ownerId: input.ownerId,
    notebookId: input.notebookId,
    snapshot,
    question: prompt,
    answer,
  });

  return {
    prompt,
    item_id: req.item_id,
    item_kind: target.kind,
    messages,
  };
}
