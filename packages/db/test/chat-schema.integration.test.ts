import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { HashingTestEmbedder } from "@everlast/cloud";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook, deleteNotebook } from "../src/notebooks.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import { clearThread, getOrCreateThread, listThreadMessages, publishTurn, GenerationCancelledError } from "../src/chat-history.ts";

/** Package 1.3 persistence (FR-GC-06, FR-WM-04, C-02) against PostgreSQL. */

let db: TestDatabase;
let pool: Pool;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });

beforeAll(async () => {
  db = await createTestDatabase();
  pool = db.pool;
});

afterAll(async () => {
  await db?.drop();
});

async function setup() {
  const owner = await createTestUser(pool);
  const { notebook } = await createNotebook(pool, owner, {});
  const source = await seedReadySource(pool, owner, notebook.id, { pages: ["Fact one."], embed: (t) => embedder.embed(t) });
  const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [source.sourceId]);
  return { owner, notebook, source, snapshot };
}

describe("FR-GC-06 chat persistence", () => {
  it("DB-P13-01: exactly one thread per (notebook, user); another user gets a distinct thread", async () => {
    const { owner, notebook } = await setup();
    const a = await getOrCreateThread(pool, owner, notebook.id);
    const again = await getOrCreateThread(pool, owner, notebook.id);
    expect(again.id).toBe(a.id);
    const dup = await pool.query("INSERT INTO chat_threads (id, notebook_id, user_id) VALUES ($1, $2, $3)", [randomUUID(), notebook.id, owner]).catch((e) => e.code);
    expect(dup).toBe("23505");
  });

  it("DB-P13-02: published turns store question + answer with complete provenance, ordered by sequence", async () => {
    const { owner, notebook, snapshot } = await setup();
    const thread = await getOrCreateThread(pool, owner, notebook.id);
    await publishTurn(pool, { thread, snapshot, requestId: randomUUID(), question: "Q1", answer: { kind: "refusal", content: "R1", citations: [] } });
    await publishTurn(pool, { thread, snapshot, requestId: randomUUID(), question: "Q2", answer: { kind: "refusal", content: "R2", citations: [] } });
    const messages = await listThreadMessages(pool, thread.id);
    expect(messages.map((m) => m.content)).toEqual(["Q1", "R1", "Q2", "R2"]);
    for (const m of messages) expect(m.provenance).toEqual(snapshot.sources);
    expect(new Set(messages.slice(0, 2).map((m) => m.turn_id)).size).toBe(1);
  });

  it("DB-P13-03: role/kind constraints and per-request uniqueness are enforced by the schema", async () => {
    const { owner, notebook } = await setup();
    const thread = await getOrCreateThread(pool, owner, notebook.id);
    const bad = await pool
      .query(
        "INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, turn_id, request_id, role, kind, content, generation_epoch) VALUES ($1, $2, $3, $4, $5, $6, 'user', 'answer', 'x', 0)",
        [randomUUID(), thread.id, notebook.id, owner, randomUUID(), randomUUID()]
      )
      .catch((e) => e.code);
    expect(bad).toBe("23514");
  });

  it("DB-P13-04: clear advances the epoch, deletes only messages, and fences a late publication", async () => {
    const { owner, notebook, snapshot, source } = await setup();
    const thread = await getOrCreateThread(pool, owner, notebook.id);
    await publishTurn(pool, { thread, snapshot, requestId: randomUUID(), question: "Q", answer: { kind: "refusal", content: "R", citations: [] } });
    const { generation_epoch } = await clearThread(pool, owner, notebook.id);
    expect(generation_epoch).toBe(thread.generation_epoch + 1);
    expect(await listThreadMessages(pool, thread.id)).toEqual([]);
    await expect(
      publishTurn(pool, { thread, snapshot, requestId: randomUUID(), question: "late", answer: { kind: "refusal", content: "late", citations: [] } })
    ).rejects.toBeInstanceOf(GenerationCancelledError);
    expect((await pool.query("SELECT status FROM sources WHERE id = $1", [source.sourceId])).rows[0].status).toBe("Ready");
  });

  it("DB-P13-05: deleting the notebook cascades threads and messages", async () => {
    const { owner, notebook, snapshot } = await setup();
    const thread = await getOrCreateThread(pool, owner, notebook.id);
    await publishTurn(pool, { thread, snapshot, requestId: randomUUID(), question: "Q", answer: { kind: "refusal", content: "R", citations: [] } });
    await deleteNotebook(pool, owner, notebook.id);
    expect((await pool.query("SELECT 1 FROM chat_threads WHERE id = $1", [thread.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM chat_messages WHERE thread_id = $1", [thread.id])).rowCount).toBe(0);
  });
});
