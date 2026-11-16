import type {
  FlashcardItem,
  LearningItemOutcome,
  LearningProgressDto,
  StudioEvidenceRef,
  StudioFlashcardsPayload,
} from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";

/**
 * [014-studio-active-learning-suite] T013, T023 — Interactive Flashcards viewer with 3D flip,
 * Spacebar/click handling, self-assessment, Review missed filtering, Reset progress, and chat Explain
 * (FR-ST-13, FR-ST-15, Gate v4.0 #1, #2).
 */

export interface FlashcardsViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioFlashcardsPayload;
  progress: LearningProgressDto | null;
  onRecordProgress(itemId: string, outcome: LearningItemOutcome): Promise<LearningProgressDto>;
  onResetProgress(): Promise<LearningProgressDto>;
  onExplain(itemId: string): Promise<void> | void;
  onCitationClick?(sourceId: string, chunkId: string): void;
  onClose?(): void;
  actions?: HTMLElement[];
  confirmReset?(): Promise<boolean>;
}

export interface FlashcardsViewer {
  element: HTMLElement;
  destroy(): void;
}

export function createFlashcardsViewer(options: FlashcardsViewerOptions): FlashcardsViewer {
  const { payload } = options;
  let progress: LearningProgressDto | null = options.progress;
  let reviewMissedOnly = false;
  let currentIndex = 0;
  let side: "front" | "back" = "front";
  let busy = false;

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close flashcards",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const masteryEl = h("span", {
    class: "badge active-learning-mastery",
    "data-testid": "flashcards-mastery",
  });
  const counterEl = h("span", {
    class: "muted flashcards-counter",
    "data-testid": "flashcards-counter",
  });
  const reviewMissedBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "flashcards-review-missed",
  }) as HTMLButtonElement;
  const practiceAllBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "flashcards-practice-all",
    text: "Practice all again",
  }) as HTMLButtonElement;
  const resetBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "flashcards-reset-progress",
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

  const cardHost = h("div", { class: "flashcards-stage-host" });
  const navHost = h("div", { class: "flashcards-nav" });
  const root = h(
    "article",
    {
      class: "studio-flashcards-viewer",
      "data-testid": "studio-flashcards-viewer",
      "data-artifact-id": options.artifactId,
      "aria-label": options.title,
    },
    headEl,
    toolbarEl,
    ...(noteEl ? [noteEl] : []),
    cardHost,
    navHost
  );

  function statesMap() {
    return progress?.item_states_json ?? {};
  }

  function activeDeck(): FlashcardItem[] {
    if (!reviewMissedOnly) return payload.cards;
    const states = statesMap();
    const missed = payload.cards.filter((c) => states[c.id]?.status === "needs_review");
    return missed.length > 0 ? missed : payload.cards;
  }

  function renderBadges(cites: readonly StudioEvidenceRef[]): HTMLElement[] {
    return cites.map((cite) => {
      const btn = h("button", {
        class: "citation-badge",
        type: "button",
        "data-testid": "flashcard-citation-badge",
        "data-badge": cite.badge_number,
        "data-chunk-id": cite.chunk_id,
        "aria-label": `Citation ${cite.badge_number}`,
        title: cite.snippet,
        text: `[${cite.badge_number}]`,
      });
      btn.addEventListener("click", (ev: Event) => {
        ev.stopPropagation?.();
        options.onCitationClick?.(cite.source_id, cite.chunk_id);
      });
      return btn;
    });
  }

  function updateToolbar(deck: FlashcardItem[]): void {
    const states = statesMap();
    const masteredCount = payload.cards.filter((c) => states[c.id]?.status === "mastered").length;
    const missedCount = payload.cards.filter((c) => states[c.id]?.status === "needs_review").length;
    masteryEl.textContent = `${masteredCount}/${payload.cards.length} mastered`;
    counterEl.textContent = `Card ${deck.length === 0 ? 0 : currentIndex + 1} of ${deck.length}`;
    reviewMissedBtn.textContent = `Review missed (${missedCount})`;
    reviewMissedBtn.disabled = missedCount === 0;
    reviewMissedBtn.hidden = missedCount === 0 && !reviewMissedOnly;
    practiceAllBtn.hidden = missedCount > 0 && !reviewMissedOnly;
  }

  function renderCard(): void {
    clear(cardHost);
    clear(navHost);
    const deck = activeDeck();
    if (currentIndex >= deck.length) currentIndex = Math.max(0, deck.length - 1);
    updateToolbar(deck);
    const card = deck[currentIndex];
    if (!card) return;

    const flip = () => {
      side = side === "front" ? "back" : "front";
      stage.setAttribute("data-side", side);
      stage.classList.toggle("flipped", side === "back");
      frontFace.hidden = side !== "front";
      backFace.hidden = side !== "back";
    };

    const frontFace = h(
      "div",
      { class: "flashcard-face flashcard-front", hidden: side !== "front" },
      h("span", { class: "flashcard-face-label muted", text: "Question / Term · Click or Space to flip" }),
      h("p", { class: "flashcard-text", "data-testid": "flashcard-front-text", text: card.front_text })
    );

    const explainBtn = h("button", {
      class: "btn btn-sm",
      type: "button",
      "data-testid": "flashcard-explain",
      text: "Explain",
    });
    explainBtn.addEventListener("click", (ev: Event) => {
      ev.stopPropagation?.();
      void options.onExplain(card.id);
    });

    const gotItBtn = h("button", {
      class: "btn btn-sm btn-primary",
      type: "button",
      "data-testid": "flashcard-got-it",
      text: "Got it",
    }) as HTMLButtonElement;
    const needsReviewBtn = h("button", {
      class: "btn btn-sm",
      type: "button",
      "data-testid": "flashcard-needs-review",
      text: "Needs review",
    }) as HTMLButtonElement;

    const record = async (outcome: LearningItemOutcome) => {
      if (busy) return;
      busy = true;
      gotItBtn.disabled = true;
      needsReviewBtn.disabled = true;
      try {
        progress = await options.onRecordProgress(card.id, outcome);
        if (reviewMissedOnly && outcome === "mastered") {
          const remaining = payload.cards.filter((c) => statesMap()[c.id]?.status === "needs_review");
          if (remaining.length === 0) reviewMissedOnly = false;
        }
        side = "front";
        if (currentIndex + 1 < activeDeck().length) currentIndex += 1;
        renderCard();
      } finally {
        busy = false;
        gotItBtn.disabled = false;
        needsReviewBtn.disabled = false;
      }
    };

    gotItBtn.addEventListener("click", (ev: Event) => {
      ev.stopPropagation?.();
      void record("mastered");
    });
    needsReviewBtn.addEventListener("click", (ev: Event) => {
      ev.stopPropagation?.();
      void record("needs_review");
    });

    const backFace = h(
      "div",
      { class: "flashcard-face flashcard-back", hidden: side !== "back" },
      h("span", { class: "flashcard-face-label muted", text: "Answer / Definition" }),
      h("p", { class: "flashcard-text", "data-testid": "flashcard-back-text", text: card.back_text }),
      h("div", { class: "flashcard-citations" }, ...renderBadges(card.citations)),
      h("div", { class: "flashcard-actions" }, gotItBtn, needsReviewBtn, explainBtn)
    );

    const stage = h(
      "div",
      {
        class: `flashcard-stage${side === "back" ? " flipped" : ""}`,
        "data-testid": "flashcard-stage",
        "data-side": side,
        tabIndex: 0,
        role: "button",
        "aria-label": "Flip flashcard",
      },
      frontFace,
      backFace
    );
    stage.addEventListener("click", flip);
    stage.addEventListener("keydown", (ev: Event) => {
      const key = (ev as KeyboardEvent).key;
      if (key === " " || key === "Spacebar" || key === "Enter") {
        (ev as KeyboardEvent).preventDefault?.();
        flip();
      }
    });
    cardHost.append(stage);

    const prevBtn = h("button", {
      class: "btn btn-sm",
      type: "button",
      "data-testid": "flashcard-prev",
      disabled: currentIndex === 0,
      text: "← Prev",
    }) as HTMLButtonElement;
    prevBtn.addEventListener("click", () => {
      if (currentIndex > 0) {
        currentIndex -= 1;
        side = "front";
        renderCard();
      }
    });

    const nextBtn = h("button", {
      class: "btn btn-sm",
      type: "button",
      "data-testid": "flashcard-next",
      disabled: currentIndex >= deck.length - 1,
      text: "Next →",
    }) as HTMLButtonElement;
    nextBtn.addEventListener("click", () => {
      if (currentIndex < deck.length - 1) {
        currentIndex += 1;
        side = "front";
        renderCard();
      }
    });

    navHost.append(prevBtn, nextBtn);
  }

  reviewMissedBtn.addEventListener("click", () => {
    const missed = payload.cards.filter((c) => statesMap()[c.id]?.status === "needs_review");
    if (missed.length === 0) return;
    reviewMissedOnly = true;
    currentIndex = 0;
    side = "front";
    renderCard();
  });

  practiceAllBtn.addEventListener("click", () => {
    reviewMissedOnly = false;
    currentIndex = 0;
    side = "front";
    renderCard();
  });

  resetBtn.addEventListener("click", async () => {
    const ok = options.confirmReset
      ? await options.confirmReset()
      : true;
    if (!ok) return;
    progress = await options.onResetProgress();
    reviewMissedOnly = false;
    currentIndex = 0;
    side = "front";
    renderCard();
  });

  renderCard();

  return {
    element: root,
    destroy() {
      clear(root);
    },
  };
}
