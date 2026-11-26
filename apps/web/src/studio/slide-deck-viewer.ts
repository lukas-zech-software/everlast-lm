import type {
  SlideDeckExportFormat,
  SlideItem,
  StudioEvidenceRef,
  StudioSlideDeckPayload,
} from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";

/**
 * [015-studio-visuals-presentations] T014 — Interactive 16:9 Slide Deck carousel viewer,
 * thumbnail strip, toggleable Speaker Notes drawer, clickable grounded citations, and
 * PPTX / PDF export controls (`FR-ST-16`, `D8/DEV-02`, `Gate v4.0 #3`).
 */

export interface SlideDeckViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioSlideDeckPayload;
  onOpenCitation?: (ref: StudioEvidenceRef) => void;
  onCitationClick?: (sourceId: string, chunkId: string) => void;
  onExport?: (format: SlideDeckExportFormat) => Promise<void> | void;
  onClose?: () => void;
  actions?: HTMLElement[];
}

export interface SlideDeckViewer {
  element: HTMLElement;
  destroy: () => void;
}

function renderVisualSpec(slide: SlideItem): HTMLElement | null {
  const vs = slide.visual_spec;
  if (vs.layout === "key_metric_callout" && vs.callout) {
    return h(
      "div",
      { class: "studio-slide-callout", "data-testid": "slide-visual-callout" },
      h("div", { class: "studio-slide-callout-value", text: vs.callout.value }),
      h("div", { class: "studio-slide-callout-label", text: vs.callout.label }),
      ...(vs.callout.context ? [h("p", { class: "muted", text: vs.callout.context })] : []),
    );
  }
  if (vs.layout === "two_column" && vs.columns) {
    return h(
      "div",
      { class: "studio-slide-two-col", "data-testid": "slide-visual-two-col" },
      h(
        "div",
        { class: "studio-slide-col" },
        h("h5", { text: vs.columns.left_heading }),
        h("ul", {}, ...vs.columns.left_points.map((pt) => h("li", { text: pt }))),
      ),
      h(
        "div",
        { class: "studio-slide-col" },
        h("h5", { text: vs.columns.right_heading }),
        h("ul", {}, ...vs.columns.right_points.map((pt) => h("li", { text: pt }))),
      ),
    );
  }
  if (vs.layout === "comparison_table" && vs.table) {
    return h(
      "table",
      { class: "studio-slide-table", "data-testid": "slide-visual-table" },
      h("thead", {}, h("tr", {}, ...vs.table.headers.map((hd) => h("th", { text: hd })))),
      h(
        "tbody",
        {},
        ...vs.table.rows.map((row) => h("tr", {}, ...row.map((cell) => h("td", { text: cell })))),
      ),
    );
  }
  if (vs.layout === "diagram_chart" && vs.diagram_steps && vs.diagram_steps.length > 0) {
    return h(
      "div",
      { class: "studio-slide-diagram", "data-testid": "slide-visual-diagram" },
      ...vs.diagram_steps.map((step, idx) =>
        h(
          "div",
          { class: "studio-slide-diagram-step" },
          h("span", { class: "studio-slide-step-num", text: String(idx + 1) }),
          h("span", { text: step }),
        ),
      ),
    );
  }
  if (vs.subtitle) {
    return h("p", { class: "studio-slide-subtitle muted", text: vs.subtitle });
  }
  return null;
}

