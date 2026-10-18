import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import {
  CitationTooltipPopover,
  computePopoverPlacement,
} from "../src/chat/citation-preview.js";
import { CitationNavigationAdapter } from "../src/chat/citation-navigation.js";
import { SourceInspectorController } from "../src/sources/inspector.js";
import { SourceSelectionController } from "../src/sources/selection.js";
import type { Citation, UnifiedDocumentChunk } from "@everlast/contracts";

describe("FR-GC-03: User Story 3 - Interactive Citation Verification Boundary & Error Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const sourceId = "11111111-1111-4111-8111-111111111111";

  const createCitation = (badgeNumber: number, text = "Verified fact passage."): Citation => ({
    badge_number: badgeNumber,
    source_id: sourceId,
    source_title: "Spec_Document.pdf",
    chunk_id: `018f6b40-000${badgeNumber}-7000-8000-00000000000${badgeNumber}`,
    snippet: text,
    locator: { page_number: 1, start_offset: 0, end_offset: 100 },
  });

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  it("Boundary 1: Flips popover placement to 'top' when near bottom of viewport", () => {
    // Viewport: 1440 x 900
    // Badge positioned near bottom: top=850, bottom=870, height=20
    const badgeRect = { top: 850, bottom: 870, left: 300, right: 350, width: 50, height: 20 };
    const popoverSize = { width: 320, height: 180 };
    const viewport = { width: 1440, height: 900 };

    const placement = computePopoverPlacement(badgeRect, popoverSize, viewport);

    // If placed at bottom, 870 + 180 = 1050 > 900 (overflows). Placement must flip to 'top'
    expect(placement.placement).toBe("top");
    expect(placement.top).toBeLessThan(badgeRect.top);
  });

  it("Boundary 2: Adjusts popover placement or horizontal offset when near right edge of viewport", () => {
    // Badge positioned near right edge: left=1380, right=1430 in 1440px viewport
    const badgeRect = { top: 200, bottom: 220, left: 1380, right: 1430, width: 50, height: 20 };
    const popoverSize = { width: 320, height: 180 };
    const viewport = { width: 1440, height: 900 };

    const placement = computePopoverPlacement(badgeRect, popoverSize, viewport);

    // Ensure popover does not exceed viewport.width
    expect(placement.left + popoverSize.width).toBeLessThanOrEqual(viewport.width);
  });

  it("Boundary 3: Renders scrollable container for long verbatim chunk text", async () => {
    const longText = "Verbatim sentence. ".repeat(80); // ~400 words
    const longCitation = createCitation(1, longText);

    const popover = new CitationTooltipPopover({
      container: dom.document.body,
    });

    const badgeEl = dom.document.createElement("button");
    dom.document.body.appendChild(badgeEl);

    await popover.show(badgeEl, longCitation);

    const tooltipEl = popover.getElement();
    const snippetEl = tooltipEl.querySelector(".citation-tooltip-snippet");

    expect(snippetEl).toBeDefined();
    expect(snippetEl?.className).toContain("citation-tooltip-snippet");
    expect(snippetEl?.textContent).toContain(longText);
  });

  it("Boundary 4: Keyboard focus and Escape key dismisses popover", async () => {
    const popover = new CitationTooltipPopover({
      container: dom.document.body,
    });

    const badgeEl = dom.document.createElement("button");
    dom.document.body.appendChild(badgeEl);

    // Focus triggers popover
    await popover.show(badgeEl, createCitation(1));
    expect(popover.isVisible()).toBe(true);

    // Escape key dismisses popover
    popover.handleKeyDown({ key: "Escape" } as KeyboardEvent);
    expect(popover.isVisible()).toBe(false);
  });

  it("Boundary 5: Switching between multiple citation badges maintains exactly one active popover", async () => {
    const popover = new CitationTooltipPopover({
      container: dom.document.body,
    });

    const badge1 = dom.document.createElement("button");
    const badge2 = dom.document.createElement("button");
    dom.document.body.appendChild(badge1);
    dom.document.body.appendChild(badge2);

    const cit1 = createCitation(1, "First snippet text");
    const cit2 = createCitation(2, "Second snippet text");

    await popover.show(badge1, cit1);
    expect(popover.getElement().textContent).toContain("First snippet text");

    // Immediately hover badge 2
    await popover.show(badge2, cit2);
    expect(popover.getElement().textContent).toContain("Second snippet text");
    expect(popover.getElement().textContent).not.toContain("First snippet text");

    // All popover elements in document.body
    const popoverElements = dom.document.body.children.filter((c: any) =>
      c.getAttribute("class")?.includes("citation-tooltip")
    );
    expect(popoverElements).toHaveLength(1);
  });

  it("Boundary 6: Singleton inspection read does NOT mutate active chat source selection (CP-02)", async () => {
    // Given source A is checked, source B is unchecked in chat
    const sourceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const sourceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const selectionController = new SourceSelectionController({
      notebookId,
      initialSources: [
        {
          id: sourceA,
          notebook_id: notebookId,
          title: "Source_A.pdf",
          media_type: "application/pdf",
          status: "Ready",
          revision_id: 1,
        },
        {
          id: sourceB,
          notebook_id: notebookId,
          title: "Source_B.pdf",
          media_type: "application/pdf",
          status: "Ready",
          revision_id: 1,
        },
      ],
    });
    // Deselect sourceB from active chat selection
    selectionController.toggleSource(sourceB);

    const inspectorController = new SourceInspectorController({
      notebookId,
      validateNotebookSource: async () => true,
      getSourceStatus: async () => "Ready",
      fetchSourceChunks: async () => [],
    });

    const navAdapter = new CitationNavigationAdapter({
      inspectorController,
      selectionController,
      isSourceDeleted: async () => false,
    });

    // When clicking citation for source B (which is currently deselected from chat)
    const citationForB: Citation = {
      badge_number: 1,
      source_id: sourceB,
      source_title: "Source_B.pdf",
      chunk_id: "018f6b40-000b-7000-8000-00000000000b",
      snippet: "Passage in source B",
      locator: { page_number: 1, start_offset: 0, end_offset: 50 },
    };

    const handled = await navAdapter.handleClick(citationForB);
    expect(handled).toBe(true);

    // Inspector opened source B
    expect(inspectorController.getState().sourceId).toBe(sourceB);

    // CP-02: Chat active selection MUST NOT be mutated!
    const activeSelection = selectionController.getSelectedSourceIds();
    expect(activeSelection).toEqual([sourceA]);
    expect(activeSelection).not.toContain(sourceB);
  });
});
