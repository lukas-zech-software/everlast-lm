import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotebook, findReusableNoteSource, getNoteSourceProvenance, noteSourceOriginKey, recordNoteSourceProvenance, reserveSources } from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [007-notes-pinboard-lifecycle] owner decision 2026-10-20 — note-source provenance and reuse in PostgreSQL
 * (migration 0004_note_sources.sql; FR-NM-03, FR-NM-04 FR-015, SRS §5.6).
 */

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));

describe("0004_note_sources: note_markdown sources and provenance", () => {
  it("accepts note_markdown sources and still rejects unknown media types", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    const [ok] = await reserveSources(db.pool, owner, nb, [{ attempt_id: randomUUID(), title: "Note", media_type: "note_markdown", declared_bytes: 4 }]);
    expect(ok!.admitted).toBe(true);
    await expect(db.pool.query("UPDATE sources SET media_type = 'image/png' WHERE id = $1", [ok!.source!.id])).rejects.toThrow();
  });

  it("finds a Ready note-source by its (note_id, revision) set, scoped to notebook and owner, and cascades on delete", async () => {
    const owner = await createTestUser(db.pool);
    const other = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    const nb2 = (await createNotebook(db.pool, owner, {})).notebook.id;
    const { sourceId } = await seedReadySource(db.pool, owner, nb, { title: "Combined notes", mediaType: "note_markdown", pages: ["# A\n\none"], embed });
    const a = randomUUID();
    const b = randomUUID();
    const origins = [{ note_id: a, revision: 2, title: "A" }, { note_id: b, revision: 1, title: "B" }];
    expect(noteSourceOriginKey(origins)).toBe(noteSourceOriginKey([...origins].reverse()));
    expect(noteSourceOriginKey(origins)).not.toBe(noteSourceOriginKey([{ ...origins[0]!, revision: 3 }, origins[1]!]));

    await recordNoteSourceProvenance(db.pool, { notebook_id: nb, source_id: sourceId, origin_notes: origins, origin_citations: [] });
    expect(await findReusableNoteSource(db.pool, owner, nb, noteSourceOriginKey(origins))).toBe(sourceId);
    expect(await findReusableNoteSource(db.pool, owner, nb2, noteSourceOriginKey(origins))).toBeNull();
    await expect(findReusableNoteSource(db.pool, other, nb, noteSourceOriginKey(origins))).rejects.toThrow();
    expect((await getNoteSourceProvenance(db.pool, nb, [sourceId])).get(sourceId)).toMatchObject({ origin_notes: origins, origin_citations: [] });

    await db.pool.query("UPDATE sources SET status = 'Failed' WHERE id = $1", [sourceId]);
    expect(await findReusableNoteSource(db.pool, owner, nb, noteSourceOriginKey(origins))).toBeNull();
    await db.pool.query("DELETE FROM sources WHERE id = $1", [sourceId]);
    expect((await db.pool.query("SELECT count(*)::int AS c FROM note_source_provenance WHERE source_id = $1", [sourceId])).rows[0].c).toBe(0);
  });
});
