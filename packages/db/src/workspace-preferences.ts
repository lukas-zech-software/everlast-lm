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
import type { Pool } from "pg";
import { getNotebookRaw, getNotebookRecord, getReadySourceCount, getReadySourceCounts, onNotebookForgotten } from "./poc-bridge.ts";
import { v2Pool } from "./v2-persistence.ts";

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

async function ensureNotebookOwner(ownerId: string, notebookId: string): Promise<Notebook> {
  const notebook = await getNotebookRecord(notebookId);
  if (!notebook || notebook.owner_id !== ownerId || notebook.archived_at) {
    throw new NotebookPreferenceScopeError();
  }
  return notebook;
}

// ---- PostgreSQL (specs/013, DEV-04 closed): notebook_v2_metadata, user_preferences, notebook_user_preferences --

interface MetadataRow {
  icon_emoji: string;
  icon_source: NotebookMetadata["icon_source"];
  topic_selection_attempted: boolean;
}
const DEFAULT_METADATA_ROW: MetadataRow = { icon_emoji: DEFAULT_NOTEBOOK_ICON, icon_source: "default", topic_selection_attempted: false };

async function pgMetadata(pool: Pool, notebookIds: string[]): Promise<Map<string, MetadataRow>> {
  const { rows } = await pool.query<MetadataRow & { notebook_id: string }>(
    "SELECT notebook_id, icon_emoji, icon_source, topic_selection_attempted FROM notebook_v2_metadata WHERE notebook_id = ANY($1::uuid[])",
    [notebookIds]
  );
  return new Map(rows.map((r) => [r.notebook_id, { icon_emoji: r.icon_emoji, icon_source: r.icon_source, topic_selection_attempted: r.topic_selection_attempted }]));
}

async function pgNotebookPreferences(pool: Pool, ownerId: string, notebookIds: string[]): Promise<Map<string, OwnerNotebookPreferences>> {
  const { rows } = await pool.query<{ notebook_id: string; record: unknown }>(
    "SELECT notebook_id, record FROM notebook_user_preferences WHERE user_id = $1 AND notebook_id = ANY($2::uuid[])",
    [ownerId, notebookIds]
  );
  const stored = new Map(rows.map((r) => [r.notebook_id, r.record]));
  return new Map(
    notebookIds.map((id) => [id, OwnerNotebookPreferencesSchema.parse({ ...(stored.get(id) as object | undefined), owner_id: ownerId, notebook_id: id })])
  );
}

