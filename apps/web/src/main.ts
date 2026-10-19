import { renderWorkspaceLayout, type WorkspaceLayoutController } from "./workspace-layout.js";
import { renderNotebookHome } from "./notebooks.js";
import { handleNotebookNotFound } from "./delete-notebook.js";
import { SourceGuideController } from "./source-guide.js";
import { ChatControlController, renderResponseActions, type SourceRevision } from "./chat-control.js";

/**
 * Client SPA entrypoint (FR-UI-01, FR-WM-01).
 * Routes between Notebook Home and Active Notebook Workspace.
 */

let currentLayoutController: WorkspaceLayoutController | null = null;

export async function initApp(): Promise<WorkspaceLayoutController | null> {
  const root = document.getElementById("app");
  if (!root) return null;

  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";

  const notebookMatch = pathname.match(/^\/notebook\/([^/]+)$/);
  if (notebookMatch) {
    const notebookId = notebookMatch[1]!;

    // Verify notebook existence via API
    let quotaData: any = { sources_used: 0, source_limit: 50 };
    try {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const res = await fetch(`/api/notebooks/${notebookId}${search}`);
      if (!res.ok) {
        handleNotebookNotFound(root);
        return null;
      }
      const data = await res.json();
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
        initialDraft: "",
        initialSourceCount: sourcesUsed,
      });
      const guideElement = workspaceEl.querySelector<HTMLElement>("#source-guide-panel");
      const overviewElement = workspaceEl.querySelector<HTMLElement>("#notebook-overview");
      const messagesElement = workspaceEl.querySelector<HTMLElement>("#chat-messages");
      let sourceRevisions: SourceRevision[] = [];
      const sendGroundedPrompt = async (message: string, activeSources: SourceRevision[]) => {
        if (!activeSources.length) return;
        controls.setStreaming(true);
        workspaceEl.querySelectorAll(".follow-up-chip").forEach((button) => button.remove());
        const response = await fetch(`/api/notebooks/${notebookId}/chat/turns`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, active_source_ids: activeSources.map((item) => item.source_id) }),
        });
        if (!response.ok || !messagesElement) { controls.setStreaming(false); return; }
        const result = await response.json() as { turn?: { id: string; content: string; citations?: { badge_number: number }[]; active_source_revisions_snapshot?: SourceRevision[] } };
        if (!result.turn) { controls.setStreaming(false); return; }
        const turn = document.createElement("article");
        turn.className = "chat-turn chat-turn-assistant";
        turn.textContent = result.turn.content;
        const actions = document.createElement("div");
        renderResponseActions(actions, { notebookId, messageId: result.turn.id, content: result.turn.content, citations: result.turn.citations ?? [] });
        turn.appendChild(actions);
        const followUpsResponse = await fetch(`/api/notebooks/${notebookId}/chat/messages/${result.turn.id}/follow-ups`, { method: "POST" });
        if (followUpsResponse.ok) {
          const followUps = await followUpsResponse.json() as { suggested_followups?: string[] };
          controls.setStreaming(false);
          controls.setFollowUps(followUps.suggested_followups ?? []);
          for (const prompt of controls.getFollowUps()) { const button = document.createElement("button"); button.type = "button"; button.className = "follow-up-chip"; button.textContent = prompt; button.addEventListener("click", () => controls.submitFollowUp(prompt)); turn.appendChild(button); }
        } else controls.setStreaming(false);
        messagesElement.appendChild(turn);
      };
      const guide = new SourceGuideController({
        notebookId,
        onTopic: (topic, sourceId) => void sendGroundedPrompt(`Explain “${topic}” using only this source and cite supporting passages.`, [{ source_id: sourceId, revision: sourceRevisions.find((item) => item.source_id === sourceId)?.revision ?? 1 }]),
      });
      guide.render(guideElement!);
      const controls = new ChatControlController({ notebookId, submit: (prompt) => void sendGroundedPrompt(prompt, sourceRevisions) });
      const configDialog = workspaceEl.querySelector<HTMLDialogElement>("#chat-config-dialog");
      const configForm = workspaceEl.querySelector<HTMLFormElement>("#chat-config-form");
      const styleSelect = configForm?.elements.namedItem("style") as HTMLSelectElement | null;
      const customInstructions = configForm?.elements.namedItem("custom_instructions") as HTMLTextAreaElement | null;
      const lengthSelect = configForm?.elements.namedItem("response_length") as HTMLSelectElement | null;
      const customRow = workspaceEl.querySelector<HTMLElement>("#custom-instructions-row");
      const countLabel = workspaceEl.querySelector<HTMLElement>("#custom-instructions-count");
      const updateCustomRow = () => { if (customRow) customRow.hidden = styleSelect?.value !== "custom"; if (countLabel) countLabel.textContent = `${Array.from(customInstructions?.value ?? "").length} / 5000`; };
      styleSelect?.addEventListener("change", updateCustomRow);
      customInstructions?.addEventListener("input", updateCustomRow);
      workspaceEl.querySelector("#chat-settings-open")?.addEventListener("click", async () => {
        try {
          const response = await fetch(`/api/notebooks/${notebookId}/chat/configuration`);
          if (response.ok) { const config = await response.json() as { style: string; custom_instructions?: string; response_length: string }; if (styleSelect) styleSelect.value = config.style; if (customInstructions) customInstructions.value = config.custom_instructions ?? ""; if (lengthSelect) lengthSelect.value = config.response_length; updateCustomRow(); }
        } finally { configDialog?.showModal(); }
      });
      workspaceEl.querySelector("#chat-settings-cancel")?.addEventListener("click", () => configDialog?.close());
      configForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const config = { style: (styleSelect?.value ?? "default") as "default" | "learning_guide" | "analyst" | "custom", response_length: (lengthSelect?.value ?? "default") as "default" | "longer" | "shorter", ...(styleSelect?.value === "custom" ? { custom_instructions: customInstructions?.value ?? "" } : {}) };
        void controls.saveConfiguration(config).then((saved) => {
          const indicator = workspaceEl.querySelector<HTMLElement>("#chat-config-indicator");
          if (indicator) indicator.textContent = saved ? "Preferences active" : "Invalid settings; previous settings retained";
          if (saved) configDialog?.close();
        });
      });
      window.addEventListener("everlast:source-selected", ((event: CustomEvent<{ source_id: string; revision: number }>) => {
        const detail = event.detail;
        if (!detail || !guideElement) return;
        sourceRevisions = [{ source_id: detail.source_id, revision: detail.revision }];
        void guide.load(detail.source_id, detail.revision).then(() => guide.render(guideElement));
      }) as EventListener);
      window.addEventListener("everlast:chat-scope-changed", ((event: CustomEvent<{ source_revisions: SourceRevision[]; language?: string }>) => {
        sourceRevisions = event.detail?.source_revisions ?? [];
        const language = event.detail?.language ?? "en-US";
        controls.updateScope(sourceRevisions, language);
        workspaceEl.querySelectorAll(".follow-up-chip").forEach((button) => button.remove());
        if (overviewElement) overviewElement.replaceChildren();
        if (!sourceRevisions.length || !overviewElement) return;
        void fetch(`/api/notebooks/${notebookId}/overview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_revisions: sourceRevisions, output_language: language }) })
          .then(async (response) => { if (!response.ok) throw new Error("Overview unavailable"); return response.json(); })
          .then((overview: { overview_md: string; starter_prompts: string[] }) => {
            controls.setOverview(overview);
            if (!overviewElement || !controls.getOverview()) return;
            overviewElement.replaceChildren();
            const heading = document.createElement("h3"); heading.textContent = `Notebook overview · ${sourceRevisions.length} sources`; overviewElement.appendChild(heading);
            const summary = document.createElement("p"); summary.textContent = overview.overview_md; overviewElement.appendChild(summary);
            for (const prompt of overview.starter_prompts) { const button = document.createElement("button"); button.type = "button"; button.textContent = prompt; button.addEventListener("click", () => controls.submitStarterPrompt(prompt)); overviewElement.appendChild(button); }
          }).catch(() => { if (overviewElement) overviewElement.replaceChildren(); });
      }) as EventListener);

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
