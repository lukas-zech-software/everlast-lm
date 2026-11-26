import type {
  GradeQuizQuestionResponse,
  LearningItemOutcome,
  LearningProgressDto,
  StudioEvidenceRef,
  StudioLearningOverviewPayload,
} from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";
import { renderMarkdownNodes } from "./markdown.ts";

/**
 * [014-studio-active-learning-suite] T029 — Composite Interactive Learning Overview viewer
 * weaving narrative summaries with citations, sanitized D9 SVG concept diagrams, embedded
 * flip flashcards, and inline checkpoint quiz widgets with LearningProgress persistence (FR-ST-12, FR-ST-15).
 */

export interface LearningOverviewViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioLearningOverviewPayload;
  progress: LearningProgressDto | null;
  onRecordProgress: (itemId: string, outcome: LearningItemOutcome) => Promise<LearningProgressDto>;
  onGrade: (questionId: string, answer: string | string[]) => Promise<GradeQuizQuestionResponse>;
  onResetProgress: () => Promise<LearningProgressDto>;
  onExplain: (itemId: string, itemKind: "flashcard" | "quiz_question") => Promise<void> | void;
  onCitationClick?: (sourceId: string, chunkId: string) => void;
  onClose?: () => void;
  actions?: HTMLElement[];
  confirmReset?: () => Promise<boolean>;
}

export interface LearningOverviewViewer {
  element: HTMLElement;
  destroy: () => void;
}

const ALLOWED_SVG_TAGS = new Set([
  "svg",
  "g",
  "rect",
  "line",
  "path",
  "circle",
  "text",
  "tspan",
  "title",
  "polygon",
]);
const ALLOWED_SVG_ATTRS = new Set([
  "xmlns",
  "viewbox",
  "width",
  "height",
  "role",
  "aria-label",
  "x",
  "y",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "font-family",
  "font-size",
  "font-weight",
]);

function decodeXmlEntities(raw: string): string {
  return raw
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function createSvgNode(tag: string): HTMLElement {
  const doc = document as unknown as {
    createElementNS?: (ns: string, name: string) => HTMLElement;
    createElement: (name: string) => HTMLElement;
  };
  return typeof doc.createElementNS === "function"
    ? doc.createElementNS("http://www.w3.org/2000/svg", tag)
    : doc.createElement(tag);
}

function stopEvent(ev: Event): void {
  (ev as Partial<Event>).stopPropagation?.();
}

function applySvgAttributes(node: HTMLElement, rawAttrs: string): void {
  const attrRe = /([a-zA-Z0-9:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRe.exec(rawAttrs)) !== null) {
    const attrName = attrMatch[1];
    if (!attrName) continue;
    const attrVal = decodeXmlEntities(attrMatch[2] ?? attrMatch[3] ?? "");
    if (ALLOWED_SVG_ATTRS.has(attrName.toLowerCase()) && !/^javascript:/i.test(attrVal)) {
      node.setAttribute(attrName, attrVal);
    }
  }
}

function popSvgTag(stack: HTMLElement[], tag: string): void {
  while (stack.length > 0) {
    const popped = stack.pop();
    if (popped?.tagName.toLowerCase() === tag) break;
  }
}

function appendSvgText(stack: HTMLElement[], text: string): void {
  const decoded = decodeXmlEntities(text).trim();
  const parent = stack.at(-1);
  if (decoded && parent) {
    parent.append(document.createTextNode(decoded));
  }
}

/**
 * Parses allowlisted static SVG primitives cleanly without `innerHTML` script risks (`D9`).
 */
export function buildSafeSvgElement(svgText: string): HTMLElement | null {
  if (/<(?:script|foreignObject|iframe|object|embed)\b/i.test(svgText)) return null;
  if (/\bon[a-z]+\s*=|javascript:|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(svgText)) {
    return null;
  }

  const tokenRe = /<(\/?)([a-zA-Z0-9-]+)([^>]*?)(\/?)>|([^<]+)/g;
  const stack: HTMLElement[] = [];
  let rootSvg: HTMLElement | null = null;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(svgText)) !== null) {
    const [, closing = "", rawTag = "", rawAttrs = "", selfClosing = "", text] = match;
    if (text !== undefined) {
      appendSvgText(stack, text);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) continue;

    if (closing) {
      popSvgTag(stack, tag);
      continue;
    }

    const node = createSvgNode(tag);
    applySvgAttributes(node, rawAttrs);

    const parent = stack.at(-1);
    if (!rootSvg && tag === "svg") {
      rootSvg = node;
    } else if (parent) {
      parent.append(node);
    }

    if (!selfClosing) stack.push(node);
  }
  return rootSvg;
}

