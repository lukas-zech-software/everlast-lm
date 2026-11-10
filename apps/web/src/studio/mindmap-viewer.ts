import type { MindmapNode, StudioMindmapPayload } from "@everlast/contracts";
import { clear, h } from "../lib/dom.ts";
import { computeMindmapLayout, defaultExpandedNodeIds } from "./mindmap-layout.ts";

/**
 * [011-studio-mindmaps-data-tables] T029, T030, T034 — Interactive SVG mindmap viewer, branch controls,
 * pan/zoom/fit transform, and 60fps / <=16ms frame-budget evaluator (FR-ST-08/09; FR-002, FR-004, FR-005, FR-013, SC-003, SC-004).
 */

export const MINDMAP_FRAME_BUDGET_MS = 16;
export const MINDMAP_MIN_FRAME_SAMPLES = 20;

export interface MindmapFrameSample {
  frame_index: number;
  operation: "pan" | "zoom" | "expand" | "collapse";
  node_count: number;
  rendered_nodes_before?: number;
  rendered_nodes_after?: number;
  duration_ms: number;
  dropped: boolean;
}

export interface MindmapFrameReport {
  sample_count: number;
  p95_frame_ms: number;
  max_frame_ms: number;
  estimated_fps: number;
  budget_ms: number;
  passed: boolean;
  samples: MindmapFrameSample[];
}

export function evaluateMindmapFrameSamples(
  samples: readonly MindmapFrameSample[],
  budgetMs = MINDMAP_FRAME_BUDGET_MS
): MindmapFrameReport {
  if (samples.length < MINDMAP_MIN_FRAME_SAMPLES) {
    throw new Error(
      `Mindmap frame benchmark requires at least ${MINDMAP_MIN_FRAME_SAMPLES} frame samples (received ${samples.length}).`
    );
  }
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("Invalid frame budget");
  const identities = new Set<number>();
  const operations = new Set<string>();
  for (const sample of samples) {
    if (!Number.isInteger(sample.frame_index) || sample.frame_index < 1 || identities.has(sample.frame_index)) throw new Error("Expected unique positive frame indices; duplicate index");
    identities.add(sample.frame_index);
    if (sample.node_count !== 120) throw new Error("The declared viewer benchmark requires 120 nodes");
    if (!["pan", "zoom", "expand", "collapse"].includes(sample.operation)) throw new Error("Invalid frame operation");
    operations.add(sample.operation);
    if (!Number.isFinite(sample.duration_ms) || sample.duration_ms < 0 || typeof sample.dropped !== "boolean") throw new Error("Invalid frame duration or dropped flag");
  }
  if (operations.size !== 4) throw new Error("Frame population must include all four operations");
  const durations = samples.map((s) =>
    !Number.isFinite(s.duration_ms) || s.duration_ms < 0 ? Number.POSITIVE_INFINITY : s.duration_ms
  );
  const sorted = [...durations].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  const p95 = sorted[rank - 1]!;
  const max = sorted[sorted.length - 1]!;
  const fps = p95 > 0 && Number.isFinite(p95) ? Math.min(60, Math.round(1000 / p95)) : 0;
  return {
    sample_count: samples.length,
    p95_frame_ms: p95,
    max_frame_ms: max,
    estimated_fps: p95 <= budgetMs ? 60 : fps,
    budget_ms: budgetMs,
    passed: Number.isFinite(p95) && p95 <= budgetMs && !samples.some((s) => s.dropped),
    samples: [...samples],
  };
}

export interface MindmapViewerOptions {
  artifactId: string;
  title: string;
  payload: StudioMindmapPayload;
  onDrilldown?(nodeId: string): void;
  onCitationClick?(sourceId: string, chunkId: string): void;
  onExport?(format: "svg" | "png", expandedNodeIds: string[]): void;
  onClose?(): void;
  actions?: HTMLElement[];
}

export interface MindmapTransform {
  x: number;
  y: number;
  scale: number;
}

export interface MindmapViewer {
  element: HTMLElement;
  getExpandedNodeIds(): string[];
  getTransform(): MindmapTransform;
  setTransform(transform: MindmapTransform): void;
  destroy(): void;
}

