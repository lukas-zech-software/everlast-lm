import { describe, it, expect } from "vitest";
import {
  SourceSelectionController,
  type SourceItem,
} from "../src/sources/selection.js";

describe("FR-SI-03: User Story 2 - Boundary & Error Tests", () => {
  const notebookId = "11111111-1111-4111-8111-111111111111";

  it("US2-B01: Deleting a checked source automatically removes it and decrements badge", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
        { id: "s2", notebook_id: notebookId, title: "S2.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    expect(controller.getBadgeText()).toBe("2 sources");
    expect(controller.getSelectedSourceIds()).toContain("s1");

    controller.removeSource("s1");
    expect(controller.getSelectedSourceIds()).not.toContain("s1");
    expect(controller.getBadgeText()).toBe("1 source");
  });

  it("US2-B02: Deleting an unchecked source does not decrement active badge count", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
        { id: "s2", notebook_id: notebookId, title: "S2.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    // Uncheck s2
    controller.toggleSource("s2", false);
    expect(controller.getBadgeText()).toBe("1 source");

    controller.removeSource("s2");
    expect(controller.getBadgeText()).toBe("1 source");
  });

  it("US2-B03: Singular vs plural badge grammar (1 source vs 0 sources / 2 sources)", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    expect(controller.getBadgeText()).toBe("1 source");

    controller.deselectAll();
    expect(controller.getBadgeText()).toBe("0 sources");

    controller.addSource({ id: "s2", notebook_id: notebookId, title: "S2.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 }, { isImportingSession: true });
    controller.addSource({ id: "s3", notebook_id: notebookId, title: "S3.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 }, { isImportingSession: true });
    expect(controller.getBadgeText()).toBe("2 sources");
  });

  it("US2-B04: In-flight request preserves submission-time snapshot when checkboxes change", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
        { id: "s2", notebook_id: notebookId, title: "S2.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    // Take snapshot at request submission
    const inFlightSnapshot = controller.createSubmissionSnapshot();
    expect(inFlightSnapshot.active_source_ids).toEqual(["s1", "s2"]);

    // User unchecks s2 while in-flight turn is streaming
    controller.toggleSource("s2", false);
    expect(controller.getSelectedSourceIds()).toEqual(["s1"]);

    // The in-flight snapshot remains immutable
    expect(inFlightSnapshot.active_source_ids).toEqual(["s1", "s2"]);
  });

  it("US2-B05: Reject cross-notebook source injection into active selection", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [
        { id: "s1", notebook_id: notebookId, title: "S1.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      ],
    });

    // Attempting to select a foreign source from a different notebook
    const foreignSource: SourceItem = {
      id: "s_foreign",
      notebook_id: "22222222-2222-4222-8222-222222222222",
      title: "Foreign.pdf",
      media_type: "application/pdf",
      status: "Ready",
      revision_id: 1,
    };

    expect(() => controller.addSource(foreignSource, { isImportingSession: true })).toThrow(/cross-notebook/i);
    expect(controller.getSelectedSourceIds()).toEqual(["s1"]);
  });
});
