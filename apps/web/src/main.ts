import { renderWorkspaceLayout, type WorkspaceLayoutController } from "./workspace-layout.js";
import { renderNotebookHome } from "./notebooks.js";
import { handleNotebookNotFound } from "./delete-notebook.js";
import { SourceGuideController } from "./source-guide.js";
import { ChatControlController, renderResponseActions, renderSavedResponseNote, renderNotebookOverview, formatChatConfigurationLabel, scopeSignature, type SourceRevision } from "./chat-control.js";
import { mountNotebookSourceList } from "./sources/list.js";
import { type SourceItem, type SourceSelectionController } from "./sources/selection.js";
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
      notebookData = data?.notebook ?? (data?.title ? { title: data.title, icon_emoji: data.icon_emoji ?? "📓" } : notebookData);
      if (data?.quota) {
        quotaData = data.quota;
      }
    } catch {
      handleNotebookNotFound(root);
      return null;
    }

    const notebookTitle = notebookData.title ?? "Research Notebook";
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
        notebookTitle,
        notebookIcon: notebookData.icon_emoji,
        initialDraft: "",
        initialSourceCount: sourcesUsed,
      });
      const guideElement = workspaceEl.querySelector<HTMLElement>("#source-guide-panel");
      const overviewElement = workspaceEl.querySelector<HTMLElement>("#notebook-overview");
      const messagesElement = workspaceEl.querySelector<HTMLElement>("#chat-messages");
      let sourceRevisions: SourceRevision[] = [];
      let sourceItems: SourceItem[] = [];
      let sourceSelection: SourceSelectionController | null = null;
      let sourcesLoaded = false;
      let outputLanguage = "en-US";
      const sendGroundedPrompt = async (message: string, activeSources: SourceRevision[]) => {
        if (!activeSources.length) return;
        const submittedScope = [...activeSources];
        const submittedScopeSignature = scopeSignature(submittedScope, outputLanguage);
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
        renderResponseActions(actions, { notebookId, messageId: result.turn.id, content: result.turn.content, citations: result.turn.citations ?? [], onSavedNote: (note) => {
          const studio = workspaceEl.querySelector<HTMLElement>(".studio-content");
          if (!studio) return;
          renderSavedResponseNote(studio, note, (citation) => {
            currentLayoutController?.openSourceInspector(citation.source_id, citation.chunk_id);
            const source = sourceItems.find((item) => item.id === citation.source_id);
            if (source) window.dispatchEvent(new CustomEvent("everlast:source-selected", { detail: { source_id: source.id, revision: source.revision_id } }));
          });
        } });
        turn.appendChild(actions);
        const submittedSnapshot = result.turn.active_source_revisions_snapshot ?? submittedScope;
        const followUpsResponse = await fetch(`/api/notebooks/${notebookId}/chat/messages/${result.turn.id}/follow-ups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_revisions: submittedSnapshot }) });
        if (followUpsResponse.ok) {
          const followUps = await followUpsResponse.json() as { suggested_followups?: string[] };
          controls.setStreaming(false);
          controls.setFollowUps(followUps.suggested_followups ?? [], submittedScopeSignature);
          for (const prompt of controls.getFollowUps()) { const button = document.createElement("button"); button.type = "button"; button.className = "follow-up-chip"; button.textContent = prompt; button.addEventListener("click", () => controls.submitFollowUp(prompt)); turn.appendChild(button); }
        } else controls.setStreaming(false);
        messagesElement.appendChild(turn);
      };
      const guide = new SourceGuideController({
        notebookId,
        onTopic: (topic, sourceId) => void sendGroundedPrompt(`Explain “${topic}” using only this source and cite supporting passages.`, [{ source_id: sourceId, revision: sourceItems.find((item) => item.id === sourceId)?.revision_id ?? 1 }]),
      });
      guide.render(guideElement!);
      const controls = new ChatControlController({ notebookId, submit: (prompt) => void sendGroundedPrompt(prompt, sourceRevisions) });
      const configIndicator = workspaceEl.querySelector<HTMLElement>("#chat-config-indicator");
      void controls.loadConfiguration().then((config) => { if (config && configIndicator) configIndicator.textContent = formatChatConfigurationLabel(config); }).catch(() => undefined);
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
          const config = await controls.loadConfiguration();
          if (config) { if (styleSelect) styleSelect.value = config.style; if (customInstructions) customInstructions.value = config.custom_instructions ?? ""; if (lengthSelect) lengthSelect.value = config.response_length; updateCustomRow(); if (configIndicator) configIndicator.textContent = formatChatConfigurationLabel(config); }
        } finally { configDialog?.showModal(); }
      });
      workspaceEl.querySelector("#chat-settings-cancel")?.addEventListener("click", () => configDialog?.close());
      configForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const config = { style: (styleSelect?.value ?? "default") as "default" | "learning_guide" | "analyst" | "custom", response_length: (lengthSelect?.value ?? "default") as "default" | "longer" | "shorter", ...(styleSelect?.value === "custom" ? { custom_instructions: customInstructions?.value ?? "" } : {}) };
        void controls.saveConfiguration(config).then((saved) => {
          if (configIndicator) configIndicator.textContent = saved ? formatChatConfigurationLabel(controls.getConfiguration()) : "Invalid settings; previous settings retained";
          if (saved) configDialog?.close();
        });
      });
      window.addEventListener("everlast:source-deleted", ((event: CustomEvent<{ source_id: string }>) => {
        if (!event.detail?.source_id || !sourceSelection) return;
        sourceSelection.removeSource(event.detail.source_id);
        sourceItems = sourceSelection.getSources();
        sourceRevisions = sourceItems.filter((item) => sourceSelection?.getSelectedSourceIds().includes(item.id)).map((item) => ({ source_id: item.id, revision: item.revision_id }));
        currentLayoutController?.setActiveSourceCount(sourceRevisions.length);
        window.dispatchEvent(new CustomEvent("everlast:chat-scope-changed", { detail: { source_revisions: sourceRevisions, language: "en-US" } }));
      }) as EventListener);
      window.addEventListener("everlast:source-selected", ((event: CustomEvent<{ source_id: string; revision: number }>) => {
        const detail = event.detail;
        if (!detail || !guideElement) return;
        void guide.load(detail.source_id, detail.revision).then(() => guide.render(guideElement));
      }) as EventListener);
      window.addEventListener("everlast:chat-scope-changed", ((event: CustomEvent<{ source_revisions: SourceRevision[]; language?: string }>) => {
        sourceRevisions = event.detail?.source_revisions ?? [];
        currentLayoutController?.setActiveSourceCount(sourceRevisions.length);
        const language = event.detail?.language ?? "en-US";
        outputLanguage = language;
        controls.updateScope(sourceRevisions, language);
        workspaceEl.querySelectorAll(".follow-up-chip").forEach((button) => button.remove());
        if (overviewElement) overviewElement.replaceChildren();
        if (!sourceRevisions.length || !overviewElement) {
          if (overviewElement) {
            const empty = document.createElement("p");
            empty.textContent = !sourcesLoaded ? "Sources are unavailable right now." : sourceItems.length === 0 ? "Add a source to get started." : "Select at least one Ready source to see a notebook overview.";
            overviewElement.appendChild(empty);
          }
          return;
        }
        void fetch(`/api/notebooks/${notebookId}/overview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_revisions: sourceRevisions, output_language: language }) })
          .then(async (response) => { if (!response.ok) throw new Error("Overview unavailable"); return response.json(); })
          .then((overview: { overview_md: string; starter_prompts: string[] }) => {
            controls.setOverview(overview);
            if (!overviewElement || !controls.getOverview()) return;
            renderNotebookOverview(overviewElement, { notebookTitle, sourceCount: sourceRevisions.length, overview: overview.overview_md, starterPrompts: overview.starter_prompts, onPrompt: (prompt) => controls.submitStarterPrompt(prompt) });
          }).catch(() => { if (overviewElement) overviewElement.replaceChildren(); });
      }) as EventListener);

      const sourceList = workspaceEl.querySelector<HTMLElement>("#sources-list");
      if (sourceList) {
        void mountNotebookSourceList(sourceList, notebookId).then((selection) => {
          sourceSelection = selection;
          sourceItems = selection.getSources();
          sourcesLoaded = true;
          selection.subscribe(() => currentLayoutController?.setActiveSourceCount(selection.getSelectedSourceIds().length));
          sourceRevisions = selection.getSources().filter((item) => selection.getSelectedSourceIds().includes(item.id)).map((item) => ({ source_id: item.id, revision: item.revision_id }));
          currentLayoutController?.setActiveSourceCount(sourceRevisions.length);
          window.dispatchEvent(new CustomEvent("everlast:chat-scope-changed", { detail: { source_revisions: sourceRevisions, language: "en-US" } }));
          const firstReady = sourceItems.find((item) => item.status === "Ready");
          if (firstReady) window.dispatchEvent(new CustomEvent("everlast:source-selected", { detail: { source_id: firstReady.id, revision: firstReady.revision_id } }));
        }).catch(() => {
          sourcesLoaded = true;
          sourceList.textContent = "Sources are unavailable right now.";
          window.dispatchEvent(new CustomEvent("everlast:chat-scope-changed", { detail: { source_revisions: [], language: "en-US" } }));
        });
      }

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
