import type { SourceInspectorController } from "./inspector.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";

export interface RenderSourceViewerOptions {
  controller: SourceInspectorController;
  onClose?: () => void;
  windowSize?: number;
}

/**
 * Presentation adapter for the Source Inspector / Viewer (FR-SI-04).
 * Supports deterministic chunk highlighting and virtualized windowed rendering for large documents.
 */
export function renderSourceViewer(
  container: HTMLElement | any,
  options: RenderSourceViewerOptions
): () => void {
  const { controller, onClose, windowSize } = options;

  function update() {
    const state = controller.getState();

    if (state.status === "closed" || !state.sourceId) {
      container.innerHTML = "";
      return;
    }

    const titleText = state.sourceTitle ?? "Source Viewer";

    // Determine window of chunks to render
    const allChunks = state.chunks;
    let chunksToRender: UnifiedDocumentChunk[] = allChunks;

    if (windowSize && windowSize > 0 && allChunks.length > windowSize) {
      let targetIndex = 0;
      if (state.highlightChunkId) {
        const foundIdx = allChunks.findIndex((c) => c.chunk_id === state.highlightChunkId);
        if (foundIdx !== -1) {
          targetIndex = foundIdx;
        }
      }

      const half = Math.floor(windowSize / 2);
      const start = Math.max(0, Math.min(targetIndex - half, allChunks.length - windowSize));
      const end = Math.min(allChunks.length, start + windowSize);
      chunksToRender = allChunks.slice(start, end);
    }

    // Build DOM structure
    let chunksHtml = "";
    for (const chunk of chunksToRender) {
      const isHighlighted = chunk.chunk_id === state.highlightChunkId;
      const highlightClass = isHighlighted ? " source-chunk-highlight" : "";
      chunksHtml += `<div class="source-chunk${highlightClass}" data-chunk-id="${chunk.chunk_id}">${escapeHtml(chunk.text)}</div>`;
    }

    container.innerHTML = `
      <div class="source-inspector-panel">
        <div class="source-inspector-header">
          <button class="source-inspector-close" aria-label="Close Source Inspector">✕</button>
          <span class="source-inspector-title">${escapeHtml(titleText)}</span>
        </div>
        <div class="source-inspector-content">
          ${chunksHtml}
        </div>
      </div>
    `;

    // Wire close button
    const closeBtn = container.querySelector(".source-inspector-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        controller.close();
        if (onClose) {
          onClose();
        }
      });
    }

    // If a chunk is highlighted, trigger scroll into view
    if (state.highlightChunkId) {
      const highlightedEl = container.querySelector(`[data-chunk-id="${state.highlightChunkId}"]`);
      if (highlightedEl && typeof highlightedEl.scrollIntoView === "function") {
        highlightedEl.scrollIntoView();
      }
    }
  }

  // Initial render
  update();

  // Subscribe to reactive controller updates
  return controller.subscribe(update);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
