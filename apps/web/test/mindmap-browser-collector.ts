import type { Page } from "@playwright/test";
import type { MindmapFrameSample } from "../src/studio/mindmap-viewer.ts";

export interface MindmapFrameWindow {
  operation: MindmapFrameSample["operation"];
  frames: number;
}

/** [011-studio-mindmaps-data-tables] T060 — actual Chromium rAF intervals around declared viewer actions (FR-ST-09/SC-003). */
export async function captureMindmapFrames(
  page: Page,
  windows: readonly MindmapFrameWindow[],
  checkpoint?: (samples: readonly MindmapFrameSample[]) => void,
): Promise<MindmapFrameSample[]> {
  const validOperations = new Set<MindmapFrameSample["operation"]>([
    "pan",
    "zoom",
    "expand",
    "collapse",
  ]);
  const windowList: readonly MindmapFrameWindow[] = Array.isArray(windows) ? windows : [];
  if (
    !Array.isArray(windows) ||
    windowList.some(
      (w) => !validOperations.has(w.operation) || !Number.isInteger(w.frames) || w.frames < 1,
    ) ||
    new Set(windowList.map((w) => w.operation)).size !== 4 ||
    windowList.reduce((n, w) => n + w.frames, 0) < 20
  ) {
    throw new Error("Predeclare all four operations and at least 20 frames");
  }
  const samples: MindmapFrameSample[] = [];
  for (const window of windowList) {
    const frames = await page.evaluate(
      async ({ operation, count, offset }) => {
        const viewer = document.querySelector<HTMLElement>(
          '[data-testid="studio-mindmap-viewer"][data-node-count="120"]',
        );
        if (!viewer) throw new Error("Expected a declared 120-node viewer");
        const canvas = viewer.querySelector<HTMLElement>('[data-testid="mindmap-canvas"]')!;
        const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
        const allExpanded = () => {
          for (let i = 0; i < 120; i++) {
            const toggle = canvas.querySelector<HTMLButtonElement>(
              '[data-testid="mindmap-node-toggle"][aria-expanded="false"]',
            );
            if (!toggle) break;
            toggle.click();
          }
          if (canvas.querySelectorAll('[data-testid="mindmap-node"]').length !== 120)
            throw new Error("120-node fixture is not fully rendered");
        };
        const values = [];
        for (let i = 0; i < count; i++) {
          // Declared setup is outside the one-frame action window. Every measured frame remains in the population.
          allExpanded();
          const toggles = canvas.querySelectorAll<HTMLButtonElement>(
            '[data-testid="mindmap-node-toggle"]',
          );
          // Layout emits children before parents; the last toggle is the root. Choose
          // a deepest branch deterministically so expansion restores all its direct leaves.
          const target = [...toggles].sort((a, b) => {
            const x = a.parentElement!,
              y = b.parentElement!;
            return (
              Number(y.dataset.depth) - Number(x.dataset.depth) ||
              x.dataset.nodeId!.localeCompare(y.dataset.nodeId!)
            );
          })[0]!;
          const targetId = target.parentElement!.getAttribute("data-node-id")!;
          if (operation === "expand") target.click();
          const before = canvas.getAttribute("data-transform");
          const beforeNodes = canvas.querySelectorAll('[data-testid="mindmap-node"]').length;
          const start = await frame();
          let failed: boolean;
          if (operation === "pan") {
            canvas.dispatchEvent(
              new PointerEvent("pointerdown", {
                bubbles: true,
                button: 0,
                pointerId: 1,
                clientX: 10,
                clientY: 10,
              }),
            );
            canvas.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                pointerId: 1,
                clientX: 20,
                clientY: 15,
              }),
            );
            canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
            failed = canvas.getAttribute("data-transform") === before;
          } else if (operation === "zoom") {
            viewer
              .querySelector<HTMLButtonElement>(
                `[data-testid="${i % 2 === 0 ? "mindmap-zoom-in" : "mindmap-zoom-out"}"]`,
              )!
              .click();
            failed = canvas.getAttribute("data-transform") === before;
          } else {
            const nodeTarget = [
              ...canvas.querySelectorAll<HTMLElement>('[data-testid="mindmap-node"]'),
            ].find((n) => n.getAttribute("data-node-id") === targetId)!;
            nodeTarget
              .querySelector<HTMLButtonElement>('[data-testid="mindmap-node-toggle"]')!
              .click();
            const afterNodes = canvas.querySelectorAll('[data-testid="mindmap-node"]').length;
            failed = operation === "expand" ? afterNodes <= beforeNodes : afterNodes >= beforeNodes;
          }
          const end = await frame();
          const afterNodes = canvas.querySelectorAll('[data-testid="mindmap-node"]').length;
          values.push({
            frame_index: offset + i + 1,
            operation,
            node_count: 120,
            rendered_nodes_before: beforeNodes,
            rendered_nodes_after: afterNodes,
            duration_ms: Math.max(0.001, end - start),
            dropped: failed,
          });
        }
        return values;
      },
      { operation: window.operation, count: window.frames, offset: samples.length },
    );
    samples.push(...frames);
    checkpoint?.(samples);
  }
  return samples;
}
