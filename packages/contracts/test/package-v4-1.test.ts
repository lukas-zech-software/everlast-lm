import { describe, expect, it } from "vitest";
import {
  CreateStudioJobRequestSchema,
  LearningProgressDtoSchema,
  PedagogyFocusPromptSchema,
  QuizShortAnswerInputSchema,
  RecordLearningProgressRequestSchema,
  ResetLearningProgressRequestSchema,
  resolveFlashcardTargetCount,
  renderDeterministicConceptDiagramSvg,
  STUDIO_FLASHCARDS_PLUGIN_TYPE,
  STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE,
  STUDIO_QUIZ_PLUGIN_TYPE,
  StudioArtifactSchema,
  StudioExplainRequestSchema,
  StudioFlashcardsPayloadSchema,
  StudioLearningOverviewPayloadSchema,
  StudioQuizPayloadSchema,
  validatePedagogyFocusPrompt,
  validateSafeDeterministicSvg,
  validateShortAnswerInput,
  GradeQuizQuestionRequestSchema,
} from "../src/index.ts";

/**
 * [014-studio-active-learning-suite] T003 — Contract & Schema tests for Package 4.1
 * (FR-ST-13, FR-ST-14, FR-ST-15, FR-ST-12, C-03, D9).
 */

const NB = "41000000-0000-4000-8000-000000000001";
const USER = "41000000-0000-4000-8000-000000000002";
const ART = "41000000-aaaa-4000-8000-000000000001";
const SRC = "41000000-0000-4000-8000-000000000101";
const CHUNK = "0190f410-0000-7000-8000-000000000001";
const ITEM_1 = "41000000-bbbb-4000-8000-000000000001";
const ITEM_2 = "41000000-bbbb-4000-8000-000000000002";
const MOD_1 = "41000000-cccc-4000-8000-000000000001";

const cite = {
  badge_number: 1,
  chunk_id: CHUNK,
  source_id: SRC,
  revision: 1,
  snippet: "Maximum payload size is 200 megabytes.",
};