export function createMindmapViewer(options: MindmapViewerOptions): MindmapViewer {
  const { payload } = options;
  const visibleIds = new Set<string>(
    defaultExpandedNodeIds(payload.root_node, payload.initial_expanded_depth ?? 2)
  );
  let transform: MindmapTransform = { x: 0, y: 0, scale: 1 };

  const closeBtn = options.onClose
    ? h("button", {
        class: "icon-btn",
        type: "button",
        "data-testid": "studio-viewer-close",
        "aria-label": "Close mindmap",
        text: "←",
      })
    : null;
  closeBtn?.addEventListener("click", () => options.onClose?.());

  const zoomInBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "mindmap-zoom-in",
    "aria-label": "Zoom in",
    text: "+",
  });
  const zoomOutBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "mindmap-zoom-out",
    "aria-label": "Zoom out",
    text: "−",
  });
  const fitBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "mindmap-fit",
    "aria-label": "Fit to screen",
    text: "Fit",
  });
  const exportSvgBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "mindmap-export-svg",
    text: "Export SVG",
  });
  const exportPngBtn = h("button", {
    class: "btn btn-sm",
    type: "button",
    "data-testid": "mindmap-export-png",
    text: "Export PNG",
  });

  const aiBadge = h("span", {
    class: "studio-ai-badge muted",
    "data-testid": "studio-ai-generated-badge",
    role: "note",
    text: (payload as { ai_generated_label?: string }).ai_generated_label ?? "AI-generated from selected sources · Structural edges are illustrative",
  });

  const limitedNote = payload.insufficient_evidence_note
    ? h("p", {
        class: "muted mindmap-limited-note",
        "data-testid": "mindmap-insufficient-evidence-note",
        text: payload.insufficient_evidence_note,
      })
    : null;

  const sceneHost = h("div", {
    class: "mindmap-scene-host",
    "data-testid": "mindmap-canvas",
  });

  const applyTransform = () => {
    sceneHost.setAttribute(
      "data-transform",
      `translate(${transform.x},${transform.y}) scale(${transform.scale.toFixed(2)})`
    );
    sceneHost.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  };

  zoomInBtn.addEventListener("click", () => {
    transform = { ...transform, scale: Math.min(3, Number((transform.scale + 0.25).toFixed(2))) };
    applyTransform();
  });
  zoomOutBtn.addEventListener("click", () => {
    transform = { ...transform, scale: Math.max(0.4, Number((transform.scale - 0.25).toFixed(2))) };
    applyTransform();
  });
  fitBtn.addEventListener("click", () => {
    transform = { x: 0, y: 0, scale: 1 };
    applyTransform();
  });

  exportSvgBtn.addEventListener("click", () => {
    options.onExport?.("svg", [...visibleIds]);
  });
  exportPngBtn.addEventListener("click", () => {
    options.onExport?.("png", [...visibleIds]);
  });

  // Pan from the canvas background only: dragging a factual node must not create a chat turn (FR-ST-09).
  let pan: { pointerId: number; clientX: number; clientY: number; x: number; y: number } | null = null;
  sceneHost.style.touchAction = "none";
  sceneHost.style.cursor = "grab";
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element | null)?.closest?.("button")) return;
    pan = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: transform.x, y: transform.y };
    if (event.isTrusted) sceneHost.setPointerCapture?.(event.pointerId);
    sceneHost.style.cursor = "grabbing";
    event.preventDefault();
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    transform = { ...transform, x: pan.x + event.clientX - pan.clientX, y: pan.y + event.clientY - pan.clientY };
    applyTransform();
    event.preventDefault();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (sceneHost.hasPointerCapture?.(event.pointerId)) sceneHost.releasePointerCapture(event.pointerId);
    pan = null;
    sceneHost.style.cursor = "grab";
  };
  sceneHost.addEventListener("pointerdown", pointerDown);
  sceneHost.addEventListener("pointermove", pointerMove);
  sceneHost.addEventListener("pointerup", pointerEnd);
  sceneHost.addEventListener("pointercancel", pointerEnd);
  sceneHost.addEventListener("lostpointercapture", pointerEnd);

  const toggleSubtree = (node: MindmapNode) => {
    const anyChildVisible = node.children.some((c) => visibleIds.has(c.id));
    if (anyChildVisible) {
      // Collapse all descendants of `node`
      const removeDescendants = (curr: MindmapNode) => {
        for (const ch of curr.children) {
          visibleIds.delete(ch.id);
          removeDescendants(ch);
        }
      };
      removeDescendants(node);
    } else {
      // Expand direct children of `node`
      for (const ch of node.children) {
        visibleIds.add(ch.id);
      }
    }
    renderScene();
  };

  function renderScene(): void {
    clear(sceneHost);
    const layout = computeMindmapLayout(payload.root_node, visibleIds);
    sceneHost.setAttribute("data-scene-width", String(layout.width));
    sceneHost.setAttribute("data-scene-height", String(layout.height));

    for (const positioned of layout.nodes) {
      const { node, depth, hasChildren, expanded } = positioned;
      const bodyBtn = h(
        "button",
        {
          class: "mindmap-node-body",
          type: "button",
          "data-testid": "mindmap-node-body",
          "data-node-id": node.id,
          title: node.summary || node.label,
        },
        h("span", {
          class: "mindmap-node-label",
          "data-testid": "mindmap-node-label",
          text: node.label,
        })
      );
      bodyBtn.addEventListener("click", () => {
        options.onDrilldown?.(node.id);
      });

      const nodeContainer = h(
        "div",
        {
          class: "mindmap-node",
          "data-testid": "mindmap-node",
          "data-node-id": node.id,
          "data-depth": String(depth),
          "data-x": String(positioned.x),
          "data-y": String(positioned.y),
          style: `left: ${positioned.x}px; top: ${positioned.y}px;`,
        },
        bodyBtn
      );

      if (hasChildren) {
        const toggleBtn = h("button", {
          class: "mindmap-node-toggle",
          type: "button",
          "data-testid": "mindmap-node-toggle",
          "aria-expanded": String(expanded),
          "aria-label": `${expanded ? "Collapse" : "Expand"} ${node.label}`,
          text: expanded ? "▾" : "▸",
        });
        toggleBtn.addEventListener("click", (ev: Event) => {
          ev.stopPropagation?.();
          toggleSubtree(node);
        });
        nodeContainer.append(toggleBtn);
      }

      sceneHost.append(nodeContainer);
    }
    applyTransform();
  }

  renderScene();

  const headItems: HTMLElement[] = [];
  if (closeBtn) headItems.push(closeBtn);
  headItems.push(h("h3", { class: "studio-report-title", "data-testid": "studio-report-title", text: options.title }));

  const toolbar = h(
    "div",
    { class: "mindmap-toolbar", "data-testid": "mindmap-toolbar" },
    zoomInBtn,
    zoomOutBtn,
    fitBtn,
    exportSvgBtn,
    exportPngBtn
  );

  const element = h(
    "article",
    {
      class: "studio-mindmap-viewer",
      "data-testid": "studio-mindmap-viewer",
      "data-artifact-id": options.artifactId,
      "data-node-count": String(payload.node_count),
    },
    h("div", { class: "studio-viewer-head" }, ...headItems),
    aiBadge,
    ...(limitedNote ? [limitedNote] : []),
    toolbar,
    sceneHost,
    ...(options.actions && options.actions.length > 0
      ? [h("div", { class: "studio-viewer-actions" }, ...options.actions)]
      : [])
  );

  return {
    element,
    getExpandedNodeIds: () => [...visibleIds],
    getTransform: () => ({ ...transform }),
    setTransform(next) {
      transform = { ...next };
      applyTransform();
    },
    destroy() {
      sceneHost.removeEventListener("pointerdown", pointerDown);
      sceneHost.removeEventListener("pointermove", pointerMove);
      sceneHost.removeEventListener("pointerup", pointerEnd);
      sceneHost.removeEventListener("pointercancel", pointerEnd);
      sceneHost.removeEventListener("lostpointercapture", pointerEnd);
      pan = null;
      clear(sceneHost);
    },
  };
}
