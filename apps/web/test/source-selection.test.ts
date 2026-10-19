import { describe, it, expect, beforeEach } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import {
  SourceSelectionController,
  type SourceItem,
} from "../src/sources/selection.js";
import { renderSourceList } from "../src/sources/list.js";

describe("FR-SI-03: User Story 2 - Source Selection Acceptance Tests", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "11111111-1111-4111-8111-111111111111";

  const sampleSources: SourceItem[] = [
    {
      id: "src_1",
      notebook_id: notebookId,
      title: "Policy_2024.pdf",
      media_type: "application/pdf",
      status: "Ready",
      revision_id: 1,
    },
    {
      id: "src_2",
      notebook_id: notebookId,
      title: "Policy_2025.pdf",
      media_type: "application/pdf",
      status: "Ready",
      revision_id: 1,
    },
    {
      id: "src_3",
      notebook_id: notebookId,
      title: "Notes.txt",
      media_type: "text/plain",
      status: "Ready",
      revision_id: 1,
    },
  ];

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  it("US2-01: Displays individual checkboxes and tri-state master checkbox", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: sampleSources,
    });

    const rendered = renderSourceList(container, { controller });
    const masterCheckbox = container.querySelector(".select-all-sources") as any;
    const itemCheckboxes = container.querySelectorAll(".source-checkbox") as any[];

    expect(masterCheckbox).not.toBeNull();
    expect(itemCheckboxes).toHaveLength(3);

    // Initial state: all Ready sources default to checked
    expect(masterCheckbox.checked).toBe(true);
    expect(masterCheckbox.indeterminate).toBe(false);
    expect(controller.getMasterState()).toBe("AllSelected");
    expect(controller.getSelectedSourceIds()).toEqual(["src_1", "src_2", "src_3"]);
  });

  it("opens source inspection without changing the active chat selection (FR-SI-02, C-02)", () => {
    const controller = new SourceSelectionController({ notebookId, initialSources: sampleSources });
    let scopeEvents = 0;
    let selectedEvents = 0;
    dom.window.addEventListener("everlast:chat-scope-changed", () => { scopeEvents += 1; });
    dom.window.addEventListener("everlast:source-selected", () => { selectedEvents += 1; });
    renderSourceList(container, { controller });
    (container.querySelector(".source-title") as any).click();
    expect(controller.getSelectedSourceIds()).toEqual(["src_1", "src_2", "src_3"]);
    expect(scopeEvents).toBe(0);
    expect(selectedEvents).toBe(1);
  });

  it("US2-02: Unchecking an individual source changes master to indeterminate and updates badge", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: sampleSources,
    });

    renderSourceList(container, { controller });
    const masterCheckbox = container.querySelector(".select-all-sources") as any;
    const itemCheckboxes = container.querySelectorAll(".source-checkbox") as any[];

    // Uncheck second source
    controller.toggleSource("src_2", false);

    expect(controller.getSelectedSourceIds()).toEqual(["src_1", "src_3"]);
    expect(controller.getMasterState()).toBe("PartialSelected");
    expect(controller.getBadgeText()).toBe("2 sources");
    const updatedMaster = container.querySelector(".select-all-sources") as any;
    expect(updatedMaster.checked).toBe(false);
    expect(updatedMaster.indeterminate).toBe(true);
  });

  it("US2-03: Zero sources selected disables chat input with guidance indicator", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: sampleSources,
    });

    renderSourceList(container, { controller });

    // Deselect all
    controller.deselectAll();

    expect(controller.getSelectedSourceIds()).toHaveLength(0);
    expect(controller.getMasterState()).toBe("NoneSelected");
    expect(controller.getBadgeText()).toBe("0 sources");
    expect(controller.isChatSubmitDisabled()).toBe(true);
    expect(controller.getZeroSourcesWarning()).toBe("Select at least one source to chat");
  });

  it("US2-04: Clicking master checkbox toggles between NoneSelected and AllSelected", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: sampleSources,
    });

    renderSourceList(container, { controller });

    // Toggle master when AllSelected -> NoneSelected
    controller.toggleMaster();
    expect(controller.getSelectedSourceIds()).toHaveLength(0);
    expect(controller.getMasterState()).toBe("NoneSelected");

    // Toggle master when NoneSelected -> AllSelected
    controller.toggleMaster();
    expect(controller.getSelectedSourceIds()).toEqual(["src_1", "src_2", "src_3"]);
    expect(controller.getMasterState()).toBe("AllSelected");
  });

  it("US2-05: Non-Ready sources are disabled and cannot be selected", () => {
    const mixedSources: SourceItem[] = [
      { id: "src_ready", notebook_id: notebookId, title: "Ready.pdf", media_type: "application/pdf", status: "Ready", revision_id: 1 },
      { id: "src_uploading", notebook_id: notebookId, title: "Up.pdf", media_type: "application/pdf", status: "Uploading", revision_id: 1 },
      { id: "src_processing", notebook_id: notebookId, title: "Proc.pdf", media_type: "application/pdf", status: "Processing", revision_id: 1 },
      { id: "src_failed", notebook_id: notebookId, title: "Fail.pdf", media_type: "application/pdf", status: "Failed", revision_id: 1 },
    ];

    const controller = new SourceSelectionController({
      notebookId,
      initialSources: mixedSources,
    });

    expect(controller.getSelectedSourceIds()).toEqual(["src_ready"]);

    // Attempting to select a Processing or Failed source must be rejected
    controller.toggleSource("src_processing", true);
    expect(controller.getSelectedSourceIds()).toEqual(["src_ready"]);

    controller.toggleSource("src_failed", true);
    expect(controller.getSelectedSourceIds()).toEqual(["src_ready"]);
  });

  it("US2-06: Newly Ready source is auto-selected only in the importing session", () => {
    const controller = new SourceSelectionController({
      notebookId,
      initialSources: [sampleSources[0]!],
    });

    expect(controller.getSelectedSourceIds()).toEqual(["src_1"]);

    // Ingestion completes in this session
    controller.addSource({
      id: "src_new",
      notebook_id: notebookId,
      title: "Imported.pdf",
      media_type: "application/pdf",
      status: "Ready",
      revision_id: 1,
    }, { isImportingSession: true });

    expect(controller.getSelectedSourceIds()).toContain("src_new");
    expect(controller.getBadgeText()).toBe("2 sources");
  });
});