export function createSlideDeckViewer(options: SlideDeckViewerOptions): SlideDeckViewer {
  const { payload } = options;
  const slides = payload.slides;
  let currentIndex = 0;
  let notesOpen = false;
  let destroyed = false;

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close slide deck",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const aiLabel = h("span", {
    class: "studio-table-ai-badge muted",
    "data-testid": "slide-deck-ai-label",
    text: "AI-generated from selected sources",
  });

  const exportPptxBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "slide-export-pptx",
    text: "Export PPTX",
  });
  exportPptxBtn.addEventListener("click", () => {
    void options.onExport?.("pptx");
  });

  const exportPdfBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "slide-export-pdf",
    text: "Export PDF",
  });
  exportPdfBtn.addEventListener("click", () => {
    void options.onExport?.("pdf");
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
    aiLabel,
    h(
      "div",
      { class: "studio-table-controls" },
      exportPptxBtn,
      exportPdfBtn,
      ...(options.actions ?? []),
    ),
  );

  const noteBanner = payload.insufficient_evidence_note
    ? h("p", {
        class: "studio-insufficient-note muted",
        "data-testid": "slide-deck-insufficient-note",
        text: payload.insufficient_evidence_note,
      })
    : null;

  const stageEl = h("div", { class: "studio-slide-stage", "data-testid": "slide-stage" });
  const counterEl = h("span", {
    class: "studio-slide-counter muted",
    "data-testid": "slide-deck-counter",
  });
  const prevBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "slide-prev",
    text: "Prev",
  });
  const nextBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "slide-next",
    text: "Next",
  });
  const notesToggleBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "slide-notes-toggle",
    "aria-expanded": "false",
    text: "Speaker Notes",
  });

  const controlsEl = h(
    "div",
    { class: "studio-slide-controls" },
    prevBtn,
    counterEl,
    nextBtn,
    notesToggleBtn,
  );

  const notesEl = h("section", {
    class: "studio-slide-notes",
    "data-testid": "slide-speaker-notes",
    "aria-label": "Speaker notes",
  });
  notesEl.hidden = true;

  const thumbsEl = h("div", {
    class: "studio-slide-thumbnails",
    "data-testid": "slide-thumbnails",
  });

  function render(): void {
    if (destroyed || slides.length === 0) return;
    const slide = slides[currentIndex];
    if (!slide) return;
    clear(stageEl);

    const visualNode = renderVisualSpec(slide);
    const bulletList = h(
      "ul",
      { class: "studio-slide-bullets" },
      ...slide.bullets.map((b) => h("li", { text: b })),
    );

    const citeRow = h(
      "div",
      { class: "studio-slide-citations" },
      ...slide.citations.map((ref) => {
        const pill = h("button", {
          class: "citation-badge",
          type: "button",
          "data-testid": `slide-citation-${ref.badge_number}`,
          "data-chunk-id": ref.chunk_id,
          title: ref.snippet,
          text: `[${ref.badge_number}]`,
        });
        pill.addEventListener("click", () => {
          options.onOpenCitation?.(ref);
          options.onCitationClick?.(ref.source_id, ref.chunk_id);
        });
        return pill;
      }),
    );

    stageEl.append(
      h("span", { class: "studio-slide-layout-chip muted", text: slide.layout }),
      h("h4", {
        class: "studio-slide-stage-title",
        "data-testid": "slide-stage-title",
        text: slide.title,
      }),
      ...(visualNode ? [visualNode] : []),
      bulletList,
      citeRow,
    );

    counterEl.textContent = `Slide ${currentIndex + 1} of ${slides.length}`;
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex >= slides.length - 1;

    clear(notesEl);
    notesEl.hidden = !notesOpen;
    notesToggleBtn.setAttribute("aria-expanded", String(notesOpen));
    notesEl.append(
      h("strong", { text: `Slide ${slide.slide_number} Speaker Notes` }),
      h("p", { text: slide.speaker_notes }),
    );

    clear(thumbsEl);
    slides.forEach((s, idx) => {
      const active = idx === currentIndex;
      const thumb = h(
        "button",
        {
          class: `studio-slide-thumb${active ? " active" : ""}`,
          type: "button",
          "data-testid": `slide-thumb-${s.slide_number}`,
          "aria-pressed": String(active),
        },
        h("span", { class: "studio-slide-thumb-num", text: `${s.slide_number}` }),
        h("span", { class: "studio-slide-thumb-title", text: s.title }),
      );
      thumb.addEventListener("click", () => {
        currentIndex = idx;
        render();
      });
      thumbsEl.append(thumb);
    });
  }

  prevBtn.addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex--;
      render();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (currentIndex < slides.length - 1) {
      currentIndex++;
      render();
    }
  });
  notesToggleBtn.addEventListener("click", () => {
    notesOpen = !notesOpen;
    render();
  });

  render();

  const element = h(
    "article",
    {
      class: "studio-slide-deck-viewer",
      "data-testid": "studio-slide-deck-viewer",
      "data-artifact-id": options.artifactId,
    },
    headEl,
    ...(noteBanner ? [noteBanner] : []),
    stageEl,
    controlsEl,
    notesEl,
    thumbsEl,
  );

  return {
    element,
    destroy() {
      destroyed = true;
    },
  };
}
