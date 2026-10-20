import { authFetch } from "../lib/api.ts";
import { h } from "../lib/dom.ts";
import type { SavedResponseNote } from "@everlast/contracts";
import type { ChatMessage, SourceDto } from "../lib/types.ts";
import {
  ChatControlController,
  formatChatConfigurationLabel,
  scopeSignature,
  renderAddSourceEmptyState,
  renderNotebookOverview,
  renderResponseActions,
  renderSavedResponseNote,
  type ChatConfig,
  type SourceRevision,
} from "../chat-control.ts";
import { SourceGuideController } from "../source-guide.ts";
import {
  adoptServerTheme,
  effectiveOutputLanguage,
  hydrateWorkspaceSettings,
  loadWorkspacePreferences,
  renderWorkspaceSettings,
  type WorkspaceSettingsState,
} from "../workspace-preferences.ts";

/**
 * Release v2 workspace features on the v1 workspace (D16 proof of concept): settings and theme (FR-UI-02),
 * notebook icon (FR-WM-02), Source Guide (FR-SI-02), notebook overview and starter prompts (FR-GC-04),
 * follow-ups (FR-GC-05), chat configuration (FR-GC-07), copy, feedback and save-to-notes (FR-GC-09).
 * Generation features that the server reports as not configured (503) stay hidden.
 */

export interface WorkspaceFeaturesOptions {
  notebookId: string;
  notebookTitle: string;
  /** Notebook icon (FR-WM-02) shown in the overview hero (FR-GC-04). */
  notebookIcon?: string | undefined;
}

export interface WorkspaceFeatures {
  headerItems: HTMLElement[];
  settingsPanel: HTMLElement;
  chatTools: HTMLElement[];
  chatIntro: HTMLElement;
  /** Follow-up chips row, mounted directly above the chat input bar (FR-GC-05). */
  followUpBar: HTMLElement;
  onStreamStart(): void;
  onStreamEnd(): void;
  decorateAnswer(bubble: HTMLElement, message: ChatMessage, fresh: boolean): void;
  onSourceOpened(source: { id: string; revision: number }, slot: HTMLElement, viaCitation: boolean): void;
  onSelectionChange(sources: SourceDto[], selectedIds: string[]): void;
  bind(input: {
    ask(text: string): void;
    studio: HTMLElement;
    openCitation(sourceId: string, chunkId: string): void;
    /** The Package 2.3 notes pinboard receives the saved note (FR-NM-02); without it the note is rendered inline. */
    onSavedNote?(note: SavedResponseNote): void;
  }): void;
}

