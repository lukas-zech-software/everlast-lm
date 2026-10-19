import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createNote, getOccupiedSourceCount, listNotes, seedSourceSlots, getScopedContext } from "@everlast/db";
import { newNotebook, resetAll, startApi, stubIngestor, USER } from "./notes-fixtures.js";

const words = (n: number) => Array.from({ length: n }, () => "w").join(" ");

describe("FR-NM-03, FR-WM-07, FR-SI-01: convert notes to source", () => {
  let nb: string;
  let api: Awaited<ReturnType<typeof startApi>>;
  let stub: ReturnType<typeof stubIngestor>;

  const start = async (mode: "ok" | "failed" | "throws" = "ok") => {
    stub = stubIngestor(mode);
    api = await startApi({ ingestor: stub.ingestor });
  };
  const convert = (body: unknown) => api.call("POST", `/api/notebooks/${nb}/notes/convert-to-source`, body);

  beforeEach(async () => {
    resetAll();
    nb = await newNotebook();
  });
  afterEach(() => api.close());

  it("converts one note, keeping its title and preserving the note", async () => {
    await start();
    const n = await createNote(nb, USER, { title: "Raw Data", content_md: "TITAN-77" });
    const r = await convert({ note_ids: [n.id] });
    expect(r.status).toBe(201);
    expect(r.json.source).toMatchObject({ title: "Raw Data", status: "Ready", media_type: "note_markdown" });
    expect(stub.calls[0]!.markdown).toBe("# Raw Data\n\nTITAN-77");
    expect(await listNotes(nb, USER)).toHaveLength(1);
    expect((await getScopedContext(nb, [r.json.source.id]))[0]!.text).toContain("TITAN-77");
  });

  it("combines selected and all notes in display order under their titles", async () => {
    await start();
    const a = await createNote(nb, USER, { title: "A", content_md: "one" });
    const b = await createNote(nb, USER, { title: "B", content_md: "two" });
    const c = await createNote(nb, USER, { title: "C", content_md: "three" });
    const sel = await convert({ note_ids: [c.id, a.id] });
    expect(sel.json.source.title).toBe("Combined notes");
    expect(stub.calls[0]!.markdown).toBe("# A\n\none\n\n# C\n\nthree");
    const all = await convert({ all: true });
    expect(all.json.source.origin_notes.map((o: any) => o.note_id)).toEqual([a.id, b.id, c.id]);
  });

  it("clamps long note titles to 100 code points for the source title", async () => {
    await start();
    const n = await createNote(nb, USER, { title: "😀".repeat(150), content_md: "x" });
    const r = await convert({ note_ids: [n.id] });
    expect(Array.from(r.json.source.title)).toHaveLength(100);
    expect(stub.calls[0]!.markdown.startsWith("# " + "😀".repeat(150))).toBe(true);
  });

  it("rejects at 50/50 with 'Source limit reached' and never ingests", async () => {
    await start();
    await seedSourceSlots(nb, 50);
    const n = await createNote(nb, USER, { title: "A", content_md: "x" });
    const r = await convert({ note_ids: [n.id] });
    expect(r.status).toBe(409);
    expect(r.json.error).toEqual({ code: "SourceLimitReached", message: "Source limit reached" });
    expect(stub.calls).toHaveLength(0);
  });

  it("accepts exactly 500,000 words and rejects 500,001 without using a slot", async () => {
    await start();
    // each note adds 2 title words ("# T")
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await createNote(nb, USER, { title: "T", content_md: words(99_998) })).id);
    }
    const ok = await convert({ note_ids: ids });
    expect(ok.status).toBe(201);
    expect(ok.json.source.word_count).toBe(500_000);
    const over = await createNote(nb, USER, { title: "T", content_md: words(99_998 + 1) });
    const before = await getOccupiedSourceCount(nb);
    const r = await convert({ note_ids: [...ids.slice(0, 4), over.id] });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("SourceOversizedWords");
    expect(await getOccupiedSourceCount(nb)).toBe(before);
  });

  it("rejects whitespace-only and unknown or cross-notebook notes", async () => {
    await start();
    const blank = await createNote(nb, USER, { title: "Blank", content_md: "  \n " });
    expect((await convert({ note_ids: [blank.id] })).json.error.code).toBe("NoteSourceEmpty");
    const other = await newNotebook();
    const foreign = await createNote(other, USER, { title: "F", content_md: "x" });
    expect((await convert({ note_ids: [foreign.id] })).status).toBe(404);
    expect((await convert({ all: true })).status).toBe(422);
    expect(stub.calls).toHaveLength(0);
  });

  it.each(["failed", "throws"] as const)("releases the slot when ingestion %s", async (mode) => {
    await start(mode);
    const n = await createNote(nb, USER, { title: "A", content_md: "x" });
    const r = await convert({ note_ids: [n.id] });
    expect(r.status).toBe(502);
    expect(await getOccupiedSourceCount(nb)).toBe(0);
    expect(await listNotes(nb, USER)).toHaveLength(1);
  });
});
