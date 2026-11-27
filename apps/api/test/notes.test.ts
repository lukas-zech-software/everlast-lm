import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Note } from "@everlast/contracts";
import { newNotebook, resetAll, startApi } from "./notes-fixtures.ts";
import { allowV2MemoryStores } from "@everlast/db";

// TEST-ONLY: this DB-free suite exercises the in-memory v2 double (D16, grill F8a).
allowV2MemoryStores();

describe("FR-NM-01: notes CRUD routes", () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  let nb: string;

  beforeEach(async () => {
    resetAll();
    nb = await newNotebook();
    api = await startApi({});
  });
  afterEach(() => api.close());

  it("creates a note with the default title, auto-saves, lists in order, reopens", async () => {
    const created = await api.call("POST", `/api/notebooks/${nb}/notes`, {});
    expect(created.status).toBe(201);
    const createdNote = (created.json as { note: Note }).note;
    expect(createdNote.title).toBe("New note");
    const id = createdNote.id;

    const patched = await api.call("PATCH", `/api/notebooks/${nb}/notes/${id}`, {
      title: "Key Audit Findings",
      content_md: "## Risk 1\nMissing mTLS on port 8080",
    });
    expect(patched.status).toBe(200);
    expect((patched.json as { note: Note }).note.revision).toBe(2);

    await api.call("POST", `/api/notebooks/${nb}/notes`, { title: "Second" });
    const list = await api.call("GET", `/api/notebooks/${nb}/notes`);
    const listBody = list.json as { notes: Note[]; source_slots: { used: number; limit: number } };
    expect(listBody.notes.map((n) => n.title)).toEqual(["Key Audit Findings", "Second"]);
    expect(listBody.source_slots).toEqual({ used: 0, limit: 50 });

    const open = await api.call("GET", `/api/notebooks/${nb}/notes/${id}`);
    expect((open.json as { note: Note }).note.content_md).toBe(
      "## Risk 1\nMissing mTLS on port 8080",
    );
  });

  it("validates title bounds and sanitizes unsafe content", async () => {
    const bad = await api.call("POST", `/api/notebooks/${nb}/notes`, {
      title: "x".repeat(201),
    });
    expect(bad.status).toBe(422);
    expect((bad.json as { error: { code: string } }).error.code).toBe("ValidationError");
    const ok = await api.call("POST", `/api/notebooks/${nb}/notes`, {
      content_md: "hi <script>x()</script>",
    });
    expect((ok.json as { note: Note }).note.content_md).toBe("hi ");
  });

  it("requires confirmation to delete and permanently removes the note", async () => {
    const { json } = await api.call("POST", `/api/notebooks/${nb}/notes`, {});
    const id = (json as { note: Note }).note.id;
    expect((await api.call("DELETE", `/api/notebooks/${nb}/notes/${id}`)).status).toBe(400);
    expect(
      (await api.call("DELETE", `/api/notebooks/${nb}/notes/${id}?confirm=true`)).json,
    ).toEqual({ deleted: true });
    expect((await api.call("GET", `/api/notebooks/${nb}/notes/${id}`)).status).toBe(404);
  });

  it("detects stale revisions", async () => {
    const { json } = await api.call("POST", `/api/notebooks/${nb}/notes`, {});
    const id = (json as { note: Note }).note.id;
    await api.call("PATCH", `/api/notebooks/${nb}/notes/${id}`, { title: "a" });
    const r = await api.call("PATCH", `/api/notebooks/${nb}/notes/${id}`, {
      title: "b",
      base_revision: 1,
    });
    expect(r.status).toBe(409);
    expect((r.json as { error: { code: string } }).error.code).toBe("RevisionConflict");
  });

  it("rejects non-owners", async () => {
    const denied = await startApi({ verifyOwnership: () => false });
    const r = await denied.call("GET", `/api/notebooks/${nb}/notes`);
    expect(r.status).toBe(403);
    await denied.close();
  });
});
