import { describe, it, expect, beforeEach } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import {
  renderWorkspaceLayout,
  type WorkspaceLayoutController,
} from "../src/workspace-layout.js";

describe("T007 [US1] Integration & Timing: Workspace Layout (FR-UI-01, C-02, NFR-EVAL-04)", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "a1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  describe("Measurable Outcome SC-001: Panel Transition Duration", () => {
    it("completes panel expand/collapse state transition in <= 200 ms with zero data loss", () => {
      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialDraft: "Active research draft",
      });
      layout.setChatScroll(320);

      const startTime = performance.now();
      layout.toggleLeftPanel();
      layout.toggleRightPanel();
      const endTime = performance.now();

      const durationMs = endTime - startTime;
      expect(durationMs).toBeLessThanOrEqual(200);

      // Verify zero layout shift data loss
      expect(layout.getChatDraft()).toBe("Active research draft");
      expect(layout.getChatScroll()).toBe(320);
    });
  });

  describe("Active Source Counter Dynamic Integration (FR-UI-01, C-02)", () => {
    it("updates prompt input bar counter display dynamically as sources change", () => {
      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialSourceCount: 0,
      });

      const counter = container.querySelector(".active-source-counter");
      expect(counter?.textContent).toContain("0 sources");

      layout.setActiveSourceCount(1);
      expect(counter?.textContent).toContain("1 source");

      layout.setActiveSourceCount(4);
      expect(counter?.textContent).toContain("4 sources");
    });
  });

  describe("C-02 Context Scoping Non-Mutation Invariant (NFR-EVAL-04)", () => {
    it("opening source inspector does not alter chat active source count or mutate selection", () => {
      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialSourceCount: 2,
      });

      const counter = container.querySelector(".active-source-counter");
      expect(counter?.textContent).toContain("2 sources");

      // Open inspector for a historical or unselected citation
      const unselectedSourceId = "s9999999-9999-4999-8999-999999999999";
      const chunkId = "c9999999-9999-4999-8999-999999999999";
      layout.openSourceInspector(unselectedSourceId, chunkId);

      // Counter remains 2 sources (no leakage or mutation of chat selection)
      expect(counter?.textContent).toContain("2 sources");
      expect(layout.getState().inspector_open).toBe(true);
      expect(layout.getState().inspector_source_id).toBe(unselectedSourceId);
    });
  });
});
