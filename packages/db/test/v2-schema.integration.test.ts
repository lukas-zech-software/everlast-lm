import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotebook } from "../src/index.ts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";

/**
 * [013-v2-persistence-postgres] T002 — v2 tables (migrations 0005–0008) and the notebook cascade
 * (DEV-04, FR-WM-01, FR-008, FR-013). Replaces the SQLite checks of the former v3-draft schema.
 */

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

const V2_TABLES = [
  "notebook_v2_metadata",
  "user_preferences",
  "notebook_user_preferences",
  "source_guides",
  "notebook_overviews",
  "chat_configurations",
  "message_feedback",
  "message_followups",
  "notes",
  "studio_artifacts",
];
const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));
const snapshot = (sourceId: string) => JSON.stringify([{ source_id: sourceId, revision: 1 }]);

async function seedAll(owner: string, nb: string) {
  const q = (sql: string, params: unknown[]) => db.pool.query(sql, params);
  const { sourceId } = await seedReadySource(db.pool, owner, nb, { title: "S", mediaType: "text/plain", pages: ["x"], embed });
  const thread = randomUUID();
  const message = randomUUID();
  await q("INSERT INTO chat_threads (id, notebook_id, user_id) VALUES ($1, $2, $3)", [thread, nb, owner]);
  await q(
    `INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, turn_id, request_id, role, kind, content, generation_epoch)
     VALUES ($1, $2, $3, $4, $5, $6, 'assistant', 'answer', 'a', 1)`,
    [message, thread, nb, owner, randomUUID(), randomUUID()]
  );
  await q("INSERT INTO notebook_v2_metadata (notebook_id) VALUES ($1)", [nb]);
  await q("INSERT INTO user_preferences (user_id, record) VALUES ($1, '{}')", [owner]);
  await q("INSERT INTO notebook_user_preferences (user_id, notebook_id, record) VALUES ($1, $2, '{}')", [owner, nb]);
  await q("INSERT INTO source_guides (source_id, revision, output_language, notebook_id, status, record) VALUES ($1, 1, 'en-US', $2, 'GuideReady', '{}')", [sourceId, nb]);
  await q("INSERT INTO notebook_overviews (cache_key, notebook_id, authorization_key, record) VALUES ($1, $2, 'k', '{}')", [randomUUID(), nb]);
  await q("INSERT INTO chat_configurations (notebook_id, user_id, record) VALUES ($1, $2, '{}')", [nb, owner]);
  await q("INSERT INTO message_feedback (notebook_id, user_id, message_id, record) VALUES ($1, $2, $3, '{}')", [nb, owner, message]);
  await q("INSERT INTO message_followups (notebook_id, user_id, message_id, output_language, record) VALUES ($1, $2, $3, 'en-US', '{}')", [nb, owner, message]);
  await q("INSERT INTO notes (id, notebook_id, owner_id, title, display_order) VALUES ($1, $2, $3, 'T', 1)", [randomUUID(), nb, owner]);
  await q(
    `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, source_revisions_snapshot)
     VALUES ($1, $2, $3, 'report', 'faq', 'Queued', 'FAQ', $4)`,
    [randomUUID(), nb, owner, snapshot(sourceId)]
  );
  return { sourceId, message };
}

const count = async (table: string, nb: string) =>
  table === "user_preferences"
    ? -1
    : (await db.pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE notebook_id = $1`, [nb])).rows[0].c as number;

describe("DEV-04 / FR-013: v2 migrations 0005–0008", () => {
  it("applies 0005–0008 in order after 0004 and creates every v2 table", async () => {
    const versions = (await db.pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => r.version);
    expect(versions.slice(-5)).toEqual(["0004_note_sources.sql", "0005_v2_workspace.sql", "0006_v2_context.sql", "0007_notes.sql", "0008_studio_artifacts.sql"]);
    const tables = (await db.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name);
    for (const t of V2_TABLES) expect(tables).toContain(t);
  });

  it("FR-WM-01 / FR-008: deleting a notebook removes every v2 row of it", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    await seedAll(owner, nb);
    for (const t of V2_TABLES.filter((t) => t !== "user_preferences")) expect(await count(t, nb)).toBe(1);
    await db.pool.query("DELETE FROM notebooks WHERE id = $1", [nb]);
    for (const t of V2_TABLES.filter((t) => t !== "user_preferences")) expect(await count(t, nb)).toBe(0);
  });

  it("CC-04: deleting a source removes its guides; deleting a chat message removes its feedback and follow-ups", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    const { sourceId, message } = await seedAll(owner, nb);
    await db.pool.query("DELETE FROM sources WHERE id = $1", [sourceId]);
    expect(await count("source_guides", nb)).toBe(0);
    await db.pool.query("DELETE FROM chat_messages WHERE id = $1", [message]);
    expect(await count("message_feedback", nb)).toBe(0);
    expect(await count("message_followups", nb)).toBe(0);
  });

  it("FR-NM-01/02: note defaults; unknown origin types and duplicate saved responses are rejected", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    const id = randomUUID();
    await db.pool.query("INSERT INTO notes (id, notebook_id, owner_id, title, display_order) VALUES ($1, $2, $3, 'T', 1)", [id, nb, owner]);
    const row = (await db.pool.query("SELECT origin_type, revision, content_md FROM notes WHERE id = $1", [id])).rows[0];
    expect(row).toEqual({ origin_type: "manual", revision: 1, content_md: "" });
    const ins = (origin: string, message: string | null) =>
      db.pool.query("INSERT INTO notes (id, notebook_id, owner_id, title, display_order, origin_type, source_message_id) VALUES ($1, $2, $3, 'T', 2, $4, $5)", [randomUUID(), nb, owner, origin, message]);
    await expect(ins("bogus", null)).rejects.toThrow();
    const m = randomUUID();
    await ins("saved_response", m);
    await expect(ins("saved_response", m)).rejects.toThrow();
  });

  it("FR-ST-10 / C-03: Studio status, subtype, payload-iff-Completed and non-empty snapshot are enforced", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, {})).notebook.id;
    const ins = (status: string, subtype: string, payload: string | null, snap: string) =>
      db.pool.query(
        `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, payload_json, source_revisions_snapshot)
         VALUES ($1, $2, $3, 'report', $4, $5, 'T', $6, $7)`,
        [randomUUID(), nb, owner, subtype, status, payload, snap]
      );
    const snap = snapshot(randomUUID());
    await expect(ins("Completed", "faq", '{"content_md":"x"}', snap)).resolves.toBeTruthy();
    await expect(ins("Completed", "faq", null, snap)).rejects.toThrow();
    await expect(ins("Running", "faq", '{"x":1}', snap)).rejects.toThrow();
    await expect(ins("Done", "faq", null, snap)).rejects.toThrow();
    await expect(ins("Queued", "poem", null, snap)).rejects.toThrow();
    await expect(ins("Queued", "faq", null, "[]")).rejects.toThrow();
  });
});
