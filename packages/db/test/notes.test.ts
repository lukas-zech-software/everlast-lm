import { describe, it, expect, beforeEach } from "vitest";
import {
  createNote,
  listNotes,
  getNote,
  updateNote,
  deleteNote,
  saveResponseAsNote,
  convertToEditable,
  deleteNotesForNotebook,
  resetNoteStore,
  NoteNotFoundError,
  NoteReadOnlyError,
  RevisionConflictError,
  NotSavedResponseError,
  registerSource,
  replaceSource,
  deleteSource,
  getNoteSource,
  getScopedContext,
  resetSourceRegistry,
  clearChatThread,
  getOrCreateChatThread,
  resetChatStore,
} from "@everlast/db";
import type { Citation, UnifiedDocumentChunk } from "@everlast/contracts";

const nb = "11111111-1111-4111-8111-111111111111";
const nb2 = "22222222-2222-4222-8222-222222222222";
const msg = "33333333-3333-4333-8333-333333333333";
const src = "44444444-4444-4444-8444-444444444444";
const owner = "usr_alice";

const citation: Citation = {
  badge_number: 1,
  source_id: src,
  source_title: "Spec.pdf",
  chunk_id: "018f6b40-0001-7000-8000-000000000001",
  snippet: "Port 8080 requires mTLS.",
  locator: { page_number: 1, start_offset: 0, end_offset: 10 },
};

beforeEach(() => {
  resetNoteStore();
  resetSourceRegistry();
  resetChatStore();
});

describe("FR-NM-01: manual note lifecycle", () => {
  it("creates with default title and increments revision and order", async () => {
    const a = await createNote(nb, owner, {});
    const b = await createNote(nb, owner, { title: "Second" });
    expect(a.title).toBe("New note");
    expect(a.revision).toBe(1);
    expect(b.display_order).toBeGreaterThan(a.display_order);
    const u = await updateNote(nb, owner, a.id, { content_md: "## Risk 1" });
    expect(u.revision).toBe(2);
    expect((await listNotes(nb, owner)).map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it("detects stale base_revision and isolates owners/notebooks", async () => {
    const a = await createNote(nb, owner, {});
    await updateNote(nb, owner, a.id, { title: "x" });
    await expect(updateNote(nb, owner, a.id, { title: "y", base_revision: 1 })).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await getNote(nb, "usr_bob", a.id)).toBeNull();
    expect(await getNote(nb2, owner, a.id)).toBeNull();
    await expect(updateNote(nb2, owner, a.id, { title: "z" })).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("permanently deletes and cascades with the notebook", async () => {
    const a = await createNote(nb, owner, {});
    expect(await deleteNote(nb, owner, a.id)).toBe(true);
    expect(await deleteNote(nb, owner, a.id)).toBe(false);
    await createNote(nb, owner, {});
    deleteNotesForNotebook(nb);
    expect(await listNotes(nb, owner)).toEqual([]);
  });
});

describe("FR-NM-02 / FR-GC-09: saved responses", () => {
  const save = () =>
    saveResponseAsNote(nb, owner, { message_id: msg, content: "Port 8080 requires mTLS [1]", citations: [citation] });

  it("is idempotent per (notebook, owner, message) and read-only", async () => {
    const first = await save();
    const second = await save();
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.note.id).toBe(first.note.id);
    expect((await listNotes(nb, owner)).length).toBe(1);
    await expect(updateNote(nb, owner, first.note.id, { title: "t" })).rejects.toBeInstanceOf(NoteReadOnlyError);
  });

  it("survives clearing chat", async () => {
    const { note } = await save();
    await getOrCreateChatThread(undefined, nb, owner);
    await clearChatThread(undefined, nb, owner);
    const kept = await getNote(nb, owner, note.id);
    expect(kept?.citations_json[0]?.source_title).toBe("Spec.pdf");
  });

  it("convert-to-editable makes an independent manual copy without badges", async () => {
    const { note } = await save();
    const copy = await convertToEditable(nb, owner, note.id);
    expect(copy.origin_type).toBe("manual");
    expect(copy.origin_note_id).toBe(note.id);
    expect(copy.content_md).toBe("Port 8080 requires mTLS");
    expect(copy.citations_json).toEqual([]);
    expect((await getNote(nb, owner, note.id))?.content_md).toContain("[1]");
    await expect(convertToEditable(nb, owner, copy.id)).rejects.toBeInstanceOf(NotSavedResponseError);
  });
});

describe("C-02: source registry", () => {
  const chunk = (revision: number): UnifiedDocumentChunk => ({
    chunk_id: "018f6b40-0001-7000-8000-00000000000" + revision,
    source_id: src,
    revision,
    locator: { selector: "h1", start_offset: 0, end_offset: 3 },
    token_count: 1,
    text: "rev" + revision,
  });

  it("serves only current-revision chunks of Ready sources in the notebook", async () => {
    await registerSource({
      id: src, notebook_id: nb, title: "T", media_type: "note_markdown", status: "Ready", revision_id: 1,
      byte_size: 1, word_count: 1, origin_notes: [{ note_id: msg, revision: 1, title: "n" }], created_at: new Date().toISOString(),
    }, [chunk(1)]);
    expect((await getScopedContext(nb, [src])).map((c) => c.text)).toEqual(["rev1"]);
    await expect(getScopedContext(nb2, [src])).rejects.toThrow();
    await replaceSource(nb, src, [chunk(2)]);
    expect((await getNoteSource(nb, src))?.revision_id).toBe(2);
    expect((await getScopedContext(nb, [src])).map((c) => c.text)).toEqual(["rev2"]);
    await deleteSource(nb, src);
    await expect(getScopedContext(nb, [src])).rejects.toThrow();
  });
});
