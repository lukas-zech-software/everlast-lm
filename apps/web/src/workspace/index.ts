import { api, ApiError } from "../lib/api.ts";
import { confirmDialog, h, toast } from "../lib/dom.ts";
import { SelectionModel } from "../lib/selection.ts";
import type { NotebookDto, QuotaSummary } from "../lib/types.ts";
import type { Session } from "../lib/auth.ts";
import { createWorkspaceShell } from "./layout.ts";
import { createTitleEditor } from "./title.ts";
import { createSourcesPanel } from "../sources/panel.ts";
import { createInspector } from "../sources/inspector.ts";
import { createChatPanel } from "../chat/panel.ts";

/** Notebook workspace (FR-UI-01) wiring sources, inspector, chat and the v1 Studio placeholder. */

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
    createTitleEditor(data.notebook, options.notebookMissing),
    h("div", { class: "grow" }),
    deleteButton,
    h("span", { class: "user-profile", "data-testid": "user-profile", text: options.session.email ?? "Signed in" }),
    signOut
  );
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
  const inspector = createInspector({
    notebookId,
    onClose: () => {
      shell.setLeftWide(false);
      sources.element.hidden = false;
    },
  });
  const chat = createChatPanel({
    notebookId,
    selection,
    onNotebookMissing: options.notebookMissing,
    onCitationClick: (citation) => {
      shell.revealSources();
      shell.setLeftWide(true);
      sources.element.hidden = true;
      void inspector.open(citation.source_id, citation.chunk_id);
    },
  });
  sources = createSourcesPanel({
    notebookId,
    selection,
    onSelectionChange: () => chat.updateSelection(),
    onNotebookMissing: options.notebookMissing,
    onOpenSource: (sourceId) => {
      shell.setLeftWide(true);
      sources.element.hidden = true;
      void inspector.open(sourceId, null);
    },
  });
  shell.left.append(sources.element, inspector.element);
  shell.center.append(chat.element);
  shell.right.append(h("p", { class: "studio-placeholder muted", "data-testid": "studio-placeholder", text: "Notes and Studio tools will appear here" }));

  await Promise.all([sources.refresh(), chat.load()]);
  if (options.openAddSources) sources.openAddSources();
  return () => shell.destroy();
}
