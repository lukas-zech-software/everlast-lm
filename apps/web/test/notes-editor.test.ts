import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NoteEditorSession, type DraftStore, type NoteDraft } from "../src/notes/editor-session.js";
import { orderNotes, conversionState, togglePinboardSelection } from "../src/notes/pinboard.js";

function memoryDrafts(): DraftStore & { map: Map<string, NoteDraft> } {
  const map = new Map<string, NoteDraft>();
  return {
    map,
    save: (id, d) => void map.set(id, d),
    load: (id) => map.get(id) ?? null,
    clear: (id) => void map.delete(id),
  };
}

describe("FR-NM-01: note editor auto-save", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces 500 ms, saves within the 1 s deadline and reports saved", async () => {
    const patch = vi.fn(async () => ({ revision: 2 }));
    const s = new NoteEditorSession({ noteId: "n1", revision: 1, api: { patchNote: patch }, drafts: memoryDrafts() });
    s.edit({ content_md: "a" });
    s.edit({ content_md: "ab" });
    expect(s.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(499);
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("n1", { content_md: "ab", base_revision: 1 });
    expect(s.status).toBe("saved");
    expect(s.revision).toBe(2);
  });

  it("flushes pending edits on close before reporting success", async () => {
    const patch = vi.fn(async () => ({ revision: 2 }));
    const drafts = memoryDrafts();
    const s = new NoteEditorSession({ noteId: "n1", revision: 1, api: { patchNote: patch }, drafts });
    s.edit({ title: "Key Audit Findings" });
    await expect(s.close()).resolves.toEqual({ ok: true });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(drafts.map.size).toBe(0);
  });

  it("keeps a recoverable draft and shows error when the save fails; close is not successful", async () => {
    const drafts = memoryDrafts();
    const s = new NoteEditorSession({
      noteId: "n1", revision: 1, drafts,
      api: { patchNote: async () => { throw new Error("offline"); } },
    });
    s.edit({ content_md: "unsaved" });
    await expect(s.close()).resolves.toEqual({ ok: false });
    expect(s.status).toBe("error");
    expect(drafts.load("n1")).toMatchObject({ content_md: "unsaved" });

    const patch = vi.fn(async () => ({ revision: 2 }));
    const next = new NoteEditorSession({ noteId: "n1", revision: 1, api: { patchNote: patch }, drafts });
    expect(next.recoverDraft()).toBe(true);
    expect(next.status).toBe("pending");
    await next.close();
    expect(patch).toHaveBeenCalledWith("n1", { content_md: "unsaved", base_revision: 1 });
  });
});

describe("FR-NM-01, FR-NM-03: pinboard helpers", () => {
  const n = (id: string, order: number, content = "x") => ({ id, display_order: order, content_md: content });

  it("orders by display_order", () => {
    expect(orderNotes([n("b", 2), n("a", 1)]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("disables conversion for blank bodies or a full source quota", () => {
    expect(conversionState([n("a", 1)], { used: 0, limit: 50 })).toEqual({ enabled: true });
    expect(conversionState([n("a", 1, "  ")], { used: 0, limit: 50 })).toMatchObject({ enabled: false });
    expect(conversionState([n("a", 1)], { used: 50, limit: 50 })).toEqual({ enabled: false, tooltip: "Source limit reached" });
    expect(conversionState([], { used: 0, limit: 50 })).toMatchObject({ enabled: false });
  });

  it("caps note selection at 50", () => {
    let sel: string[] = [];
    for (let i = 0; i < 50; i++) sel = togglePinboardSelection(sel, `n${i}`, 50);
    expect(sel).toHaveLength(50);
    expect(togglePinboardSelection(sel, "extra", 50)).toHaveLength(50);
    expect(togglePinboardSelection(sel, "n0", 50)).toHaveLength(49);
  });
});
