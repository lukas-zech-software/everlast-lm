import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configureV2Persistence,
  convertToEditable,
  createNote,
  createNotebook,
  deleteNote,
  getNote,
  listNotes,
  NoteNotFoundError,
  NoteReadOnlyError,
  NotSavedResponseError,
  resetNoteStore,
  RevisionConflictError,
  saveResponseAsNote,
  updateNote,
} from "../src/index.ts";
import { createTestDatabase, createTestUser, type TestDatabase } from "../src/testing.ts";

/**
 * [013-v2-persistence-postgres] T012 — notes store over PostgreSQL (FR-NM-01, FR-NM-02, FR-009). The in-memory
 * store is cleared before each read to prove the value came from PostgreSQL.
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

async function setup() {
  const owner = await createTestUser(db.pool);
  const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
  return { owner, nb };
}
const citation = { badge_number: 1, source_id: randomUUID(), source_title: "Spec", chunk_id: randomUUID(), snippet: "Port 8080 requires mTLS.", locator: { kind: "page", page: 1 } } as any;

describe("FR-NM-01: manual notes in PostgreSQL", () => {
  it("creates, lists in display order, updates with revisions and deletes; order numbers are never reused", async () => {
    const { owner, nb } = await setup();
    const a = await createNote(nb, owner, { title: "A", content_md: "one <script>x</script>" });
    const b = await createNote(nb, owner, { title: "B", content_md: "two" });
    expect(a.content_md).not.toContain("<script>");
    resetNoteStore();
    expect((await listNotes(nb, owner)).map((n) => [n.title, n.display_order])).toEqual([["A", 1], ["B", 2]]);
    const updated = await updateNote(nb, owner, a.id, { content_md: "one!", base_revision: 1 });
    expect(updated).toMatchObject({ revision: 2, content_md: "one!" });
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(a.updated_at));
    await expect(updateNote(nb, owner, a.id, { content_md: "stale", base_revision: 1 })).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await updateNote(nb, owner, a.id, {} as any)).toMatchObject({ revision: 2 });
    expect(await deleteNote(nb, owner, b.id)).toBe(true);
    expect(await deleteNote(nb, owner, b.id)).toBe(false);
    const c = await createNote(nb, owner, {});
    expect(c.display_order).toBe(3);
    resetNoteStore();
    expect(await getNote(nb, owner, a.id)).toEqual(updated);
  });

  it("scopes every operation to notebook and owner", async () => {
    const { owner, nb } = await setup();
    const other = await createTestUser(db.pool);
    const a = await createNote(nb, owner, { title: "A", content_md: "x" });
    expect(await getNote(nb, other, a.id)).toBeNull();
    expect(await listNotes(nb, other)).toEqual([]);
    await expect(updateNote(nb, other, a.id, { content_md: "y" })).rejects.toBeInstanceOf(NoteNotFoundError);
    expect(await deleteNote(nb, other, a.id)).toBe(false);
  });

  it("FR-009: of two concurrent edits on the same base revision exactly one wins", async () => {
    const { owner, nb } = await setup();
    const a = await createNote(nb, owner, { title: "A", content_md: "x" });
    const results = await Promise.allSettled([
      updateNote(nb, owner, a.id, { content_md: "left", base_revision: 1 }),
      updateNote(nb, owner, a.id, { content_md: "right", base_revision: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(RevisionConflictError);
    expect((await getNote(nb, owner, a.id))!.revision).toBe(2);
  });
});

describe("FR-NM-02: saved responses in PostgreSQL", () => {
  it("is idempotent per message, also under two concurrent saves, read-only, and convertible to an editable copy", async () => {
    const { owner, nb } = await setup();
    const message = randomUUID();
    const input = { message_id: message, content: "Port 8080 requires mTLS [1].", citations: [citation], title: "Which port?" };
    const [x, y] = await Promise.all([saveResponseAsNote(nb, owner, input), saveResponseAsNote(nb, owner, input)]);
    expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
    expect(x.note.id).toBe(y.note.id);
    resetNoteStore();
    const again = await saveResponseAsNote(nb, owner, input);
    expect(again).toMatchObject({ created: false, note: { id: x.note.id, origin_type: "saved_response", citations_json: [citation], title: "Which port?" } });
    await expect(updateNote(nb, owner, x.note.id, { content_md: "edit" })).rejects.toBeInstanceOf(NoteReadOnlyError);
    const copy = await convertToEditable(nb, owner, x.note.id);
    expect(copy).toMatchObject({ origin_type: "manual", origin_note_id: x.note.id, source_message_id: null, content_md: "Port 8080 requires mTLS." });
    await expect(convertToEditable(nb, owner, copy.id)).rejects.toBeInstanceOf(NotSavedResponseError);
    await expect(convertToEditable(nb, owner, randomUUID())).rejects.toBeInstanceOf(NoteNotFoundError);
  });
});