describe("[014-studio-active-learning-suite] T003: Package 4.1 contracts, limits, and D9 SVG safety", () => {
  it("resolves flashcard count presets fewer->10, standard->20, more->35 and validates 0..1000 focus_prompt & 1..1000 short answers in Unicode code points", () => {
    expect(STUDIO_FLASHCARDS_PLUGIN_TYPE).toBe("flashcards");
    expect(STUDIO_QUIZ_PLUGIN_TYPE).toBe("quiz");
    expect(STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE).toBe("learning_overview");

    expect(resolveFlashcardTargetCount()).toBe(20);
    expect(resolveFlashcardTargetCount("fewer")).toBe(10);
    expect(resolveFlashcardTargetCount("standard")).toBe(20);
    expect(resolveFlashcardTargetCount("more")).toBe(35);
    expect(resolveFlashcardTargetCount(10)).toBe(10);
    expect(resolveFlashcardTargetCount(20)).toBe(20);
    expect(resolveFlashcardTargetCount(35)).toBe(35);

    // 1,000 astral Unicode code points (each 2 UTF-16 code units!) pass after outer trim
    const okPrompt = `  ${"🧪".repeat(1000)}  `;
    const promptCheck = validatePedagogyFocusPrompt(okPrompt);
    expect(promptCheck.valid).toBe(true);
    expect(promptCheck.codePoints).toBe(1000);
    expect(PedagogyFocusPromptSchema.parse(okPrompt)).toBe("🧪".repeat(1000));

    // 1,001 code points rejected without truncation
    const overPrompt = "🧪".repeat(1001);
    expect(validatePedagogyFocusPrompt(overPrompt).valid).toBe(false);
    expect(PedagogyFocusPromptSchema.safeParse(overPrompt).success).toBe(false);

    // Short answer: whitespace-only rejected, 1..1000 code points allowed, 1001 rejected
    expect(validateShortAnswerInput("   ").valid).toBe(false);
    expect(QuizShortAnswerInputSchema.safeParse("  \n\t ").success).toBe(false);
    expect(QuizShortAnswerInputSchema.parse(` ${"💡".repeat(1000)} `)).toBe("💡".repeat(1000));
    expect(QuizShortAnswerInputSchema.safeParse("💡".repeat(1001)).success).toBe(false);
  });

  it("validates CreateStudioJobRequestSchema for flashcards, quiz, and learning_overview while rejecting cross-plugin mismatch", () => {
    const fcReq = CreateStudioJobRequestSchema.parse({
      plugin_type: "flashcards",
      subtype: "default",
      active_source_ids: [SRC],
      difficulty: "hard",
      card_count: "more",
      focus_prompt: "Focus on security invariants",
    });
    expect(fcReq.card_count).toBe("more");

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "flashcards",
        subtype: "default",
        active_source_ids: [SRC],
        focus_prompt: "a".repeat(1001),
      }).success
    ).toBe(false);

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "quiz",
        subtype: "default",
        active_source_ids: [SRC],
        question_count: 15,
        difficulty: "easy",
      }).success
    ).toBe(true);

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "quiz",
        subtype: "default",
        active_source_ids: [SRC],
        question_count: 4,
      }).success
    ).toBe(false);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "quiz",
        subtype: "default",
        active_source_ids: [SRC],
        question_count: 26,
      }).success
    ).toBe(false);

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "learning_overview",
        subtype: "default",
        active_source_ids: [SRC],
        section_count: 4,
      }).success
    ).toBe(true);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "learning_overview",
        subtype: "default",
        active_source_ids: [SRC],
        section_count: 2,
      }).success
    ).toBe(false);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "learning_overview",
        subtype: "default",
        active_source_ids: [SRC],
        section_count: 7,
      }).success
    ).toBe(false);

    // Existing report/mindmap/data_table remain protected against v4 fields
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "mindmap",
        subtype: "default",
        active_source_ids: [SRC],
        difficulty: "hard",
      }).success
    ).toBe(false);
  });

  it("validates Flashcard and Quiz payloads including insufficient_evidence_note requirement and UUID item IDs", () => {
    const validCards = {
      cards: [
        {
          id: ITEM_1,
          front_text: "What is the maximum payload size?",
          back_text: "200 megabytes.",
          source_chunk_ids: [CHUNK],
          citations: [cite],
        },
      ],
      difficulty: "medium" as const,
      target_count: 20 as const,
      insufficient_evidence_note: "Source supports 1 concise flashcard.",
      citations: [cite],
    };
    expect(StudioFlashcardsPayloadSchema.safeParse(validCards).success).toBe(true);
    expect(
      StudioFlashcardsPayloadSchema.safeParse({ ...validCards, insufficient_evidence_note: null }).success
    ).toBe(false);

    const validQuiz = {
      questions: [
        {
          id: ITEM_1,
          type: "multiple_choice" as const,
          prompt: "Which limit applies?",
          options: [
            { id: "opt_1", text: "200 MB" },
            { id: "opt_2", text: "50 MB" },
          ],
          correct_answer: "opt_1",
          rubric: "Matches 200 megabytes",
          explanation: "The spec sets 200 megabytes [1].",
          source_chunk_ids: [CHUNK],
          citations: [cite],
        },
        {
          id: ITEM_2,
          type: "short_answer" as const,
          prompt: "What is the maximum payload size?",
          hint: "Check the ingestion quota section.",
          correct_answer: "200 megabytes",
          rubric: "Must state 200 megabytes or equivalent 0.2 GB",
          explanation: "Maximum payload size is 200 megabytes [1].",
          source_chunk_ids: [CHUNK],
          citations: [cite],
        },
      ],
      target_count: 10,
      difficulty: "medium" as const,
      insufficient_evidence_note: "Short source yielded 2 questions.",
      citations: [cite],
    };
    expect(StudioQuizPayloadSchema.safeParse(validQuiz).success).toBe(true);

    const artifactOk = StudioArtifactSchema.safeParse({
      id: ART,
      notebook_id: NB,
      plugin_type: "quiz",
      subtype: "default",
      status: "Completed",
      title: "Quiz",
      params_json: { question_count: 10, difficulty: "medium" },
      payload_json: validQuiz,
      source_revisions_snapshot: [{ source_id: SRC, revision: 1 }],
      output_language: "en-US",
      progress: null,
      failure: null,
      attempt: 1,
      retry_of: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(artifactOk.success).toBe(true);
  });

  it("renders deterministic non-clipping SVG concept diagrams (D9) and rejects unsafe markup", () => {
    const svg = renderDeterministicConceptDiagramSvg({
      title: "Payload Limits Overview",
      nodes: [
        {
          label: "Maximum Payload Size Constraint for Every Uploaded Source",
          detail: "200,000,000 bytes inclusive enforced atomically before ingestion",
          badge_numbers: [1],
        },
        {
          label: "Word Count Extraction Bound",
          detail: "500,000 extracted words inclusive per source",
          badge_numbers: [1],
        },
      ],
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("AI-generated");
    expect(validateSafeDeterministicSvg(svg).valid).toBe(true);

    expect(validateSafeDeterministicSvg('<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>').valid).toBe(false);
    expect(validateSafeDeterministicSvg('<svg viewBox="0 0 100 100" onload="alert(1)"><rect/></svg>').valid).toBe(false);
    expect(validateSafeDeterministicSvg('<svg viewBox="0 0 100 100"><foreignObject><div/></foreignObject></svg>').valid).toBe(false);
    expect(validateSafeDeterministicSvg('<svg viewBox="0 0 100 100"><a href="https://evil.test"><rect/></a></svg>').valid).toBe(false);

    const overview = {
      modules: [
        {
          id: MOD_1,
          title: "Module 1: Quotas",
          summary_md: "Maximum payload size is 200 megabytes [1].",
          diagram_svg: svg,
          flashcards: [
            {
              id: ITEM_1,
              front_text: "Max payload?",
              back_text: "200 MB",
              source_chunk_ids: [CHUNK],
              citations: [cite],
            },
          ],
          checkpoint_quiz: [
            {
              id: ITEM_2,
              type: "short_answer" as const,
              prompt: "What is the max payload?",
              correct_answer: "200 megabytes",
              rubric: "200 megabytes / 0.2 GB",
              explanation: "200 MB [1].",
              source_chunk_ids: [CHUNK],
              citations: [cite],
            },
          ],
          citations: [cite],
        },
      ],
      target_section_count: 3,
      insufficient_evidence_note: "Single module supported by brief source.",
      citations: [cite],
    };
    expect(StudioLearningOverviewPayloadSchema.safeParse(overview).success).toBe(true);
  });

  it("validates LearningProgress, Grade, and Explain request schemas", () => {
    expect(RecordLearningProgressRequestSchema.safeParse({ item_id: ITEM_1, outcome: "mastered" }).success).toBe(true);
    expect(ResetLearningProgressRequestSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(ResetLearningProgressRequestSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(
      LearningProgressDtoSchema.safeParse({
        user_id: USER,
        artifact_id: ART,
        notebook_id: NB,
        item_states_json: {
          [ITEM_1]: { status: "needs_review", attempts: 2, last_reviewed_at: new Date().toISOString() },
        },
        updated_at: new Date().toISOString(),
      }).success
    ).toBe(true);
    expect(GradeQuizQuestionRequestSchema.safeParse({ question_id: ITEM_1, answer: "0.2 GB (200 MB)" }).success).toBe(true);
    expect(
      StudioExplainRequestSchema.safeParse({ item_id: ITEM_1, active_source_ids: [SRC] }).success
    ).toBe(true);
    expect(
      StudioExplainRequestSchema.safeParse({ item_id: ITEM_1, active_source_ids: [] }).success
    ).toBe(false);
  });
});
