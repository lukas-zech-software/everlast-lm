import { beforeEach, describe, expect, it } from "vitest";
import { createNotebook, getNotebookRaw, resetNotebookStore } from "../src/notebooks.js";
import { resetQuotaStore, reserveSourceSlot, transitionSourceStatus } from "../src/quota.js";
import {
  buildNotebookOverview,
  getOwnerNotebookPreferences,
  recordNotebookOpened,
  resetWorkspacePreferenceStore,
  setNotebookIcon,
  setNotebookPinned,
  setTopicIconIfDefault,
  sortNotebookOverview,
  touchNotebookModified,
} from "../src/workspace-preferences.js";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

async function makeNotebook(owner = OWNER_A, title = "Notebook") {
  return createNotebook(undefined, owner, { title });
}

beforeEach(() => {
  resetNotebookStore();
  resetQuotaStore();
  resetWorkspacePreferenceStore();
});

describe("Package 2.1 workspace repository (FR-WM-02, FR-WM-03)", () => {
  it("isolates pin and last-opened preferences by owner and notebook", async () => {
    const notebook = await makeNotebook();
    await setNotebookPinned(OWNER_A, notebook.id, true);
    const opened = await recordNotebookOpened(OWNER_A, notebook.id, "2026-10-19T12:00:00.000Z");
    const otherNotebook = await makeNotebook(OWNER_B, "Other owner");
    const otherOwner = await getOwnerNotebookPreferences(OWNER_B, otherNotebook.id);
    expect(opened.is_pinned).toBe(true);
    expect(opened.last_opened_at).toBe("2026-10-19T12:00:00.000Z");
    expect(otherOwner.is_pinned).toBe(false);
    expect(otherOwner.last_opened_at).toBeNull();
  });

  it("records an open event without modifying notebook content timestamp", async () => {
    const notebook = await makeNotebook();
    const before = getNotebookRaw(notebook.id)!.updated_at;
    await recordNotebookOpened(OWNER_A, notebook.id, "2026-10-19T12:00:00.000Z");
    expect(getNotebookRaw(notebook.id)!.updated_at).toBe(before);
  });

  it("keeps pinned notebooks first under each sort and gives deterministic ID ties", async () => {
    const notebooks = await Promise.all([
      makeNotebook(OWNER_A, "Zeta"),
      makeNotebook(OWNER_A, "Alpha"),
      makeNotebook(OWNER_A, "Beta"),
    ]);
    const [zeta, alpha, beta] = notebooks;
    expect(zeta && alpha && beta).toBeTruthy();
    await setNotebookPinned(OWNER_A, beta!.id, true);
    const items = await buildNotebookOverview(OWNER_A, notebooks);
    for (const order of ["recent", "title_asc", "created_desc"] as const) {
      expect(sortNotebookOverview(items, order)[0]?.id).toBe(beta!.id);
    }
    const tied = items.map((item) => ({ ...item, is_pinned: false, created_at: "2026-01-01T00:00:00.000Z", last_opened_at: null }));
    expect(sortNotebookOverview(tied, "created_desc").map(({ id }) => id)).toEqual([...tied.map(({ id }) => id).sort()]);
  });

  it("derives Ready-only source count and leaves failed/in-flight records out", async () => {
    const notebook = await makeNotebook();
    await reserveSourceSlot(undefined, { attempt_id: "ready", notebook_id: notebook.id, declared_byte_size: 1, file_name: "ready.pdf", mime_type: "application/pdf" });
    await reserveSourceSlot(undefined, { attempt_id: "processing", notebook_id: notebook.id, declared_byte_size: 1, file_name: "processing.pdf", mime_type: "application/pdf" });
    await reserveSourceSlot(undefined, { attempt_id: "failed", notebook_id: notebook.id, declared_byte_size: 1, file_name: "failed.pdf", mime_type: "application/pdf" });
    await transitionSourceStatus(undefined, notebook.id, "ready", "Ready");
    await transitionSourceStatus(undefined, notebook.id, "processing", "Processing");
    await transitionSourceStatus(undefined, notebook.id, "failed", "Failed");
    const [item] = await buildNotebookOverview(OWNER_A, [notebook]);
    expect(item?.ready_source_count).toBe(1);
  });

  it("accepts a topic icon only while default and never overwrites a custom icon", async () => {
    const notebook = await makeNotebook();
    expect(await setTopicIconIfDefault(notebook.id, "🧬")).toBe(true);
    expect(await setNotebookIcon(OWNER_A, notebook.id, "🪐")).toBe(true);
    expect(await setTopicIconIfDefault(notebook.id, "🌱")).toBe(false);
    const [item] = await buildNotebookOverview(OWNER_A, [notebook]);
    expect(item?.icon_emoji).toBe("🪐");
    expect(item?.icon_source).toBe("custom");
  });

  it("updates last-modified time for shared source/note/artifact writes but not an open event", async () => {
    const notebook = await makeNotebook();
    const initial = getNotebookRaw(notebook.id)!.updated_at;
    const added = await reserveSourceSlot(undefined, { attempt_id: "new-source", notebook_id: notebook.id, declared_byte_size: 1, file_name: "new.pdf", mime_type: "application/pdf" });
    expect(added.admitted).toBe(true);
    const afterSource = getNotebookRaw(notebook.id)!.updated_at;
    expect(Date.parse(afterSource)).toBeGreaterThan(Date.parse(initial));
    await recordNotebookOpened(OWNER_A, notebook.id, "2026-10-19T12:00:00.000Z");
    expect(getNotebookRaw(notebook.id)!.updated_at).toBe(afterSource);
    await touchNotebookModified(notebook.id);
    expect(Date.parse(getNotebookRaw(notebook.id)!.updated_at)).toBeGreaterThan(Date.parse(afterSource));
  });
});
