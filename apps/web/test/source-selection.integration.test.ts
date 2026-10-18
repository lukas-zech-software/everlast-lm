import { describe, it, expect } from "vitest";
import {
  SourceSelectionController,
  type SourceItem,
} from "../src/sources/selection.js";

describe("FR-SI-03: User Story 2 - Integration & Timing Tests", () => {
  const notebookId = "11111111-1111-4111-8111-111111111111";

  it("US2-I01: Badge text updates within 50 ms latency threshold (SC-002)", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
        { id: "s2", notebook_id: notebookId, title: "S2.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    const start = performance.now();
    controller.toggleSource("s1", false);
    const badge = controller.getBadgeText();
    const duration = performance.now() - start;

    expect(badge).toBe("1 source");
    expect(duration).toBeLessThan(50); // <= 50 ms per SC-002
  });

  it("US2-I02: Zero Leakage Invariant (NFR-EVAL-04): Deselected sources are never returned in scoped context", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "source_a", notebook_id: notebookId, title: "Policy_2024.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
        { id: "source_b", notebook_id: notebookId, title: "Policy_2025.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    // Deselect source_b
    controller.toggleSource("source_b", false);

    const activeSnapshot = controller.createSubmissionSnapshot();
    expect(activeSnapshot.active_source_ids).toEqual(["source_a"]);
    expect(activeSnapshot.active_source_ids).not.toContain("source_b");
  });

  it("US2-I03: Subscribed listener receives immediate update upon selection toggle", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    let notificationReceived = false;
    controller.subscribe(() => {
      notificationReceived = true;
    });

    controller.toggleSource("s1", false);
    expect(notificationReceived).toBe(true);
    expect(controller.getSelectedSourceIds()).toHaveLength(0);
  });
});
