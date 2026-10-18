import { describe, it, expect, beforeEach } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import {
  renderWorkspaceLayout,
  type WorkspaceLayoutController,
} from "../src/workspace-layout.js";
import {
  PANEL_PREFS_KEY,
  loadPanelPreferences,
  savePanelPreferences,
} from "../src/workspace-state.js";

describe("T005 [US1] Acceptance: Workspace Layout (FR-UI-01)", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "a1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  describe("Scenario: Workspace renders all three panels and active source counter", () => {
    it("Given a notebook with 3 Ready sources, When opened on 1440x900 desktop viewport, Then Left, Center, and Right panels are visible and Chat displays '3 sources'", () => {
      dom.window.resizeTo(1440);

      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialSourceCount: 3,
      });

      // Verify DOM tree structure
      const leftPanel = container.querySelector(".panel-sources");
      const centerPanel = container.querySelector(".panel-chat");
      const rightPanel = container.querySelector(".panel-studio");
      const sourceCounter = container.querySelector(".active-source-counter");
      const studioPlaceholder = container.querySelector(".studio-placeholder");

      expect(leftPanel).not.toBeNull();
      expect(centerPanel).not.toBeNull();
      expect(rightPanel).not.toBeNull();
      expect(sourceCounter).not.toBeNull();

      // State check
      const state = layout.getState();
      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(false);

      // Visible panels
      expect(leftPanel?.classList.contains("collapsed")).toBe(false);
      expect(rightPanel?.classList.contains("collapsed")).toBe(false);

      // Active source count in chat input bar
      expect(sourceCounter?.textContent).toContain("3 sources");

      // Studio placeholder text
      expect(studioPlaceholder?.textContent).toBe("Notes and Studio tools will appear here");
    });
  });

  describe("Scenario: Collapsing side panels preserves chat draft and scroll position", () => {
    it("Given user typed draft in chat input, When user collapses Left and Right panels, Then Center panel expands and draft/scroll are preserved", () => {
      dom.window.resizeTo(1440);

      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialSourceCount: 3,
        initialDraft: "Summarize section 2",
      });

      layout.setChatScroll(150);

      // Initial checks
      expect(layout.getChatDraft()).toBe("Summarize section 2");
      expect(layout.getChatScroll()).toBe(150);

      // Collapse Left and Right panels
      layout.toggleLeftPanel();
      layout.toggleRightPanel();

      const state = layout.getState();
      expect(state.left_collapsed).toBe(true);
      expect(state.right_collapsed).toBe(true);

      const leftPanel = container.querySelector(".panel-sources");
      const rightPanel = container.querySelector(".panel-studio");
      const centerPanel = container.querySelector(".panel-chat");

      expect(leftPanel?.classList.contains("collapsed")).toBe(true);
      expect(rightPanel?.classList.contains("collapsed")).toBe(true);
      expect(centerPanel?.classList.contains("expanded-full")).toBe(true);

      // Assert draft and scroll are intact
      expect(layout.getChatDraft()).toBe("Summarize section 2");
      expect(layout.getChatScroll()).toBe(150);
    });
  });

  describe("Responsive Viewport Defaults (FR-UI-01)", () => {
    it("Desktop wide (>= 1280px): 3 columns side-by-side with both side panels expanded", () => {
      dom.window.resizeTo(1280);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(false);
      expect(container.querySelector(".workspace-tabs")).toBeNull();
    });

    it("Laptop/compact (1024-1279px): 3 columns with Right Panel collapsed by default", () => {
      dom.window.resizeTo(1024);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(true);
      expect(container.querySelector(".workspace-tabs")).toBeNull();
    });

    it("Tablet/mobile (< 1024px): tabbed navigation between Sources, Chat, Studio", () => {
      dom.window.resizeTo(768);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      const tabs = container.querySelector(".workspace-tabs");
      expect(tabs).not.toBeNull();
      expect(state.active_tab).toBe("chat");

      // Switch tab
      layout.setActiveTab("sources");
      expect(layout.getState().active_tab).toBe("sources");

      const activeTabContent = container.querySelector(".panel-sources.tab-active");
      expect(activeTabContent).not.toBeNull();
    });
  });

  describe("LocalStorage Persistence (FR-UI-01)", () => {
    it("persists user panel preferences across reloads on desktop", () => {
      dom.window.resizeTo(1440);

      // First session: user collapses left panel
      const layout1 = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      layout1.toggleLeftPanel();
      expect(layout1.getState().left_collapsed).toBe(true);

      // Verify localStorage was written
      const saved = dom.localStorage.getItem(PANEL_PREFS_KEY);
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved!)).toEqual({ left_collapsed: true, right_collapsed: false });

      // Second session (reload): fresh container
      const container2 = dom.document.createElement("div");
      const layout2 = renderWorkspaceLayout(container2, { activeNotebookId: notebookId });
      expect(layout2.getState().left_collapsed).toBe(true);
      expect(layout2.getState().right_collapsed).toBe(false);
    });
  });

  describe("Source Inspector Expansion & Citation Navigation (FR-UI-01, FR-SI-04)", () => {
    it("automatically un-collapses Left Panel, opens inspector, and targets chunk on citation click", () => {
      dom.window.resizeTo(1440);

      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialDraft: "Preserve this draft",
      });

      // User collapses left panel
      layout.toggleLeftPanel();
      expect(layout.getState().left_collapsed).toBe(true);

      // Citation [1] clicked -> opens inspector
      const chunkId = "c1111111-1111-4111-8111-111111111111";
      const sourceId = "s1111111-1111-4111-8111-111111111111";
      layout.openSourceInspector(sourceId, chunkId);

      const state = layout.getState();
      expect(state.left_collapsed).toBe(false);
      expect(state.inspector_open).toBe(true);
      expect(state.inspector_source_id).toBe(sourceId);
      expect(state.highlight_chunk_id).toBe(chunkId);

      const leftPanel = container.querySelector(".panel-sources");
      expect(leftPanel?.classList.contains("inspector-expanded")).toBe(true);

      // Draft preserved
      expect(layout.getChatDraft()).toBe("Preserve this draft");
    });
  });
});
