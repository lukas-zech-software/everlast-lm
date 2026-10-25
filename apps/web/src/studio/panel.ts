import type { DataTableSchemaId, ReportCitation, StudioDataTablePayload, StudioMindmapPayload } from "@everlast/contracts";
import type { ChatMessage } from "../lib/types.ts";
import { clear, confirmDialog, h, toast } from "../lib/dom.ts";
import { createStudioApi, StudioApiError, type ArtifactDto } from "./api.ts";
import { StudioArtifactListController, type ArtifactView, type StudioRow } from "./artifact-list.ts";
import { renderMarkdownNodes } from "./markdown.ts";
import { downloadMindmapScene, revokePendingExportUrls, triggerBlobDownload } from "./mindmap-export.ts";
import { createMindmapViewer } from "./mindmap-viewer.ts";
import { CUSTOM_PROMPT_MAX, promptCodePoints, REPORT_TEMPLATES, ReportsModalController } from "./reports-modal.ts";
import { createDataTableViewer } from "./table-viewer.ts";

/**
 * Studio in the Right Panel (FR-ST-10, FR-ST-11; FR-001, FR-006, FR-008..FR-012, FR-018). A Reports tile opens the
 * `Create report` modal (Create Your Own, the four standard templates and 3–4 Suggested Format cards); the artifact
 * list shows background jobs until they are terminal; the viewer renders the section model with citation badges
 * and offers Copy, Delete (with confirmation) and Convert to source. Every request carries the current explicit
 * selection (C-02: no all-sources fallback). v2 has no cancel action (card FR-ST-10); v2.0 is Owner-only and the
 * server authorizes every call.
 */

export interface StudioPanelOptions {
  notebookId: string;
  /** `authFetch`: adds the caller's bearer token. */
  fetcher: typeof fetch;
  /** Current Left Panel selection, read at request time. */
  selectedSourceIds(): string[];
  /** Opens the Source Inspector on a cited chunk. */
  openCitation(sourceId: string, chunkId: string): void;
  /** Convert to source created a source: add it to this browser's selection and refresh the Left Panel. */
  onSourceCreated(sourceId: string): Promise<void> | void;
  /** Appends persisted chat messages from a mindmap node drilldown turn (FR-ST-09). */
  onAssistantMessages?(messages: ChatMessage[]): void;
  /** Fallback chat submission when drilldown delegates to chat panel. */
  onAskChat?(prompt: string): void;
  confirm?: (options: { title: string; body: string; confirm: string; danger?: boolean }) => Promise<boolean>;
  notify?: (message: string, kind?: "error" | "info") => void;
  clipboard?: { writeText(text: string): Promise<void> };
  /** List refresh interval while a job is Queued or Running. */
  pollMs?: number;
  /** Suggestions re-read interval while Source Guides are pending. */
  suggestionPollMs?: number;
  /** Pending reads before suggestions are shown as unavailable (never endless loading). */
  maxSuggestionPolls?: number;
}

export interface StudioPanel {
  element: HTMLElement;
  refresh(): Promise<void>;
  /** Re-evaluates the actions that depend on the Left Panel selection. */
  updateSourceSelection(): void;
  /** Starts a mindmap generation job using the current explicit source selection (FR-ST-08). */
  generateMindmap(): Promise<void>;
  destroy(): void;
}

const SCOPE_HINT = "Select at least one source to create a report.";
const SUGGESTIONS_LOADING = "Finding report formats for your sources…";
const SUGGESTIONS_UNAVAILABLE = "Suggested formats are unavailable right now. You can still use a standard format or Create Your Own.";
const SUGGESTIONS_NEED_SCOPE = "Suggested formats are unavailable until you select at least one source.";
const PROMPT_PLACEHOLDER =
  "Describe the report you want: its structure, style, tone and audience. Example: a one-page brief for new engineers in a friendly tone.";

const messageOf = (error: unknown): string =>
  error instanceof StudioApiError || error instanceof Error ? error.message : "The request failed. Please try again.";