export function createWorkspaceFeatures(options: WorkspaceFeaturesOptions): WorkspaceFeatures {
  const { notebookId } = options;
  let ask: (text: string) => void = () => undefined;
  let studio: HTMLElement | null = null;
  let openCitation: (sourceId: string, chunkId: string) => void = () => undefined;
  let savedNoteHandler: ((note: SavedResponseNote) => void) | null = null;
  let revisions: SourceRevision[] = [];
  // Current browser-local selection (C-02, FR-SI-02): topic chips send only for selected sources.
  let selectedSourceIds = new Set<string>();

  // ---- Settings (theme, languages) ---------------------------------------------------------------------
  const settingsPanel = h("div", { class: "workspace-settings-host", "data-testid": "workspace-settings", hidden: true });
  const settingsToggle = h("button", {
    class: "btn btn-sm",
    "data-testid": "workspace-settings-toggle",
    "aria-expanded": "false",
    text: "Settings",
  });
  let settings: WorkspaceSettingsState = {
    theme: loadWorkspacePreferences().theme,
    input_language: "auto",
    output_language: null,
    notebook_input_language: null,
    notebook_output_language: null,
  };
  const renderSettings = () =>
    renderWorkspaceSettings(settingsPanel, settings, {
      notebookId,
      onUpdate: async (next, key) => {
        settings = next;
        const notebookLevel = key === "notebook_input_language" || key === "notebook_output_language";
        const value = next[key] === "" && notebookLevel ? null : next[key];
        await authFetch(notebookLevel ? `/api/notebooks/${notebookId}/preferences` : "/api/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        }).catch(() => undefined);
        if (key === "output_language" || notebookLevel) {
          syncFollowUpScope();
          refreshOverview();
        }
      },
    });
  settingsToggle.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsToggle.setAttribute("aria-expanded", String(!settingsPanel.hidden));
    if (!settingsPanel.hidden) renderSettings();
  });
  void hydrateWorkspaceSettings(settings, { notebookId, fetcher: authFetch }).then((loaded) => {
    settings = loaded;
    adoptServerTheme(loaded.theme, document.documentElement);
    if (!settingsPanel.hidden) renderSettings();
  });
  void authFetch(`/api/notebooks/${notebookId}/opened`, { method: "POST" }).catch(() => undefined);

  // ---- Chat configuration (FR-GC-07) -------------------------------------------------------------------
  const controls = new ChatControlController({ notebookId, fetcher: authFetch, submit: (prompt) => ask(prompt) });
  const configLabel = h("span", { class: "chat-config-label muted", "data-testid": "chat-config-indicator" });
  const configButton = h("button", { class: "icon-btn", "data-testid": "chat-settings", "aria-label": "Chat settings", title: "Chat settings", text: "⚙" });
  const configDialog = buildConfigDialog(controls, configLabel);
  configButton.addEventListener("click", () => configDialog.open());
  void controls
    .loadConfiguration()
    .then((config) => {
      if (config) configLabel.textContent = formatChatConfigurationLabel(config);
    })
    .catch(() => undefined);

  // ---- Notebook overview and starter prompts (FR-GC-04) ------------------------------------------------
  const chatIntro = h("div", { class: "notebook-overview", "data-testid": "notebook-overview", hidden: true });
  let overviewTimer: ReturnType<typeof setTimeout> | null = null;
  let overviewToken = 0;
  // FR-UI-02 / FR-012: a supported tag only (notebook > user > supported browser locale > en-US).
  const outputLanguage = () => effectiveOutputLanguage(settings);
  let hasSources = true;
  function refreshOverview(): void {
    if (overviewTimer) clearTimeout(overviewTimer);
    if (!hasSources) {
      // FR-GC-04 / FR-007: no sources → clear the overview at once and show the add-source state.
      overviewToken += 1;
      renderAddSourceEmptyState(chatIntro);
      chatIntro.hidden = false;
      return;
    }
    if (chatIntro.querySelector("[data-testid=add-source-empty-state]")) {
      while (chatIntro.firstChild) chatIntro.removeChild(chatIntro.firstChild);
      chatIntro.hidden = true;
    }
    overviewTimer = setTimeout(async () => {
      const token = ++overviewToken;
      if (revisions.length === 0) {
        chatIntro.hidden = true;
        return;
      }
      const language = outputLanguage();
      controls.updateScope(revisions, language);
      try {
        const res = await authFetch(`/api/notebooks/${notebookId}/overview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source_revisions: revisions, output_language: language }),
        });
        if (token !== overviewToken) return;
        if (!res.ok) {
          chatIntro.hidden = true;
          return;
        }
        const overview = (await res.json()) as { overview_md: string; starter_prompts: string[] };
        controls.setOverview(overview);
        renderNotebookOverview(chatIntro, {
          notebookTitle: options.notebookTitle,
          notebookIcon: options.notebookIcon,
          sourceCount: revisions.length,
          overview: overview.overview_md,
          starterPrompts: overview.starter_prompts,
          onPrompt: (prompt) => controls.submitStarterPrompt(prompt),
        });
        chatIntro.hidden = false;
      } catch {
        chatIntro.hidden = true;
      }
    }, 300);
  }

  // ---- Follow-up chips above the chat input bar (FR-GC-05, C-02) --------------------------------------
  // Driven by ChatControlController: chips show only for the current scope signature and never while streaming.
  const followUpBar = h("div", { class: "follow-ups", "data-testid": "follow-ups", hidden: true });
  const renderFollowUps = () => {
    while (followUpBar.firstChild) followUpBar.removeChild(followUpBar.firstChild);
    const prompts = controls.getFollowUps();
    for (const prompt of prompts) {
      const chip = h("button", { class: "follow-up-chip", type: "button", text: prompt });
      chip.addEventListener("click", () => {
        // submitFollowUp sends only a chip of the current scope that is not hidden by streaming.
        controls.submitFollowUp(prompt);
        controls.setFollowUps([]);
        renderFollowUps();
      });
      followUpBar.append(chip);
    }
    followUpBar.hidden = prompts.length === 0;
  };
  const syncFollowUpScope = () => {
    controls.updateScope(revisions, outputLanguage());
    renderFollowUps();
  };

  // ---- Source Guide (FR-SI-02) -------------------------------------------------------------------------
  const guide = new SourceGuideController({
    notebookId,
    fetcher: authFetch,
    isSelected: (sourceId) => selectedSourceIds.has(sourceId),
    onTopic: (topic) => ask(`Explain “${topic}” using only the selected sources and cite supporting passages.`),
  });

  return {
    headerItems: [settingsToggle],
    settingsPanel,
    chatTools: [configLabel, configButton],
    chatIntro,
    followUpBar,
    onStreamStart() {
      controls.setStreaming(true);
      renderFollowUps();
    },
    onStreamEnd() {
      controls.setStreaming(false);
    },
    decorateAnswer(bubble, message, fresh) {
      const actions = h("div", { class: "answer-actions" });
      bubble.append(actions);
      renderResponseActions(actions, {
        notebookId,
        messageId: message.id,
        content: message.content ?? "",
        citations: message.citations,
        fetcher: authFetch,
        onSavedNote: (note) => {
          // FR-NM-02 / FR-GC-09: the saved response lands in the Right Panel pinboard (Package 2.3).
          if (savedNoteHandler) savedNoteHandler(note);
          if (!studio) return;
          if (!savedNoteHandler) renderSavedResponseNote(studio, note, (citation) => openCitation(citation.source_id, citation.chunk_id));
          // FR-NM-02: the note is in the single notes store; the Package 2.3 notes panel refreshes on this event.
          studio.dispatchEvent(new CustomEvent("everlast:note-saved", { detail: { note_id: note.id } }));
        },
      });
      if (!fresh || revisions.length === 0) return;
      const snapshot = [...revisions];
      const signature = scopeSignature(snapshot, outputLanguage());
      void authFetch(`/api/notebooks/${notebookId}/chat/messages/${message.id}/follow-ups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_revisions: snapshot }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const { suggested_followups } = (await res.json()) as { suggested_followups?: { text: string }[] };
          // Stored only when the signature still equals the current scope; otherwise dropped (C-02).
          controls.setFollowUps((suggested_followups ?? []).map((chip) => chip.text), signature);
          renderFollowUps();
        })
        .catch(() => undefined);
    },
    onSourceOpened(source, slot, viaCitation) {
      if (viaCitation) return;
      void guide.load(source.id, source.revision).then(() => guide.render(slot));
    },
    onSelectionChange(sources, selectedIds) {
      const selected = new Set(selectedIds);
      selectedSourceIds = selected;
      hasSources = sources.length > 0;
      revisions = sources
        .filter((s) => selected.has(s.id) && s.status === "Ready" && s.revision !== null)
        .map((s) => ({ source_id: s.id, revision: s.revision! }))
        .sort((a, b) => a.source_id.localeCompare(b.source_id));
      syncFollowUpScope();
      refreshOverview();
    },
    bind(input) {
      ask = input.ask;
      studio = input.studio;
      openCitation = input.openCitation;
      savedNoteHandler = input.onSavedNote ?? null;
    },
  };
}

