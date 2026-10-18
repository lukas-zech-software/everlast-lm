import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import {
  SourceInspectorController,
  type SourceInspectorState,
} from "../src/sources/inspector.js";
import { renderSourceViewer } from "../src/sources/viewer.js";

describe("FR-SI-04: User Story 3 - Source Inspector Boundary Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "22222222-2222-4222-8222-222222222222";
  const sourceIdA = "33333333-3333-4333-8333-33333333333a";
  const sourceIdB = "33333333-3333-4333-8333-33333333333b";

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  it("US3-B01: Very large source (400,000 words) uses virtualized/windowed rendering", async () => {
    // Generate 100 simulated chunks
    const largeChunks: UnifiedDocumentChunk[] = Array.from({ length: 100 }, (_, i) => ({
      chunk_id: `chunk_${i}`,
      source_id: sourceIdA,
      revision: 1,
      token_count: 450,
      text: `Paragraph ${i} of extensive canonical reference document containing detailed technical descriptions.`,
      locator: {
        page_number: Math.floor(i / 5) + 1,
        start_offset: i * 500,
        end_offset: (i + 1) * 500,
      },
    }));

    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async () => largeChunks,
    });

    // Open and focus chunk_75 with windowSize = 20
    await controller.openSource(sourceIdA, "Large_Spec.pdf", "chunk_75");

    renderSourceViewer(container, { controller, windowSize: 20 });

    const renderedChunkEls = container.querySelectorAll(".source-chunk");
    // Should NOT render all 100 chunks at once in DOM (windowed virtualization)
    expect(renderedChunkEls.length).toBeLessThanOrEqual(25);
    expect(renderedChunkEls.length).toBeGreaterThanOrEqual(10);

    // Target chunk_75 must be rendered and highlighted
    const targetEl = container.querySelector('[data-chunk-id="chunk_75"]');
    expect(targetEl).not.toBeNull();
    expect(targetEl?.classList.contains("source-chunk-highlight")).toBe(true);
  });

  it("US3-B02: Citation click switching sources switches source immediately", async () => {
    const chunksA: UnifiedDocumentChunk[] = [
      {
        chunk_id: "chk_a1",
        source_id: sourceIdA,
        revision: 1,
        token_count: 300,
        text: "Source A content.",
        locator: { page_number: 1, start_offset: 0, end_offset: 17 },
      },
    ];

    const chunksB: UnifiedDocumentChunk[] = [
      {
        chunk_id: "chk_b1",
        source_id: sourceIdB,
        revision: 1,
        token_count: 320,
        text: "Source B content passage.",
        locator: { page_number: 1, start_offset: 0, end_offset: 25 },
      },
    ];

    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async (id) => (id === sourceIdA ? chunksA : chunksB),
    });

    // First open Source A
    await controller.openSource(sourceIdA, "Source_A.txt", "chk_a1");
    expect(controller.getState().sourceId).toBe(sourceIdA);
    expect(controller.getState().highlightChunkId).toBe("chk_a1");

    // Second citation click pointing to Source B
    await controller.openSource(sourceIdB, "Source_B.txt", "chk_b1");
    expect(controller.getState().sourceId).toBe(sourceIdB);
    expect(controller.getState().sourceTitle).toBe("Source_B.txt");
    expect(controller.getState().highlightChunkId).toBe("chk_b1");
    expect(controller.getState().chunks[0]?.chunk_id).toBe("chk_b1");
  });

  it("US3-B03: Non-existent highlight_chunk_id falls back gracefully to top", async () => {
    const chunks: UnifiedDocumentChunk[] = [
      {
        chunk_id: "chk_real_1",
        source_id: sourceIdA,
        revision: 1,
        token_count: 300,
        text: "Valid content chunk.",
        locator: { page_number: 1, start_offset: 0, end_offset: 20 },
      },
    ];

    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async () => chunks,
    });

    // Request non-existent chunk ID
    await controller.openSource(sourceIdA, "Doc.md", "chk_nonexistent_999");

    // Falls back to open mode with null highlight
    expect(controller.getState().status).toBe("open");
    expect(controller.getState().highlightChunkId).toBeNull();
    expect(controller.getState().error).toBeNull();
  });

  it("US3-B04: Cross-notebook source access is rejected", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      validateNotebookSource: async (nbId, srcId) => {
        // Only sourceIdA belongs to notebookId
        return srcId === sourceIdA && nbId === notebookId;
      },
      fetchSourceChunks: async () => [],
    });

    // Attempt to open cross-notebook source
    await controller.openSource("cross-notebook-source-id", "Foreign.pdf");

    expect(controller.getState().status).toBe("closed");
    expect(controller.getState().error).toContain("Source does not belong to notebook");
    expect(controller.getState().chunks).toHaveLength(0);
  });

  it("US3-B05: Non-Ready source cannot be inspected", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      getSourceStatus: async (srcId) => "Processing",
      fetchSourceChunks: async () => [],
    });

    await controller.openSource(sourceIdA, "Processing_Doc.pdf");

    expect(controller.getState().status).toBe("closed");
    expect(controller.getState().error).toContain("Source is not ready for inspection");
    expect(controller.getState().chunks).toHaveLength(0);
  });
});
