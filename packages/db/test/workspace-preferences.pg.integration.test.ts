import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildNotebookOverview,
  claimTopicIconSelection,
  configureV2Persistence,
  createNotebook,
  getNotebookMetadata,
  getNotebookRecord,
  getOwnerNotebookPreferences,
  getOwnerWorkspacePreferences,
  NotebookPreferenceScopeError,
  patchOwnerNotebookPreferences,
  patchOwnerWorkspacePreferences,
  recordNotebookOpened,
  resetWorkspacePreferenceStore,
  setNotebookIcon,
  setNotebookPinned,
  setTopicIconIfDefault,
} from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [013-v2-persistence-postgres] T017 — Package 2.1 stores over PostgreSQL (FR-WM-02, FR-WM-03, FR-UI-02,
 * FR-WM-04, FR-009). After every write the in-memory maps are cleared to prove the value came from PostgreSQL.
 */

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  configureV2Persistence(db.pool);
});
afterAll(async () => {
  configureV2Persistence(null);
  await db?.drop();
});

const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));
const notebookOf = async (owner: string, title = "NB") => (await createNotebook(db.pool, owner, { title })).notebook.id;

describe("FR-WM-02/03, FR-UI-02: workspace stores in PostgreSQL", () => {
  it("returns defaults without rows and round-trips owner and notebook preferences", async () => {
    const owner = await createTestUser(db.pool);
    const nb = await notebookOf(owner);
    expect(await getOwnerWorkspacePreferences(owner)).toEqual({ owner_id: owner, theme: "system", input_language: "auto", output_language: null });
    expect(await getOwnerNotebookPreferences(owner, nb)).toMatchObject({ is_pinned: false, last_opened_at: null, notebook_output_language: null });
    await patchOwnerWorkspacePreferences(owner, { theme: "dark", output_language: "de-DE" });
    await patchOwnerNotebookPreferences(owner, nb, { notebook_output_language: "fr-FR" });
    await setNotebookPinned(owner, nb, true);
    await recordNotebookOpened(owner, nb, "2026-10-21T08:00:00.000Z");
    resetWorkspacePreferenceStore();
    expect(await getOwnerWorkspacePreferences(owner)).toMatchObject({ theme: "dark", output_language: "de-DE" });
    expect(await getOwnerNotebookPreferences(owner, nb)).toMatchObject({ is_pinned: true, last_opened_at: "2026-10-21T08:00:00.000Z", notebook_output_language: "fr-FR" });
  });

  it("FR-WM-04: rejects another owner's notebook and a missing notebook", async () => {
    const owner = await createTestUser(db.pool);
    const other = await createTestUser(db.pool);
    const nb = await notebookOf(owner);
    await expect(getOwnerNotebookPreferences(other, nb)).rejects.toBeInstanceOf(NotebookPreferenceScopeError);
    await expect(setNotebookIcon(other, nb, "🧪")).rejects.toBeInstanceOf(NotebookPreferenceScopeError);
    await expect(getOwnerNotebookPreferences(owner, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(NotebookPreferenceScopeError);
  });

  it("FR-WM-02: custom icon persists, bumps the modified time and is never replaced by a topic icon", async () => {
    const owner = await createTestUser(db.pool);
    const nb = await notebookOf(owner);
    const before = (await getNotebookRecord(nb))!.updated_at;
    await setNotebookIcon(owner, nb, "🧪");
    resetWorkspacePreferenceStore();
    expect(await getNotebookMetadata(nb)).toMatchObject({ icon_emoji: "🧪", icon_source: "custom", topic_selection_attempted: true });
    expect(Date.parse((await getNotebookRecord(nb))!.updated_at)).toBeGreaterThan(Date.parse(before));
    expect(await claimTopicIconSelection(nb)).toBe(false);
    expect(await setTopicIconIfDefault(nb, "🌍")).toBe(false);
    expect((await getNotebookMetadata(nb)).icon_emoji).toBe("🧪");
  });

  it("FR-009: of two concurrent topic-icon claims exactly one wins; the topic icon is stored", async () => {
    const owner = await createTestUser(db.pool);
    const nb = await notebookOf(owner);
    const claims = await Promise.all([claimTopicIconSelection(nb), claimTopicIconSelection(nb)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await setTopicIconIfDefault(nb, "🌍")).toBe(true);
    resetWorkspacePreferenceStore();
    expect(await getNotebookMetadata(nb)).toMatchObject({ icon_emoji: "🌍", icon_source: "topic" });
  });

  it("FR-WM-03: the overview combines icon, Ready count, pin and last opened from PostgreSQL", async () => {
    const owner = await createTestUser(db.pool);
    const a = await notebookOf(owner, "A");
    const b = await notebookOf(owner, "B");
    await seedReadySource(db.pool, owner, a, { title: "S", mediaType: "text/plain", pages: ["x"], embed });
    await setNotebookPinned(owner, b, true);
    await setNotebookIcon(owner, a, "🧪");
    resetWorkspacePreferenceStore();
    const items = await buildNotebookOverview(owner, [(await getNotebookRecord(a))!, (await getNotebookRecord(b))!]);
    expect(items.find((i) => i.id === a)).toMatchObject({ icon_emoji: "🧪", icon_source: "custom", ready_source_count: 1, is_pinned: false });
    expect(items.find((i) => i.id === b)).toMatchObject({ icon_emoji: "📓", icon_source: "default", ready_source_count: 0, is_pinned: true });
  });
});
