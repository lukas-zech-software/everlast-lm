import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [007-notes-pinboard-lifecycle] T033, T044 — Gate v2.0 #2 round trip through the v1 routes (FR-NM-02, FR-NM-03
 * FR-013/FR-019, US3/AC1/AC3, C-01, C-02, NFR-EVAL-02, NFR-EVAL-04, SC-003, SC-006). Real PostgreSQL, real v1
 * Markdown ingestion and embeddings (lexical test embedder), scripted grounded model, production verifier.
 */

let n: NotesApi;
const OWNER = "roundtrip-owner";

beforeAll(async () => {
  n = await startNotesApi();
});
afterAll(async () => {
  await n?.close();
});

describe("Gate v2.0 #2: chat answer → Save to note → Convert to source → cited in the next turn", () => {
  it("answers TITAN-77 citing the converted note-source with zero deselected leakage", async () => {
    const nb = await n.notebook(OWNER);
    const raw = await n.addText(OWNER, nb, "Raw data sheet. Project codename is TITAN-77.");
    const decoy = await n.addText(OWNER, nb, "Decoy memo. Project codename is DECOY-99.");

    // 1. Grounded chat answer citing the raw upload.
    const first = await n.turn(OWNER, nb, "What is the project codename TITAN-77?", [raw]);
    const answer = first.messages.find((m: any) => m.role === "assistant");
    expect(answer.kind).toBe("answer");
    expect(answer.citations[0].source_id).toBe(raw);

    // 2. Save to note through the one shared route (FR-GC-09, FR-NM-02).
    const saved = await n.saveNote(OWNER, nb, answer.id);
    expect(saved.status).toBe(200);
    expect(saved.json.note).toMatchObject({ source_message_id: answer.id, origin_type: "saved_response", read_only: true });
    expect(saved.json.note.title).toBe("What is the project codename TITAN-77?");

    // 3. Convert the unedited saved-response note.
    const started = performance.now();
    const converted = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: [saved.json.note.id] });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(converted.status).toBe(201);
    const noteSource = converted.json.source;
    expect(noteSource).toMatchObject({ media_type: "note_markdown", status: "Ready" });

    // The converted source is a v1 source: listed as Ready in the Left Panel list.
    const listed = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/sources`)).json.sources;
    expect(listed.find((s: any) => s.id === noteSource.id)).toMatchObject({ status: "Ready", media_type: "note_markdown", title: noteSource.title });

    // 4. Next v1 chat turn with only the converted source selected.
    n.model.calls = [];
    const second = await n.turn(OWNER, nb, "What is the project codename?", [noteSource.id]);
    const cited = second.messages.find((m: any) => m.role === "assistant");
    expect(cited.kind).toBe("answer");
    expect(cited.content).toContain("TITAN-77");
    expect(cited.citations).toHaveLength(1);
    expect(cited.citations[0]).toMatchObject({ badge_number: 1, source_id: noteSource.id, status: "available", source_title: noteSource.title, source_media_type: "note_markdown" });

    // Retrieval saw only the converted source (NFR-EVAL-04): the decoy and the raw upload never entered the prompt.
    const prompted = n.model.calls.flatMap((c) => c.chunks);
    expect(prompted.length).toBeGreaterThan(0);
    expect(prompted.every((c) => c.source_id === noteSource.id)).toBe(true);
    expect(prompted.some((c) => c.source_id === decoy || c.source_id === raw)).toBe(false);

    // Turn provenance holds (note_source_id, revision) and the history shows the citation as available.
    const provenance = await n.api.db.pool.query("SELECT provenance FROM chat_messages WHERE id = $1", [cited.id]);
    expect(provenance.rows[0].provenance).toEqual([{ source_id: noteSource.id, revision: 1 }]);
    const history = (await n.call(OWNER, "GET", `/api/notebooks/${nb}/chat`)).json.messages;
    const last = history.at(-1);
    expect(last.citations[0]).toMatchObject({ source_id: noteSource.id, status: "available", source_title: noteSource.title, source_media_type: "note_markdown" });
  });

  it("converts a 5,000-word note into a citable Ready source within 2.0 s through the full route (FR-019, SC-003)", async () => {
    const nb = await n.notebook(OWNER);
    const created = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes`, {
      title: "Big", content_md: Array.from({ length: 5000 }, (_, i) => `w${i}`).join(" "),
    });
    expect(created.status).toBe(201);
    const t = performance.now();
    const r = await n.call(OWNER, "POST", `/api/notebooks/${nb}/notes/convert-to-source`, { note_ids: [created.json.note.id] });
    const elapsed = performance.now() - t;
    expect(r.status).toBe(201);
    expect(r.json.source.status).toBe("Ready");
    expect(r.json.source.word_count).toBe(5002);
    expect(elapsed).toBeLessThan(2000);
    const chunks = await n.api.db.pool.query("SELECT count(*)::int AS c FROM chunks WHERE source_id = $1", [r.json.source.id]);
    expect(chunks.rows[0].c).toBeGreaterThan(1);
  });
});
