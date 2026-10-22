import { DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE } from "@everlast/contracts";
import type { OcrEngine } from "@everlast/cloud";
import { IngestionFailure, MSG_EMPTY, MSG_UNREADABLE, extractPdf, type CanonicalDocument, type CanonicalPage } from "./extract.ts";
import { ZipArchive, ZipError, type ZipLimits } from "./zip.ts";
import { xmlEvents } from "./xml.ts";
import type { NormalizedSource, SourceAdapter } from "./pipeline.ts";

/**
 * Office normalization (FR-SI-01 Subset B, C-01, D15; specs/009 T014). DOCX and PPTX (uploaded or exported from
 * Google Docs/Slides, D11) become ordered canonical pages for the Source Inspector and `page_span` chunks:
 *
 * - Native OOXML path (always available): DOCX pages follow explicit and Word-rendered page breaks, PPTX pages follow
 *   presentation slide order. Text, tables (`cell | cell` rows) and image/shape alt-text descriptions are kept.
 * - Renderer path (architecture C8): when the LibreOffice job is configured, its PDF pages are the viewer pages and
 *   the OOXML-only evidence (speaker notes, visual descriptions) is supplemented onto the mapped page.
 *
 * Speaker notes form their own section (chunks never mix slide text and notes). A slide number is page metadata
 * (`physical_page`), never a locator variant. Macros and embedded objects are never executed or fetched.
 */

export interface OfficeRenderInput {
  bytes: Buffer;
  format: "docx" | "pptx";
  /** Private object holding the exact input generation (required by the Cloud Run job renderer). */
  object?: { name: string; generation: string } | undefined;
}

export interface OfficeRenderer {
  readonly name: string;
  convertToPdf(input: OfficeRenderInput): Promise<Buffer>;
}

export interface OfficePage {
  /** Main content blocks in reading order (paragraphs, table rows, image descriptions). */
  blocks: string[];
  /** Image/shape alt-text descriptions (already contained in `blocks` for DOCX, separate for PPTX). */
  descriptions: string[];
  notes: string | null;
}

export interface OfficeDocument {
  pages: CanonicalPage[];
  /** Raw page structure (renderer supplementation). */
  structure: OfficePage[];
}

const describe = (text: string) => `Image description: ${text.replace(/\s+/g, " ").trim()}`;
const clean = (text: string) => text.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim();

function toZip(bytes: Buffer, limits?: ZipLimits): ZipArchive {
  if (bytes.length === 0) throw new IngestionFailure("EmptyFile", MSG_EMPTY);
  try {
    return new ZipArchive(bytes, limits);
  } catch {
    throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  }
}

function readPart(zip: ZipArchive, name: string): string {
  try {
    return zip.readText(name);
  } catch (err) {
    if (err instanceof ZipError) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
    throw err;
  }
}

/** Composes a canonical page: main section, then a separate speaker-notes section. */
export function composePage(pageNumber: number, main: string[], notes: string | null): CanonicalPage {
  const body = main.map(clean).filter(Boolean).join("\n\n");
  const notesText = notes && clean(notes) ? `Speaker notes: ${clean(notes)}` : "";
  const text = notesText ? (body ? `${body}\n\n${notesText}` : notesText) : body;
  const sections: [number, number][] = [];
  if (body) sections.push([0, body.length]);
  if (notesText) sections.push([text.length - notesText.length, text.length]);
  return { page_number: pageNumber, physical_page: pageNumber, text, sections };
}

// ---------------------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------------------

