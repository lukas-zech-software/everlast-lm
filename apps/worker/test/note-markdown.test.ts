import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { countOccupiedSources, getSourceById, reserveSources } from "@everlast/db";
import type { Embedder } from "@everlast/cloud";
import { ingestNoteSource } from "../src/ingestion/note-markdown.ts";
import { createWorkerHarness, type WorkerHarness } from "./support.ts";

/**
 * [007-notes-pinboard-lifecycle] T017 rewritten for the owner decision 2026-10-20 — a note-source runs the v1
 * Markdown ingestion at once (FR-SI-01, FR-NM-03, C-01, FR-WM-07). Real PostgreSQL and local storage.
 */

let h: WorkerHarness;
beforeAll(async () => {
  h = await createWorkerHarness();
});
afterAll(async () => {
  await h?.close();
});

async function reserve(markdown: string) {
  const [admitted] = await reserveSources(h.db.pool, h.ownerId, h.notebookId, [
    { attempt_id: randomUUID(), title: "Combined notes", media_type: "note_markdown", declared_bytes: Buffer.byteLength(markdown) },
  ]);
  expect(admitted!.admitted).toBe(true);
  return admitted!.source!;
}

describe("FR-SI-01, C-01, FR-NM-03: note-source ingestion over the v1 pipeline", () => {
  it("publishes Ready C-01 chunks with Markdown sections and embeddings", async () => {
    const markdown = "# Raw data\n\nProject codename is TITAN-77.\n\n# Second note\n\nAnother finding.";
    const source = await reserve(markdown);
    const outcome = await ingestNoteSource({ pool: h.db.pool, storage: h.storage, embedder: h.embedder }, { source, markdown });
    expect(outcome.status).toBe("ready");
    const ready = (await getSourceById(h.db.pool, source.id))!;
    expect(ready).toMatchObject({ status: "Ready", media_type: "note_markdown", active_revision: 1, word_count: 12 });
    const rows = (await h.db.pool.query("SELECT chunk_id, source_id, revision, locator, token_count, text FROM chunks WHERE source_id = $1 ORDER BY sequence", [source.id])).rows;
    expect(rows.map((r) => r.text)).toEqual(["# Raw data\n\nProject codename is TITAN-77.", "# Second note\n\nAnother finding."]);
    for (const r of rows) expect(UnifiedDocumentChunkSchema.safeParse(r).success).toBe(true);
  });

  it("marks the source Failed and releases its slot when ingestion fails, without retrying later", async () => {
    const failing: Embedder = { model: h.embedder.model, embed: async () => { throw new Error("upstream detail"); } };
    const before = await countOccupiedSources(h.db.pool, h.notebookId);
    const markdown = "# Note\n\nBody";
    const source = await reserve(markdown);
    expect(await countOccupiedSources(h.db.pool, h.notebookId)).toBe(before + 1);
    const outcome = await ingestNoteSource({ pool: h.db.pool, storage: h.storage, embedder: failing }, { source, markdown });
    expect(outcome.status).toBe("failed");
    expect((await getSourceById(h.db.pool, source.id))!.status).toBe("Failed");
    expect(await countOccupiedSources(h.db.pool, h.notebookId)).toBe(before);
    expect(await h.storage.listVersions(`notebooks/${h.notebookId}/sources/${source.id}/`)).toHaveLength(0);
  });
});
