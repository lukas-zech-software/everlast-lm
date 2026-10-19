import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { processIngestJob } from "../src/ingestion/pipeline.ts";
import { createWorkerHarness, FixtureOcr, prose, type WorkerHarness } from "./support.ts";

/** T007 [US1] — FR-SI-01 acceptance scenarios against real parsing, PostgreSQL and storage. */

let h: WorkerHarness;

beforeAll(async () => {
  h = await createWorkerHarness();
});

afterAll(async () => {
  await h?.close();
});

async function chunksOf(sourceId: string) {
  const rows = await h.db.pool.query(
    "SELECT chunk_id, source_id, revision, locator, token_count, text FROM chunks WHERE source_id = $1 ORDER BY sequence",
    [sourceId]
  );
  return rows.rows;
}

async function pageText(sourceId: string, page: number): Promise<string> {
  const row = await h.db.pool.query("SELECT text FROM source_pages WHERE source_id = $1 AND page_number = $2", [sourceId, page]);
  return row.rows[0].text;
}

describe("FR-SI-01: Text, Markdown, PDF & Copied Text Ingestion", () => {
  it("US1-01: Upload multi-page PDF with scanned page produces valid chunks", async () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      i === 3 ? ({ kind: "image" } as const) : ({ kind: "text", lines: wrapLines(`Page ${i + 1} findings. ${prose(150, `p${i + 1}`)}`) } as const)
    );
    const ocr = new FixtureOcr({ 4: "Scanned appendix: the OCR extracted warranty clause covers 36 months." });
    const { outcome, source } = await h.ingest({ name: "Report.pdf", bytes: buildPdf(pages), mediaType: "application/pdf", ocr });

    expect(outcome.status).toBe("ready");
    expect(source.status).toBe("Ready");
    expect(ocr.calls).toEqual([[4]]); // OCR runs only for the page without a text layer
    const chunks = await chunksOf(source.id);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(UnifiedDocumentChunkSchema.safeParse(chunk).success).toBe(true);
    const page4 = chunks.filter((c) => c.locator.page_number === 4);
    expect(page4).toHaveLength(1);
    expect(page4[0].locator.physical_page).toBe(4);
    expect(page4[0].text).toContain("warranty clause covers 36 months");
    expect(new Set(chunks.map((c) => c.locator.page_number))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("US1-02: Paste raw clipboard text (1,500 words) becomes a Ready 'Pasted text' source selectable for chat", async () => {
    const text = prose(1500, "meeting");
    const { outcome, source } = await h.ingest({ name: "Pasted text", bytes: Buffer.from(text), mediaType: "copied_text" });
    expect(outcome).toMatchObject({ status: "ready", words: 1500 });
    expect(source).toMatchObject({ title: "Pasted text", status: "Ready", word_count: 1500, active_revision: 1 });
    const chunks = await chunksOf(source.id);
    expect(chunks.every((c) => c.locator.physical_page === undefined)).toBe(true);
  });

  it("US1-03: Password-protected PDF fails gracefully with the exact message", async () => {
    const encrypted = buildPdf([{ kind: "text", lines: ["confidential"] }], { encrypted: true });
    const { outcome, source } = await h.ingest({ name: "Locked.pdf", bytes: encrypted, mediaType: "application/pdf" });
    expect(outcome).toMatchObject({ status: "failed", message: "Could not read file (password-protected or corrupted)" });
    expect(source).toMatchObject({ status: "Failed", failure_message: "Could not read file (password-protected or corrupted)" });
    const corrupt = await h.ingest({ name: "Broken.pdf", bytes: Buffer.from("%PDF-1.7\nnot really a pdf"), mediaType: "application/pdf" });
    expect(corrupt.source.failure_message).toBe("Could not read file (password-protected or corrupted)");
    expect((await chunksOf(source.id)).length).toBe(0);
    // The raw object of a failed source is purged.
    expect(await h.storage.listVersions(`notebooks/${source.notebook_id}/sources/${source.id}/`)).toEqual([]);
  });

  it("US1-04: TXT and Markdown locators index the canonical text exactly (no physical page)", async () => {
    const md = "# Title\n\nIntro paragraph with émojis 🚀 and ünïcode.\n\n## Section Two\n\nSecond section body.\nMore lines here.\n";
    const { source } = await h.ingest({ name: "Architecture_Spec.md", bytes: Buffer.from(md), mediaType: "text/markdown" });
    expect(source.status).toBe("Ready");
    const canonical = Array.from(await pageText(source.id, 1));
    const chunks = await chunksOf(source.id);
    expect(chunks).toHaveLength(2); // headings are hard section boundaries
    for (const c of chunks) {
      expect(c.locator.page_number).toBe(1);
      expect(c.locator.physical_page).toBeUndefined();
      expect(canonical.slice(c.locator.start_offset, c.locator.end_offset).join("")).toBe(c.text);
    }
    expect(chunks[0].text.startsWith("# Title")).toBe(true);
    expect(chunks[1].text.startsWith("## Section Two")).toBe(true);

    const txt = "First paragraph.\r\n\r\nSecond 🧪 paragraph.\n";
    const t = await h.ingest({ name: "notes.txt", bytes: Buffer.from(txt), mediaType: "text/plain" });
    const tc = await chunksOf(t.source.id);
    const tcanon = Array.from(await pageText(t.source.id, 1));
    expect(tc).toHaveLength(1);
    expect(tcanon.slice(tc[0].locator.start_offset, tc[0].locator.end_offset).join("")).toBe(tc[0].text);
  });

  it("US1-05: States follow Uploading → Processing → Ready and Ready publishes atomically", async () => {
    const { source } = await h.ingest({ name: "state.txt", bytes: Buffer.from(prose(50)), mediaType: "text/plain" });
    expect(source.status).toBe("Ready");
    const revision = await h.db.pool.query("SELECT revision, word_count, embedding_model FROM source_revisions WHERE source_id = $1", [source.id]);
    expect(revision.rows).toEqual([{ revision: 1, word_count: 50, embedding_model: "test-hashing-embedder-v1" }]);
  });

  it("US1-06: Duplicate/late jobs for the same attempt never re-ingest or publish twice", async () => {
    const { source } = await h.ingest({ name: "dup.txt", bytes: Buffer.from(prose(80)), mediaType: "text/plain" });
    const before = (await chunksOf(source.id)).length;
    const replay = await processIngestJob(
      { pool: h.db.pool, storage: h.storage, embedder: h.embedder, ocr: new FixtureOcr() },
      { source_id: source.id, attempt_id: source.attempt_id }
    );
    expect(replay).toEqual({ status: "stale", reason: "status_Ready" });
    expect((await chunksOf(source.id)).length).toBe(before);
    const wrongAttempt = await processIngestJob(
      { pool: h.db.pool, storage: h.storage, embedder: h.embedder, ocr: new FixtureOcr() },
      { source_id: source.id, attempt_id: "00000000-0000-4000-8000-000000000000" }
    );
    expect(wrongAttempt.status).toBe("stale");
  });
});