export function extractDocx(bytes: Buffer, limits?: ZipLimits): OfficeDocument {
  const zip = toZip(bytes, limits);
  if (!zip.has("word/document.xml")) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  const xml = readPart(zip, "word/document.xml");

  const pages: OfficePage[] = [{ blocks: [], descriptions: [], notes: null }];
  let pendingBreak = false;
  const current = () => pages[pages.length - 1]!;
  const addBlock = (text: string, isDescription = false) => {
    const t = clean(text);
    if (!t) return;
    if (pendingBreak && current().blocks.length > 0) pages.push({ blocks: [], descriptions: [], notes: null });
    pendingBreak = false;
    current().blocks.push(t);
    if (isDescription) current().descriptions.push(t);
  };

  let inText = false;
  let para: string | null = null;
  let tableDepth = 0;
  let row: string[] = [];
  let cell: string[] | null = null;
  let rows: string[] = [];
  let deleted = 0;

  const endParagraph = () => {
    if (para === null) return;
    if (tableDepth > 0 && cell) cell.push(para);
    else addBlock(para);
    para = null;
  };

  for (const ev of xmlEvents(xml)) {
    if (ev.type === "text") {
      if (inText && deleted === 0 && para !== null) para += ev.text;
      continue;
    }
    const name = ev.name;
    if (ev.type === "open") {
      switch (name) {
        case "w:del":
          deleted++;
          break;
        case "w:p":
          para = "";
          break;
        case "w:t":
          inText = true;
          break;
        case "w:tab":
          if (para !== null) para += "\t";
          break;
        case "w:cr":
          if (para !== null) para += "\n";
          break;
        case "w:br":
          if (ev.attrs["w:type"] === "page") {
            if (tableDepth === 0) {
              const before = para;
              para = null;
              if (before !== null) addBlock(before);
              pendingBreak = true;
              para = "";
            }
          } else if (para !== null) para += "\n";
          break;
        case "w:lastRenderedPageBreak":
          if (tableDepth === 0 && para !== null) {
            const before = para;
            addBlock(before);
            pendingBreak = true;
            para = "";
          }
          break;
        case "wp:docPr": {
          const text = ev.attrs.descr || ev.attrs.title;
          if (text && deleted === 0) {
            if (tableDepth > 0 && cell) cell.push(describe(text));
            else addBlock(describe(text), true);
          }
          break;
        }
        case "w:tbl":
          if (tableDepth === 0) rows = [];
          tableDepth++;
          break;
        case "w:tr":
          if (tableDepth === 1) row = [];
          break;
        case "w:tc":
          if (tableDepth === 1) cell = [];
          break;
      }
    } else {
      switch (name) {
        case "w:del":
          deleted = Math.max(0, deleted - 1);
          break;
        case "w:t":
          inText = false;
          break;
        case "w:p":
          endParagraph();
          break;
        case "w:tc":
          if (tableDepth === 1 && cell) {
            row.push(cell.map(clean).filter(Boolean).join(" "));
            cell = null;
          }
          break;
        case "w:tr":
          if (tableDepth === 1 && row.some(Boolean)) rows.push(row.join(" | "));
          break;
        case "w:tbl":
          tableDepth--;
          if (tableDepth === 0) addBlock(rows.join("\n"));
          break;
      }
    }
  }
  const structure = pages.filter((p) => p.blocks.length > 0);
  return { structure, pages: structure.map((p, i) => composePage(i + 1, p.blocks, null)) };
}

// ---------------------------------------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------------------------------------

function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relationships(zip: ZipArchive, relsPath: string): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  if (!zip.has(relsPath)) return map;
  for (const ev of xmlEvents(readPart(zip, relsPath))) {
    if (ev.type === "open" && ev.name === "Relationship" && ev.attrs.Id && ev.attrs.Target) {
      map.set(ev.attrs.Id, { type: ev.attrs.Type ?? "", target: ev.attrs.Target });
    }
  }
  return map;
}

interface ShapeText {
  blocks: string[];
  descriptions: string[];
}

const NOTES_SKIP_PLACEHOLDERS = new Set(["sldNum", "sldImg", "hdr", "ftr", "dt"]);

