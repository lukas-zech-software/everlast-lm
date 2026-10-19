import {
  DEFAULT_NOTEBOOK_ICON,
  NotebookIconSchema,
  OwnerNotebookPreferencesSchema,
  OwnerWorkspacePreferencesSchema,
  resolveOutputLanguage,
  type Notebook,
  type NotebookMetadata,
  type NotebookSortOrder,
  type OwnerNotebookPreferences,
  type OwnerWorkspacePreferences,
  type OutputLanguageResolutionInput,
} from "@everlast/contracts";
import { getNotebookRaw } from "./notebooks.js";

export interface NotebookOverviewItem extends Notebook {
  icon_emoji: string;
  icon_source: "default" | "topic" | "custom";
  ready_source_count: number;
  is_pinned: boolean;
  last_opened_at: string | null;
  owner_role: "Owner";
}

export class NotebookPreferenceScopeError extends Error {
  constructor() {
    super("Notebook not found or not owned by caller");
    this.name = "NotebookPreferenceScopeError";
  }
}

const metadataStore = new Map<string, NotebookMetadata>();
const ownerPreferencesStore = new Map<string, OwnerWorkspacePreferences>();
const notebookPreferencesStore = new Map<string, OwnerNotebookPreferences>();

function getMetadataRecord(notebookId: string): NotebookMetadata {
  let value = metadataStore.get(notebookId);
  if (!value) {
    value = {
      icon_emoji: DEFAULT_NOTEBOOK_ICON,
      icon_source: "default",
      ready_source_count: 0,
      topic_selection_attempted: false,
    };
    metadataStore.set(notebookId, value);
  }
  return value;
}

function notebookPreferenceKey(ownerId: string, notebookId: string): string {
  return `${ownerId}\u0000${notebookId}`;
}

function ensureNotebookOwner(ownerId: string, notebookId: string): Notebook {
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.owner_id !== ownerId || notebook.archived_at) {
    throw new NotebookPreferenceScopeError();
  }
  return notebook;
}

export function resetWorkspacePreferenceStore(): void {
  metadataStore.clear();
  ownerPreferencesStore.clear();
  notebookPreferencesStore.clear();
}

export async function getNotebookMetadata(notebookId: string): Promise<NotebookMetadata> {
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) {
    return {
      icon_emoji: DEFAULT_NOTEBOOK_ICON,
      icon_source: "default",
      ready_source_count: 0,
      topic_selection_attempted: false,
    };
  }
  return { ...getMetadataRecord(notebookId) };
}

export async function buildNotebookOverview(ownerId: string, notebooks: Notebook[]): Promise<NotebookOverviewItem[]> {
  const { getReadySourceCount } = await import("./quota.js");
  const items = await Promise.all(notebooks.map(async (notebook) => {
    const metadata = getMetadataRecord(notebook.id);
    const preferences = await getOwnerNotebookPreferences(ownerId, notebook.id);
    const readyCount = await getReadySourceCount(notebook.id);
    metadata.ready_source_count = readyCount;
    return {
      ...notebook,
      icon_emoji: metadata.icon_emoji,
      icon_source: metadata.icon_source,
      ready_source_count: readyCount,
      is_pinned: preferences.is_pinned,
      last_opened_at: preferences.last_opened_at,
      owner_role: "Owner" as const,
    };
  }));
  return items;
}

export function sortNotebookOverview<T extends NotebookOverviewItem>(items: T[], order: NotebookSortOrder): T[] {
  const timestamp = (value: string | null, fallback: string) => Date.parse(value ?? fallback) || 0;
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    let comparison = 0;
    if (order === "title_asc") {
      comparison = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    } else if (order === "created_desc") {
      comparison = timestamp(b.created_at, "") - timestamp(a.created_at, "");
    } else {
      comparison = timestamp(b.last_opened_at, b.created_at) - timestamp(a.last_opened_at, a.created_at);
    }
    return comparison || a.id.localeCompare(b.id);
  });
}

function monotonicTimestamp(previous?: string): string {
  const now = Date.now();
  const last = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, last + 1)).toISOString();
}

