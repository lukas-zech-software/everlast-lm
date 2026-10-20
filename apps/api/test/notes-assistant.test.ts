import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPocNotebook, createNote, resetNoteStore, resetPocBridge } from "@everlast/db";
import type { NoteSource } from "@everlast/contracts";
import { NotesService, NotesServiceError, type NoteAssistantContext, type NoteSourceStore } from "../src/notes/service.ts";
import { citeAll, startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [007-notes-pinboard-lifecycle] T023 rewritten for PostgreSQL, T039, T040, T041 — Note Assistant (FR-NM-04
 * FR-014..FR-018, FR-GC-06, C-02, SRS §5.6 2026-10-20 reuse). Real PostgreSQL, v1 ingestion, scripted grounded
 * model and the production verifier.
 */

let n: NotesApi;
const OWNER = "assistant-owner";

beforeAll(async () => {
  n = await startNotesApi();
});
afterAll(async () => {
  await n?.close();
});
beforeEach(() => {
  n.model.calls = [];
  n.model.script = citeAll;
});

const note = async (nb: string, title: string, content: string) =>
  (await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, { title, content_md: content })).json.note;
const run = (nb: string, body: unknown) => n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/assistant`, body);
const slots = async (nb: string) => (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots;

async function setup() {
  const nb = await n.notebook(OWNER);
  const ext = await n.addText(OWNER, nb, "Migration requires a 4-hour maintenance window.");
  const a = await note(nb, "A", "Deployment requires zero downtime.");
  const b = await note(nb, "B", "Beta idea about rollouts.");
  return { nb, ext, ids: [a.id, b.id] };
}

describe("FR-NM-04: Note Assistant actions", () => {
  it("summarizes using only the note-source and flags note assertions", async () => {
    const { nb, ids } = await setup();
    const r = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    expect(r.status).toBe(200);
    expect(n.model.calls).toHaveLength(1);
    expect(n.model.calls[0]!.chunks.every((c) => c.source_id === r.json.note_source.id)).toBe(true);
    expect(new Set(Object.values(r.json.citation_kinds))).toEqual(new Set(["note_assertion"]));
    expect(r.json.note_assertion_source_ids).toEqual([r.json.note_source.id]);
    expect(r.json.snapshot).toEqual([{ source_id: r.json.note_source.id, revision: 1 }]);
    expect(r.json.message).toMatchObject({ role: "assistant", kind: "answer" });
    expect(r.json.message.citations.every((c: any) => c.source_media_type === "note_markdown")).toBe(true);
  });

  it("critique requires a comparison source and converts nothing and calls no model without one", async () => {
    const { nb, ids } = await setup();
    const before = await slots(nb);
    const r = await run(nb, { action_type: "critique", selected_note_ids: ids, selected_source_ids: [] });
    expect(r.status).toBe(400);
    expect(r.json.error).toEqual({ code: "ComparisonSourceRequired", message: "Select a comparison source first" });
    expect(n.model.calls).toHaveLength(0);
    expect(await slots(nb)).toEqual(before);
  });

  it("critique adds the selected source and distinguishes note assertions from source facts", async () => {
    const { nb, ext, ids } = await setup();
    const r = await run(nb, { action_type: "critique", selected_note_ids: ids, selected_source_ids: [ext] });
    expect(r.status).toBe(200);
    expect(new Set(Object.values(r.json.citation_kinds))).toEqual(new Set(["note_assertion", "source_fact"]));
    expect(r.json.snapshot.map((p: any) => p.source_id).sort()).toEqual([ext, r.json.note_source.id].sort());
  });

  it("validates selection size, action and note ownership before any conversion", async () => {
    const { nb, ids } = await setup();
    const many = Array.from({ length: 51 }, () => randomUUID());
    expect((await run(nb, { action_type: "summarize", selected_note_ids: many, selected_source_ids: [] })).status).toBe(422);
    expect((await run(nb, { action_type: "rewrite", selected_note_ids: ids, selected_source_ids: [] })).status).toBe(422);
    expect((await run(nb, { action_type: "summarize", selected_note_ids: [randomUUID()], selected_source_ids: [] })).status).toBe(404);
    expect(n.model.calls).toHaveLength(0);
    expect((await slots(nb)).used).toBe(1);
  });

  it("makes no model call when conversion fails, and releases the slot", async () => {
    const { nb, ids } = await setup();
    n.embedder.failDocuments = true;
    try {
      const r = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
      expect(r.status).toBe(502);
    } finally {
      n.embedder.failDocuments = false;
    }
    expect(n.model.calls).toHaveLength(0);
    expect((await slots(nb)).used).toBe(1);
  });

  it("fails without publishing when a captured source is deleted mid-run", async () => {
    const { nb, ext, ids } = await setup();
    n.model.script = async (input) => {
      await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [ext]);
      return citeAll(input);
    };
    const r = await run(nb, { action_type: "related_ideas", selected_note_ids: ids, selected_source_ids: [ext] });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SourceSnapshotInvalid");
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat`)).json.messages).toHaveLength(0);
  });
});

