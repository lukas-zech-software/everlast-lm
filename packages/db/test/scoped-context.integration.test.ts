import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { SourceNotReadyError, SourceSnapshotInvalidError, UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { HashingTestEmbedder } from "@everlast/cloud";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook, deleteNotebook, NotebookForbiddenError } from "../src/notebooks.ts";
import { reserveSources } from "../src/quota.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import { buildOrTsQuery, getSnapshotChunksByIds, readSourceForInspection, retrieveScopedChunks } from "../src/scoped-context.ts";

/**
 * T014–T018 / T031 — C-02 hybrid retrieval and singleton inspection against PostgreSQL + pgvector
 * (FR-SI-03, FR-SI-04, NFR-EVAL-04, D1). Uses the deterministic lexical test embedder.
 */

let db: TestDatabase;
let pool: Pool;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (texts: string[]) => embedder.embed(texts);

beforeAll(async () => {
  db = await createTestDatabase();
  pool = db.pool;
});

afterAll(async () => {
  await db?.drop();
});

async function query(text: string) {
  return (await embedder.embed([text]))[0]!;
}

describe("C-02 hybrid retrieval (FR-SI-03, NFR-EVAL-04)", () => {
  it("RET-01: deselected Source B never leaks: 'Project Aurora' query returns only Source A chunks", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const a = await seedReadySource(pool, owner, notebook.id, {
      title: "Policy_2024.pdf",
      pages: ["Travel policy 2024 covers economy flights.\n\nHotel budgets are capped per city."],
      embed,
    });
    const b = await seedReadySource(pool, owner, notebook.id, {
      title: "Policy_2025.pdf",
      pages: ["Project Aurora budget is $4.2M.\n\nAurora launches in spring."],
      embed,
    });
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [a.sourceId]);
    const results = await retrieveScopedChunks(pool, snapshot, {
      queryText: "What is the Project Aurora budget?",
      queryEmbedding: await query("What is the Project Aurora budget?"),
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.source_id === a.sourceId)).toBe(true);
    expect(results.some((c) => c.text.includes("Aurora"))).toBe(false);

    const both = await captureScopeSnapshot(pool, owner, notebook.id, [a.sourceId, b.sourceId]);
    const all = await retrieveScopedChunks(pool, both, {
      queryText: "What is the Project Aurora budget?",
      queryEmbedding: await query("What is the Project Aurora budget?"),
    });
    expect(all[0]!.text).toContain("Project Aurora budget is $4.2M");
  });

  it("RET-02: full-text path finds exact identifiers; results are valid C-01 chunks with deterministic order", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const s = await seedReadySource(pool, owner, notebook.id, {
      pages: ["Codename OMEGA-991 is restricted.\n\nGeneral notes about logistics.\n\nMore unrelated material."],
      embed,
    });
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [s.sourceId]);
    const opts = { queryText: "omega 991", queryEmbedding: await query("unrelated vector words"), limit: 3 };
    const first = await retrieveScopedChunks(pool, snapshot, opts);
    const second = await retrieveScopedChunks(pool, snapshot, opts);
    expect(first[0]!.text).toContain("OMEGA-991");
    expect(first.map((c) => c.chunk_id)).toEqual(second.map((c) => c.chunk_id));
    for (const { score: _s, ...chunk } of first) expect(UnifiedDocumentChunkSchema.safeParse(chunk).success).toBe(true);
    expect(buildOrTsQuery("What is the?")).toBeNull();
    expect(buildOrTsQuery("Robert'); DROP TABLE chunks;--")).toBe("robert | drop | table | chunks");
  });

  it("RET-03: identical text in another notebook (same owner) is never returned", async () => {
    const owner = await createTestUser(pool);
    const { notebook: nbA } = await createNotebook(pool, owner, {});
    const { notebook: nbB } = await createNotebook(pool, owner, {});
    const text = "Shared identical paragraph about OMEGA-991 secrets.";
    const sa = await seedReadySource(pool, owner, nbA.id, { pages: [text], embed });
    const sb = await seedReadySource(pool, owner, nbB.id, { pages: [text], embed });
    const snapshot = await captureScopeSnapshot(pool, owner, nbA.id, [sa.sourceId]);
    const results = await retrieveScopedChunks(pool, snapshot, { queryText: "OMEGA-991", queryEmbedding: await query(text) });
    expect(results.map((r) => r.source_id)).toEqual([sa.sourceId]);
    expect(results.some((r) => r.source_id === sb.sourceId)).toBe(false);
  });

  it("RET-04: deletion or revision replacement after capture fails retrieval instead of substituting content", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const s = await seedReadySource(pool, owner, notebook.id, { pages: ["Original revision text."], embed });
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [s.sourceId]);
    await pool.query("UPDATE sources SET active_revision = 2 WHERE id = $1", [s.sourceId]);
    await expect(
      retrieveScopedChunks(pool, snapshot, { queryText: "original", queryEmbedding: await query("original") })
    ).rejects.toBeInstanceOf(SourceSnapshotInvalidError);
    await pool.query("UPDATE sources SET active_revision = 1 WHERE id = $1", [s.sourceId]);
    await deleteNotebook(pool, owner, notebook.id);
    await expect(
      retrieveScopedChunks(pool, snapshot, { queryText: "original", queryEmbedding: await query("original") })
    ).rejects.toBeInstanceOf(SourceSnapshotInvalidError);
  });

  it("RET-05: citation hydration only resolves chunk IDs inside the snapshot", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const a = await seedReadySource(pool, owner, notebook.id, { pages: ["Alpha only."], embed });
    const b = await seedReadySource(pool, owner, notebook.id, { pages: ["Beta only."], embed });
    const snapshot = await captureScopeSnapshot(pool, owner, notebook.id, [a.sourceId]);
    const resolved = await getSnapshotChunksByIds(pool, snapshot, [...a.chunkIds, ...b.chunkIds, "garbage", randomUUID()]);
    expect(resolved.map((c) => c.chunk_id)).toEqual(a.chunkIds);
  });
});