export function createLearningOverviewViewer(
  options: LearningOverviewViewerOptions,
): LearningOverviewViewer {
  const { payload } = options;
  let progress: LearningProgressDto | null = options.progress;
  let reviewMissedOnly = false;

  const allItemIds = payload.modules.flatMap((m) => [
    ...m.flashcards.map((c) => c.id),
    ...m.checkpoint_quiz.map((q) => q.id),
  ]);

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close learning overview",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const masteryEl = h("span", {
    class: "badge active-learning-mastery",
    "data-testid": "overview-mastery",
  });
  const reviewMissedBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "overview-review-missed",
  });
  const practiceAllBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "overview-practice-all",
    text: "Practice all again",
  });
  const resetBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "overview-reset-progress",
    text: "Reset progress",
  });

  const headEl = h(
    "div",
    { class: "studio-viewer-head" },
    ...(closeBtn ? [closeBtn] : []),
    h("h3", {
      class: "studio-report-title",
      "data-testid": "studio-report-title",
      text: options.title,
    }),
    h("span", { class: "muted", text: "AI-generated" }),
    ...(options.actions ?? []),
  );

  const toolbarEl = h(
    "div",
    { class: "active-learning-toolbar" },
    masteryEl,
    reviewMissedBtn,
    practiceAllBtn,
    resetBtn,
  );

  const noteEl = payload.insufficient_evidence_note
    ? h("p", { class: "muted active-learning-note", text: payload.insufficient_evidence_note })
    : null;

  const modulesHost = h("div", { class: "overview-modules-host" });
  const root = h(
    "article",
    {
      class: "studio-learning-overview-viewer",
      "data-testid": "studio-learning-overview-viewer",
      "data-artifact-id": options.artifactId,
      "aria-label": options.title,
    },
    headEl,
    toolbarEl,
    ...(noteEl ? [noteEl] : []),
    modulesHost,
  );

  const statesMap = () => progress?.item_states_json ?? {};

  function updateToolbar(): void {
    const states = statesMap();
    const masteredCount = allItemIds.filter((id) => states[id]?.status === "mastered").length;
    const missedCount = allItemIds.filter((id) => states[id]?.status === "needs_review").length;
    masteryEl.textContent = `${masteredCount}/${allItemIds.length} mastered`;
    reviewMissedBtn.textContent = `Review missed (${missedCount})`;
    reviewMissedBtn.disabled = missedCount === 0;
    reviewMissedBtn.hidden = missedCount === 0 && !reviewMissedOnly;
    practiceAllBtn.hidden = missedCount > 0 && !reviewMissedOnly;
  }

  function renderCitations(cites: readonly StudioEvidenceRef[]): HTMLElement[] {
    return cites.map((cite) => {
      const btn = h("button", {
        class: "citation-badge",
        type: "button",
        "data-badge": cite.badge_number,
        "data-chunk-id": cite.chunk_id,
        "aria-label": `Citation ${cite.badge_number}`,
        title: cite.snippet,
        text: `[${cite.badge_number}]`,
      });
      btn.addEventListener("click", (ev: Event) => {
        stopEvent(ev);
        options.onCitationClick?.(cite.source_id, cite.chunk_id);
      });
      return btn;
    });
  }

  function badgeLookup(cites: readonly StudioEvidenceRef[]) {
    return (n: number): Node | null => {
      const found = cites.find((c) => c.badge_number === n);
      if (!found) return null;
      const btn = h("button", {
        class: "citation-badge",
        type: "button",
        "data-badge": n,
        "data-chunk-id": found.chunk_id,
        title: found.snippet,
        text: String(n),
      });
      btn.addEventListener("click", () =>
        options.onCitationClick?.(found.source_id, found.chunk_id),
      );
      return btn;
    };
  }

  type OverviewModule = StudioLearningOverviewPayload["modules"][number];
  type OverviewCard = OverviewModule["flashcards"][number];
  type OverviewQuestion = OverviewModule["checkpoint_quiz"][number];

  function recordCardOutcome(cardId: string, outcome: LearningItemOutcome): void {
    void options.onRecordProgress(cardId, outcome).then((next) => {
      progress = next;
      updateToolbar();
    });
  }

  function renderOverviewFlashcard(card: OverviewCard): HTMLElement {
    let cardSide: "front" | "back" = "front";
    const front = h("div", { class: "overview-card-front", text: card.front_text });
    const explainBtn = h("button", { class: "btn btn-sm", type: "button", text: "Explain" });
    explainBtn.addEventListener("click", (ev: Event) => {
      stopEvent(ev);
      void options.onExplain(card.id, "flashcard");
    });
    const gotBtn = h("button", {
      class: "btn btn-sm btn-primary",
      type: "button",
      text: "Got it",
    });
    gotBtn.addEventListener("click", (ev: Event) => {
      stopEvent(ev);
      recordCardOutcome(card.id, "mastered");
    });
    const reviewBtn = h("button", { class: "btn btn-sm", type: "button", text: "Needs review" });
    reviewBtn.addEventListener("click", (ev: Event) => {
      stopEvent(ev);
      recordCardOutcome(card.id, "needs_review");
    });
    const back = h(
      "div",
      { class: "overview-card-back", hidden: true },
      h("p", { text: card.back_text }),
      h("div", { class: "flashcard-citations" }, ...renderCitations(card.citations)),
      h("div", { class: "flashcard-actions" }, gotBtn, reviewBtn, explainBtn),
    );
    const cardEl = h(
      "div",
      {
        class: "overview-flashcard",
        "data-testid": "overview-flashcard",
        "data-side": "front",
        tabIndex: 0,
        role: "button",
      },
      front,
      back,
    );
    cardEl.addEventListener("click", () => {
      cardSide = cardSide === "front" ? "back" : "front";
      cardEl.setAttribute("data-side", cardSide);
      cardEl.classList.toggle("flipped", cardSide === "back");
      front.hidden = cardSide !== "front";
      back.hidden = cardSide !== "back";
    });
    return cardEl;
  }

  function buildQuestionInputs(q: OverviewQuestion, qCard: HTMLElement): () => string | string[] {
    let chosenSingle = "";
    const chosenMulti = new Set<string>();
    let textAnswer = "";

    if (q.type === "multiple_choice" && q.options) {
      const name = `ov-mc-${q.id}`;
      for (const opt of q.options) {
        const inp = h("input", { type: "radio", name, value: opt.id });
        inp.addEventListener("change", () => {
          if (inp.checked) chosenSingle = opt.id;
        });
        qCard.append(
          h("label", { class: "quiz-option-row" }, inp, " ", h("span", { text: opt.text })),
        );
      }
      return () => chosenSingle;
    }

    if (q.type === "multiple_select" && q.options) {
      for (const opt of q.options) {
        const inp = h("input", { type: "checkbox", value: opt.id });
        inp.addEventListener("change", () => {
          if (inp.checked) chosenMulti.add(opt.id);
          else chosenMulti.delete(opt.id);
        });
        qCard.append(
          h("label", { class: "quiz-option-row" }, inp, " ", h("span", { text: opt.text })),
        );
      }
      return () => [...chosenMulti];
    }

    const inp = h("input", {
      class: "url-input",
      type: "text",
      placeholder: "Type checkpoint answer...",
    });
    inp.addEventListener("input", () => {
      textAnswer = inp.value;
    });
    qCard.append(inp);
    return () => textAnswer.trim();
  }

  function renderOverviewQuizItem(q: OverviewQuestion): HTMLElement {
    const qCard = h("div", { class: "overview-quiz-item" }, h("p", { text: q.prompt }));
    const readAnswer = buildQuestionInputs(q, qCard);
    const feedbackHost = h("div", { class: "overview-quiz-feedback" });
    const checkBtn = h("button", {
      class: "btn btn-sm btn-primary",
      type: "button",
      text: "Check",
    });
    const gradeAnswer = async (): Promise<void> => {
      const ans = readAnswer();
      if (!ans || (Array.isArray(ans) && ans.length === 0)) return;
      const res = await options.onGrade(q.id, ans);
      progress = res.progress;
      updateToolbar();
      clear(feedbackHost);
      const explainBtn = h("button", { class: "btn btn-sm", type: "button", text: "Explain" });
      explainBtn.addEventListener("click", () => void options.onExplain(q.id, "quiz_question"));
      feedbackHost.append(
        h("strong", { text: res.correct ? "Right!" : "Not quite" }),
        h("p", { text: res.explanation }),
        ...renderCitations(res.citations),
        explainBtn,
      );
    };
    checkBtn.addEventListener("click", () => {
      void gradeAnswer();
    });
    qCard.append(checkBtn, feedbackHost);
    return qCard;
  }

  function renderOverviewModule(mod: OverviewModule): HTMLElement | null {
    const states = statesMap();
    const modCards = reviewMissedOnly
      ? mod.flashcards.filter((c) => states[c.id]?.status === "needs_review")
      : mod.flashcards;
    const modQuestions = reviewMissedOnly
      ? mod.checkpoint_quiz.filter((q) => states[q.id]?.status === "needs_review")
      : mod.checkpoint_quiz;
    if (reviewMissedOnly && modCards.length === 0 && modQuestions.length === 0) return null;

    const sectionEl = h("section", {
      class: "overview-module",
      "data-testid": "overview-module",
    });
    sectionEl.append(h("h4", { class: "overview-module-title", text: mod.title }));

    const summaryEl = h("div", { class: "studio-report-content overview-summary" });
    for (const n of renderMarkdownNodes(mod.summary_md, {
      badge: badgeLookup(payload.citations),
    })) {
      summaryEl.append(n);
    }
    sectionEl.append(summaryEl);

    const diagramWrap = h("div", {
      class: "overview-diagram",
      "data-testid": "overview-diagram",
    });
    const svgNode = buildSafeSvgElement(mod.diagram_svg);
    if (svgNode) diagramWrap.append(svgNode);
    sectionEl.append(diagramWrap);

    if (modCards.length > 0) {
      sectionEl.append(
        h("div", { class: "overview-flashcards" }, ...modCards.map(renderOverviewFlashcard)),
      );
    }

    if (modQuestions.length > 0) {
      sectionEl.append(
        h(
          "div",
          { class: "overview-checkpoint-quiz", "data-testid": "overview-checkpoint-quiz" },
          ...modQuestions.map(renderOverviewQuizItem),
        ),
      );
    }

    return sectionEl;
  }

  function renderModules(): void {
    clear(modulesHost);
    updateToolbar();
    for (const mod of payload.modules) {
      const sectionEl = renderOverviewModule(mod);
      if (sectionEl) modulesHost.append(sectionEl);
    }
  }

  reviewMissedBtn.addEventListener("click", () => {
    reviewMissedOnly = true;
    renderModules();
  });
  practiceAllBtn.addEventListener("click", () => {
    reviewMissedOnly = false;
    renderModules();
  });
  const handleReset = async (): Promise<void> => {
    const ok = options.confirmReset ? await options.confirmReset() : true;
    if (!ok) return;
    progress = await options.onResetProgress();
    reviewMissedOnly = false;
    renderModules();
  };
  resetBtn.addEventListener("click", () => {
    void handleReset();
  });

  renderModules();

  return {
    element: root,
    destroy() {
      clear(root);
    },
  };
}
