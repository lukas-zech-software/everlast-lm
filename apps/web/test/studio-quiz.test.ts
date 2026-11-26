import { beforeEach, describe, expect, it } from "vitest";
import type { LearningProgressDto, StudioQuizPayload } from "@everlast/contracts";
import { createQuizViewer } from "../src/studio/quiz-viewer.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [014-studio-active-learning-suite] T016, T021 — Interactive Quiz viewer unit tests
 * (FR-ST-14, FR-ST-15, Gate v4.0 #1, #2).
 */

const SRC_A = "41000000-0000-4000-8000-000000000101";
const CHUNK_1 = "0190f410-0000-7000-8000-000000000001";
const Q1 = "41000000-bbbb-4000-8000-000000000011";
const Q2 = "41000000-bbbb-4000-8000-000000000012";
const NB = "41000000-0000-4000-8000-000000000001";
const ART = "41000000-aaaa-4000-8000-000000000002";

const cite = {
  badge_number: 1,
  chunk_id: CHUNK_1,
  source_id: SRC_A,
  revision: 1,
  snippet: "The maximum payload size is 200 megabytes.",
};

const sampleQuiz: StudioQuizPayload = {
  questions: [
    {
      id: Q1,
      type: "multiple_choice",
      prompt: "Which region runs Cloud SQL?",
      hint: "European region",
      options: [
        { id: "opt_1", text: "europe-west4" },
        { id: "opt_2", text: "us-west1" },
      ],
      correct_answer: "opt_1",
      rubric: "europe-west4",
      explanation: "Cloud SQL runs in europe-west4 [1].",
      source_chunk_ids: [CHUNK_1],
      citations: [cite],
    },
    {
      id: Q2,
      type: "short_answer",
      prompt: "What is the maximum payload size?",
      hint: "Measured in megabytes",
      correct_answer: "200 megabytes",
      rubric: "200 megabytes / 0.2 GB",
      explanation: "Maximum payload size is 200 megabytes [1].",
      source_chunk_ids: [CHUNK_1],
      citations: [cite],
    },
  ],
  target_count: 5,
  difficulty: "medium",
  insufficient_evidence_note: "Brief source yielded 2 questions.",
  citations: [cite],
};

describe("[014-studio-active-learning-suite] T016/T021: Quiz viewer runner, hints, grading feedback, and Review missed", () => {
  let dom: ReturnType<typeof setupMockDOM>;

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  const body = () => dom.document.body;
  const tid = (id: string, root: MockElement = body()) => root.querySelector(`[data-testid=${id}]`);

  it("displays Hint, grades MC and Short Answer via callback, renders score summary, and filters Review missed", async () => {
    let currentProgress: LearningProgressDto = {
      user_id: "41000000-0000-4000-8000-000000000002",
      artifact_id: ART,
      notebook_id: NB,
      item_states_json: {},
      updated_at: new Date().toISOString(),
    };

    const viewer = createQuizViewer({
      artifactId: ART,
      title: "Quiz",
      payload: sampleQuiz,
      progress: currentProgress,
      onGrade: (questionId, answer) => {
        const answerText = typeof answer === "string" ? answer : answer.join(" ");
        const correct =
          (questionId === Q1 && answer === "opt_1") ||
          (questionId === Q2 && answerText.includes("200"));
        const outcome = correct ? ("mastered" as const) : ("needs_review" as const);
        currentProgress = {
          ...currentProgress,
          item_states_json: {
            ...currentProgress.item_states_json,
            [questionId]: {
              status: outcome,
              attempts: 1,
              last_reviewed_at: new Date().toISOString(),
            },
          },
        };
        return Promise.resolve({
          question_id: questionId,
          correct,
          outcome,
          grading_mode: questionId === Q1 ? ("deterministic" as const) : ("semantic" as const),
          elapsed_ms: 5,
          explanation: "Grounded explanation [1].",
          citations: [cite],
          progress: currentProgress,
        });
      },
      onResetProgress: () => Promise.resolve({ ...currentProgress, item_states_json: {} }),
      onExplain: () => Promise.resolve(undefined),
      confirmReset: () => Promise.resolve(true),
    });
    body().append(viewer.element as unknown as MockElement);

    // Hint before submission
    tid("quiz-hint-btn")!.click();
    expect(tid("quiz-hint-text")!.textContent).toContain("European region");

    // Answer Q1 correctly
    const opt1 = body().querySelector("[data-option-id=opt_1]")!;
    opt1.checked = true;
    opt1.dispatchEvent({ type: "change", target: opt1 });
    tid("quiz-submit-btn")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tid("quiz-feedback")!.textContent).toContain("Right!");

    // Move to Q2 and answer incorrectly
    tid("quiz-next-btn")!.click();
    const input = tid("quiz-text-answer")!;
    input.value = "50 MB";
    input.dispatchEvent({ type: "input", target: input });
    tid("quiz-submit-btn")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tid("quiz-feedback")!.textContent).toContain("Not quite");

    // Finish -> Summary screen shows Score: 1 / 2 and Review 1 missed questions
    tid("quiz-finish-btn")!.click();
    expect(tid("quiz-summary-score")!.textContent).toContain("1 / 2");

    // Review missed presents exclusively Q2
    tid("quiz-review-missed")!.click();
    expect(tid("quiz-counter")!.textContent).toBe("Question 1 of 1");
    expect(tid("quiz-question-prompt")!.textContent).toContain("maximum payload size");
  });
});
