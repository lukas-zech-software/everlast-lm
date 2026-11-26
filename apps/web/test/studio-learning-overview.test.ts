import { beforeEach, describe, expect, it } from "vitest";
import {
  renderDeterministicConceptDiagramSvg,
  type StudioLearningOverviewPayload,
} from "@everlast/contracts";
import { createLearningOverviewViewer } from "../src/studio/learning-overview-viewer.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [014-studio-active-learning-suite] T026 — Composite Learning Overview viewer tests
 * (FR-ST-12, FR-ST-15, D9).
 */

const SRC_A = "41000000-0000-4000-8000-000000000101";
const CHUNK_1 = "0190f410-0000-7000-8000-000000000001";
const MOD_1 = "41000000-cccc-4000-8000-000000000001";
const CARD_1 = "41000000-bbbb-4000-8000-000000000021";
const Q_1 = "41000000-bbbb-4000-8000-000000000022";

const cite = {
  badge_number: 1,
  chunk_id: CHUNK_1,
  source_id: SRC_A,
  revision: 1,
  snippet: "Maximum payload size is 200 megabytes.",
};

describe("[014-studio-active-learning-suite] T026: Learning Overview scrollable viewer", () => {
  let dom: ReturnType<typeof setupMockDOM>;

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  const body = () => dom.document.body;
  const tid = (id: string, root: MockElement = body()) => root.querySelector(`[data-testid=${id}]`);

  it("renders chapter markdown with citations, safe D9 SVG diagram, embedded flip card, and checkpoint quiz widget", () => {
    const svg = renderDeterministicConceptDiagramSvg({
      title: "Payload Limits",
      nodes: [
        { label: "Byte Limit", detail: "200 MB", badge_numbers: [1] },
        { label: "Word Limit", detail: "500k words", badge_numbers: [1] },
      ],
    });
    const payload: StudioLearningOverviewPayload = {
      modules: [
        {
          id: MOD_1,
          title: "Module 1: Quotas",
          summary_md: "The **maximum payload size** is 200 megabytes [1].",
          diagram_svg: svg,
          flashcards: [
            {
              id: CARD_1,
              front_text: "What is max payload?",
              back_text: "200 megabytes",
              source_chunk_ids: [CHUNK_1],
              citations: [cite],
            },
          ],
          checkpoint_quiz: [
            {
              id: Q_1,
              type: "short_answer",
              prompt: "State max payload.",
              correct_answer: "200 megabytes",
              rubric: "200 megabytes / 0.2 GB",
              explanation: "200 megabytes [1].",
              source_chunk_ids: [CHUNK_1],
              citations: [cite],
            },
          ],
          citations: [cite],
        },
      ],
      target_section_count: 3,
      insufficient_evidence_note: "Single module grounded from brief source.",
      citations: [cite],
    };

    const viewer = createLearningOverviewViewer({
      artifactId: "41000000-aaaa-4000-8000-000000000003",
      title: "Learning Overview",
      payload,
      progress: null,
      onRecordProgress: (itemId, outcome) =>
        Promise.resolve({
          user_id: "41000000-0000-4000-8000-000000000002",
          artifact_id: "41000000-aaaa-4000-8000-000000000003",
          notebook_id: "41000000-0000-4000-8000-000000000001",
          item_states_json: {
            [itemId]: { status: outcome, attempts: 1, last_reviewed_at: new Date().toISOString() },
          },
          updated_at: new Date().toISOString(),
        }),
      onGrade: (questionId, answer) => {
        const answerText = typeof answer === "string" ? answer : answer.join(" ");
        const isCorrect = answerText.includes("200");
        return Promise.resolve({
          question_id: questionId,
          correct: isCorrect,
          outcome: isCorrect ? ("mastered" as const) : ("needs_review" as const),
          grading_mode: "semantic" as const,
          elapsed_ms: 4,
          explanation: "200 MB [1].",
          citations: [cite],
          progress: {
            user_id: "41000000-0000-4000-8000-000000000002",
            artifact_id: "41000000-aaaa-4000-8000-000000000003",
            notebook_id: "41000000-0000-4000-8000-000000000001",
            item_states_json: {
              [questionId]: {
                status: "mastered" as const,
                attempts: 1,
                last_reviewed_at: new Date().toISOString(),
              },
            },
            updated_at: new Date().toISOString(),
          },
        });
      },
      onResetProgress: () =>
        Promise.resolve({
          user_id: "41000000-0000-4000-8000-000000000002",
          artifact_id: "41000000-aaaa-4000-8000-000000000003",
          notebook_id: "41000000-0000-4000-8000-000000000001",
          item_states_json: {},
          updated_at: new Date().toISOString(),
        }),
      onExplain: () => Promise.resolve(undefined),
      confirmReset: () => Promise.resolve(true),
    });

    body().append(viewer.element as unknown as MockElement);
    expect(tid("overview-module")).not.toBeNull();
    expect(body().querySelector("svg")).not.toBeNull();
    const flipCard = tid("overview-flashcard")!;
    expect(flipCard.getAttribute("data-side")).toBe("front");
    flipCard.click();
    expect(flipCard.getAttribute("data-side")).toBe("back");
    expect(tid("overview-checkpoint-quiz")).not.toBeNull();
  });
});
