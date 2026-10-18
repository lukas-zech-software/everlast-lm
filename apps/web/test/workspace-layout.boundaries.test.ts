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

describe("T006 [US1] Boundary & Error: Workspace Layout (FR-UI-01)", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let container: MockElement;
  const notebookId = "a1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    dom = setupMockDOM(1440);
    container = dom.document.createElement("div");
  });

  describe("Exact Viewport Pixel Boundaries (1023px / 1024px / 1279px / 1280px)", () => {
    it("at exactly 1023px: switches to tablet/mobile tabbed mode", () => {
      dom.window.resizeTo(1023);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });

      expect(container.querySelector(".workspace-tabs")).not.toBeNull();
      expect(layout.getState().active_tab).toBe("chat");
    });

    it("at exactly 1024px: switches to 3-column desktop compact with Studio collapsed", () => {
      dom.window.resizeTo(1024);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      expect(container.querySelector(".workspace-tabs")).toBeNull();
      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(true);
    });

    it("at exactly 1279px: remains in 3-column desktop compact with Studio collapsed", () => {
      dom.window.resizeTo(1279);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      expect(container.querySelector(".workspace-tabs")).toBeNull();
      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(true);
    });

    it("at exactly 1280px: enters desktop wide with both side panels expanded", () => {
      dom.window.resizeTo(1280);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      expect(container.querySelector(".workspace-tabs")).toBeNull();
      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(false);
    });
  });

  describe("Preference Retention Across Viewport Switches", () => {
    it("preserves saved desktop preferences in localStorage when resizing to mobile (< 1024px) and back", () => {
      dom.window.resizeTo(1440);
      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });

      // User collapses right panel explicitly
      layout.toggleRightPanel();
      expect(layout.getState().right_collapsed).toBe(true);

      // Resize to mobile
      dom.window.resizeTo(600);
      expect(container.querySelector(".workspace-tabs")).not.toBeNull();

      // Ensure localStorage still holds desktop preference
      const saved = dom.localStorage.getItem(PANEL_PREFS_KEY);
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved!)).toEqual({ left_collapsed: false, right_collapsed: true });

      // Resize back to desktop
      dom.window.resizeTo(1440);
      const stateRestored = layout.getState();
      expect(stateRestored.left_collapsed).toBe(false);
      expect(stateRestored.right_collapsed).toBe(true);
    });
  });

  describe("Corrupted / Malformed LocalStorage Recovery", () => {
    it("falls back to breakpoint defaults when localStorage contains invalid JSON", () => {
      dom.localStorage.setItem(PANEL_PREFS_KEY, "{ invalid json corrupt !! ");
      dom.window.resizeTo(1440);

      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      // Safely falls back to desktop wide defaults (both expanded)
      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(false);
    });

    it("falls back to defaults when localStorage contains invalid types", () => {
      dom.localStorage.setItem(
        PANEL_PREFS_KEY,
        JSON.stringify({ left_collapsed: "invalid", right_collapsed: 123 })
      );
      dom.window.resizeTo(1440);

      const layout = renderWorkspaceLayout(container, { activeNotebookId: notebookId });
      const state = layout.getState();

      expect(state.left_collapsed).toBe(false);
      expect(state.right_collapsed).toBe(false);
    });
  });

  describe("Mobile Citation Click Edge Case (< 1024px)", () => {
    it("switches to sources tab and opens inspector without losing chat draft", () => {
      dom.window.resizeTo(768);
      const layout = renderWorkspaceLayout(container, {
        activeNotebookId: notebookId,
        initialDraft: "Mobile draft text",
      });

      expect(layout.getState().active_tab).toBe("chat");

      const sourceId = "s2222222-2222-4222-8222-222222222222";
      const chunkId = "c2222222-2222-4222-8222-222222222222";
      layout.openSourceInspector(sourceId, chunkId);

      const state = layout.getState();
      expect(state.active_tab).toBe("sources");
      expect(state.inspector_open).toBe(true);
      expect(state.inspector_source_id).toBe(sourceId);
      expect(state.highlight_chunk_id).toBe(chunkId);
      expect(layout.getChatDraft()).toBe("Mobile draft text");
    });
  });
});
