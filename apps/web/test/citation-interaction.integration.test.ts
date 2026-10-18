import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM } from "./mock-dom.js";
import { CitationTooltipPopover } from "../src/chat/citation-preview.js";
import { CitationNavigationAdapter } from "../src/chat/citation-navigation.js";
import { SourceInspectorController } from "../src/sources/inspector.js";
import {
  checkCitationAccess,
  CitationAccessError,
} from "../../api/src/chat/citation-access.js";
import type { Citation, UnifiedDocumentChunk } from "@everlast/contracts";

describe("FR-GC-03, C-02, SC-003: Interactive Citations Integration & Authorization Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const userId = "usr_alice_123";
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const chunkId = "018f6b40-0010-7000-8000-000000000010";

  const sampleChunk: UnifiedDocumentChunk = {
    chunk_id: chunkId,
    source_id: sourceId,
    revision: 1,
    locator: { page_number: 2, start_offset: 100, end_offset: 250 },
    token_count: 40,
    text: "Confidential architecture specification for data encryption at rest.",
  };

  const sampleCitation: Citation = {
    badge_number: 1,
    source_id: sourceId,
    source_title: "Architecture.pdf",
    chunk_id: chunkId,
    snippet: sampleChunk.text,
    locator: sampleChunk.locator,
  };

  beforeEach(() => {
    dom = setupMockDOM();
  });

  it("SC-003: Hover tooltip renders in <= 300 ms across repeated invocations", async () => {
    const popover = new CitationTooltipPopover({
      container: dom.document.body,
    });

    const badge = dom.document.createElement("button");
    dom.document.body.appendChild(badge);

    const latencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await popover.show(badge, sampleCitation);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      popover.hide();
    }

    for (const lat of latencies) {
      expect(lat).toBeLessThanOrEqual(300);
    }
  });

  it("SC-003, Gate v1.0 #3: Click-to-scroll in Source Inspector resolves deterministically in 100% of attempts", async () => {
    const inspectorController = new SourceInspectorController({
      notebookId,
      validateNotebookSource: async () => true,
      getSourceStatus: async () => "Ready",
      fetchSourceChunks: async () => [sampleChunk],
    });

    const navAdapter = new CitationNavigationAdapter({
      inspectorController,
      isSourceDeleted: async () => false,
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const handled = await navAdapter.handleClick(sampleCitation);
      expect(handled).toBe(true);

      const state = inspectorController.getState();
      expect(state.status).toBe("highlighted");
      expect(state.sourceId).toBe(sourceId);
      expect(state.highlightChunkId).toBe(chunkId);
    }
  });

  it("Backend Citation Access: Validates authorization and handles deleted source fencing", async () => {
    // 1. Authorized user with existing active source
    const accessResult = await checkCitationAccess({
      notebookId,
      userId,
      sourceId,
      chunkId,
      verifyOwnership: async (nId, uId) => nId === notebookId && uId === userId,
      getSourceStatus: async (sId) => (sId === sourceId ? "Ready" : null),
      getChunk: async (cId) => (cId === chunkId ? sampleChunk : null),
    });

    expect(accessResult.deleted).toBe(false);
    expect(accessResult.snippet).toBe(sampleChunk.text);
    expect(accessResult.source_title).toBe("Architecture.pdf");

    // 2. Deleted source returns deleted flag and suppresses confidential snippet
    const deletedAccessResult = await checkCitationAccess({
      notebookId,
      userId,
      sourceId: "deleted-source-id",
      chunkId,
      verifyOwnership: async () => true,
      getSourceStatus: async () => null, // Source deleted from DB
      getChunk: async () => null,
    });

    expect(deletedAccessResult.deleted).toBe(true);
    expect(deletedAccessResult.message).toBe("Source deleted");
    expect(deletedAccessResult.snippet).toBeUndefined();

    // 3. Unauthorized user or cross-notebook access is rejected with error
    await expect(
      checkCitationAccess({
        notebookId,
        userId: "unauthorized_user",
        sourceId,
        chunkId,
        verifyOwnership: async (nId, uId) => uId === userId,
        getSourceStatus: async () => "Ready",
        getChunk: async () => sampleChunk,
      })
    ).rejects.toThrow(CitationAccessError);
  });
});