/** Walks a slide or notes part: text per shape, tables as rows, alt-text descriptions. */
function walkSlide(xml: string, mode: "slide" | "notes"): ShapeText {
  const blocks: string[] = [];
  const descriptions: string[] = [];
  let inText = false;
  let para: string | null = null;
  let shapeParas: string[] = [];
  let skipShape = false;
  let tableDepth = 0;
  let rows: string[] = [];
  let row: string[] = [];
  let cell: string[] | null = null;

  for (const ev of xmlEvents(xml)) {
    if (ev.type === "text") {
      if (inText && para !== null) para += ev.text;
      continue;
    }
    const name = ev.name;
    if (ev.type === "open") {
      switch (name) {
        case "p:sp":
          shapeParas = [];
          skipShape = false;
          break;
        case "p:ph":
          if (mode === "notes" && NOTES_SKIP_PLACEHOLDERS.has(ev.attrs.type ?? "body")) skipShape = true;
          break;
        case "p:cNvPr":
          if (mode === "slide" && ev.attrs.descr?.trim()) descriptions.push(describe(ev.attrs.descr));
          break;
        case "a:p":
          para = "";
          break;
        case "a:t":
          inText = true;
          break;
        case "a:br":
          if (para !== null) para += "\n";
          break;
        case "a:tbl":
          if (tableDepth === 0) rows = [];
          tableDepth++;
          break;
        case "a:tr":
          if (tableDepth === 1) row = [];
          break;
        case "a:tc":
          if (tableDepth === 1) cell = [];
          break;
      }
    } else {
      switch (name) {
        case "a:t":
          inText = false;
          break;
        case "a:p":
          if (para !== null) {
            if (tableDepth > 0 && cell) cell.push(para);
            else shapeParas.push(para);
          }
          para = null;
          break;
        case "a:tc":
          if (tableDepth === 1 && cell) {
            row.push(cell.map(clean).filter(Boolean).join(" "));
            cell = null;
          }
          break;
        case "a:tr":
          if (tableDepth === 1 && row.some(Boolean)) rows.push(row.join(" | "));
          break;
        case "a:tbl":
          tableDepth--;
          if (tableDepth === 0 && rows.length) blocks.push(rows.join("\n"));
          break;
        case "p:sp": {
          const text = shapeParas.map(clean).filter(Boolean).join("\n");
          if (text && !skipShape) blocks.push(text);
          shapeParas = [];
          break;
        }
      }
    }
  }
  return { blocks, descriptions };
}

export function extractPptx(bytes: Buffer, limits?: ZipLimits): OfficeDocument {
  const zip = toZip(bytes, limits);
  if (!zip.has("ppt/presentation.xml")) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  const rels = relationships(zip, "ppt/_rels/presentation.xml.rels");
  const order: string[] = [];
  for (const ev of xmlEvents(readPart(zip, "ppt/presentation.xml"))) {
    if (ev.type === "open" && ev.name === "p:sldId") {
      const rel = rels.get(ev.attrs["r:id"] ?? "");
      if (rel) order.push(resolvePart("ppt", rel.target));
    }
  }
  const structure: OfficePage[] = [];
  for (const slidePath of order) {
    if (!zip.has(slidePath)) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
    const slide = walkSlide(readPart(zip, slidePath), "slide");
    const dir = slidePath.slice(0, slidePath.lastIndexOf("/"));
    const slideRels = relationships(zip, `${dir}/_rels/${slidePath.slice(dir.length + 1)}.rels`);
    let notes: string | null = null;
    for (const rel of slideRels.values()) {
      if (rel.type.endsWith("/notesSlide")) {
        const notesPath = resolvePart(dir, rel.target);
        if (zip.has(notesPath)) notes = walkSlide(readPart(zip, notesPath), "notes").blocks.join("\n") || null;
      }
    }
    structure.push({ blocks: [...slide.blocks, ...slide.descriptions], descriptions: slide.descriptions, notes });
  }
  // Every slide keeps its page number (slide n = page n), even when empty, so numbering matches the deck.
  const pages = structure.map((s, i) => composePage(i + 1, s.blocks, s.notes)).filter((p) => p.text.length > 0);
  return { structure, pages };
}

