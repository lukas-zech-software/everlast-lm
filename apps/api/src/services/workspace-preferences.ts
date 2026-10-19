import {
  InputLanguageSchema,
  resolveOutputLanguage,
  type Notebook,
  type NotebookSortOrder,
  type OwnerNotebookPreferences,
  type OwnerWorkspacePreferences,
} from "@everlast/contracts";
import {
  buildNotebookOverview,
  getNotebookMetadata,
  getNotebookRaw,
  getOwnerNotebookPreferences,
  getOwnerWorkspacePreferences,
  getReadySourceCount,
  patchOwnerNotebookPreferences,
  patchOwnerWorkspacePreferences,
  recordNotebookOpened,
  setNotebookIcon,
  setNotebookPinned,
  sortNotebookOverview,
  type NotebookOverviewItem,
} from "@everlast/db";

/**
 * Package 2.1 workspace comfort service (FR-WM-02, FR-WM-03, FR-UI-02). Preferences, icons and pins live in the
 * in-memory PoC stores (D16); the notebook rows themselves come from PostgreSQL through the API, which has
 * already authorized the caller and mirrored the notebook into the PoC bridge.
 */
export class WorkspacePreferencesService {
  getNotebookRaw(notebookId: string): Notebook | null {
    return getNotebookRaw(notebookId);
  }

  /** Adds icon, Ready count and the caller's pin/last-opened state to PostgreSQL notebook rows, then sorts. */
  async overview(ownerId: string, notebooks: Notebook[], requestedSort?: NotebookSortOrder): Promise<NotebookOverviewItem[]> {
    const preferences = await getOwnerWorkspacePreferences(ownerId);
    const items = await buildNotebookOverview(ownerId, notebooks);
    return sortNotebookOverview(items, requestedSort ?? preferences.sort_order);
  }

  async decorate(ownerId: string, notebook: Notebook): Promise<NotebookOverviewItem> {
    const [metadata, preference, readyCount] = await Promise.all([
      getNotebookMetadata(notebook.id),
      getOwnerNotebookPreferences(ownerId, notebook.id),
      getReadySourceCount(notebook.id),
    ]);
    return {
      ...notebook,
      icon_emoji: metadata.icon_emoji,
      icon_source: metadata.icon_source,
      ready_source_count: readyCount,
      is_pinned: preference.is_pinned,
      last_opened_at: preference.last_opened_at,
      owner_role: "Owner",
    };
  }

  updateNotebookIcon(ownerId: string, notebookId: string, icon: string): Promise<boolean> {
    return setNotebookIcon(ownerId, notebookId, icon);
  }

  markNotebookOpened(ownerId: string, notebookId: string): Promise<OwnerNotebookPreferences> {
    return recordNotebookOpened(ownerId, notebookId);
  }

  pinNotebook(ownerId: string, notebookId: string, isPinned: boolean): Promise<OwnerNotebookPreferences> {
    return setNotebookPinned(ownerId, notebookId, isPinned);
  }

  getOwnerPreferences(ownerId: string): Promise<OwnerWorkspacePreferences> {
    return getOwnerWorkspacePreferences(ownerId);
  }

  patchOwnerPreferences(
    ownerId: string,
    patch: Partial<Omit<OwnerWorkspacePreferences, "owner_id">>
  ): Promise<OwnerWorkspacePreferences> {
    return patchOwnerWorkspacePreferences(ownerId, patch);
  }

  getNotebookPreferences(ownerId: string, notebookId: string): Promise<OwnerNotebookPreferences> {
    return getOwnerNotebookPreferences(ownerId, notebookId);
  }

  patchNotebookPreferences(
    ownerId: string,
    notebookId: string,
    patch: Partial<Omit<OwnerNotebookPreferences, "owner_id" | "notebook_id" | "last_opened_at">>
  ): Promise<OwnerNotebookPreferences> {
    return patchOwnerNotebookPreferences(ownerId, notebookId, patch);
  }

  /** Input/output language precedence: job → personal override → notebook default → user default → browser. */
  async resolveLanguagePreferences(
    ownerId: string,
    notebookId: string,
    browserLocale?: string,
    jobInputLanguage?: string,
    jobOutputLanguage?: string
  ): Promise<{ input_language: string; output_language: string }> {
    const [user, notebook] = await Promise.all([
      getOwnerWorkspacePreferences(ownerId),
      getOwnerNotebookPreferences(ownerId, notebookId),
    ]);
    const inputCandidates = [
      jobInputLanguage,
      notebook.input_language_override,
      notebook.notebook_input_language,
      user.input_language,
      "auto",
    ];
    const inputLanguage = inputCandidates.find((c) => c && InputLanguageSchema.safeParse(c).success) ?? "auto";
    return {
      input_language: inputLanguage,
      output_language: resolveOutputLanguage({
        jobLanguage: jobOutputLanguage ?? null,
        personalOverride: notebook.output_language_override,
        notebookDefault: notebook.notebook_output_language,
        userDefault: user.output_language,
        browserLocale: browserLocale ?? null,
      }),
    };
  }
}
