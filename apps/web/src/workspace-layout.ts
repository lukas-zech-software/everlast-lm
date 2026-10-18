import {
  getViewportBreakpoint,
  type WorkspaceViewState,
  type ViewportBreakpoint,
} from "@everlast/contracts";
import {
  loadPanelPreferences,
  savePanelPreferences,
  type PanelPreferences,
} from "./workspace-state.js";

export interface WorkspaceLayoutOptions {
  activeNotebookId?: string | null;
  initialSourceCount?: number;
  initialDraft?: string;
  initialTab?: "sources" | "chat" | "studio";
}

export interface WorkspaceLayoutController {
  getState(): WorkspaceViewState;
  toggleLeftPanel(): void;
  toggleRightPanel(): void;
  setActiveTab(tab: "sources" | "chat" | "studio"): void;
  openSourceInspector(sourceId: string, chunkId?: string): void;
  closeSourceInspector(): void;
  setChatDraft(draft: string): void;
  getChatDraft(): string;
  setChatScroll(scroll: number): void;
  getChatScroll(): number;
  setActiveSourceCount(count: number): void;
  destroy(): void;
}

/**
 * Renders the reactive 3-column workspace layout per FR-UI-01.
 */
export function renderWorkspaceLayout(
  container: any,
  options?: WorkspaceLayoutOptions
): WorkspaceLayoutController {
  const doc = typeof document !== "undefined" ? document : container.ownerDocument;
  const win = typeof window !== "undefined" ? window : null;

  // Viewport width detection
  const getWidth = (): number => (win ? win.innerWidth : 1440);

  // Initialize state
  const notebookId = options?.activeNotebookId ?? null;
  let activeTab: "sources" | "chat" | "studio" = options?.initialTab ?? "chat";
  let chatDraft = options?.initialDraft ?? "";
  let chatScroll = 0;
  let sourceCount = options?.initialSourceCount ?? 0;
  let inspectorOpen = false;
  let inspectorSourceId: string | null = null;
  let highlightChunkId: string | null = null;

  // Determine initial collapse state
  const savedPrefs = loadPanelPreferences();
  const initialBreakpoint = getViewportBreakpoint(getWidth());

  let leftCollapsed = false;
  let rightCollapsed = false;

  if (savedPrefs) {
    leftCollapsed = savedPrefs.left_collapsed;
    rightCollapsed = savedPrefs.right_collapsed;
  } else {
    // Default breakpoint rules
    if (initialBreakpoint === "desktop_compact") {
      rightCollapsed = true;
    }
  }

  // Build DOM layout
  container.className = "workspace-container";
  container.innerHTML = "";

  // 1. Top Navigation Header
  const header = doc.createElement("header");
  header.className = "workspace-header";
  header.innerHTML = `
    <div class="header-left">
      <span class="logo">Everlast LM</span>
      <span class="notebook-title" data-testid="notebook-title">Research Notebook</span>
    </div>
    <div class="header-right">
      <div class="user-profile" data-testid="user-profile">User</div>
    </div>
  `;
  container.appendChild(header);

  // 2. Tabs Bar (for narrow viewports < 1024px)
  const tabsBar = doc.createElement("nav");
  tabsBar.className = "workspace-tabs";
  tabsBar.innerHTML = `
    <button class="tab-btn ${activeTab === "sources" ? "active" : ""}" data-tab="sources">Sources</button>
    <button class="tab-btn ${activeTab === "chat" ? "active" : ""}" data-tab="chat">Chat</button>
    <button class="tab-btn ${activeTab === "studio" ? "active" : ""}" data-tab="studio">Studio</button>
  `;

  // 3. Main Workspace Area (3 columns)
  const main = doc.createElement("main");
  main.className = "workspace-main";

  // 3a. Left Panel (Sources)
  const leftPanel = doc.createElement("section");
  leftPanel.className = "workspace-panel panel-sources";
  leftPanel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Sources</span>
      <div id="source-quota-counter" class="quota-count ${sourceCount >= 50 ? "at-limit" : ""}">${sourceCount} / 50 sources</div>
      <button class="panel-toggle-btn" data-action="toggle-left" aria-label="Toggle Sources panel">⮜</button>
    </div>
    <div class="panel-content sources-content">
      <div class="source-actions">
        <button id="add-source-btn" class="btn btn-sm btn-add-source" ${sourceCount >= 50 ? "disabled" : ""}>Add sources</button>
      </div>
      <div class="sources-list" id="sources-list"></div>
      <div class="source-inspector-container" id="source-inspector" style="display: none;"></div>
    </div>
  `;
  main.appendChild(leftPanel);

  // 3b. Center Panel (Chat)
  const centerPanel = doc.createElement("section");
  centerPanel.className = "workspace-panel panel-chat";
  centerPanel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Chat</span>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-bar">
      <div class="active-source-counter">${sourceCount === 1 ? "1 source" : `${sourceCount} sources`}</div>
      <textarea class="chat-input" id="chat-input" placeholder="Ask a question about your sources...">${chatDraft}</textarea>
      <button class="chat-submit" id="chat-submit">Send</button>
    </div>
  `;
  main.appendChild(centerPanel);

  // 3c. Right Panel (Studio)
  const rightPanel = doc.createElement("section");
  rightPanel.className = "workspace-panel panel-studio";
  rightPanel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Studio</span>
      <button class="panel-toggle-btn" data-action="toggle-right" aria-label="Toggle Studio panel">⮞</button>
    </div>
    <div class="panel-content studio-content">
      <div class="studio-placeholder">Notes and Studio tools will appear here</div>
    </div>
  `;
  main.appendChild(rightPanel);

  container.appendChild(main);

  // Update DOM representation based on state
  const syncDOM = () => {
    const width = getWidth();
    const breakpoint = getViewportBreakpoint(width);
    const isMobile = breakpoint === "tablet_mobile";

    if (isMobile) {
      if (!container.querySelector(".workspace-tabs")) {
        container.insertBefore(tabsBar, main);
      }
      tabsBar.style.display = "flex";

      // Tab bar active indicators
      const tabButtons = tabsBar.querySelectorAll(".tab-btn");
      tabButtons.forEach((btn: any) => {
        const tabName = btn.getAttribute("data-tab");
        if (tabName === activeTab) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      // Panel visibility in tabbed mode
      leftPanel.classList.toggle("tab-active", activeTab === "sources");
      centerPanel.classList.toggle("tab-active", activeTab === "chat");
      rightPanel.classList.toggle("tab-active", activeTab === "studio");

      leftPanel.classList.remove("collapsed");
      rightPanel.classList.remove("collapsed");
      centerPanel.classList.remove("expanded-full");
    } else {
      if (container.querySelector(".workspace-tabs")) {
        container.removeChild(tabsBar);
      }

      leftPanel.classList.remove("tab-active");
      centerPanel.classList.remove("tab-active");
      rightPanel.classList.remove("tab-active");

      // Apply collapse classes
      leftPanel.classList.toggle("collapsed", leftCollapsed);
      rightPanel.classList.toggle("collapsed", rightCollapsed);
      centerPanel.classList.toggle("expanded-full", leftCollapsed && rightCollapsed);
    }

    // Inspector expansion
    if (inspectorOpen) {
      leftPanel.classList.add("inspector-expanded");
      const inspEl = leftPanel.querySelector("#source-inspector");
      if (inspEl) {
        inspEl.style.display = "block";
        if (highlightChunkId) {
          inspEl.setAttribute("data-chunk-id", highlightChunkId);
        }
      }
    } else {
      leftPanel.classList.remove("inspector-expanded");
      const inspEl = leftPanel.querySelector("#source-inspector");
      if (inspEl) inspEl.style.display = "none";
    }

    // Active source count
    const counterEl = centerPanel.querySelector(".active-source-counter");
    if (counterEl) {
      counterEl.textContent = sourceCount === 1 ? "1 source" : `${sourceCount} sources`;
    }
  };

  // Wire up event listeners
  const toggleLeftBtn = leftPanel.querySelector('[data-action="toggle-left"]');
  if (toggleLeftBtn) {
    toggleLeftBtn.addEventListener("click", () => {
      controller.toggleLeftPanel();
    });
  }

  const toggleRightBtn = rightPanel.querySelector('[data-action="toggle-right"]');
  if (toggleRightBtn) {
    toggleRightBtn.addEventListener("click", () => {
      controller.toggleRightPanel();
    });
  }

  tabsBar.querySelectorAll(".tab-btn").forEach((btn: any) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab") as "sources" | "chat" | "studio";
      if (tab) controller.setActiveTab(tab);
    });
  });

  const chatInputEl = centerPanel.querySelector("#chat-input");
  if (chatInputEl) {
    chatInputEl.addEventListener("input", (e: any) => {
      chatDraft = e.target.value ?? "";
    });
  }

  const handleResize = () => {
    syncDOM();
  };

  if (win) {
    win.addEventListener("resize", handleResize);
  }

  // Initial sync
  syncDOM();

  const controller: WorkspaceLayoutController = {
    getState(): WorkspaceViewState {
      return {
        active_notebook_id: notebookId,
        active_tab: activeTab,
        left_collapsed: leftCollapsed,
        right_collapsed: rightCollapsed,
        inspector_open: inspectorOpen,
        inspector_source_id: inspectorSourceId,
        highlight_chunk_id: highlightChunkId,
      };
    },

    toggleLeftPanel(): void {
      leftCollapsed = !leftCollapsed;
      const width = getWidth();
      if (getViewportBreakpoint(width) !== "tablet_mobile") {
        savePanelPreferences({
          left_collapsed: leftCollapsed,
          right_collapsed: rightCollapsed,
        });
      }
      syncDOM();
    },

    toggleRightPanel(): void {
      rightCollapsed = !rightCollapsed;
      const width = getWidth();
      if (getViewportBreakpoint(width) !== "tablet_mobile") {
        savePanelPreferences({
          left_collapsed: leftCollapsed,
          right_collapsed: rightCollapsed,
        });
      }
      syncDOM();
    },

    setActiveTab(tab: "sources" | "chat" | "studio"): void {
      activeTab = tab;
      syncDOM();
    },

    openSourceInspector(sourceId: string, chunkId?: string): void {
      inspectorOpen = true;
      inspectorSourceId = sourceId;
      highlightChunkId = chunkId ?? null;

      // Clicking citation automatically un-collapses Left Panel if collapsed
      if (leftCollapsed) {
        leftCollapsed = false;
      }

      // On narrow viewport, switch to sources tab
      const width = getWidth();
      if (getViewportBreakpoint(width) === "tablet_mobile") {
        activeTab = "sources";
      }

      syncDOM();

      if (chunkId) {
        const targetChunk = leftPanel.querySelector(`[data-chunk-id="${chunkId}"]`);
        if (targetChunk && typeof targetChunk.scrollIntoView === "function") {
          targetChunk.scrollIntoView();
        }
      }
    },

    closeSourceInspector(): void {
      inspectorOpen = false;
      inspectorSourceId = null;
      highlightChunkId = null;
      syncDOM();
    },

    setChatDraft(draft: string): void {
      chatDraft = draft;
      const input = centerPanel.querySelector("#chat-input");
      if (input) input.value = draft;
    },

    getChatDraft(): string {
      return chatDraft;
    },

    setChatScroll(scroll: number): void {
      chatScroll = scroll;
      const stream = centerPanel.querySelector("#chat-messages");
      if (stream) stream.scrollTop = scroll;
    },

    getChatScroll(): number {
      return chatScroll;
    },

    setActiveSourceCount(count: number): void {
      sourceCount = count;
      const counterEl = centerPanel.querySelector(".active-source-counter");
      if (counterEl) {
        counterEl.textContent = sourceCount === 1 ? "1 source" : `${sourceCount} sources`;
      }
    },

    destroy(): void {
      if (win) {
        win.removeEventListener("resize", handleResize);
      }
    },
  };

  return controller;
}
