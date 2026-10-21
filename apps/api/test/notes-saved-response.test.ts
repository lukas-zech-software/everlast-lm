import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [007-notes-pinboard-lifecycle] T038 (with T010/T011) — the one shared save-note contract over the real v1 chat
 * (FR-NM-02, FR-GC-09, FR-006, FR-009; spec/requirements/README.md v2 row). Real PostgreSQL chat history.
 */

let n: NotesApi;
const OWNER = "saved-owner";

beforeAll(async () => {
  n = await startNotesApi();
});
afterAll(async () => {
  await n?.close();
});

async function answered(question = "Which port requires mTLS?") {
  const nb = await n.notebook(OWNER);
  const spec = await n.addText(OWNER, nb, "Spec sheet. Port 8080 requires mTLS.");
  const turn = await n.turn(OWNER, nb, question, [spec]);
  const answer = turn.messages.find((m: any) => m.role === "assistant");
  expect(answer.kind).toBe("answer");
  return { nb, spec, answer };
}

describe("FR-NM-02, FR-GC-09: Save to note through the shared route", () => {
  it("saves once, lists the note, stays idempotent and keeps citations after Clear chat", async () => {
    const { nb, spec, answer } = await answered();
    const first = await n.saveNote(OWNER, nb, answer.id);
    expect(first.status).toBe(200);
    expect(Object.keys(first.json.note).sort()).toEqual(["citations_json", "content_md", "created_at", "id", "notebook_id", "origin_type", "read_only", "source_message_id", "title"]);
    expect(first.json.note).toMatchObject({ notebook_id: nb, source_message_id: answer.id, title: "Which port requires mTLS?", origin_type: "saved_response", read_only: true });
    expect(first.json.note.citations_json[0]).toMatchObject({ badge_number: 1, source_id: spec, source_title: "Pasted text" });

    const listed = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: first.json.note.id, origin_type: "saved_response", source_message_id: answer.id });

    expect((await n.saveNote(OWNER, nb, answer.id)).json.note.id).toBe(first.json.note.id);
    expect((await n.call(OWNER, "DELETE", `/api/notebooks/${nb}/chat`)).status).toBe(200);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat`)).json.messages).toHaveLength(0);
    const repeat = await n.saveNote(OWNER, nb, answer.id);
    expect(repeat.json.note.id).toBe(first.json.note.id);
    const after = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes;
    expect(after).toHaveLength(1);
    expect(after[0].citations_json[0].source_id).toBe(spec);
  });

  it("titles the note with the preceding user question trimmed to 200 code points", async () => {
    const question = `${"🌱".repeat(205)} mTLS port?`;
    const { nb, answer } = await answered(question);
    const saved = await n.saveNote(OWNER, nb, answer.id);
    expect(saved.json.note.title).toBe("🌱".repeat(200));
  });

  it("rejects bodies whose IDs differ from the path, and invalid bodies, with 400", async () => {
    const { nb, answer } = await answered();
    const path = `/api/notebooks/${nb}/chat/messages/${answer.id}/note`;
    expect((await n.call(OWNER, "POST", path, { notebook_id: nb, message_id: randomUUID() })).status).toBe(400);
    expect((await n.call(OWNER, "POST", path, { notebook_id: nb })).status).toBe(400);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes).toHaveLength(0);
  });

  it("returns 404 MessageNotFound for an unknown message and never saves another user's message", async () => {
    const { nb, answer } = await answered();
    const unknown = randomUUID();
    const r = await n.call(OWNER, "POST", `/api/notebooks/${nb}/chat/messages/${unknown}/note`, { notebook_id: nb, message_id: unknown });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("MessageNotFound");
    // Another user never reaches the v2 handler: v1 ownership is checked first (FR-WM-04).
    const intruder = await n.saveNote("saved-intruder", nb, answer.id);
    expect([403, 404]).toContain(intruder.status);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes).toHaveLength(0);
  });

  it("removes the 2.3 duplicate route: POST /notes/from-message no longer creates notes", async () => {
    const { nb, answer } = await answered();
    const r = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: answer.id });
    expect(r.status).toBe(404);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes).toHaveLength(0);
  });

  it("is read-only and converts to a separate editable copy without verified badges", async () => {
    const { nb, answer } = await answered();
    const { json } = await n.saveNote(OWNER, nb, answer.id);
    const id = json.note.id;
    expect(json.note.content_md).toContain("[[1]]");
    const edit = await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${id}`, { title: "x" });
    expect(edit.status).toBe(409);
    expect(edit.json.error).toEqual({ code: "NoteReadOnly", message: "Saved responses cannot be edited" });

    const copy = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/${id}/convert-to-editable`);
    expect(copy.status).toBe(201);
    expect(copy.json.note.content_md).toBe("Spec sheet. Port 8080 requires mTLS.");
    expect(copy.json.note).toMatchObject({ origin_type: "manual", origin_note_id: id, citations_json: [] });
    expect((await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${copy.json.note.id}`, { title: "ok" })).status).toBe(200);
    const original = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes/${id}`)).json.note;
    expect(original.content_md).toBe(json.note.content_md);
    expect((await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/${copy.json.note.id}/convert-to-editable`)).status).toBe(409);
  });
});
