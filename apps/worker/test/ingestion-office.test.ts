import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChunkLocatorSchema, DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE, UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { buildDocx, buildPptx, buildZip } from "@everlast/testkit/ooxml-builder";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { OFFICE_GOLDEN, docxFixture, pptxFixture } from "@everlast/testkit/multimodal-fixtures";
import { createOfficeAdapter, extractDocx, extractPptx, normalizeOffice, type OfficeRenderer } from "../src/ingestion/office.ts";
import { createWorkerHarness, prose, type WorkerHarness } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T010 — Office (DOCX/PPTX) golden extraction and page anchors (FR-SI-01, C-01;
 * spec FR-001, SC-003): every text, table, speaker note and embedded visual description reaches the normalized
 * viewer; locators are C-01 `page_span` only (slide numbers are page metadata); malformed/encrypted/empty files fail.
 */

let h: WorkerHarness;
beforeAll(async () => {
  h = await createWorkerHarness();
});
afterAll(async () => {
  await h?.close();
});

const office = { adapters: { office: createOfficeAdapter({}) } };

async function viewer(sourceId: string) {
  const pages = await h.db.pool.query<{ page_number: number; physical_page: number | null; text: string }>(
    "SELECT page_number, physical_page, text FROM source_pages WHERE source_id = $1 ORDER BY page_number",
    [sourceId]
  );
  const chunks = await h.db.pool.query("SELECT chunk_id, source_id, revision, locator, token_count, text FROM chunks WHERE source_id = $1 ORDER BY sequence", [sourceId]);
  return { pages: pages.rows, chunks: chunks.rows };
}

describe("DOCX normalization (FR-SI-01, C-01)", () => {
  it("OFFICE-01: paragraphs, tables and image descriptions land in page-anchored viewer text", () => {
    const doc = extractDocx(docxFixture());
    expect(doc.pages).toHaveLength(2);
    const page1 = doc.pages[0]!.text;
    expect(page1).toContain(OFFICE_GOLDEN.docxParagraph);
    expect(page1).toContain("Phase | Budget");
    expect(page1).toContain("Two | 340 kEUR");
    expect(page1).toContain(`Image description: ${OFFICE_GOLDEN.docxImage}`);
    expect(doc.pages[1]!.text).toContain(OFFICE_GOLDEN.docxSecondPage);
  });

  it("OFFICE-02: uploaded DOCX becomes Ready with page_span chunks whose offsets index the canonical page text", async () => {
    const { outcome, source } = await h.ingest({ name: "Falcon.docx", bytes: docxFixture(), mediaType: DOCX_MEDIA_TYPE, deps: office });
    expect(outcome.status).toBe("ready");
    expect(source.status).toBe("Ready");
    const { pages, chunks } = await viewer(source.id);
    expect(pages.map((p) => p.page_number)).toEqual([1, 2]);
    expect(pages.every((p) => p.physical_page === p.page_number)).toBe(true);
    for (const row of chunks) {
      const chunk = UnifiedDocumentChunkSchema.parse(row);
      expect("page_number" in chunk.locator).toBe(true);
      const loc = chunk.locator as { page_number: number; start_offset: number; end_offset: number };
      const page = pages.find((p) => p.page_number === loc.page_number)!;
      expect(Array.from(page.text).slice(loc.start_offset, loc.end_offset).join("")).toBe(chunk.text);
    }
    const all = chunks.map((c) => c.text).join("\n");
    for (const golden of [OFFICE_GOLDEN.docxParagraph, OFFICE_GOLDEN.docxImage, OFFICE_GOLDEN.docxSecondPage, "340 kEUR"]) expect(all).toContain(golden);
  });

  it("OFFICE-03: macros are never executed or extracted; the document text still ingests", async () => {
    const bytes = buildDocx([{ kind: "paragraph", text: "Quarterly depot memo." }], { macros: true });
    const doc = extractDocx(bytes);
    expect(doc.pages.map((p) => p.text).join("\n")).toBe("Quarterly depot memo.");
    expect(JSON.stringify(doc)).not.toContain("AutoOpen");
  });
});