async function pgSaveNotebookPreferences(pool: Pool, value: OwnerNotebookPreferences): Promise<void> {
  await pool.query(
    `INSERT INTO notebook_user_preferences (user_id, notebook_id, record) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, notebook_id) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
    [value.owner_id, value.notebook_id, JSON.stringify(value)]
  );
}

export function resetWorkspacePreferenceStore(): void {
  metadataStore.clear();
  ownerPreferencesStore.clear();
  notebookPreferencesStore.clear();
}

export async function getNotebookMetadata(notebookId: string): Promise<NotebookMetadata> {
  const pool = v2Pool();
  if (pool) {
    if (!(await getNotebookRecord(notebookId))) return { ...DEFAULT_METADATA_ROW, ready_source_count: 0 };
    const row = (await pgMetadata(pool, [notebookId])).get(notebookId) ?? DEFAULT_METADATA_ROW;
    return { ...row, ready_source_count: await getReadySourceCount(notebookId) };
  }
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
  const pool = v2Pool();
  if (pool) {
    // One query per store for the whole list; the caller listed only this owner's notebooks from PostgreSQL.
    const ids = notebooks.map((n) => n.id);
    const [metadata, preferences, ready] = await Promise.all([pgMetadata(pool, ids), pgNotebookPreferences(pool, ownerId, ids), getReadySourceCounts(ids)]);
    return notebooks.map((notebook) => {
      const meta = metadata.get(notebook.id) ?? DEFAULT_METADATA_ROW;
      const pref = preferences.get(notebook.id)!;
      return {
        ...notebook,
        icon_emoji: meta.icon_emoji,
        icon_source: meta.icon_source,
        ready_source_count: ready.get(notebook.id) ?? 0,
        is_pinned: pref.is_pinned,
        last_opened_at: pref.last_opened_at,
        owner_role: "Owner" as const,
      };
    });
  }
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

/**
 * Pinned first, then the requested order (FR-WM-03). Title order is case-insensitive through an `Intl.Collator`
 * for the UI locale; equal titles (and every other tie) fall back to `created_at` descending, then `id`.
 */
export function sortNotebookOverview<T extends NotebookOverviewItem>(items: T[], order: NotebookSortOrder, locale?: string): T[] {
  const timestamp = (value: string | null, fallback: string) => Date.parse(value ?? fallback) || 0;
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    let comparison = 0;
    if (order === "title_asc") {
      comparison = collator.compare(a.title, b.title);
    } else if (order === "recent") {
      comparison = timestamp(b.last_opened_at, b.created_at) - timestamp(a.last_opened_at, a.created_at);
    }
    return comparison || timestamp(b.created_at, "") - timestamp(a.created_at, "") || a.id.localeCompare(b.id);
  });
}

function monotonicTimestamp(previous?: string): string {
  const now = Date.now();
  const last = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, last + 1)).toISOString();
}

export async function touchNotebookModified(notebookId: string): Promise<string | null> {
  const pool = v2Pool();
  if (pool) {
    // FR-WM-03: a v2 content change is the notebook's content modification; strictly increasing per notebook.
    const { rows } = await pool.query<{ updated_at: Date }>(
      "UPDATE notebooks SET updated_at = greatest(now(), updated_at + interval '1 millisecond') WHERE id = $1 RETURNING updated_at",
      [notebookId]
    );
    return rows[0]?.updated_at.toISOString() ?? null;
  }
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) return null;
  notebook.updated_at = monotonicTimestamp(notebook.updated_at);
  return notebook.updated_at;
}

export async function setNotebookIcon(ownerId: string, notebookId: string, icon: string): Promise<boolean> {
  await ensureNotebookOwner(ownerId, notebookId);
  const valid = NotebookIconSchema.parse(icon);
  const pool = v2Pool();
  if (pool) {
    await pool.query(
      `INSERT INTO notebook_v2_metadata (notebook_id, icon_emoji, icon_source, topic_selection_attempted) VALUES ($1, $2, 'custom', true)
       ON CONFLICT (notebook_id) DO UPDATE SET icon_emoji = EXCLUDED.icon_emoji, icon_source = 'custom', topic_selection_attempted = true`,
      [notebookId, valid]
    );
    await touchNotebookModified(notebookId);
    return true;
  }
  const metadata = getMetadataRecord(notebookId);
  metadata.icon_emoji = valid;
  metadata.icon_source = "custom";
  metadata.topic_selection_attempted = true;
  await touchNotebookModified(notebookId);
  return true;
}

export async function claimTopicIconSelection(notebookId: string): Promise<boolean> {
  const pool = v2Pool();
  if (pool) {
    // FR-009: one conditional upsert; exactly one concurrent caller gets the row back.
    const { rowCount } = await pool.query(
      `INSERT INTO notebook_v2_metadata (notebook_id, topic_selection_attempted)
       SELECT id, true FROM notebooks WHERE id = $1
       ON CONFLICT (notebook_id) DO UPDATE SET topic_selection_attempted = true
       WHERE notebook_v2_metadata.topic_selection_attempted = false AND notebook_v2_metadata.icon_source = 'default'`,
      [notebookId]
    );
    return (rowCount ?? 0) > 0;
  }
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) return false;
  const metadata = getMetadataRecord(notebookId);
  if (metadata.topic_selection_attempted || metadata.icon_source !== "default") return false;
  metadata.topic_selection_attempted = true;
  return true;
}

export async function setTopicIconIfDefault(notebookId: string, icon: string): Promise<boolean> {
  const valid = NotebookIconSchema.safeParse(icon);
  const pool = v2Pool();
  if (pool) {
    if (!valid.success) return false;
    const { rowCount } = await pool.query(
      `INSERT INTO notebook_v2_metadata (notebook_id, icon_emoji, icon_source, topic_selection_attempted)
       SELECT id, $2, 'topic', true FROM notebooks WHERE id = $1
       ON CONFLICT (notebook_id) DO UPDATE SET icon_emoji = EXCLUDED.icon_emoji, icon_source = 'topic', topic_selection_attempted = true
       WHERE notebook_v2_metadata.icon_source = 'default'`,
      [notebookId, valid.data]
    );
    if ((rowCount ?? 0) === 0) return false;
    await touchNotebookModified(notebookId);
    return true;
  }
  const notebook = getNotebookRaw(notebookId);
  if (!notebook || notebook.archived_at) return false;
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
  const pool = v2Pool();
  if (pool) {
    const { rows } = await pool.query<{ record: object }>("SELECT record FROM user_preferences WHERE user_id = $1", [ownerId]);
    return OwnerWorkspacePreferencesSchema.parse({ ...rows[0]?.record, owner_id: ownerId });
  }
  const existing = ownerPreferencesStore.get(ownerId);
  return OwnerWorkspacePreferencesSchema.parse(existing ?? { owner_id: ownerId });
}

export async function patchOwnerWorkspacePreferences(
  ownerId: string,
  patch: Partial<Omit<OwnerWorkspacePreferences, "owner_id">>
): Promise<OwnerWorkspacePreferences> {
  const current = await getOwnerWorkspacePreferences(ownerId);
  const updated = OwnerWorkspacePreferencesSchema.parse({ ...current, ...patch, owner_id: ownerId });
  const pool = v2Pool();
  if (pool) {
    await pool.query(
      `INSERT INTO user_preferences (user_id, record) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
      [ownerId, JSON.stringify(updated)]
    );
    return { ...updated };
  }
  ownerPreferencesStore.set(ownerId, updated);
  return { ...updated };
}