export async function touchNotebookModified(notebookId: string): Promise<string | null> {
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) return null;
  notebook.updated_at = monotonicTimestamp(notebook.updated_at);
  return notebook.updated_at;
}

export async function setNotebookIcon(ownerId: string, notebookId: string, icon: string): Promise<boolean> {
  ensureNotebookOwner(ownerId, notebookId);
  const valid = NotebookIconSchema.parse(icon);
  const metadata = getMetadataRecord(notebookId);
  metadata.icon_emoji = valid;
  metadata.icon_source = "custom";
  metadata.topic_selection_attempted = true;
  await touchNotebookModified(notebookId);
  return true;
}

export async function claimTopicIconSelection(notebookId: string): Promise<boolean> {
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) return false;
  const metadata = getMetadataRecord(notebookId);
  if (metadata.topic_selection_attempted || metadata.icon_source !== "default") return false;
  metadata.topic_selection_attempted = true;
  return true;
}

export async function setTopicIconIfDefault(notebookId: string, icon: string): Promise<boolean> {
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) return false;
  const valid = NotebookIconSchema.safeParse(icon);
  if (!valid.success) return false;
  const metadata = getMetadataRecord(notebookId);
  if (metadata.icon_source !== "default") return false;
  metadata.icon_emoji = valid.data;
  metadata.icon_source = "topic";
  metadata.topic_selection_attempted = true;
  await touchNotebookModified(notebookId);
  return true;
}

export async function getOwnerWorkspacePreferences(ownerId: string): Promise<OwnerWorkspacePreferences> {
  const existing = ownerPreferencesStore.get(ownerId);
  return OwnerWorkspacePreferencesSchema.parse(existing ?? { owner_id: ownerId });
}

export async function patchOwnerWorkspacePreferences(
  ownerId: string,
  patch: Partial<Omit<OwnerWorkspacePreferences, "owner_id">>
): Promise<OwnerWorkspacePreferences> {
  const current = await getOwnerWorkspacePreferences(ownerId);
  const updated = OwnerWorkspacePreferencesSchema.parse({ ...current, ...patch, owner_id: ownerId });
  ownerPreferencesStore.set(ownerId, updated);
  return { ...updated };
}

export async function getOwnerNotebookPreferences(ownerId: string, notebookId: string): Promise<OwnerNotebookPreferences> {
  ensureNotebookOwner(ownerId, notebookId);
  const key = notebookPreferenceKey(ownerId, notebookId);
  const existing = notebookPreferencesStore.get(key);
  return OwnerNotebookPreferencesSchema.parse(existing ?? { owner_id: ownerId, notebook_id: notebookId });
}

export async function patchOwnerNotebookPreferences(
  ownerId: string,
  notebookId: string,
  patch: Partial<Omit<OwnerNotebookPreferences, "owner_id" | "notebook_id" | "last_opened_at">>
): Promise<OwnerNotebookPreferences> {
  const current = await getOwnerNotebookPreferences(ownerId, notebookId);
  const updated = OwnerNotebookPreferencesSchema.parse({ ...current, ...patch, owner_id: ownerId, notebook_id: notebookId });
  notebookPreferencesStore.set(notebookPreferenceKey(ownerId, notebookId), updated);
  return { ...updated };
}

export async function setNotebookPinned(ownerId: string, notebookId: string, isPinned: boolean): Promise<OwnerNotebookPreferences> {
  return patchOwnerNotebookPreferences(ownerId, notebookId, { is_pinned: isPinned });
}

export async function recordNotebookOpened(ownerId: string, notebookId: string, at = new Date().toISOString()): Promise<OwnerNotebookPreferences> {
  const current = await getOwnerNotebookPreferences(ownerId, notebookId);
  const updated = OwnerNotebookPreferencesSchema.parse({ ...current, last_opened_at: at });
  notebookPreferencesStore.set(notebookPreferenceKey(ownerId, notebookId), updated);
  return { ...updated };
}

export function resolveEffectiveOutputLanguage(input: OutputLanguageResolutionInput): string {
  return resolveOutputLanguage(input);
}