describe("PPTX normalization (FR-SI-01, C-01)", () => {
  it("OFFICE-04: slides follow presentation order; slide text, tables, speaker notes and visual descriptions are kept", () => {
    const deck = extractPptx(pptxFixture());
    expect(deck.pages).toHaveLength(2);
    const [s1, s2] = deck.pages.map((p) => p.text);
    expect(s1).toContain(OFFICE_GOLDEN.slideTitle);
    expect(s1).toContain(OFFICE_GOLDEN.slideBody);
    expect(s1).toContain(`Image description: ${OFFICE_GOLDEN.slideImage}`);
    expect(s1).toContain(`Speaker notes: ${OFFICE_GOLDEN.slideNotes}`);
    expect(s2).toContain(OFFICE_GOLDEN.slide2Title);
    expect(s2).toContain("Vendor delay | Procurement");
    expect(s2).toContain(`Speaker notes: ${OFFICE_GOLDEN.slide2Notes}`);
    // The notes slide-number placeholder is not note content.
    expect(s1).not.toMatch(/Speaker notes:[\s\S]*\n1$/);
  });

  it("OFFICE-05: speaker notes form their own section, so no chunk mixes slide text with notes", async () => {
    const { outcome, source } = await h.ingest({ name: "Falcon.pptx", bytes: pptxFixture(), mediaType: PPTX_MEDIA_TYPE, deps: office });
    expect(outcome.status).toBe("ready");
    const { chunks } = await viewer(source.id);
    for (const c of chunks) {
      expect(ChunkLocatorSchema.parse(c.locator)).not.toHaveProperty("slide_number");
      expect(c.text.includes(OFFICE_GOLDEN.slideBody) && c.text.includes(OFFICE_GOLDEN.slideNotes)).toBe(false);
    }
    expect(chunks.some((c) => c.text.includes(OFFICE_GOLDEN.slideNotes))).toBe(true);
  });

  it("OFFICE-06: with the LibreOffice renderer, PDF pages are the viewer pages and notes/descriptions are supplemented per slide", async () => {
    const renderer: OfficeRenderer = {
      name: "fixture-renderer",
      async convertToPdf() {
        return buildPdf([
          { kind: "text", lines: [OFFICE_GOLDEN.slideTitle, OFFICE_GOLDEN.slideBody] },
          { kind: "text", lines: [OFFICE_GOLDEN.slide2Title, "Risk Owner", "Vendor delay Procurement"] },
        ]);
      },
    };
    const doc = await normalizeOffice(pptxFixture(), PPTX_MEDIA_TYPE, { renderer, ocr: { name: "none", recognize: async () => new Map() } });
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0]!.text).toContain(OFFICE_GOLDEN.slideBody);
    expect(doc.pages[0]!.text).toContain(`Speaker notes: ${OFFICE_GOLDEN.slideNotes}`);
    expect(doc.pages[0]!.text).toContain(`Image description: ${OFFICE_GOLDEN.slideImage}`);
    expect(doc.pages[1]!.text).toContain(`Speaker notes: ${OFFICE_GOLDEN.slide2Notes}`);
  });
});

describe("chunk structure and failures (FR-SI-01, C-01)", () => {
  it("OFFICE-07: long pages chunk to at most 600 tokens; short pages keep one short chunk; no chunk crosses a page", async () => {
    const long = prose(1500, "falcon");
    const bytes = buildDocx([{ kind: "paragraph", text: long }, { kind: "pageBreak" }, { kind: "paragraph", text: "Short closing page." }]);
    const { outcome, source } = await h.ingest({ name: "Long.docx", bytes, mediaType: DOCX_MEDIA_TYPE, deps: office });
    expect(outcome.status).toBe("ready");
    const { chunks } = await viewer(source.id);
    for (const c of chunks) expect(c.token_count).toBeLessThanOrEqual(600);
    const page2 = chunks.filter((c) => c.locator.page_number === 2);
    expect(page2.map((c) => c.text)).toEqual(["Short closing page."]);
    expect(chunks.filter((c) => c.locator.page_number === 1).length).toBeGreaterThan(1);
  });

  it("OFFICE-08: empty, non-OOXML, encrypted-like and document-less archives fail with explicit messages and release the slot", async () => {
    const cases: [string, Buffer, string][] = [
      ["Empty.docx", Buffer.alloc(0), "File is empty"],
      ["Garbage.pptx", Buffer.from("not a zip at all"), "Could not read file (password-protected or corrupted)"],
      // Password-protected OOXML is an OLE compound file, not a ZIP package.
      ["Locked.docx", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]), "Could not read file (password-protected or corrupted)"],
      ["NoBody.docx", buildZip([{ name: "[Content_Types].xml", data: "<Types/>" }]), "Could not read file (password-protected or corrupted)"],
      ["Blank.pptx", buildPptx([{ texts: [] }]), "No extractable text found"],
    ];
    for (const [name, bytes, message] of cases) {
      const nb = await h.newNotebook();
      const mediaType = name.endsWith(".pptx") ? PPTX_MEDIA_TYPE : DOCX_MEDIA_TYPE;
      const { source } = await h.ingest({ name, bytes, mediaType, deps: office, notebookId: nb });
      expect(source.status, name).toBe("Failed");
      expect(source.failure_message, name).toBe(message);
      const occupied = await h.db.pool.query("SELECT count(*)::int AS n FROM sources WHERE notebook_id = $1 AND status <> 'Failed'", [nb]);
      expect(occupied.rows[0].n).toBe(0);
    }
  });

  it("OFFICE-09: zip bombs beyond the uncompressed budget are rejected rather than expanded", () => {
    const huge = Buffer.alloc(64 * 1024 * 1024, 0x20);
    const bomb = buildZip([{ name: "word/document.xml", data: huge }]);
    expect(() => extractDocx(bomb, { maxUncompressedBytes: 16 * 1024 * 1024 })).toThrow(/Could not read file/);
  });
});

void wrapLines;
