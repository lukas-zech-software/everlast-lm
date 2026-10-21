import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [007-notes-pinboard-lifecycle] T016 rewritten for the owner decision 2026-10-20, and T042 — convert notes into a
 * v1 PostgreSQL source (FR-NM-03 FR-010..FR-013, FR-WM-07, FR-SI-01, C-01). Real PostgreSQL and v1 ingestion.
 */

let n: NotesApi;
const OWNER = "convert-owner";
const words = (k: number) => Array.from({ length: k }, () => "w").join(" ");

beforeAll(async () => {
  n = await startNotesApi();
});
afterAll(async () => {
  await n?.close();
});

const note = async (nb: string, title: string, content: string) =>
  (await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, { title, content_md: content })).json.note;
const convert = (nb: string, body: unknown) => n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, body);
const sourceText = async (sourceId: string) =>
  (await n.api.db.pool.query("SELECT string_agg(text, '\n' ORDER BY sequence) AS t FROM chunks WHERE source_id = $1", [sourceId])).rows[0].t as string;
const pagesText = async (sourceId: string) =>
  (await n.api.db.pool.query("SELECT string_agg(text, '' ORDER BY page_number) AS t FROM source_pages WHERE source_id = $1", [sourceId])).rows[0].t as string;

describe("FR-NM-03: convert notes to a v1 source", () => {
  it("converts one note through the v1 Markdown ingestion, keeping its title and the note", async () => {
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "Raw Data", "TITAN-77 is the codename.");
    const r = await convert(nb, { note_ids: [a.id] });
    expect(r.status).toBe(201);
    expect(r.json.reused).toBe(false);
    expect(r.json.source).toMatchObject({ title: "Raw Data", status: "Ready", media_type: "note_markdown", revision_id: 1, origin_notes: [{ note_id: a.id, revision: 1, title: "Raw Data" }], origin_citations: [] });
    expect(await pagesText(r.json.source.id)).toBe("# Raw Data\n\nTITAN-77 is the codename.");
    const row = (await n.api.db.pool.query("SELECT media_type, status, active_revision FROM sources WHERE id = $1", [r.json.source.id])).rows[0];
    expect(row).toEqual({ media_type: "note_markdown", status: "Ready", active_revision: 1 });
    const embedded = (await n.api.db.pool.query("SELECT count(*)::int AS c FROM chunks WHERE source_id = $1 AND embedding IS NOT NULL", [r.json.source.id])).rows[0].c;
    expect(embedded).toBeGreaterThan(0);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.notes).toHaveLength(1);
  });

  it("combines selected and all notes in display order under their titles; later edits do not change the source", async () => {
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "A", "one");
    const b = await note(nb, "B", "two");
    const c = await note(nb, "C", "three");
    const sel = await convert(nb, { note_ids: [c.id, a.id] });
    expect(sel.json.source.title).toBe("Combined notes");
    expect(await pagesText(sel.json.source.id)).toBe("# A\n\none\n\n# C\n\nthree");
    const all = await convert(nb, { all: true });
    expect(all.json.source.origin_notes.map((o: any) => o.note_id)).toEqual([a.id, b.id, c.id]);
    await n.call(OWNER, "PATCH", `/api/notebooks/${nb}/notes/${a.id}`, { content_md: "changed" });
    expect(await pagesText(sel.json.source.id)).toBe("# A\n\none\n\n# C\n\nthree");
    expect(await sourceText(all.json.source.id)).not.toContain("changed");
  });

  it("clamps long note titles to 100 code points for the source title and keeps the full heading", async () => {
    const nb = await n.notebook(OWNER);
    const a = await note(nb, "😀".repeat(150), "x");
    const r = await convert(nb, { note_ids: [a.id] });
    expect(Array.from(r.json.source.title)).toHaveLength(100);
    expect((await pagesText(r.json.source.id)).startsWith(`# ${"😀".repeat(150)}`)).toBe(true);
  });

  it("accepts exactly 500,000 words and rejects 500,001 without using a slot", async () => {
    const nb = await n.notebook(OWNER);
    // each note adds 2 heading words ("# T")
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await note(nb, "T", words(99_998))).id);
    const ok = await convert(nb, { note_ids: ids });
    expect(ok.status).toBe(201);
    expect(ok.json.source.word_count).toBe(500_000);
    const over = await note(nb, "T", words(99_999));
    const before = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots.used;
    const r = await convert(nb, { note_ids: [...ids.slice(0, 4), over.id] });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("SourceOversizedWords");
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/notes`)).json.source_slots.used).toBe(before);
  }, 120_000);

  it("rejects whitespace-only, unknown and cross-notebook notes without creating a source", async () => {
    const nb = await n.notebook(OWNER);
    const blank = await note(nb, "Blank", "  \n ");
    expect((await convert(nb, { note_ids: [blank.id] })).json.error.code).toBe("NoteSourceEmpty");
    const other = await n.notebook(OWNER);
    const foreign = await note(other, "F", "x");
    expect((await convert(nb, { note_ids: [foreign.id] })).status).toBe(404);
    expect((await convert(nb, { all: true })).status).toBe(422);
    expect((await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources`)).json.sources).toHaveLength(0);
  });
});

describe("FR-NM-03 FR-013: saved-response citation markers are provenance only (T042)", () => {
  it("removes verified inline markers from the source text, keeps unverified brackets and stores the copied citations", async () => {
    const nb = await n.notebook(OWNER);
    const spec = await n.addText(OWNER, nb, "Spec sheet. Port 8080 requires mTLS.");
    const turn = await n.turn(OWNER, nb, "Which port requires mTLS?", [spec]);
    const answer = turn.messages.find((m: any) => m.role === "assistant");
    const saved = (await n.saveNote(OWNER, nb, answer.id)).json.note;
    expect(saved.content_md).toContain("[[1]]");
    // A manual note with an unverified bracket that must stay.
    const manual = await note(nb, "Manual", "See appendix [7] and [draft].");

    const r = await convert(nb, { note_ids: [saved.id, manual.id] });
    expect(r.status).toBe(201);
    const text = `${await pagesText(r.json.source.id)}\n${await sourceText(r.json.source.id)}`;
    expect(text).not.toContain("[[1]]");
    expect(text).not.toMatch(/mTLS\.\s*\[1\]/);
    expect(text).toContain("Port 8080 requires mTLS.");
    expect(text).toContain("See appendix [7] and [draft].");
    expect(r.json.source.origin_citations).toHaveLength(1);
    expect(r.json.source.origin_citations[0]).toMatchObject({ badge_number: 1, source_id: spec, source_title: "Pasted text" });
    const stored = await n.api.db.pool.query("SELECT origin_citations, origin_notes FROM note_source_provenance WHERE source_id = $1", [r.json.source.id]);
    expect(stored.rows[0].origin_citations[0].source_id).toBe(spec);
    expect(stored.rows[0].origin_notes.map((o: any) => o.note_id)).toEqual([saved.id, manual.id]);

    // New answers cite the note-source's own chunks, never the copied citation.
    const next = await n.turn(OWNER, nb, "Which port requires mTLS?", [r.json.source.id]);
    const cited = next.messages.find((m: any) => m.role === "assistant");
    expect(cited.citations.every((c: any) => c.source_id === r.json.source.id)).toBe(true);
  });
});