describe("FR-SI-04 singleton inspection", () => {
  it("INS-01: returns ordered canonical pages and chunks; foreign highlight never resolves", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const report = await seedReadySource(pool, owner, notebook.id, {
      title: "Report.pdf",
      pages: ["Page one intro.\n\nPage one detail.", "Page two only paragraph."],
      embed,
    });
    const other = await seedReadySource(pool, owner, notebook.id, { pages: ["Other source."], embed });
    const content = await readSourceForInspection(pool, owner, notebook.id, report.sourceId, { highlightChunkId: report.chunkIds[2] });
    expect(content.source).toMatchObject({ id: report.sourceId, title: "Report.pdf", revision: 1, page_count: 2 });
    expect(content.pages.map((p) => p.page_number)).toEqual([1, 2]);
    expect(content.chunks.map((c) => c.chunk_id)).toEqual(report.chunkIds);
    expect(content.highlight).toEqual({ chunk_id: report.chunkIds[2], page_number: 2, start_offset: 0, end_offset: 24 });
    const foreign = await readSourceForInspection(pool, owner, notebook.id, report.sourceId, { highlightChunkId: other.chunkIds[0] });
    expect(foreign.highlight).toBeNull();
    expect(JSON.stringify(foreign)).not.toContain("Other source.");
  });

  it("INS-02: inspection requires owner, notebook membership and Ready status", async () => {
    const owner = await createTestUser(pool);
    const intruder = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const s = await seedReadySource(pool, owner, notebook.id, { pages: ["Secret page."], embed });
    await expect(readSourceForInspection(pool, intruder, notebook.id, s.sourceId)).rejects.toBeInstanceOf(NotebookForbiddenError);
    const [pending] = await reserveSources(pool, owner, notebook.id, [
      { attempt_id: randomUUID(), title: "p.pdf", media_type: "application/pdf", declared_bytes: 1 },
    ]);
    await expect(readSourceForInspection(pool, owner, notebook.id, pending!.source!.id)).rejects.toBeInstanceOf(SourceNotReadyError);
    const { notebook: other } = await createNotebook(pool, owner, {});
    await expect(readSourceForInspection(pool, owner, other.id, s.sourceId)).rejects.toMatchObject({ code: "InvalidScope" });
  });

  it("INS-03: page batches paginate with a cursor bound to the immutable revision", async () => {
    const owner = await createTestUser(pool);
    const { notebook } = await createNotebook(pool, owner, {});
    const pages = Array.from({ length: 6 }, (_, i) => `Page ${i + 1} ${"x".repeat(100)}`);
    const s = await seedReadySource(pool, owner, notebook.id, { pages, embed });
    const first = await readSourceForInspection(pool, owner, notebook.id, s.sourceId, { maxChars: 250 });
    expect(first.pages.map((p) => p.page_number)).toEqual([1, 2]);
    expect(first.next_cursor).toBe("r1p3");
    const second = await readSourceForInspection(pool, owner, notebook.id, s.sourceId, { maxChars: 250, cursor: first.next_cursor! });
    expect(second.pages.map((p) => p.page_number)).toEqual([3, 4]);
    expect(second.chunks.every((c) => [3, 4].includes((c.locator as { page_number: number }).page_number))).toBe(true);
    await expect(readSourceForInspection(pool, owner, notebook.id, s.sourceId, { cursor: "r9p3" })).rejects.toBeInstanceOf(SourceSnapshotInvalidError);
  });
});