export async function getOwnerNotebookPreferences(ownerId: string, notebookId: string): Promise<OwnerNotebookPreferences> {
  await ensureNotebookOwner(ownerId, notebookId);
  const pool = v2Pool();
  if (pool) return (await pgNotebookPreferences(pool, ownerId, [notebookId])).get(notebookId)!;
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
  const pool = v2Pool();
  if (pool) {
    await pgSaveNotebookPreferences(pool, updated);
    return { ...updated };
  }
  notebookPreferencesStore.set(notebookPreferenceKey(ownerId, notebookId), updated);
  return { ...updated };
}

export async function setNotebookPinned(ownerId: string, notebookId: string, isPinned: boolean): Promise<OwnerNotebookPreferences> {
  return patchOwnerNotebookPreferences(ownerId, notebookId, { is_pinned: isPinned });
}

export async function recordNotebookOpened(ownerId: string, notebookId: string, at = new Date().toISOString()): Promise<OwnerNotebookPreferences> {
  const current = await getOwnerNotebookPreferences(ownerId, notebookId);
  const updated = OwnerNotebookPreferencesSchema.parse({ ...current, last_opened_at: at });
  const pool = v2Pool();
  if (pool) {
    await pgSaveNotebookPreferences(pool, updated);
    return { ...updated };
  }
  notebookPreferencesStore.set(notebookPreferenceKey(ownerId, notebookId), updated);
  return { ...updated };
}

export function resolveEffectiveOutputLanguage(input: OutputLanguageResolutionInput): string {
  return resolveOutputLanguage(input);
}

onNotebookForgotten((notebookId) => {
  metadataStore.delete(notebookId);
  for (const [key, value] of notebookPreferencesStore) {
    if (value.notebook_id === notebookId) notebookPreferencesStore.delete(key);
  }
});
