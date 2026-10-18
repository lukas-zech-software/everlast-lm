import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import {
  SourceInspectorController,
  type SourceInspectorState,
} from "../src/sources/inspector.js";
import { renderSourceViewer } from "../src/sources/viewer.js";
import { SourceSelectionController } from "../src/sources/selection.js";

describe("FR-SI-04: User Story 3 - Source Inspector Acceptance Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const chunkId1 = "44444444-4444-4444-8444-444444444441";
  const chunkId2 = "44444444-4444-4444-8444-444444444442";

  const sampleChunks: UnifiedDocumentChunk[] = [
    {
      chunk_id: chunkId1,
      source_id: sourceId,
      revision: 1,
      token_count: 350,
      text: "Everlast LM Architecture Specification Section 1. Overview of local-first workspace model.",
      locator: {
        page_number: 1,
        start_offset: 0,
        end_offset: 91,
      },
    },
    {
      chunk_id: chunkId2,
      source_id: sourceId,
      revision: 1,
      token_count: 420,
      text: "Section 2. Source Ingestion Pipeline and Strict Snapshot Isolation guarantees.",
      locator: {
        page_number: 1,
        start_offset: 92,
        end_offset: 170,
      },
    },
  ];

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  it("US3-01: Clicking source title opens full text scrolled to top", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async (id) => (id === sourceId ? sampleChunks : []),
    });

    await controller.openSource(sourceId, "Architecture_Spec.md");

    expect(controller.getState().status).toBe("open");
    expect(controller.getState().sourceTitle).toBe("Architecture_Spec.md");
    expect(controller.getState().chunks).toHaveLength(2);
    expect(controller.getState().highlightChunkId).toBeNull();

    renderSourceViewer(container, { controller });

    const titleEl = container.querySelector(".source-inspector-title");
    expect(titleEl?.textContent).toContain("Architecture_Spec.md");

    const chunkEls = container.querySelectorAll(".source-chunk");
    expect(chunkEls).toHaveLength(2);
    expect(chunkEls[0]?.getAttribute("data-chunk-id")).toBe(chunkId1);
    expect(chunkEls[0]?.textContent).toContain("Everlast LM Architecture Specification");
  });

  it("US3-02: Citation click opens source and highlights target chunk", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async (id) => (id === sourceId ? sampleChunks : []),
    });

    await controller.openSource(sourceId, "Report.pdf", chunkId2);

    expect(controller.getState().status).toBe("highlighted");
    expect(controller.getState().highlightChunkId).toBe(chunkId2);

    renderSourceViewer(container, { controller });

    const highlightedEl = container.querySelector(`[data-chunk-id="${chunkId2}"]`);
    expect(highlightedEl).not.toBeNull();
    expect(highlightedEl?.classList.contains("source-chunk-highlight")).toBe(true);

    const nonHighlightedEl = container.querySelector(`[data-chunk-id="${chunkId1}"]`);
    expect(nonHighlightedEl?.classList.contains("source-chunk-highlight")).toBe(false);
  });

  it("US3-03: Close button collapses inspector and restores list view", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async (id) => (id === sourceId ? sampleChunks : []),
    });

    await controller.openSource(sourceId, "Architecture_Spec.md");
    expect(controller.getState().status).toBe("open");

    const onClose = vi.fn();
    renderSourceViewer(container, { controller, onClose });

    const closeBtn = container.querySelector(".source-inspector-close");
    expect(closeBtn).not.toBeNull();

    closeBtn?.click();

    expect(controller.getState().status).toBe("closed");
    expect(controller.getState().sourceId).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("US3-04: Source Inspector leaves chat active source selection unchanged", async () => {
    const selectionController = new SourceSelectionController({
      notebookId,
      initialSources: [
        {
          id: sourceId,
          notebook_id: notebookId,
          title: "Architecture_Spec.md",
          media_type: "text/markdown",
          status: "Ready",
          revision_id: 1,
        },
      ],
    });

    // Chat selection starts with sourceId selected
    expect(selectionController.getSelectedSourceIds()).toEqual([sourceId]);

    const inspectorController = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async () => sampleChunks,
    });

    // Open inspector on the source
    await inspectorController.openSource(sourceId, "Architecture_Spec.md", chunkId1);
    expect(inspectorController.getState().status).toBe("highlighted");

    // Chat selection must remain completely untouched (CP4, C-02, NFR-EVAL-04)
    expect(selectionController.getSelectedSourceIds()).toEqual([sourceId]);

    // Close inspector
    inspectorController.close();
    expect(selectionController.getSelectedSourceIds()).toEqual([sourceId]);
  });

  it("US3-05: State transitions between Closed <-> Open <-> Open & Highlighted", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async () => sampleChunks,
    });

    // Initial state
    expect(controller.getState().status).toBe("closed");

    // Open without highlight
    await controller.openSource(sourceId, "Doc.md");
    expect(controller.getState().status).toBe("open");
    expect(controller.getState().highlightChunkId).toBeNull();

    // Focus / Highlight chunk
    controller.highlightChunk(chunkId2);
    expect(controller.getState().status).toBe("highlighted");
    expect(controller.getState().highlightChunkId).toBe(chunkId2);

    // Close inspector
    controller.close();
    expect(controller.getState().status).toBe("closed");
    expect(controller.getState().highlightChunkId).toBeNull();
  });
});
