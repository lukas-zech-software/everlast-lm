import type {
  InfographicExportFormat,
  StudioEvidenceRef,
  StudioInfographicPayload,
} from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";
import { buildSafeSvgElement } from "./learning-overview-viewer.ts";

/**
 * [015-studio-visuals-presentations] T020 — Visual Infographic crisp SVG viewer (`D9`),
 * zoom controls, safe DOM SVG rendering (no `innerHTML`), AI-generated label, clickable citations,
 * and SVG/2x PNG export triggers (`FR-ST-17`, `NFR-SEC-02`).
 */

export interface InfographicViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioInfographicPayload;
  onOpenCitation?: (ref: StudioEvidenceRef) => void;
  onCitationClick?: (sourceId: string, chunkId: string) => void;
  onExport?: (format: InfographicExportFormat) => Promise<void> | void;
  onClose?: () => void;
  actions?: HTMLElement[];
}

export interface InfographicViewer {
  element: HTMLElement;
  destroy: () => void;
}

const MIN_ZOOM = 40;
const MAX_ZOOM = 240;
const ZOOM_STEP = 20;

export function createInfographicViewer(options: InfographicViewerOptions): InfographicViewer {
  const { payload } = options;
  let zoomPercent = 100;

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close infographic",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const aiLabel = h("span", {
    class: "studio-table-ai-badge muted",
    "data-testid": "infographic-ai-label",
    text: "AI-generated · Illustration",
  });

  const zoomOutBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "infographic-zoom-out",
    "aria-label": "Zoom out",
    text: "−",
  });
  const zoomValueEl = h("span", {
    class: "studio-infographic-zoom-val muted",
    "data-testid": "infographic-zoom-value",
    text: "100%",
  });
  const zoomInBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "infographic-zoom-in",
    "aria-label": "Zoom in",
    text: "+",
  });
  const zoomResetBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "infographic-zoom-reset",
    text: "Reset",
  });

  const exportSvgBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "infographic-export-svg",
    text: "Export SVG",
  });
  exportSvgBtn.addEventListener("click", () => {
    void options.onExport?.("svg");
  });

  const exportPngBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "infographic-export-png",
    text: "Export PNG",
  });
  exportPngBtn.addEventListener("click", () => {
    void options.onExport?.("png");
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
    h("span", { class: "studio-slide-layout-chip muted", text: payload.style }),
    aiLabel,
    h(
      "div",
      { class: "studio-table-controls" },
      zoomOutBtn,
      zoomValueEl,
      zoomInBtn,
      zoomResetBtn,
      exportSvgBtn,
      exportPngBtn,
      ...(options.actions ?? []),
    ),
  );

  const stageInner = h("div", { class: "studio-infographic-stage-inner" });
  const svgNode = buildSafeSvgElement(payload.rendered_svg);
  if (svgNode) {
    stageInner.append(svgNode);
  } else {
    for (const block of payload.structured_blocks) {
      stageInner.append(
        h(
          "div",
          { class: "studio-infographic-fallback-card" },
          h("strong", { text: block.heading }),
          h("p", { text: block.body }),
        ),
      );
    }
  }

  const canvasEl = h(
    "div",
    { class: "studio-infographic-canvas", "data-testid": "infographic-canvas" },
    stageInner,
  );

  function applyZoom(): void {
    zoomValueEl.textContent = `${zoomPercent}%`;
    stageInner.style.transform = `scale(${zoomPercent / 100})`;
    stageInner.style.transformOrigin = "top left";
    zoomOutBtn.disabled = zoomPercent <= MIN_ZOOM;
    zoomInBtn.disabled = zoomPercent >= MAX_ZOOM;
  }

  zoomInBtn.addEventListener("click", () => {
    zoomPercent = Math.min(MAX_ZOOM, zoomPercent + ZOOM_STEP);
    applyZoom();
  });
  zoomOutBtn.addEventListener("click", () => {
    zoomPercent = Math.max(MIN_ZOOM, zoomPercent - ZOOM_STEP);
    applyZoom();
  });
  zoomResetBtn.addEventListener("click", () => {
    zoomPercent = 100;
    applyZoom();
  });

  const citationsEl = h(
    "div",
    { class: "studio-infographic-citations", "data-testid": "infographic-citations" },
    ...payload.citations.map((ref) => {
      const btn = h("button", {
        class: "citation-badge",
        type: "button",
        "data-testid": `infographic-citation-${ref.badge_number}`,
        "data-chunk-id": ref.chunk_id,
        title: ref.snippet,
        text: `[${ref.badge_number}]`,
      });
      btn.addEventListener("click", () => {
        options.onOpenCitation?.(ref);
        options.onCitationClick?.(ref.source_id, ref.chunk_id);
      });
      return btn;
    }),
  );

  applyZoom();

  const element = h(
    "article",
    {
      class: "studio-infographic-viewer",
      "data-testid": "studio-infographic-viewer",
      "data-artifact-id": options.artifactId,
    },
    headEl,
    canvasEl,
    citationsEl,
  );

  return {
    element,
    destroy() {
      clear(canvasEl);
    },
  };
}
