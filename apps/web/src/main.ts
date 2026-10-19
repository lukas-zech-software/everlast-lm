import { renderWorkspaceLayout, type WorkspaceLayoutController } from "./workspace-layout.js";
import { renderNotebookHome } from "./notebooks.js";
import { handleNotebookNotFound } from "./delete-notebook.js";
import { initializeTheme } from "./workspace-preferences.js";

/**
 * Client SPA entrypoint (FR-UI-01, FR-WM-01).
 * Routes between Notebook Home and Active Notebook Workspace.
 */

let currentLayoutController: WorkspaceLayoutController | null = null;

if (typeof document !== "undefined" && document.documentElement) initializeTheme(document.documentElement);

export async function initApp(): Promise<WorkspaceLayoutController | null> {
  const root = document.getElementById("app");
  if (!root) return null;

  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";

  const notebookMatch = pathname.match(/^\/notebook\/([^/]+)$/);
  if (notebookMatch) {
    const notebookId = notebookMatch[1]!;

    // Verify notebook existence via API
    let quotaData: any = { sources_used: 0, source_limit: 50 };
    let notebookData: any = { title: "Research Notebook", icon_emoji: "📓" };
    try {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const res = await fetch(`/api/notebooks/${notebookId}${search}`);
      if (!res.ok) {
        handleNotebookNotFound(root);
        return null;
      }
      const data = await res.json();
      notebookData = data?.notebook ?? notebookData;
      if (data?.quota) {
        quotaData = data.quota;
      }
    } catch {
      handleNotebookNotFound(root);
      return null;
    }

    const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const querySourcesUsed = urlParams.get("sources_used");
    const sourcesUsed = querySourcesUsed !== null ? Number(querySourcesUsed) : quotaData.sources_used;
    const sourceLimit = quotaData.source_limit ?? 50;
    const isAtLimit = sourcesUsed >= sourceLimit;

    root.innerHTML = `<div id="workspace" class="workspace-root"></div>`;
    const workspaceEl = document.getElementById("workspace");
    if (workspaceEl) {
      currentLayoutController = renderWorkspaceLayout(workspaceEl, {
        activeNotebookId: notebookId,
        notebookTitle: notebookData.title,
        notebookIcon: notebookData.icon_emoji,
        initialDraft: "",
        initialSourceCount: sourcesUsed,
      });

      // Render Add sources handoff modal if not already present
      let addSourcesModal = document.querySelector(".add-sources-modal") as HTMLElement;
      if (!addSourcesModal) {
        addSourcesModal = document.createElement("div");
        addSourcesModal.className = "add-sources-modal";
        document.body.appendChild(addSourcesModal);
      }
      addSourcesModal.innerHTML = `
        <div class="modal-dialog">
          <h3>Add sources to get started</h3>
          <p>Select sources to ground your chat and notes.</p>
          <div id="source-quota-counter" class="quota-count ${isAtLimit ? "at-limit" : ""}">${sourcesUsed} / ${sourceLimit} sources</div>
          <button id="add-source-btn" class="btn btn-primary btn-add-source" ${isAtLimit ? "disabled" : ""}>Add sources</button>
          <div id="dropzone" class="dropzone" data-disabled="${isAtLimit ? "true" : "false"}">Drag & drop files here</div>
        </div>
      `;

      return currentLayoutController;
    }
    return null;
  }

  // Home card view
  renderNotebookHome(root);
  return null;
}

export function getActiveLayoutController(): WorkspaceLayoutController | null {
  return currentLayoutController;
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      initApp();
    });
  } else {
    initApp();
  }
}
