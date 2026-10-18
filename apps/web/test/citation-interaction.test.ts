import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import { CitationTooltipPopover } from "../src/chat/citation-preview.js";
import { CitationNavigationAdapter } from "../src/chat/citation-navigation.js";
import { SourceInspectorController } from "../src/sources/inspector.js";
import type { Citation, UnifiedDocumentChunk } from "@everlast/contracts";

describe("FR-GC-03: User Story 3 - Interactive Citation Verification Acceptance Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const chunkId = "018f6b40-0010-7000-8000-000000000010";

  const sampleChunk: UnifiedDocumentChunk = {
    chunk_id: chunkId,
    source_id: sourceId,
    revision: 1,
    locator: { page_number: 3, start_offset: 120, end_offset: 280 },
    token_count: 50,
    text: "All production systems must enforce TLS 1.3 and require multi-factor authentication for administrative access.",
  };

  const sampleCitation: Citation = {
    badge_number: 1,
    source_id: sourceId,
    source_title: "Security_Policy.pdf",
    chunk_id: chunkId,
    snippet: sampleChunk.text,
    locator: sampleChunk.locator,
  };

  beforeEach(() => {
    dom = setupMockDOM();
  });

  it("Scenario: Hovering over citation badge shows source title and verbatim snippet", async () => {
    // Given a chat answer with citation [1] referencing chunk "chk_10" in "Security_Policy.pdf"
    const popover = new CitationTooltipPopover({
      container: dom.document.body,
    });

    const badgeEl = dom.document.createElement("button");
    badgeEl.className = "citation-badge";
    badgeEl.textContent = "[1]";
    dom.document.body.appendChild(badgeEl);

    // When the user hovers over badge [1]
    const startTime = performance.now();
    await popover.show(badgeEl, sampleCitation);
    const durationMs = performance.now() - startTime;

    // Then a popover appears within 300 ms (SC-003)
    expect(durationMs).toBeLessThanOrEqual(300);
    expect(popover.isVisible()).toBe(true);

    const tooltipEl = popover.getElement();
    expect(tooltipEl).toBeDefined();

    // And the popover displays "Security_Policy.pdf" and the verbatim text of "chk_10"
    expect(tooltipEl.textContent).toContain("Security_Policy.pdf");
    expect(tooltipEl.textContent).toContain(
      "All production systems must enforce TLS 1.3 and require multi-factor authentication"
    );

    // Clean up
    popover.hide();
    expect(popover.isVisible()).toBe(false);
  });

  it("Scenario: Clicking citation badge opens Source Inspector and highlights passage", async () => {
    // Given a chat answer with citation [1] referencing chunk "chk_10" on page 3 of "Security_Policy.pdf"
    const inspectorController = new SourceInspectorController({
      notebookId,
      validateNotebookSource: async () => true,
      getSourceStatus: async () => "Ready",
      fetchSourceChunks: async () => [sampleChunk],
    });

    const openSourceSpy = vi.spyOn(inspectorController, "openSource");

    const navAdapter = new CitationNavigationAdapter({
      inspectorController,
      isSourceDeleted: async () => false,
    });

    // When the user clicks badge [1]
    const handled = await navAdapter.handleClick(sampleCitation);

    // Then the Source Inspector opens "Security_Policy.pdf"
    expect(handled).toBe(true);
    expect(openSourceSpy).toHaveBeenCalledWith(
      sourceId,
      "Security_Policy.pdf",
      chunkId
    );

    // And scrolls to page 3 where "chk_10" is located and "chk_10" is visually highlighted
    const state = inspectorController.getState();
    expect(state.status).toBe("highlighted");
    expect(state.sourceId).toBe(sourceId);
    expect(state.highlightChunkId).toBe(chunkId);
  });

  it("Scenario: Clicking citation for a subsequently deleted source", async () => {
    // Given a persisted chat answer citing "Old_Draft.pdf"
    // And the owner subsequently deleted "Old_Draft.pdf" from the notebook
    const deletedSourceId = "22222222-2222-4222-8222-222222222222";
    const deletedCitation: Citation = {
      badge_number: 2,
      source_id: deletedSourceId,
      source_title: "Old_Draft.pdf",
      chunk_id: "018f6b40-0020-7000-8000-000000000020",
      snippet: "Outdated confidential draft text.",
      locator: { page_number: 1, start_offset: 0, end_offset: 50 },
    };

    const popover = new CitationTooltipPopover({
      container: dom.document.body,
      isSourceDeleted: async (srcId) => srcId === deletedSourceId,
    });

    const badgeEl = dom.document.createElement("button");
    dom.document.body.appendChild(badgeEl);

    // When the user hovers the citation badge
    await popover.show(badgeEl, deletedCitation);

    // Then the tooltip shows "Source deleted"
    const tooltipEl = popover.getElement();
    expect(tooltipEl.textContent).toContain("Source deleted");
    // And does not expose deleted text
    expect(tooltipEl.textContent).not.toContain("Outdated confidential draft text");

    // When the user clicks the citation badge
    const inspectorController = new SourceInspectorController({ notebookId });
    const openSourceSpy = vi.spyOn(inspectorController, "openSource");

    const navAdapter = new CitationNavigationAdapter({
      inspectorController,
      isSourceDeleted: async (srcId) => srcId === deletedSourceId,
    });

    const handled = await navAdapter.handleClick(deletedCitation);

    // And the click-through action is disabled and the inspector does not open
    expect(handled).toBe(false);
    expect(openSourceSpy).not.toHaveBeenCalled();
    expect(inspectorController.getState().status).toBe("closed");
  });
});
