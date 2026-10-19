import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { HashingTestEmbedder } from "@everlast/cloud";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook, deleteNotebook } from "../src/notebooks.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import { getOrCreateThread, publishTurn } from "../src/chat-history.ts";

/** T044/T048 — real 2-source / 15-chunk / 1-thread cascade and deletion timing (FR-WM-01, FR-WM-04). */

let db: TestDatabase;
let pool: Pool;
const embed = (t: string[]) => new HashingTestEmbedder({ NODE_ENV: "test" }).embed(t);

beforeAll(async () => {
  db = await createTestDatabase();
  pool = db.pool;
});

afterAll(async () => {
  await db?.drop();
});

const paragraphs = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} paragraph ${i + 1} content.`).join("\n\n");

async function counts(notebookId: string) {
  const q = async (table: string) => (await pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE notebook_id = $1`, [notebookId])).rows[0].c;
  return { sources: await q("sources"), revisions: await q("source_revisions"), pages: await q("source_pages"), chunks: await q("chunks"), threads: await q("chat_threads"), messages: await q("chat_messages") };
}

describe("FR-WM-01 notebook deletion cascade", () => {
  it("CASCADE-02: deleting a notebook with 2 sources, 15 chunks and 1 thread removes every row immediately", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const a = await seedReadySource(pool, owner, notebook.id, { pages: [paragraphs(8, "A")], embed });
    const b = await seedReadySource(pool, owner, notebook.id, { pages: [paragraphs(7, "B")], embed });
    const thread = await getOrCreateThread(pool, owner, notebook.id);
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [a.sourceId, b.sourceId]);
    await publishTurn(pool, { thread, snapshot, requestId: randomUUID(), question: "Q", answer: { kind: "refusal", content: "R", citations: [] } });
    expect(await counts(notebook.id)).toEqual({ sources: 2, revisions: 2, pages: 2, chunks: 15, threads: 1, messages: 2 });

    const started = performance.now();
    await deleteNotebook(pool, owner, notebook.id);
    const elapsed = performance.now() - started;
    expect(await counts(notebook.id)).toEqual({ sources: 0, revisions: 0, pages: 0, chunks: 0, threads: 0, messages: 0 });
    expect(elapsed).toBeLessThanOrEqual(2000);
  });

  it("CASCADE-03: identical uploads in another notebook keep their sources and chunks", async () => {
    const owner = await createTestUser(pool);
    const { notebook: nbA } = await createNotebook(pool, owner, {});
    const { notebook: nbB } = await createNotebook(pool, owner, {});
    await seedReadySource(pool, owner, nbA.id, { pages: [paragraphs(5, "Same")], embed });
    await seedReadySource(pool, owner, nbB.id, { pages: [paragraphs(5, "Same")], embed });
    await deleteNotebook(pool, owner, nbA.id);
    expect((await counts(nbB.id)).chunks).toBe(5);
  });

  it("PERF-01: relational + chunk cascade of a large notebook stays within 2.0 s P95 (5 samples)", async () => {
    const owner = await createTestUser(pool);
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { notebook } = await createNotebook(pool, owner, {});
      for (let s = 0; s < 5; s++) await seedReadySource(pool, owner, notebook.id, { pages: [paragraphs(400, `S${s}`)], embed });
      expect((await counts(notebook.id)).chunks).toBe(2000);
      const started = performance.now();
      await deleteNotebook(pool, owner, notebook.id);
      samples.push(performance.now() - started);
    }
    samples.sort((x, y) => x - y);
    console.log(JSON.stringify({ case: "PERF-01", chunks_per_notebook: 2000, samples_ms: samples.map(Math.round) }));
    expect(samples[4]!).toBeLessThanOrEqual(2000);
  }, 180_000);
});
