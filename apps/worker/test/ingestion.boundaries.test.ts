import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { getQuotaSummary } from "@everlast/db";
import { createWorkerHarness, FixtureOcr, prose, type WorkerHarness } from "./support.ts";

/** T008 [US1] — FR-SI-01 / FR-WM-07 boundary and error cases (exact messages, inclusive limits). */

let h: WorkerHarness;

beforeAll(async () => {
  h = await createWorkerHarness();
});

afterAll(async () => {
  await h?.close();
});

/** Builds text with exactly `words` whitespace-separated words. */
function exactWords(words: number): string {
  return Array.from({ length: words }, (_, i) => `w${i % 997}`).join(" ");
}

describe("FR-SI-01 boundaries", () => {
  it("US1-B01: empty .txt/.md (0 bytes) is rejected with 'File is empty'", async () => {
    for (const mediaType of ["text/plain", "text/markdown"]) {
      const { source } = await h.ingest({ name: "empty", bytes: Buffer.alloc(0), mediaType });
      expect(source).toMatchObject({ status: "Failed", failure_message: "File is empty" });
    }
  });

  it("US1-B02: whitespace-only file is rejected with 'File is empty'", async () => {
    const { source } = await h.ingest({ name: "blank.md", bytes: Buffer.from(" \n\t\n  \r\n"), mediaType: "text/markdown" });
    expect(source).toMatchObject({ status: "Failed", failure_message: "File is empty" });
  });

  it("US1-B03: vector-graphics-only PDF (OCR yields 0 tokens) fails with 'No extractable text found'", async () => {
    const ocr = new FixtureOcr();
    const { source } = await h.ingest({ name: "art.pdf", bytes: buildPdf([{ kind: "vector" }, { kind: "image" }]), mediaType: "application/pdf", ocr });
    expect(ocr.calls).toEqual([[1, 2]]);
    expect(source).toMatchObject({ status: "Failed", failure_message: "No extractable text found" });
  });

  it("US1-B06: exactly 500,000 extracted words is accepted", async () => {
    const { outcome, source } = await h.ingest({ name: "max.txt", bytes: Buffer.from(exactWords(500_000)), mediaType: "text/plain" });
    expect(outcome.status).toBe("ready");
    expect(source.word_count).toBe(500_000);
  }, 120_000);

  it("US1-B07: 500,001 words fails with 'Exceeds 500,000 words limit' and releases the slot", async () => {
    const notebookId = await h.newNotebook();
    const { source } = await h.ingest({ name: "over.txt", bytes: Buffer.from(exactWords(500_001)), mediaType: "text/plain", notebookId });
    expect(source).toMatchObject({ status: "Failed", failure_message: "Exceeds 500,000 words limit" });
    expect((await getQuotaSummary(h.db.pool, h.ownerId, notebookId)).sources_used).toBe(0);
    expect(await h.storage.listVersions(`notebooks/${notebookId}/sources/${source.id}/`)).toEqual([]);
    expect((await h.db.pool.query("SELECT 1 FROM chunks WHERE source_id = $1", [source.id])).rowCount).toBe(0);
  }, 120_000);

  it("US1-B08: copied text with 1 code point after outer trim is accepted", async () => {
    const { source } = await h.ingest({ name: "Pasted text", bytes: Buffer.from("   🦊  "), mediaType: "copied_text" });
    expect(source).toMatchObject({ status: "Ready", word_count: 1 });
    const chunk = (await h.db.pool.query("SELECT text, locator FROM chunks WHERE source_id = $1", [source.id])).rows[0];
    expect(chunk.text).toBe("🦊");
    expect(chunk.locator).toEqual({ page_number: 1, start_offset: 3, end_offset: 4 });
  });

  it("US1-B09: copied text with 0 code points after trim is rejected", async () => {
    const { source } = await h.ingest({ name: "Pasted text", bytes: Buffer.from("  \n "), mediaType: "copied_text" });
    expect(source).toMatchObject({ status: "Failed", failure_message: "File is empty" });
  });

  it("US1-B10: invalid UTF-8 text is reported as unreadable, never as a partial source", async () => {
    const { source } = await h.ingest({ name: "bad.txt", bytes: Buffer.from([0x48, 0x69, 0xff, 0xfe, 0x00]), mediaType: "text/plain" });
    expect(source).toMatchObject({ status: "Failed", failure_message: "Could not read file (password-protected or corrupted)" });
  });

  it("US1-B11: Unicode outside the BMP keeps exact code-point locators across logical pages", async () => {
    const paragraph = "Emoji 🧬 science and 中文 text with 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 letters. ";
    const text = Array.from({ length: 1200 }, (_, i) => `${paragraph}#${i}.${i % 40 === 39 ? "\n\n" : ""}`).join("");
    const { source } = await h.ingest({ name: "unicode.txt", bytes: Buffer.from(text), mediaType: "text/plain" });
    expect(source.status).toBe("Ready");
    const pages = (await h.db.pool.query("SELECT page_number, text FROM source_pages WHERE source_id = $1 ORDER BY page_number", [source.id])).rows;
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((p) => p.text).join("")).toBe(text);
    const chunks = (await h.db.pool.query("SELECT text, locator, token_count FROM chunks WHERE source_id = $1 ORDER BY sequence", [source.id])).rows;
    const byPage = new Map(pages.map((p) => [p.page_number, Array.from(p.text as string)]));
    for (const c of chunks) {
      expect(byPage.get(c.locator.page_number)!.slice(c.locator.start_offset, c.locator.end_offset).join("")).toBe(c.text);
      expect(c.token_count).toBeLessThanOrEqual(600);
    }
  });

  it("US1-B12: PDF pages keep native text and paragraph structure; OCR is not called when every page has text", async () => {
    const ocr = new FixtureOcr();
    const pdf = buildPdf([{ kind: "text", lines: wrapLines("Alpha paragraph one.\n\nBeta paragraph two.") }]);
    const { source } = await h.ingest({ name: "native.pdf", bytes: pdf, mediaType: "application/pdf", ocr });
    expect(ocr.calls).toEqual([]);
    const page = (await h.db.pool.query("SELECT text FROM source_pages WHERE source_id = $1", [source.id])).rows[0].text;
    expect(page).toBe("Alpha paragraph one.\n\nBeta paragraph two.");
  });

  it("US1-B13: a long prose PDF page is split toward 300–600 token chunks within the page", async () => {
    const pdf = buildPdf([{ kind: "text", lines: wrapLines(prose(1400)).slice(0, 52) }, { kind: "text", lines: wrapLines(prose(500, "beta")).slice(0, 52) }]);
    const { source } = await h.ingest({ name: "long.pdf", bytes: pdf, mediaType: "application/pdf" });
    const chunks = (await h.db.pool.query("SELECT token_count, locator FROM chunks WHERE source_id = $1 ORDER BY sequence", [source.id])).rows;
    expect(chunks.every((c) => c.token_count <= 600)).toBe(true);
    expect(chunks.filter((c) => c.locator.page_number === 1).length).toBeGreaterThanOrEqual(1);
    // No chunk crosses a page boundary.
    expect(new Set(chunks.map((c) => c.locator.page_number))).toEqual(new Set([1, 2]));
  });
});

describe("PDF text encoding", () => {
  it("US1-B14: WinAnsi characters such as € and curly quotes survive PDF extraction", async () => {
    const { source } = await h.ingest({ name: "eur.pdf", bytes: buildPdf([{ kind: "text", lines: ["Budget is €1.37M — “approved”."] }]), mediaType: "application/pdf" });
    const text = (await h.db.pool.query("SELECT text FROM source_pages WHERE source_id = $1", [source.id])).rows[0].text;
    expect(text).toBe("Budget is €1.37M — “approved”.");
  });
});
