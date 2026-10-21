import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import { resetNoteStore, resetPackageV22Store, resetPocBridge, resetWorkspacePreferenceStore } from "@everlast/db";
import { citeAll, startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [013-v2-persistence-postgres] Restart suite (DEV-04, SC-001). A "restart" closes the API, clears every in-process
 * v2 store (as a new process would start empty) and starts a new API with a new v2 runtime on the SAME PostgreSQL
 * database. Sections run sequentially in this one file (analysis F2).
 */

const OWNER = "restart-owner";
let db: TestDatabase;
let n: NotesApi;

beforeAll(async () => {
  db = await createTestDatabase();
  n = await startNotesApi({ db });
});
afterAll(async () => {
  await n?.close();
  await db?.drop();
});

async function restart(options: Parameters<typeof startNotesApi>[0] = {}): Promise<void> {
  await n.close();
  resetPocBridge();
  resetNoteStore();
  resetWorkspacePreferenceStore();
  resetPackageV22Store();
  n = await startNotesApi({ ...options, db });
}

const notesOf = async (nb: string) => (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes as any[];
const note = async (nb: string, title: string, content: string) =>
  (await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, { title, content_md: content })).json.note;
const studio = (nb: string) => `/api/notebooks/${nb}/studio`;

async function waitTerminal(nb: string, id: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`);
    if (["Completed", "Failed", "Cancelled"].includes(r.json.artifact.status)) return r.json.artifact;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("Studio job never finished");
}

describe("US1: notes and Studio reports survive a restart (FR-NM-01..04, FR-ST-10, DEV-04)", () => {
  it("US1-1 (FR-NM-01, FR-NM-02): manual and saved-response notes are unchanged after a restart", async () => {
    const nb = await n.notebook(OWNER);
    const spec = await n.addText(OWNER, nb, "Spec sheet. Port 8080 requires mTLS. Port 9090 is public.");
    await note(nb, "Alpha", "First **idea**.");
    await note(nb, "Beta", "Second idea.");
    await note(nb, "Gamma", "Third idea.");
    const turn = await n.turn(OWNER, nb, "Which port requires mTLS?", [spec]);
    const answer = turn.messages.find((m: any) => m.role === "assistant");
    const saved = (await n.saveNote(OWNER, nb, answer.id)).json.note;
    expect(saved.citations_json.length).toBeGreaterThan(0);
    const before = await notesOf(nb);
    expect(before).toHaveLength(4);

    await restart();
    expect(await notesOf(nb)).toEqual(before);
  });

  it("US1-2 (FR-NM-01): revisions continue after a restart and stale bases conflict", async () => {
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "Draft", "v1");
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "v2", base_revision: 1 });
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "v3", base_revision: 2 });

    await restart();
    const ok = await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "v4", base_revision: 3 });
    expect(ok.status).toBe(200);
    expect(ok.json.note.revision).toBe(4);
    const stale = await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "lost", base_revision: 2 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("RevisionConflict");
  });

  it("US1-3 (FR-ST-10): a completed report is unchanged after a restart", async () => {
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const { sourceId } = await seedReadySource(db.pool, owner, nb, {
      title: "Archive",
      mediaType: "text/plain",
      pages: ["In 1650 the archive opened. Count Ada led it.\n\nIn 1660 the archive moved. It concerned Count Ada Archive."],
      embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT"),
    });
    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, { plugin_type: "report", subtype: "briefing_doc", active_source_ids: [sourceId] });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.status).toBe("Completed");
    const list = (await n.call(OWNER, "GET", `${studio(nb)}/artifacts`)).json;

    await restart();
    expect((await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${done.id}`)).json.artifact).toEqual(done);
    expect((await n.call(OWNER, "GET", `${studio(nb)}/artifacts`)).json).toEqual(list);
  });

  it("US1-4 (FR-NM-03, FR-NM-04): an unchanged note reuses its note-source after a restart", async () => {
    n.model.script = citeAll;
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "Plan", "Deployment needs a maintenance window.");
    const first = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/assistant`, { action_type: "summarize", selected_note_ids: [a.id], selected_source_ids: [] });
    expect(first.status).toBe(200);
    expect(first.json.reused).toBe(false);
    const used = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots.used;

    await restart();
    n.model.script = citeAll;
    const again = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/assistant`, { action_type: "summarize", selected_note_ids: [a.id], selected_source_ids: [] });
    expect(again.status).toBe(200);
    expect(again.json.reused).toBe(true);
    expect(again.json.note_source.id).toBe(first.json.note_source.id);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots.used).toBe(used);
  });
});
