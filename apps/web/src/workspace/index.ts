import { api, ApiError, authFetch } from "../lib/api.ts";
import { confirmDialog, h, toast } from "../lib/dom.ts";
import { SelectionModel } from "../lib/selection.ts";
import type { NotebookDto, QuotaSummary } from "../lib/types.ts";
import type { Session } from "../lib/auth.ts";
import { createWorkspaceShell } from "./layout.ts";
import { createTitleEditor } from "./title.ts";
import { createSourcesPanel } from "../sources/panel.ts";
import { createInspector } from "../sources/inspector.ts";
import { createChatPanel } from "../chat/panel.ts";
import { createWorkspaceFeatures } from "../v2/workspace-features.ts";
import { createNotesPanel } from "../notes/panel.ts";
import { createStudioPanel } from "../studio/panel.ts";
import { renderIconPicker } from "../home.ts";

/** Notebook workspace (FR-UI-01) wiring sources, inspector, chat, the notes pinboard (FR-NM-01..04) and Studio reports (FR-ST-10/11). */

export interface WorkspaceRouteOptions {
  root: HTMLElement;
  notebookId: string;
  session: Session;
  openAddSources: boolean;
  goHome(): void;
  notebookMissing(): void;
}

export async function renderWorkspace(options: WorkspaceRouteOptions): Promise<() => void> {
  const { root, notebookId } = options;
  let data: { notebook: NotebookDto; quota: QuotaSummary };
  try {
    data = await api(`/api/notebooks/${notebookId}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) options.notebookMissing();
    else toast("Could not open the notebook.");
    return () => undefined;
  }
  document.title = `${data.notebook.title} · Everlast LM`;
  const shell = createWorkspaceShell(root);
  const selection = new SelectionModel(notebookId);
  const icon = (data.notebook as { icon_emoji?: string }).icon_emoji;
  const features = createWorkspaceFeatures({ notebookId, notebookTitle: data.notebook.title, notebookIcon: icon });
  // FR-WM-02: the header icon is the same picker as on the home card (saved through PATCH /icon).
  const headerIcon = icon ? renderIconPicker({ id: notebookId, title: data.notebook.title, icon_emoji: icon }, () => undefined, "workspace-notebook-icon") : null;
  headerIcon?.classList.add("workspace-notebook-icon");

  const deleteButton = h("button", { class: "btn btn-sm", "data-testid": "delete-notebook", text: "Delete" });
  const home = h("a", { class: "logo", href: "/", "data-testid": "home-link", text: "📓 Everlast LM" });
  home.addEventListener("click", (event) => {
    event.preventDefault();
    options.goHome();
  });
  const signOut = h("button", { class: "btn btn-sm", "data-testid": "sign-out", text: "Sign out" });
  signOut.addEventListener("click", () => void options.session.signOut());
  shell.header.append(
    home,
    ...(headerIcon ? [headerIcon] : []),
    createTitleEditor(data.notebook, options.notebookMissing),
    h("div", { class: "grow" }),
    ...features.headerItems,
    deleteButton,
    h("span", { class: "user-profile", "data-testid": "user-profile", text: options.session.email ?? "Signed in" }),
    signOut
  );
  shell.header.after(features.settingsPanel);
  deleteButton.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Delete notebook?", body: "This notebook, its sources and chat history will be permanently deleted.", confirm: "Delete", danger: true });
    if (!ok) return;
    try {
      await api(`/api/notebooks/${notebookId}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        toast("Could not delete the notebook.");
        return;
      }
    }
    options.goHome();
  });

  let sources: ReturnType<typeof createSourcesPanel>;
  let notesPanel: ReturnType<typeof createNotesPanel> | null = null;
  let studioPanel: ReturnType<typeof createStudioPanel> | null = null;
  const inspector = createInspector({
    notebookId,
    onClose: () => {
      shell.setLeftWide(false);
      sources.element.hidden = false;
    },
    onOpened: (source, slot, viaCitation) => features.onSourceOpened(source, slot, viaCitation),
    // FR-SI-05: a committed re-sync changes the revision; the list and history citations ("Source updated") refresh.
    onSynced: () => {
      void sources.refresh();
      void chat.load();
    },
  });
  const openCitation = (sourceId: string, chunkId: string) => {
    shell.revealSources();
    shell.setLeftWide(true);
    sources.element.hidden = true;
    void inspector.open(sourceId, chunkId);
  };
  const chat = createChatPanel({
    notebookId,
    selection,
    onNotebookMissing: options.notebookMissing,
    onCitationClick: (citation) => openCitation(citation.source_id, citation.chunk_id),
    tools: features.chatTools,
    intro: features.chatIntro,
    decorateAnswer: (bubble, message, fresh) => features.decorateAnswer(bubble, message, fresh),
    aboveInput: features.followUpBar,
    onStreamStart: () => features.onStreamStart(),
    onStreamEnd: () => features.onStreamEnd(),
    hasSources: () => (sources ? sources.sources().length > 0 : true),
  });
  sources = createSourcesPanel({
    notebookId,
    selection,
    onSelectionChange: () => {
      chat.updateSelection();
      features.onSelectionChange(sources.sources(), selection.ids());
      notesPanel?.updateSourceSelection();
      studioPanel?.updateSourceSelection();
    },
    onNotebookMissing: options.notebookMissing,
    onOpenSource: (sourceId) => {
      shell.setLeftWide(true);
      sources.element.hidden = true;
      void inspector.open(sourceId, null);
    },
    // FR-SI-05: rename updates tooltips; removal makes history citations "Source deleted" immediately.
    onSourceChanged: (sourceId, change) => {
      if (change === "removed") inspector.closeIf(sourceId);
      void chat.load();
    },
  });
  // Right Panel notes pinboard (FR-NM-01..04). A converted note becomes a v1 source: this browser selects it.
  const notes = createNotesPanel({
    notebookId,
    fetcher: authFetch,
    openCitation,
    onSourceCreated: async (sourceId) => {
      selection.markImported(sourceId);
      await sources.refresh();
    },
    selectedSourceIds: () => selection.ids(),
    onAssistantMessages: (messages) => chat.append(messages),
  });
  notesPanel = notes;
  // Studio reports (FR-ST-10/11) below the notes pinboard. Requests carry the current explicit selection (C-02); a
  // report converted to a source is selected in this browser, the same as a converted note (FR-NM-03).
  const studio = createStudioPanel({
    notebookId,
    fetcher: authFetch,
    selectedSourceIds: () => selection.ids(),
    openCitation,
    onSourceCreated: async (sourceId) => {
      selection.markImported(sourceId);
      await sources.refresh();
    },
    onAssistantMessages: (messages) => chat.append(messages),
    onAskChat: (text) => chat.ask(text),
  });
  studioPanel = studio;
  shell.left.append(sources.element, inspector.element);
  shell.center.append(chat.element);
  shell.right.append(notes.element, studio.element);

  features.bind({
    ask: (text) => chat.ask(text),
    studio: shell.right,
    openCitation,
    onSavedNote: (note) => notes.showSavedNote(note),
    onGenerateMindmap: () => void studio.generateMindmap(),
  });
  await Promise.all([sources.refresh(), chat.load(), notes.refresh(), studio.refresh()]);
  chat.markReady();
  features.onSelectionChange(sources.sources(), selection.ids());
  if (options.openAddSources) sources.openAddSources();
  return () => {
    chat.destroy();
    studio.destroy();
    shell.destroy();
  };
}