export function createStudioPanel(options: StudioPanelOptions): StudioPanel {
  const api = createStudioApi({ notebookId: options.notebookId, fetch: options.fetcher });
  const confirm = options.confirm ?? confirmDialog;
  const notify = options.notify ?? ((message: string, kind: "error" | "info" = "info") => toast(message, kind));
  const clipboard = options.clipboard ?? { writeText: (text: string) => navigator.clipboard.writeText(text) };
  const pollMs = options.pollMs ?? 2000;
  const suggestionPollMs = options.suggestionPollMs ?? 1500;
  const list = new StudioArtifactListController({ api, clipboard });
  const hasScope = () => options.selectedSourceIds().length > 0;

  let destroyed = false;
  let listTimer: ReturnType<typeof setTimeout> | null = null;
  let viewing: string | null = null;

  // ---- Static frame --------------------------------------------------------------------------------------------
  const tile = h(
    "button",
    { class: "studio-tile", type: "button", "data-testid": "studio-reports-tile", "aria-haspopup": "dialog" },
    h("span", { class: "studio-tile-icon", "aria-hidden": "true", text: "📄" }),
    h("span", { class: "studio-tile-label", text: "Reports" })
  );
  tile.addEventListener("click", () => openModal());
  const mindmapTile = h(
    "button",
    {
      class: "studio-tile",
      type: "button",
      "data-testid": "studio-mindmap-tile",
      disabled: !hasScope(),
      title: hasScope() ? "Generate a grounded Mindmap from selected sources" : "Select at least one source to generate a mindmap.",
    },
    h("span", { class: "studio-tile-icon", "aria-hidden": "true", text: "🧠" }),
    h("span", { class: "studio-tile-label", text: "Mindmap" })
  ) as HTMLButtonElement;
  mindmapTile.addEventListener("click", () => void generateMindmap());

  const dataTableTile = h(
    "button",
    {
      class: "studio-tile",
      type: "button",
      "data-testid": "studio-data-table-tile",
      "aria-haspopup": "dialog",
      disabled: !hasScope(),
      title: hasScope() ? "Generate a grounded Data Table from selected sources" : "Select at least one source to generate a data table.",
    },
    h("span", { class: "studio-tile-icon", "aria-hidden": "true", text: "📊" }),
    h("span", { class: "studio-tile-label", text: "Data Table" })
  ) as HTMLButtonElement;
  dataTableTile.addEventListener("click", () => openDataTableModal());

  const status = h("p", { class: "studio-status muted", "data-testid": "studio-status", role: "status", "aria-live": "polite" });
  const listEl = h("ul", { class: "studio-artifacts", "data-testid": "studio-artifacts" });
  const empty = h("p", { class: "studio-empty muted", "data-testid": "studio-empty", text: "Generated reports will appear here." });
  const viewerHost = h("div", { class: "studio-viewer-host" });
  const element = h(
    "section",
    { class: "studio-panel", "data-testid": "studio-panel", "aria-label": "Studio" },
    h("div", { class: "studio-header" }, h("h2", { text: "Studio" })),
    h("div", { class: "studio-tiles" }, tile, mindmapTile, dataTableTile),
    status,
    empty,
    listEl,
    viewerHost
  );

  async function generateMindmap(): Promise<void> {
    const ids = options.selectedSourceIds();
    if (ids.length === 0) return;
    try {
      const artifact = await api.create({
        plugin_type: "mindmap",
        subtype: "default",
        active_source_ids: ids,
      });
      jobCreated(artifact);
    } catch (error) {
      status.textContent = messageOf(error);
    }
  }

  // ---- Artifact list (FR-006) ----------------------------------------------------------------------------------
  function renderRow(row: StudioRow): HTMLElement {
    const iconText = row.plugin_type === "mindmap" ? "🧠" : row.plugin_type === "data_table" ? "📊" : "📄";
    const label = h("span", { class: "studio-artifact-label", "data-testid": "studio-artifact-label", text: row.generating ? `Generating ${row.title}...` : row.title });
    const item = h("li", {
      class: "studio-artifact-row",
      "data-testid": "studio-artifact-row",
      "data-status": row.status,
      "data-plugin-type": row.plugin_type,
      "data-artifact-id": row.id,
    });
    if (row.status === "Completed") {
      const open = h("button", { class: "studio-artifact-open", type: "button", "data-testid": "studio-artifact-open", "aria-label": `Open ${row.title}` }, label);
      open.addEventListener("click", () => void openViewer(row.id, row.title, row.plugin_type));
      item.append(h("span", { class: "studio-artifact-icon", "aria-hidden": "true", text: iconText }), open);
    } else {
      item.append(h("span", { class: "studio-artifact-icon", "aria-hidden": "true", text: row.generating ? "" : "⚠" }), label);
    }
    if (row.generating) {
      item.append(h("span", { class: "studio-generating", "data-testid": "studio-generating", role: "progressbar", "aria-label": `Generating ${row.title}` }));
      if (row.cancellable) {
        const cancelBtn = h("button", {
          class: "btn btn-sm",
          type: "button",
          "data-testid": "studio-cancel",
          text: "Cancel",
        });
        cancelBtn.addEventListener("click", () => void cancelRow(row.id));
        item.append(cancelBtn);
      }
    }
    if (row.failure !== null) {
      const retry = h("button", { class: "btn btn-sm", type: "button", "data-testid": "studio-retry", text: "Retry" }) as HTMLButtonElement;
      retry.disabled = !hasScope();
      retry.title = hasScope() ? "Retry with the current source selection" : SCOPE_HINT;
      retry.addEventListener("click", () => void retryRow(row.id));
      item.append(
        h("span", { class: "studio-artifact-status", text: row.status === "Failed" ? "Failed" : row.status }),
        h("p", { class: "studio-artifact-failure", "data-testid": "studio-artifact-failure", text: row.failure }),
        retry
      );
    }
    return item;
  }

  function renderList(): void {
    clear(listEl);
    const rows = list.rows();
    for (const row of rows) listEl.append(renderRow(row));
    empty.hidden = rows.length > 0;
    listEl.hidden = viewing !== null;
    if (viewing !== null) empty.hidden = true;
  }

  function schedulePoll(): void {
    if (destroyed || listTimer || !list.hasActiveJobs()) return;
    listTimer = setTimeout(() => {
      listTimer = null;
      void refresh();
    }, pollMs);
  }

  async function refresh(): Promise<void> {
    try {
      await list.refresh();
    } catch (error) {
      status.textContent = messageOf(error);
    }
    if (destroyed) return;
    renderList();
    schedulePoll();
  }

  function jobCreated(artifact: ArtifactDto): void {
    list.upsert(artifact);
    status.textContent = "";
    renderList();
    schedulePoll();
  }

  async function retryRow(id: string): Promise<void> {
    try {
      jobCreated(await list.retry(id, options.selectedSourceIds()));
    } catch (error) {
      status.textContent = messageOf(error);
    }
  }

  async function cancelRow(id: string): Promise<void> {
    try {
      const cancelled = await list.cancel(id);
      list.upsert(cancelled);
      renderList();
    } catch (error) {
      status.textContent = messageOf(error);
    }
  }

  // ---- Viewer (FR-008) -----------------------------------------------------------------------------------------
  function closeViewer(): void {
    viewing = null;
    revokePendingExportUrls();
    clear(viewerHost);
    renderList();
  }

  function badgeFor(citations: ReportCitation[]) {
    return (n: number): Node | null => {
      const citation = citations.find((c) => c.badge_number === n);
      if (!citation) return null;
      const badge = h("button", {
        class: "citation-badge",
        type: "button",
        "data-testid": "report-citation",
        "data-badge": n,
        "data-chunk-id": citation.chunk_id,
        "aria-label": `Citation ${n}`,
        title: citation.snippet,
        text: String(n),
      });
      badge.addEventListener("click", () => options.openCitation(citation.source_id, citation.chunk_id));
      return badge;
    };
  }

  function sectionKeys(view: ArtifactView): (heading: string) => string | undefined {
    const payload = view.artifact.payload_json;
    const sections = payload && "sections" in payload ? payload.sections : [];
    const unused = [...sections];
    return (heading) => {
      const index = unused.findIndex((s) => s.heading === heading.trim());
      return index >= 0 ? unused.splice(index, 1)[0]!.key : undefined;
    };
  }

  function renderMindmapInitialCanvas(article: HTMLElement, id: string, title: string, payload: StudioMindmapPayload): void {
    clear(viewerHost);
    const mv = createMindmapViewer({
      artifactId: id,
      title,
      payload,
      onClose: closeViewer,
      actions: [deleteButton(id, title)],
      onCitationClick: (sourceId, chunkId) => options.openCitation(sourceId, chunkId),
      onDrilldown: async (nodeId) => {
        const activeIds = options.selectedSourceIds();
        if (activeIds.length === 0) {
          status.textContent = "Select supporting sources in the Left Panel before asking about this node.";
          return;
        }
        try {
          if (!api.drilldownMindmap) throw new Error("Mindmap drilldown is not available.");
          const res = await api.drilldownMindmap(id, { node_id: nodeId, active_source_ids: activeIds });
          if (options.onAssistantMessages && Array.isArray(res.messages) && res.messages.length > 0) {
            options.onAssistantMessages(res.messages as ChatMessage[]);
          } else if (options.onAskChat) {
            options.onAskChat(res.prompt);
          }
          status.textContent = `Asked in chat: ${res.node_label}`;
        } catch (err) {
          status.textContent = messageOf(err);
        }
      },
      onExport: async (format, expandedNodeIds) => {
        try {
          if (!api.exportMindmap) throw new Error("Mindmap export is not available.");
          const scene = await api.exportMindmap(id, { format, expanded_node_ids: expandedNodeIds });
          if (viewing !== id) return;
          await downloadMindmapScene(scene);
          status.textContent = `Exported ${format.toUpperCase()}`;
        } catch (err) {
          status.textContent = messageOf(err);
        }
      },
    });
    viewerHost.append(mv.element);
  }

  async function openViewer(id: string, title: string, pluginType: ArtifactDto["plugin_type"] = "report"): Promise<void> {
    viewing = id;
    renderList();
    clear(viewerHost);
    const close = h("button", { class: "icon-btn", type: "button", "data-testid": "studio-viewer-close", "aria-label": "Close viewer", text: "←" });
    close.addEventListener("click", closeViewer);
    const viewerTestId = pluginType === "mindmap" ? "studio-mindmap-viewer" : pluginType === "data_table" ? "studio-table-viewer" : "studio-report-viewer";
    const article = h(
      "article",
      { class: viewerTestId, "data-testid": viewerTestId, "data-artifact-id": id },
      h("div", { class: "studio-viewer-head" }, close, h("h3", { class: "studio-report-title", "data-testid": "studio-report-title", text: title }))
    );
    viewerHost.append(article);
    let view: ArtifactView;
    try {
      view = await list.view(id);
    } catch (error) {
      const msg = messageOf(error);
      article.append(
        h("p", {
          class: "studio-report-unavailable muted",
          "data-testid": pluginType === "report" ? "studio-report-unavailable" : "studio-artifact-unavailable",
          text: msg,
        })
      );
      return;
    }
    if (viewing !== id) return;
    const actualPlugin = view.artifact.plugin_type ?? pluginType;
    const payload = view.artifact.payload_json;
    if (!payload) {
      const unavailMsg = view.unavailable?.message ?? "This artifact is not available.";
      const unavailEl = h("p", {
        class: "studio-report-unavailable muted",
        "data-testid": actualPlugin === "report" ? "studio-report-unavailable" : "studio-artifact-unavailable",
        text: unavailMsg,
      });
      // For backward compatibility if tests query studio-report-unavailable or studio-artifact-unavailable
      article.append(unavailEl, h("div", { class: "studio-viewer-actions" }, deleteButton(id, title)));
      return;
    }
    if (actualPlugin === "mindmap" || ("root_node" in (payload as object))) {
      renderMindmapInitialCanvas(article, id, title, payload as StudioMindmapPayload);
      return;
    }
    if (actualPlugin === "data_table" || ("rows" in (payload as object))) {
      clear(viewerHost);
      const tv = createDataTableViewer({
        artifactId: id,
        title,
        payload: payload as StudioDataTablePayload,
        onClose: closeViewer,
        actions: [deleteButton(id, title)],
        onCitationClick: (sourceId, chunkId) => options.openCitation(sourceId, chunkId),
        onExport: async (format, orderedRowIds) => {
          try {
            if (!api.exportDataTable) throw new Error("Data table export is not available.");
            const exported = await api.exportDataTable(id, { format, ordered_row_ids: orderedRowIds });
            if (viewing !== id) return;
            const blob = new Blob([new Uint8Array(exported.bytes)], { type: exported.contentType });
            triggerBlobDownload(blob, exported.filename);
            status.textContent = `Exported ${format.toUpperCase()}`;
          } catch (err) {
            status.textContent = messageOf(err);
          }
        },
      });
      viewerHost.append(tv.element);
      return;
    }
    if (!("content_md" in payload)) {
      return;
    }
    const content = h("div", { class: "studio-report-content", "data-testid": "studio-report-content" });
    for (const node of renderMarkdownNodes(payload.content_md, { badge: badgeFor(payload.citations), sectionKey: sectionKeys(view) })) content.append(node);
    const copy = h("button", { class: "btn btn-sm", type: "button", "data-testid": "studio-copy", text: "Copy" });
    copy.addEventListener("click", async () => {
      try {
        await clipboard.writeText(payload.content_md);
        status.textContent = "Report copied";
      } catch {
        notify("Could not copy the report.", "error");
      }
    });
    const convert = h("button", { class: "btn btn-sm", type: "button", "data-testid": "studio-convert", text: "Convert to source" }) as HTMLButtonElement;
    convert.addEventListener("click", async () => {
      convert.disabled = true;
      status.textContent = "Converting to source…";
      try {
        const { source_id } = await list.convert(id);
        status.textContent = `Source created: ${title}`;
        await options.onSourceCreated(source_id);
      } catch (error) {
        status.textContent = messageOf(error);
      } finally {
        convert.disabled = false;
      }
    });
    article.append(content, h("div", { class: "studio-viewer-actions" }, copy, convert, deleteButton(id, title)));
  }

  function deleteButton(id: string, title: string): HTMLElement {
    const button = h("button", { class: "btn btn-sm btn-danger", type: "button", "data-testid": "studio-delete", text: "Delete" });
    button.addEventListener("click", async () => {
      const ok = await confirm({ title: "Delete report?", body: `“${title}” will be permanently deleted.`, confirm: "Delete", danger: true });
      if (!ok) return;
      try {
        await list.remove(id);
        status.textContent = `Deleted: ${title}`;
        if (viewing === id) closeViewer();
        else renderList();
      } catch (error) {
        status.textContent = messageOf(error);
      }
    });
    return button;
  }

  // ---- Create report modal (FR-001, FR-009..FR-012, FR-018) -----------------------------------------------------
  let modal: { root: HTMLElement; sync(): void; rescope(): void; close(): void } | null = null;

  function openModal(): void {
    if (modal) return;
    const controller = new ReportsModalController({
      api,
      notebookId: options.notebookId,
      getActiveSourceIds: () => options.selectedSourceIds(),
      ...(options.maxSuggestionPolls !== undefined ? { maxLoadingPolls: options.maxSuggestionPolls } : {}),
    });
    let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
    let open = true;
    let busy = false;

    const error = h("p", { class: "chat-error report-modal-error", "data-testid": "report-modal-error", role: "alert", hidden: true });
    const showError = (message: string | null) => {
      error.hidden = message === null;
      error.textContent = message ?? "";
    };
    const closeButton = h("button", { class: "icon-btn", type: "button", "data-testid": "reports-modal-close", "aria-label": "Close", text: "✕" });
    const scopeHint = h("p", { class: "muted report-scope-hint", "data-testid": "report-scope-hint", text: SCOPE_HINT });

    const createOwn = h(
      "button",
      { class: "report-card report-create-own", type: "button", "data-testid": "report-create-own" },
      h("strong", { text: "Create Your Own" }),
      h("span", { class: "muted", text: "Craft reports your way by specifying structure, style, tone, and more" })
    ) as HTMLButtonElement;
    const templateButtons = REPORT_TEMPLATES.map((t) => {
      const button = h("button", { class: "report-card report-template", type: "button", "data-testid": "report-template", "data-subtype": t.subtype, title: t.description, text: t.label }) as HTMLButtonElement;
      button.addEventListener("click", () => void submit(() => controller.generateTemplate(t.subtype)));
      return button;
    });
    const suggestionsEl = h("div", { class: "report-suggestions", "data-testid": "report-suggestions", "aria-live": "polite" });

    // Prompt editor: Create Your Own (custom) or an edited suggestion (dynamic).
    const promptHeading = h("h3", { class: "report-prompt-heading" });
    const prompt = h("textarea", {
      class: "report-prompt",
      "data-testid": "report-prompt",
      rows: 8,
      "aria-label": "Report prompt",
      placeholder: PROMPT_PLACEHOLDER,
    }) as HTMLTextAreaElement;
    const count = h("span", { class: "muted report-prompt-count", "data-testid": "report-prompt-count" });
    const generate = h("button", { class: "btn btn-primary", type: "button", "data-testid": "report-generate", text: "Generate" }) as HTMLButtonElement;
    const back = h("button", { class: "btn", type: "button", "data-testid": "report-prompt-back", text: "Back" });
    const promptForm = h(
      "div",
      { class: "report-prompt-form", "data-testid": "report-prompt-form", hidden: true },
      promptHeading,
      h("p", { class: "muted", text: "Reports are written only from your selected sources and always cite them." }),
      prompt,
      h("div", { class: "report-prompt-meta" }, count, h("div", { class: "grow" }), back, generate)
    );
    const choices = h(
      "div",
      { class: "report-choices" },
      scopeHint,
      h("h3", { text: "Create Your Own" }),
      createOwn,
      h("h3", { text: "Format" }),
      h("div", { class: "report-templates" }, ...templateButtons),
      h("h3", { text: "Suggested Format" }),
      suggestionsEl
    );
    const dialog = h(
      "div",
      { class: "modal reports-modal", "data-testid": "reports-modal", role: "dialog", "aria-modal": "true", "aria-label": "Create report" },
      h("div", { class: "modal-head" }, h("h2", { text: "Create report" }), closeButton),
      choices,
      promptForm,
      error
    );
    const root = h("div", { class: "modal-backdrop" }, dialog);

    const syncPrompt = () => {
      const n = promptCodePoints(controller.prompt);
      count.textContent = `${n.toLocaleString("en-US")} / ${CUSTOM_PROMPT_MAX.toLocaleString("en-US")}`;
      count.classList.toggle("over-limit", n > CUSTOM_PROMPT_MAX);
      generate.disabled = busy || !controller.canGenerate;
    };
    const sync = () => {
      const enabled = controller.templatesEnabled && !busy;
      for (const b of templateButtons) b.disabled = !enabled;
      createOwn.disabled = !enabled;
      scopeHint.hidden = controller.templatesEnabled;
      for (const b of suggestionsEl.querySelectorAll("button")) (b as HTMLButtonElement).disabled = !enabled;
      syncPrompt();
    };
    const showPrompt = (heading: string) => {
      promptHeading.textContent = heading;
      prompt.value = controller.prompt;
      choices.hidden = true;
      promptForm.hidden = false;
      showError(null);
      sync();
      prompt.focus();
    };

    function renderSuggestions(): void {
      clear(suggestionsEl);
      suggestionsEl.setAttribute("data-state", controller.suggestionState);
      if (controller.suggestionState === "SuggestionsLoading") {
        suggestionsEl.append(h("p", { class: "muted report-suggestions-loading", "data-testid": "report-suggestions-loading", role: "status", text: SUGGESTIONS_LOADING }));
      } else if (controller.suggestionState === "SuggestionsUnavailable") {
        suggestionsEl.append(
          h("p", {
            class: "muted report-suggestions-unavailable",
            "data-testid": "report-suggestions-unavailable",
            text: controller.unavailableReason === "scope" ? SUGGESTIONS_NEED_SCOPE : SUGGESTIONS_UNAVAILABLE,
          })
        );
      } else {
        controller.suggestions.forEach((s, index) => {
          const use = h(
            "button",
            { class: "report-suggestion-use", type: "button", "data-testid": "report-suggestion-use", "aria-label": `Generate ${s.title}` },
            h("strong", { class: "report-suggestion-title", "data-testid": "report-suggestion-title", text: s.title }),
            h("span", { class: "muted report-suggestion-description", "data-testid": "report-suggestion-description", text: s.description })
          );
          use.addEventListener("click", () => void submit(() => controller.generateSuggestion(index)));
          const edit = h("button", { class: "icon-btn report-suggestion-edit", type: "button", "data-testid": "report-suggestion-edit", "aria-label": `Edit prompt: ${s.title}`, title: "Edit prompt", text: "✎" });
          edit.addEventListener("click", () => {
            controller.editSuggestion(index);
            showPrompt(s.title);
          });
          suggestionsEl.append(h("div", { class: "report-card report-suggestion", "data-testid": "report-suggestion" }, use, edit));
        });
      }
      sync();
    }

    // Suggestions belong to one explicit scope (C-02): a selection change starts a new cycle and drops older answers.
    let cycle = 0;
    async function loadSuggestions(): Promise<void> {
      suggestionTimer = null;
      const mine = cycle;
      const state = await controller.loadSuggestions();
      if (!open || mine !== cycle) return;
      renderSuggestions();
      if (state === "SuggestionsLoading") suggestionTimer = setTimeout(() => void loadSuggestions(), suggestionPollMs);
    }

    async function submit(start: () => Promise<ArtifactDto>): Promise<void> {
      if (busy || !controller.templatesEnabled) return;
      busy = true;
      showError(null);
      sync();
      try {
        const artifact = await start();
        close();
        jobCreated(artifact);
      } catch (e) {
        showError(messageOf(e));
      } finally {
        busy = false;
        if (open) sync();
      }
    }

    function close(): void {
      if (!open) return;
      open = false;
      if (suggestionTimer) clearTimeout(suggestionTimer);
      root.remove();
      modal = null;
      tile.focus();
    }

    createOwn.addEventListener("click", () => {
      if (!controller.templatesEnabled) return;
      controller.startCustom();
      showPrompt("Create Your Own");
    });
    prompt.addEventListener("input", () => {
      controller.setPrompt(prompt.value);
      syncPrompt();
    });
    generate.addEventListener("click", () => {
      if (!controller.canGenerate) return;
      void submit(() => controller.generate());
    });
    back.addEventListener("click", () => {
      promptForm.hidden = true;
      choices.hidden = false;
      showError(null);
      sync();
    });
    closeButton.addEventListener("click", close);
    root.addEventListener("click", (event: Event) => {
      if (event.target === root) close();
    });
    root.addEventListener("keydown", (event: Event) => {
      if ((event as KeyboardEvent).key === "Escape") close();
    });

    const rescope = () => {
      cycle += 1;
      if (suggestionTimer) clearTimeout(suggestionTimer);
      controller.resetSuggestions();
      renderSuggestions();
      void loadSuggestions();
    };

    modal = { root, sync, rescope, close };
    controller.resetSuggestions();
    renderSuggestions();
    document.body.append(root);
    void loadSuggestions();
  }

  let tableModal: { root: HTMLElement; close(): void } | null = null;

  function openDataTableModal(): void {
    if (tableModal || !hasScope()) return;
    let open = true;
    let busy = false;

    const closeBtn = h("button", { class: "icon-btn", type: "button", "data-testid": "data-table-modal-close", "aria-label": "Close", text: "✕" });
    const schemaSelect = h(
      "select",
      { class: "form-select", "data-testid": "data-table-schema-select", "aria-label": "Table schema" },
      h("option", { value: "auto", text: "Auto-detect attributes" }),
      h("option", { value: "vendor_comparison", text: "Vendor Comparison" }),
      h("option", { value: "feature_matrix", text: "Feature Matrix" }),
      h("option", { value: "metric_summary", text: "Metric Summary" })
    ) as HTMLSelectElement;

    const focusPrompt = h("textarea", {
      class: "report-prompt",
      "data-testid": "data-table-focus-prompt",
      rows: 4,
      "aria-label": "Focus prompt (optional)",
      placeholder: "Optional: specify which items or attributes to compare (up to 2,000 characters).",
    }) as HTMLTextAreaElement;

    const errorEl = h("p", { class: "chat-error", "data-testid": "data-table-modal-error", role: "alert", hidden: true });
    const generateBtn = h("button", { class: "btn btn-primary", type: "button", "data-testid": "data-table-generate", text: "Generate" }) as HTMLButtonElement;

    function close(): void {
      if (!open) return;
      open = false;
      root.remove();
      tableModal = null;
      dataTableTile.focus();
    }

    closeBtn.addEventListener("click", close);
    generateBtn.addEventListener("click", async () => {
      if (busy) return;
      const ids = options.selectedSourceIds();
      if (ids.length === 0) {
        errorEl.hidden = false;
        errorEl.textContent = "Select at least one source.";
        return;
      }
      const trimmedPrompt = focusPrompt.value.trim();
      if (Array.from(trimmedPrompt).length > 2000) {
        errorEl.hidden = false;
        errorEl.textContent = "Focus prompt must not exceed 2,000 characters.";
        return;
      }
      busy = true;
      generateBtn.disabled = true;
      try {
        const artifact = await api.create({
          plugin_type: "data_table",
          subtype: "default",
          active_source_ids: ids,
          ...(trimmedPrompt ? { focus_prompt: trimmedPrompt } : {}),
          schema_id: (schemaSelect.value || "auto") as DataTableSchemaId,
        });
        close();
        jobCreated(artifact);
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = messageOf(err);
      } finally {
        busy = false;
        if (open) generateBtn.disabled = false;
      }
    });

    const dialog = h(
      "div",
      { class: "modal data-table-modal", "data-testid": "data-table-modal", role: "dialog", "aria-modal": "true", "aria-label": "Create data table" },
      h("div", { class: "modal-head" }, h("h2", { text: "Create Data Table" }), closeBtn),
      h("div", { class: "modal-body" }, h("label", { text: "Schema" }), schemaSelect, h("label", { text: "Focus Prompt (Optional)" }), focusPrompt, errorEl),
      h("div", { class: "modal-foot" }, generateBtn)
    );
    const root = h("div", { class: "modal-backdrop" }, dialog);
    tableModal = { root, close };
    document.body.append(root);
  }

  return {
    element,
    refresh,
    generateMindmap,
    updateSourceSelection() {
      modal?.sync();
      modal?.rescope();
      mindmapTile.disabled = !hasScope();
      mindmapTile.title = hasScope()
        ? "Generate a grounded Mindmap from selected sources"
        : "Select at least one source to generate a mindmap.";
      dataTableTile.disabled = !hasScope();
      dataTableTile.title = hasScope()
        ? "Generate a grounded Data Table from selected sources"
        : "Select at least one source to generate a data table.";
      for (const button of listEl.querySelectorAll("[data-testid=studio-retry]")) {
        (button as HTMLButtonElement).disabled = !hasScope();
        (button as HTMLButtonElement).title = hasScope() ? "Retry with the current source selection" : SCOPE_HINT;
      }
    },
    destroy() {
      destroyed = true;
      if (listTimer) clearTimeout(listTimer);
      modal?.close();
      tableModal?.close();
    },
  };
}