function buildConfigDialog(controls: ChatControlController, label: HTMLElement): { open(): void } {
  const style = h(
    "select",
    { name: "style", "data-testid": "chat-style", "aria-label": "Response style" },
    h("option", { value: "default", text: "Default" }),
    h("option", { value: "learning_guide", text: "Learning guide" }),
    h("option", { value: "analyst", text: "Analyst" }),
    h("option", { value: "custom", text: "Custom" })
  ) as HTMLSelectElement;
  const custom = h("textarea", { name: "custom_instructions", rows: 4, maxlength: 5000, "aria-label": "Custom instructions" }) as HTMLTextAreaElement;
  const customRow = h("label", { class: "field", hidden: true }, h("span", { text: "Custom instructions" }), custom);
  const length = h(
    "select",
    { name: "response_length", "data-testid": "chat-length", "aria-label": "Response length" },
    h("option", { value: "default", text: "Default" }),
    h("option", { value: "longer", text: "Longer" }),
    h("option", { value: "shorter", text: "Shorter" })
  ) as HTMLSelectElement;
  const error = h("p", { class: "chat-error", hidden: true });
  const save = h("button", { class: "btn btn-primary", type: "submit", text: "Save" });
  const cancel = h("button", { class: "btn", type: "button", text: "Cancel" });
  const form = h(
    "form",
    { class: "modal chat-config-form", "data-testid": "chat-config-dialog" },
    h("h2", { text: "Chat settings" }),
    h("label", { class: "field" }, h("span", { text: "Style" }), style),
    customRow,
    h("label", { class: "field" }, h("span", { text: "Response length" }), length),
    h("p", { class: "muted", text: "Settings change the form of answers only. Answers still come only from your selected sources." }),
    error,
    h("div", { class: "modal-actions" }, cancel, save)
  ) as HTMLFormElement;
  // Created on open and removed on close, so the v1 workspace never has a hidden dialog in the DOM.
  const backdrop = h("div", { class: "modal-backdrop" }, form);
  const close = () => backdrop.remove();
  const sync = () => (customRow.hidden = style.value !== "custom");
  style.addEventListener("change", sync);
  cancel.addEventListener("click", close);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const config: ChatConfig = {
      style: style.value as ChatConfig["style"],
      response_length: length.value as ChatConfig["response_length"],
      ...(style.value === "custom" ? { custom_instructions: custom.value } : {}),
    };
    void controls.saveConfiguration(config).then((ok) => {
      error.hidden = ok;
      error.textContent = ok ? "" : "These settings are not valid. Your previous settings were kept.";
      if (ok) {
        label.textContent = formatChatConfigurationLabel(controls.getConfiguration());
        close();
      }
    });
  });
  return {
    open() {
      const current = controls.getConfiguration();
      style.value = current.style;
      custom.value = current.custom_instructions ?? "";
      length.value = current.response_length;
      sync();
      error.hidden = true;
      document.body.append(backdrop);
    },
  };
}