// ---------------------------------------------------------------------------------------------------------
// Normalization (native or renderer)
// ---------------------------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export interface NormalizeOfficeOptions {
  renderer?: OfficeRenderer | undefined;
  ocr?: OcrEngine | undefined;
  object?: { name: string; generation: string } | undefined;
  limits?: ZipLimits | undefined;
}

export async function normalizeOffice(bytes: Buffer, mediaType: string, options: NormalizeOfficeOptions = {}): Promise<CanonicalDocument> {
  const format = mediaType === PPTX_MEDIA_TYPE ? "pptx" : mediaType === DOCX_MEDIA_TYPE ? "docx" : null;
  if (!format) throw new IngestionFailure("UnsupportedMediaType", "Unsupported Office format");
  const native = format === "pptx" ? extractPptx(bytes, options.limits) : extractDocx(bytes, options.limits);
  if (!options.renderer) return { pages: native.pages, pageCount: native.pages.length, ocrPages: [] };

  const pdf = await options.renderer.convertToPdf({ bytes, format, object: options.object });
  const rendered = await extractPdf(pdf, options.ocr ?? { name: "none", recognize: async () => new Map() });
  const pdfPages = new Map(rendered.pages.map((p) => [p.page_number, p.text]));

  if (format === "pptx") {
    // LibreOffice exports one page per visible slide; if counts differ, keep the deterministic native pagination.
    if (rendered.pageCount !== native.structure.length) return { pages: native.pages, pageCount: native.pages.length, ocrPages: [] };
    const pages = native.structure
      .map((slide, i) => {
        const base = pdfPages.get(i + 1) ?? "";
        const extra = slide.descriptions.filter((d) => !norm(base).includes(norm(d.replace(/^Image description: /, ""))));
        return composePage(i + 1, [base, ...extra], slide.notes);
      })
      .filter((p) => p.text.length > 0);
    return { pages, pageCount: rendered.pageCount, ocrPages: rendered.ocrPages };
  }

  // DOCX: PDF pagination; each description lands on the page that contains the text right before its image.
  const supplements = new Map<number, string[]>();
  let anchor = "";
  for (const block of native.structure.flatMap((p) => p.blocks)) {
    if (!block.startsWith("Image description: ")) {
      anchor = block;
      continue;
    }
    const key = norm(anchor).slice(0, 60);
    let page = 1;
    for (const [n, text] of pdfPages) if (key && norm(text).includes(key)) page = n;
    supplements.set(page, [...(supplements.get(page) ?? []), block]);
  }
  const pages: CanonicalPage[] = [];
  for (let n = 1; n <= rendered.pageCount; n++) {
    const page = composePage(n, [pdfPages.get(n) ?? "", ...(supplements.get(n) ?? [])], null);
    if (page.text) pages.push(page);
  }
  return { pages, pageCount: rendered.pageCount, ocrPages: rendered.ocrPages };
}

export interface OfficeAdapterOptions {
  renderer?: OfficeRenderer | undefined;
  limits?: ZipLimits | undefined;
}

/** Upload adapter for `.docx` / `.pptx` (FR-SI-01): reads the received object and normalizes it. */
export function createOfficeAdapter(options: OfficeAdapterOptions): SourceAdapter {
  return async (ctx): Promise<NormalizedSource> => {
    const bytes = await ctx.readUpload();
    await ctx.progress("Parsing");
    const object = ctx.source.object_name && ctx.source.object_generation ? { name: ctx.source.object_name, generation: ctx.source.object_generation } : undefined;
    const doc = await normalizeOffice(bytes, ctx.source.media_type, { renderer: options.renderer, ocr: ctx.deps.ocr, object, limits: options.limits });
    return { doc, viewerKind: "pages", byteSize: bytes.length, screen: false };
  };
}
