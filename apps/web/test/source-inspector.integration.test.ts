import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { SourceInspectorController } from "../src/sources/inspector.js";
import { renderSourceViewer } from "../src/sources/viewer.js";

describe("FR-SI-04: User Story 3 - Source Inspector Integration & Timing Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const targetChunkId = "44444444-4444-4444-8444-444444444445";

  const fiftyChunks: UnifiedDocumentChunk[] = Array.from({ length: 50 }, (_, i) => ({
    chunk_id: i === 5 ? targetChunkId : `chunk_${i}`,
    source_id: sourceId,
    revision: 1,
    token_count: 400,
    text: `Paragraph ${i} text content for performance and deterministic locator verification.`,
    locator: {
      page_number: Math.floor(i / 5) + 1,
      start_offset: i * 400,
      end_offset: (i + 1) * 400,
    },
  }));

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  it("US3-I01: Inspector open and chunk highlight completes within <= 300 ms (Gate v1.0 #3)", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async () => fiftyChunks,
    });

    const start = performance.now();

    await controller.openSource(sourceId, "Benchmark_Doc.pdf", targetChunkId);
    renderSourceViewer(container, { controller });

    const duration = performance.now() - start;

    expect(controller.getState().status).toBe("highlighted");
    expect(controller.getState().highlightChunkId).toBe(targetChunkId);
    expect(duration).toBeLessThanOrEqual(300); // Gate v1.0 #3: <= 300 ms
  });

  it("US3-I02: Deterministic scroll target to data-chunk-id in DOM", async () => {
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async () => fiftyChunks,
    });

    await controller.openSource(sourceId, "Report.pdf", targetChunkId);

    // Render into DOM
    renderSourceViewer(container, { controller });

    const targetEl = container.querySelector(`[data-chunk-id="${targetChunkId}"]`);
    expect(targetEl).not.toBeNull();
    expect(targetEl?.getAttribute("data-chunk-id")).toBe(targetChunkId);
    expect(targetEl?.classList.contains("source-chunk-highlight")).toBe(true);

    // Verify other chunks do not carry highlight
    const otherEl = container.querySelector('[data-chunk-id="chunk_0"]');
    expect(otherEl?.classList.contains("source-chunk-highlight")).toBe(false);
  });

  it("US3-I03: Client fetches source content and enforces singleton isolation against errors", async () => {
    // Simulated API client returning singleton source inspection response
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(sourceId)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            source_id: sourceId,
            chunks: fiftyChunks.slice(0, 10),
            highlight_chunk_id: targetChunkId,
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "SourceNotFoundError" }),
      };
    });

    // 1. Success case: client fetches source content
    const controller = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async (srcId) => {
        const res = await mockFetch(`/api/notebooks/${notebookId}/sources/${srcId}/content?chunk_id=${targetChunkId}`);
        if (!res.ok) throw new Error("SourceNotFoundError");
        const data = await res.json();
        return data.chunks;
      },
    });

    await controller.openSource(sourceId, "Report.pdf", targetChunkId);
    expect(controller.getState().status).toBe("highlighted");
    expect(controller.getState().chunks).toHaveLength(10);
    expect(controller.getState().highlightChunkId).toBe(targetChunkId);

    // 2. Error case: non-existent source
    const failController = new SourceInspectorController({
      notebookId,
      fetchSourceChunks: async (srcId) => {
        const res = await mockFetch(`/api/notebooks/${notebookId}/sources/${srcId}/content`);
        if (!res.ok) throw new Error("SourceNotFoundError");
        const data = await res.json();
        return data.chunks;
      },
    });

    await expect(
      failController.openSource("00000000-0000-0000-0000-000000000000", "Unknown.pdf")
    ).rejects.toThrow("SourceNotFoundError");
  });
});
