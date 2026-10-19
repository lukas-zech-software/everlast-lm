import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearChatThread, getOrCreateChatThread, persistChatMessage } from "@everlast/db";
import { newNotebook, resetAll, startApi, stubIngestor, uuidv7, USER } from "./notes-fixtures.ts";

describe("FR-NM-02, FR-GC-09: saved responses", () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let nb: string;
  let messageId: string;
  const spec = "44444444-4444-4444-8444-444444444444";

  beforeEach(async () => {
    resetAll();
    nb = await newNotebook();
    api = await startApi({ ingestor: stubIngestor().ingestor });
    const thread = await getOrCreateChatThread(undefined, nb, USER);
    const m = await persistChatMessage(undefined, {
      thread_id: thread.id, notebook_id: nb, user_id: USER, role: "assistant",
      content: "Port 8080 requires mTLS [1]",
      citations: [{
        badge_number: 1, source_id: spec, source_title: "Spec.pdf", chunk_id: uuidv7(),
        snippet: "Port 8080 requires mTLS.", locator: { page_number: 1, start_offset: 0, end_offset: 10 },
      }],
    });
    messageId = m.id;
  });
  afterEach(() => api.close());

  it("saves once, is idempotent, keeps citations after clearing chat", async () => {
    const first = await api.call("POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: messageId });
    expect(first.status).toBe(201);
    expect(first.json.toast).toBe("Saved to notes");
    expect(first.json.note.citations_json[0].source_title).toBe("Spec.pdf");

    const second = await api.call("POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: messageId });
    expect(second.status).toBe(200);
    expect(second.json.note.id).toBe(first.json.note.id);

    await clearChatThread(undefined, nb, USER);
    const third = await api.call("POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: messageId });
    expect(third.json.created).toBe(false);
    const list = await api.call("GET", `/api/notebooks/${nb}/notes`);
    expect(list.json.notes).toHaveLength(1);
    expect(list.json.notes[0].content_md).toContain("[1]");
  });

  it("is read-only and converts to a separate editable copy without badges", async () => {
    const { json } = await api.call("POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: messageId });
    const id = json.note.id;
    const edit = await api.call("PATCH", `/api/notebooks/${nb}/notes/${id}`, { title: "x" });
    expect(edit.status).toBe(409);
    expect(edit.json.error.code).toBe("NoteReadOnly");

    const copy = await api.call("POST", `/api/notebooks/${nb}/notes/${id}/convert-to-editable`);
    expect(copy.status).toBe(201);
    expect(copy.json.note.content_md).toBe("Port 8080 requires mTLS");
    expect(copy.json.note.origin_note_id).toBe(id);
    expect((await api.call("PATCH", `/api/notebooks/${nb}/notes/${copy.json.note.id}`, { title: "ok" })).status).toBe(200);

    const again = await api.call("POST", `/api/notebooks/${nb}/notes/${copy.json.note.id}/convert-to-editable`);
    expect(again.status).toBe(409);
  });

  it("returns 404 for an unknown message", async () => {
    const r = await api.call("POST", `/api/notebooks/${nb}/notes/from-message`, { message_id: uuidv7() });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("MessageNotFound");
  });
});