describe("FR-NM-04 FR-015: note-source reuse (T039, SRS §5.6)", () => {
  it("reuses the Ready note-source for the same notes at the same revisions, even at 50/50", async () => {
    const { nb, ids } = await setup();
    const first = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    expect(first.json.reused).toBe(false);
    const used = (await slots(nb)).used;
    await n.seedSources(OWNER, nb, 50 - used);
    expect(await slots(nb)).toEqual({ used: 50, limit: 50 });
    const again = await run(nb, { action_type: "create_outline", selected_note_ids: [...ids].reverse(), selected_source_ids: [] });
    expect(again.status).toBe(200);
    expect(again.json.reused).toBe(true);
    expect(again.json.note_source.id).toBe(first.json.note_source.id);
    expect(await slots(nb)).toEqual({ used: 50, limit: 50 });
  });

  it("an edited note or a changed selection creates one new note-source and takes one slot", async () => {
    const { nb, ids } = await setup();
    const first = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    const base = (await slots(nb)).used;
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${ids[0]}`, { content_md: "Deployment now allows a short window." });
    const edited = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    expect(edited.json.reused).toBe(false);
    expect(edited.json.note_source.id).not.toBe(first.json.note_source.id);
    expect((await slots(nb)).used).toBe(base + 1);
    const c = await note(nb, "C", "Gamma idea.");
    const widened = await run(nb, { action_type: "summarize", selected_note_ids: [...ids, c.id], selected_source_ids: [] });
    expect(widened.json.reused).toBe(false);
    expect((await slots(nb)).used).toBe(base + 2);
  });

  it("does not reuse a deleted note-source", async () => {
    const { nb, ids } = await setup();
    const first = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [first.json.note_source.id]);
    const again = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    expect(again.status).toBe(200);
    expect(again.json.reused).toBe(false);
    expect(again.json.note_source.id).not.toBe(first.json.note_source.id);
  });

  it("convert-to-source with reuse: true returns the existing snapshot (assistant bar snapshot phase)", async () => {
    const { nb, ids } = await setup();
    const created = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: ids, reuse: true });
    expect(created.status).toBe(201);
    expect(created.json.reused).toBe(false);
    const reused = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: ids, reuse: true });
    expect(reused.status).toBe(200);
    expect(reused.json).toMatchObject({ reused: true, source: { id: created.json.source.id } });
    const plain = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: ids });
    expect(plain.json.source.id).not.toBe(created.json.source.id);
  });
});

describe("FR-NM-04 FR-016: scope per action (T040)", () => {
  it("summarize and create_outline read only the note-source even when sources are selected", async () => {
    const { nb, ext, ids } = await setup();
    for (const action_type of ["summarize", "create_outline"] as const) {
      n.model.calls = [];
      const r = await run(nb, { action_type, selected_note_ids: ids, selected_source_ids: [ext] });
      expect(r.status).toBe(200);
      expect(n.model.calls[0]!.chunks.every((c) => c.source_id === r.json.note_source.id)).toBe(true);
      expect(r.json.snapshot).toEqual([{ source_id: r.json.note_source.id, revision: 1 }]);
      expect(r.json.message.citations.every((c: any) => c.source_id === r.json.note_source.id)).toBe(true);
    }
  });

  it("related_ideas and critique add the selected existing sources", async () => {
    const { nb, ext, ids } = await setup();
    for (const action_type of ["related_ideas", "critique"] as const) {
      n.model.calls = [];
      const r = await run(nb, { action_type, selected_note_ids: ids, selected_source_ids: [ext] });
      expect(r.status).toBe(200);
      expect(n.model.calls[0]!.chunks.some((c) => c.source_id === ext)).toBe(true);
    }
  });
});

describe("FR-NM-04 FR-017, FR-GC-06: Note Assistant turns live in the PostgreSQL chat (T041)", () => {
  it("writes question and validated answer with provenance, shows them in GET /chat, saves and clears them", async () => {
    const { nb, ids } = await setup();
    const r = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    expect(r.json.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    const rows = await n.api.db.pool.query("SELECT role, kind, provenance FROM chat_messages WHERE notebook_id = $1 ORDER BY seq", [nb]);
    expect(rows.rows.map((m) => [m.role, m.kind])).toEqual([["user", "question"], ["assistant", "answer"]]);
    expect(rows.rows[1].provenance).toEqual([{ source_id: r.json.note_source.id, revision: 1 }]);
    const history = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat`)).json.messages;
    expect(history.map((m: any) => m.id)).toEqual(r.json.messages.map((m: any) => m.id));

    const saved = await n.saveNote(OWNER, nb, r.json.message.id);
    expect(saved.status).toBe(200);
    expect(saved.json.note.citations_json[0].source_id).toBe(r.json.note_source.id);

    expect((await n.call(OWNER, "DELETE", `/api/notebooks/${nb}/chat`)).status).toBe(200);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat`)).json.messages).toHaveLength(0);
  });

  it("stores a refusal as a refusal", async () => {
    const { nb, ids } = await setup();
    n.model.script = () => ({ status: "not_in_sources", sentences: [] });
    const r = await run(nb, { action_type: "summarize", selected_note_ids: ids, selected_source_ids: [] });
    expect(r.status).toBe(200);
    expect(r.json.message.kind).toBe("refusal");
    const rows = await n.api.db.pool.query("SELECT kind FROM chat_messages WHERE notebook_id = $1 AND role = 'assistant'", [nb]);
    expect(rows.rows).toEqual([{ kind: "refusal" }]);
  });
});

describe("FR-NM-04 FR-018: authorization is rechecked before publication", () => {
  beforeEach(() => {
    resetPocBridge();
    resetNoteStore();
  });

  it("fails without publishing when ownership is revoked before publication", async () => {
    const nb = createPocNotebook("owner-x", "NB").id;
    const a = await createNote(nb, "owner-x", { title: "A", content_md: "Alpha" });
    const source: NoteSource = {
      id: randomUUID(), notebook_id: nb, title: "A", media_type: "note_markdown", status: "Ready", revision_id: 1,
      byte_size: 5, word_count: 1, origin_notes: [{ note_id: a.id, revision: 1, title: "A" }], origin_citations: [], created_at: new Date().toISOString(),
    };
    const store: NoteSourceStore = { slots: async () => ({ used: 1, limit: 50 }), findReusable: async () => source, create: async () => source };
    const published: unknown[] = [];
    const context: NoteAssistantContext = {
      read: async () => ({ snapshot: [{ source_id: source.id, revision: 1 }], chunks: [{ chunk_id: randomUUID(), source_id: source.id, revision: 1, locator: { page_number: 1, start_offset: 0, end_offset: 5 }, token_count: 1, text: "Alpha" }] }),
      verify: async () => undefined,
      publish: async (input) => (published.push(input), []),
    };
    let checks = 0;
    const service = new NotesService({
      noteSources: store,
      context,
      assistant: { answer: async () => ({ kind: "refusal", content: "no", citations: [] }) },
      verifyOwnership: () => ++checks < 2,
    });
    await expect(service.runAssistant(nb, "owner-x", { action_type: "summarize", selected_note_ids: [a.id], selected_source_ids: [] })).rejects.toMatchObject({ httpStatus: 403 } satisfies Partial<NotesServiceError>);
    expect(published).toHaveLength(0);
  });
});
