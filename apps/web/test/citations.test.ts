import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import {
  renderCitationBadge,
  renderCitationGroup,
  renderMessageWithCitations,
} from "../src/chat/citations.js";
import type { Citation } from "@everlast/contracts";

describe("FR-GC-02: Web Citation Badges & Multi-Citation Expansion", () => {
  beforeEach(() => {
    setupMockDOM();
  });

  const sourceId = "11111111-1111-4111-8111-111111111111";

  const createCitation = (badgeNumber: number): Citation => ({
    badge_number: badgeNumber,
    source_id: sourceId,
    source_title: "Security_Policy.pdf",
    chunk_id: `018f6b40-000${badgeNumber}-7000-8000-00000000000${badgeNumber}`,
    snippet: `Verbatim text snippet for chunk ${badgeNumber}`,
    locator: { page_number: 1, start_offset: 0, end_offset: 100 },
  });

  it("renders a single citation badge with data attributes and badge text", () => {
    const citation = createCitation(1);
    const onClick = vi.fn();
    const badge = renderCitationBadge(citation, onClick);

    expect(badge.getAttribute("class")).toContain("citation-badge");
    expect(badge.getAttribute("data-badge-number")).toBe("1");
    expect(badge.getAttribute("data-chunk-id")).toBe(citation.chunk_id);
    expect(badge.getAttribute("data-source-id")).toBe(sourceId);
    expect(badge.textContent).toBe("[1]");

    (badge as any).dispatchEvent({ type: "click" });
    expect(onClick).toHaveBeenCalledWith(citation);
  });

  it("renders up to 3 citation badges inline without expansion badge", () => {
    const citations = [createCitation(1), createCitation(2), createCitation(3)];
    const groupEl = renderCitationGroup(citations);

    const badges = (groupEl as any).children.filter((c: any) =>
      c.getAttribute("class")?.includes("citation-badge")
    );
    expect(badges).toHaveLength(3);

    const expandBtn = (groupEl as any).children.find((c: any) =>
      c.getAttribute("class")?.includes("citation-expansion-badge")
    );
    expect(expandBtn).toBeUndefined();
  });

  it("renders first 3 badges and +5 expandable button for single sentence supported by 8 chunks", () => {
    // Spec edge case: Single sentence supported by 8 different chunks -> renders first 3 badges inline followed by +5 badge
    const citations = Array.from({ length: 8 }, (_, i) => createCitation(i + 1));
    const groupEl = renderCitationGroup(citations);

    // Initial state: 3 visible badges + 1 expansion badge
    const visibleBadges = (groupEl as any).children.filter((c: any) =>
      c.getAttribute("class")?.includes("citation-badge")
    );
    expect(visibleBadges).toHaveLength(3);

    const expandBtn = (groupEl as any).children.find((c: any) =>
      c.getAttribute("class")?.includes("citation-expansion-badge")
    );
    expect(expandBtn).toBeDefined();
    expect(expandBtn.textContent).toBe("+5");
    expect(expandBtn.getAttribute("data-expansion-count")).toBe("5");

    // Click +5 badge to expand inline
    expandBtn.dispatchEvent({ type: "click" });

    // After click: all 8 badges are rendered, and expand button is removed
    const expandedBadges = (groupEl as any).children.filter((c: any) =>
      c.getAttribute("class")?.includes("citation-badge")
    );
    expect(expandedBadges).toHaveLength(8);

    const expandBtnAfter = (groupEl as any).children.find((c: any) =>
      c.getAttribute("class")?.includes("citation-expansion-badge")
    );
    expect(expandBtnAfter).toBeUndefined();
  });

  it("transforms text with inline [1] [2] badges into interactive DOM fragments", () => {
    const citations = [createCitation(1), createCitation(2)];
    const text = "Server Alpha runs on port 8080 [1] and requires mTLS [2].";

    const messageEl = renderMessageWithCitations(text, citations);
    const container = document.createElement("div");
    container.appendChild(messageEl);

    expect(container.textContent).toContain("Server Alpha runs on port 8080");
    const badges = container.querySelectorAll(".citation-badge");
    expect(badges).toHaveLength(2);
  });
});
