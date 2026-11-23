import type {
  GradeQuizQuestionResponse,
  LearningProgressDto,
  QuizQuestion,
  StudioEvidenceRef,
  StudioQuizPayload,
} from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";

/**
 * [014-studio-active-learning-suite] T019, T023 — Interactive multi-format Quiz viewer
 * supporting MC, Multiple Select, Fill-in-the-blank, Short Answer, hints, semantic feedback,
 * score summary, Review missed rounds, Reset progress, and Explain to Chat
 * (FR-ST-14, FR-ST-15, Gate v4.0 #1, #2).
 */

export const QUIZ_ANSWER_MAX_CODE_POINTS = 1000;

export interface QuizViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioQuizPayload;
  progress: LearningProgressDto | null;
  onGrade(questionId: string, answer: string | string[]): Promise<GradeQuizQuestionResponse>;
  onResetProgress(): Promise<LearningProgressDto>;
  onExplain(itemId: string): Promise<void> | void;
  onCitationClick?(sourceId: string, chunkId: string): void;
  onClose?(): void;
  actions?: HTMLElement[];
  confirmReset?(): Promise<boolean>;
}

export interface QuizViewer {
  element: HTMLElement;
  destroy(): void;
}

export function createQuizViewer(options: QuizViewerOptions): QuizViewer {
  const { payload } = options;
  let progress: LearningProgressDto | null = options.progress;
  let reviewMissedOnly = false;
  let currentIndex = 0;
  let showSummary = false;
  let hintVisible = false;
  let roundGrades = new Map<string, GradeQuizQuestionResponse>();
  let busy = false;

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close quiz",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const masteryEl = h("span", { class: "badge active-learning-mastery", "data-testid": "quiz-mastery" });
  const counterEl = h("span", { class: "muted quiz-counter", "data-testid": "quiz-counter" });
  const reviewMissedBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "quiz-review-missed",
  }) as HTMLButtonElement;
  const practiceAllBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "quiz-practice-all",
    text: "Practice all again",
  }) as HTMLButtonElement;
  const resetBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "quiz-reset-progress",
    text: "Reset progress",
  }) as HTMLButtonElement;

  const headEl = h(
    "div",
    { class: "studio-viewer-head" },
    ...(closeBtn ? [closeBtn] : []),
    h("h3", { class: "studio-report-title", "data-testid": "studio-report-title", text: options.title }),
    h("span", { class: "muted", text: "AI-generated" }),
    ...(options.actions ?? [])
  );

  const toolbarEl = h(
    "div",
    { class: "active-learning-toolbar" },
    masteryEl,
    counterEl,
    reviewMissedBtn,
    practiceAllBtn,
    resetBtn
  );

  const noteEl = payload.insufficient_evidence_note
    ? h("p", { class: "muted active-learning-note", text: payload.insufficient_evidence_note })
    : null;

  const stageHost = h("div", { class: "quiz-stage-host" });
  const root = h(
    "article",
    {
      class: "studio-quiz-viewer",
      "data-testid": "studio-quiz-viewer",
      "data-artifact-id": options.artifactId,
      "aria-label": options.title,
    },
    headEl,
    toolbarEl,
    ...(noteEl ? [noteEl] : []),
    stageHost
  );

  const statesMap = () => progress?.item_states_json ?? {};

  function activeQuestions(): QuizQuestion[] {
    if (!reviewMissedOnly) return payload.questions;
    const states = statesMap();
    const missed = payload.questions.filter((q) => states[q.id]?.status === "needs_review");
    return missed.length > 0 ? missed : payload.questions;
  }

  function renderBadges(cites: readonly StudioEvidenceRef[]): HTMLElement[] {
    return cites.map((cite) => {
      const btn = h("button", {
        class: "citation-badge",
        type: "button",
        "data-testid": "quiz-citation-badge",
        "data-badge": cite.badge_number,
        "data-chunk-id": cite.chunk_id,
        "aria-label": `Citation ${cite.badge_number}`,
        title: cite.snippet,
        text: `[${cite.badge_number}]`,
      });
      btn.addEventListener("click", () => options.onCitationClick?.(cite.source_id, cite.chunk_id));
      return btn;
    });
  }

  function updateToolbar(list: QuizQuestion[]): void {
    const states = statesMap();
    const masteredCount = payload.questions.filter((q) => states[q.id]?.status === "mastered").length;
    const missedCount = payload.questions.filter((q) => states[q.id]?.status === "needs_review").length;
    masteryEl.textContent = `${masteredCount}/${payload.questions.length} mastered`;
    counterEl.textContent = showSummary
      ? `Summary (${list.length} questions)`
      : `Question ${list.length === 0 ? 0 : currentIndex + 1} of ${list.length}`;
    reviewMissedBtn.textContent = `Review missed (${missedCount})`;
    reviewMissedBtn.disabled = missedCount === 0;
    reviewMissedBtn.hidden = missedCount === 0 && !reviewMissedOnly;
    practiceAllBtn.hidden = missedCount > 0 && !reviewMissedOnly;
  }

  function renderSummary(list: QuizQuestion[]): void {
    const correctCount = list.filter((q) => roundGrades.get(q.id)?.correct).length;
    const pct = list.length > 0 ? Math.round((correctCount / list.length) * 100) : 0;
    const states = statesMap();
    const missedCount = payload.questions.filter((q) => states[q.id]?.status === "needs_review").length;

    const reviewBtn = h("button", {
      class: "btn btn-primary btn-sm",
      type: "button",
      "data-testid": "quiz-summary-review-missed",
      disabled: missedCount === 0,
      text: missedCount > 0 ? `Review ${missedCount} missed questions` : "Practice all again",
    }) as HTMLButtonElement;
    reviewBtn.addEventListener("click", () => {
      reviewMissedOnly = missedCount > 0;
      showSummary = false;
      currentIndex = 0;
      roundGrades = new Map();
      hintVisible = false;
      renderView();
    });

    const retakeBtn = h("button", {
      class: "btn btn-sm",
      type: "button",
      "data-testid": "quiz-retake",
      text: "Retake quiz",
    });
    retakeBtn.addEventListener("click", () => {
      reviewMissedOnly = false;
      showSummary = false;
      currentIndex = 0;
      roundGrades = new Map();
      hintVisible = false;
      renderView();
    });

    stageHost.append(
      h(
        "div",
        { class: "quiz-summary-card", "data-testid": "quiz-summary" },
        h("h4", { class: "quiz-summary-score", "data-testid": "quiz-summary-score", text: `Score: ${correctCount} / ${list.length} (${pct}%)` }),
        h("div", { class: "quiz-summary-actions" }, reviewBtn, retakeBtn)
      )
    );
  }

  function renderQuestion(list: QuizQuestion[]): void {
    const q = list[currentIndex];
    if (!q) return;
    const graded = roundGrades.get(q.id);

    const card = h("div", { class: "quiz-question-card", "data-testid": "quiz-question-card", "data-question-type": q.type });
    card.append(
      h("span", { class: "badge", text: q.type.replaceAll("_", " ") }),
      h("p", { class: "quiz-question-prompt", "data-testid": "quiz-question-prompt", text: q.prompt })
    );

    if (q.hint && !graded) {
      const hintBtn = h("button", {
        class: "btn btn-sm",
        type: "button",
        "data-testid": "quiz-hint-btn",
        text: hintVisible ? "Hide hint" : "Hint",
      });
      const hintEl = h("p", {
        class: "muted quiz-hint-text",
        "data-testid": "quiz-hint-text",
        hidden: !hintVisible,
        text: q.hint,
      });
      hintBtn.addEventListener("click", () => {
        hintVisible = !hintVisible;
        hintEl.hidden = !hintVisible;
        hintBtn.textContent = hintVisible ? "Hide hint" : "Hint";
      });
      card.append(hintBtn, hintEl);
    }

    let selectedSingle = "";
    const selectedMulti = new Set<string>();
    let textAnswer = "";
    const errorEl = h("p", { class: "chat-error", "data-testid": "quiz-error", role: "alert", hidden: true });
    const submitBtn = h("button", {
      class: "btn btn-primary btn-sm",
      type: "button",
      "data-testid": "quiz-submit-btn",
      disabled: Boolean(graded),
      text: "Check",
    }) as HTMLButtonElement;

    if (q.type === "multiple_choice" && q.options) {
      const groupName = `quiz-mc-${q.id}`;
      const listEl = h("div", { class: "quiz-options" });
      for (const opt of q.options) {
        const input = h("input", {
          type: "radio",
          name: groupName,
          value: opt.id,
          "data-option-id": opt.id,
          disabled: Boolean(graded),
        }) as HTMLInputElement;
        input.addEventListener("change", () => {
          if (input.checked) selectedSingle = opt.id;
        });
        listEl.append(h("label", { class: "quiz-option-row" }, input, " ", h("span", { text: opt.text })));
      }
      card.append(listEl);
    } else if (q.type === "multiple_select" && q.options) {
      const listEl = h("div", { class: "quiz-options" });
      for (const opt of q.options) {
        const input = h("input", {
          type: "checkbox",
          value: opt.id,
          "data-option-id": opt.id,
          disabled: Boolean(graded),
        }) as HTMLInputElement;
        input.addEventListener("change", () => {
          if (input.checked) selectedMulti.add(opt.id);
          else selectedMulti.delete(opt.id);
        });
        listEl.append(h("label", { class: "quiz-option-row" }, input, " ", h("span", { text: opt.text })));
      }
      card.append(listEl);
    } else {
      const input = h("textarea", {
        class: "report-prompt quiz-text-answer",
        "data-testid": "quiz-text-answer",
        rows: 3,
        disabled: Boolean(graded),
        placeholder: q.type === "fill_in_the_blank" ? "Fill in the blank..." : "Type your answer...",
      }) as HTMLTextAreaElement;
      const countEl = h("span", { class: "muted", text: `0 / ${QUIZ_ANSWER_MAX_CODE_POINTS}` });
      input.addEventListener("input", () => {
        textAnswer = input.value;
        const n = Array.from(textAnswer.trim()).length;
        countEl.textContent = `${n} / ${QUIZ_ANSWER_MAX_CODE_POINTS}`;
      });
      card.append(input, countEl);
    }

    submitBtn.addEventListener("click", async () => {
      if (busy || graded) return;
      errorEl.hidden = true;
      let payloadAnswer: string | string[];
      if (q.type === "multiple_choice") {
        if (!selectedSingle) {
          errorEl.hidden = false;
          errorEl.textContent = "Select an option before checking.";
          return;
        }
        payloadAnswer = selectedSingle;
      } else if (q.type === "multiple_select") {
        if (selectedMulti.size === 0) {
          errorEl.hidden = false;
          errorEl.textContent = "Select at least one option before checking.";
          return;
        }
        payloadAnswer = [...selectedMulti];
      } else {
        const trimmed = textAnswer.trim();
        const cps = Array.from(trimmed).length;
        if (cps < 1 || cps > QUIZ_ANSWER_MAX_CODE_POINTS) {
          errorEl.hidden = false;
          errorEl.textContent = `Answer must be 1 to ${QUIZ_ANSWER_MAX_CODE_POINTS} characters.`;
          return;
        }
        payloadAnswer = trimmed;
      }

      busy = true;
      submitBtn.disabled = true;
      try {
        const res = await options.onGrade(q.id, payloadAnswer);
        roundGrades.set(q.id, res);
        progress = res.progress;
        renderView();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err instanceof Error ? err.message : "Could not grade answer.";
        submitBtn.disabled = false;
      } finally {
        busy = false;
      }
    });

    card.append(errorEl, submitBtn);

    if (graded) {
      const explainBtn = h("button", {
        class: "btn btn-sm",
        type: "button",
        "data-testid": "quiz-explain-btn",
        text: "Explain",
      });
      explainBtn.addEventListener("click", () => void options.onExplain(q.id));

      const feedback = h(
        "div",
        {
          class: `quiz-feedback ${graded.correct ? "quiz-feedback-correct" : "quiz-feedback-incorrect"}`,
          "data-testid": "quiz-feedback",
        },
        h("strong", { text: graded.correct ? "Right!" : "Not quite" }),
        h("p", { text: graded.explanation }),
        h("div", { class: "quiz-citations" }, ...renderBadges(graded.citations)),
        explainBtn
      );
      card.append(feedback);

      const navRow = h("div", { class: "quiz-nav-row" });
      if (currentIndex < list.length - 1) {
        const nextBtn = h("button", {
          class: "btn btn-primary btn-sm",
          type: "button",
          "data-testid": "quiz-next-btn",
          text: "Next question →",
        });
        nextBtn.addEventListener("click", () => {
          currentIndex += 1;
          hintVisible = false;
          renderView();
        });
        navRow.append(nextBtn);
      } else {
        const finishBtn = h("button", {
          class: "btn btn-primary btn-sm",
          type: "button",
          "data-testid": "quiz-finish-btn",
          text: "View score",
        });
        finishBtn.addEventListener("click", () => {
          showSummary = true;
          renderView();
        });
        navRow.append(finishBtn);
      }
      card.append(navRow);
    }

    stageHost.append(card);
  }

  function renderView(): void {
    clear(stageHost);
    const list = activeQuestions();
    if (currentIndex >= list.length) currentIndex = Math.max(0, list.length - 1);
    updateToolbar(list);
    if (showSummary) {
      renderSummary(list);
    } else {
      renderQuestion(list);
    }
  }

  reviewMissedBtn.addEventListener("click", () => {
    const missed = payload.questions.filter((q) => statesMap()[q.id]?.status === "needs_review");
    if (missed.length === 0) return;
    reviewMissedOnly = true;
    showSummary = false;
    currentIndex = 0;
    roundGrades = new Map();
    hintVisible = false;
    renderView();
  });

  practiceAllBtn.addEventListener("click", () => {
    reviewMissedOnly = false;
    showSummary = false;
    currentIndex = 0;
    roundGrades = new Map();
    hintVisible = false;
    renderView();
  });

  resetBtn.addEventListener("click", async () => {
    const ok = options.confirmReset ? await options.confirmReset() : true;
    if (!ok) return;
    progress = await options.onResetProgress();
    reviewMissedOnly = false;
    showSummary = false;
    currentIndex = 0;
    roundGrades = new Map();
    hintVisible = false;
    renderView();
  });

  renderView();

  return {
    element: root,
    destroy() {
      clear(root);
    },
  };
}
