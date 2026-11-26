import { DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE } from "@everlast/contracts";
import type { OcrEngine } from "@everlast/cloud";
import {
  IngestionFailure,
  MSG_EMPTY,
  MSG_UNREADABLE,
  extractPdf,
  type CanonicalDocument,
  type CanonicalPage,
} from "./extract.ts";
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
  convertToPdf: (input: OfficeRenderInput) => Promise<Buffer>;
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
const clean = (text: string) =>
  text
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

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
export function composePage(
  pageNumber: number,
  main: string[],
  notes: string | null,
): CanonicalPage {
  const body = main.map(clean).filter(Boolean).join("\n\n");
  const cleanedNotes = notes ? clean(notes) : "";
  const notesText = cleanedNotes ? `Speaker notes: ${cleanedNotes}` : "";
  const text = [body, notesText].filter(Boolean).join("\n\n");
  const sections: Array<[number, number]> = [];
  if (body) sections.push([0, body.length]);
  if (notesText) sections.push([text.length - notesText.length, text.length]);
  return { page_number: pageNumber, physical_page: pageNumber, text, sections };
}

// ---------------------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------------------

interface DocxParserState {
  pages: OfficePage[];
  currentPage: OfficePage;
  pendingBreak: boolean;
  inText: boolean;
  para: string | null;
  tableDepth: number;
  row: string[];
  cell: string[] | null;
  rows: string[];
  deleted: number;
}

function addDocxBlock(state: DocxParserState, text: string, isDescription = false): void {
  const cleaned = clean(text);
  if (!cleaned) return;
  if (state.pendingBreak && state.currentPage.blocks.length > 0) {
    state.currentPage = { blocks: [], descriptions: [], notes: null };
    state.pages.push(state.currentPage);
  }
  state.pendingBreak = false;
  state.currentPage.blocks.push(cleaned);
  if (isDescription) state.currentPage.descriptions.push(cleaned);
}

function breakDocxPage(state: DocxParserState): void {
  if (state.tableDepth !== 0) return;
  const before = state.para;
  state.para = null;
  if (before !== null) addDocxBlock(state, before);
  state.pendingBreak = true;
  state.para = "";
}

function addDocxImageDescription(state: DocxParserState, attrs: Record<string, string>): void {
  const descr = attrs.descr ?? "";
  const text = descr.length > 0 ? descr : attrs.title;
  if (!text || state.deleted !== 0) return;
  if (state.tableDepth > 0 && state.cell) {
    state.cell.push(describe(text));
  } else {
    addDocxBlock(state, describe(text), true);
  }
}

function appendToDocxPara(state: DocxParserState, suffix: string): void {
  if (state.para !== null) state.para += suffix;
}

function handleDocxOpen(state: DocxParserState, name: string, attrs: Record<string, string>): void {
  switch (name) {
    case "w:del":
      state.deleted++;
      break;
    case "w:p":
      state.para = "";
      break;
    case "w:t":
      state.inText = true;
      break;
    case "w:tab":
      appendToDocxPara(state, "\t");
      break;
    case "w:cr":
      appendToDocxPara(state, "\n");
      break;
    case "w:br":
      if (attrs["w:type"] === "page") breakDocxPage(state);
      else appendToDocxPara(state, "\n");
      break;
    case "w:lastRenderedPageBreak":
      if (state.para !== null) breakDocxPage(state);
      break;
    case "wp:docPr":
      addDocxImageDescription(state, attrs);
      break;
    case "w:tbl":
      if (state.tableDepth === 0) state.rows = [];
      state.tableDepth++;
      break;
    case "w:tr":
      if (state.tableDepth === 1) state.row = [];
      break;
    case "w:tc":
      if (state.tableDepth === 1) state.cell = [];
      break;
  }
}

function closeDocxParagraph(state: DocxParserState): void {
  if (state.para === null) return;
  if (state.tableDepth > 0 && state.cell) state.cell.push(state.para);
  else addDocxBlock(state, state.para);
  state.para = null;
}

function handleDocxClose(state: DocxParserState, name: string): void {
  switch (name) {
    case "w:del":
      state.deleted = Math.max(0, state.deleted - 1);
      break;
    case "w:t":
      state.inText = false;
      break;
    case "w:p":
      closeDocxParagraph(state);
      break;
    case "w:tc":
      if (state.tableDepth === 1 && state.cell) {
        state.row.push(state.cell.map(clean).filter(Boolean).join(" "));
        state.cell = null;
      }
      break;
    case "w:tr":
      if (state.tableDepth === 1 && state.row.some(Boolean)) state.rows.push(state.row.join(" | "));
      break;
    case "w:tbl":
      state.tableDepth--;
      if (state.tableDepth === 0) addDocxBlock(state, state.rows.join("\n"));
      break;
  }
}

export function extractDocx(bytes: Buffer, limits?: ZipLimits): OfficeDocument {
  const zip = toZip(bytes, limits);
  if (!zip.has("word/document.xml")) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  const xml = readPart(zip, "word/document.xml");

  const initialPage: OfficePage = { blocks: [], descriptions: [], notes: null };
  const state: DocxParserState = {
    pages: [initialPage],
    currentPage: initialPage,
    pendingBreak: false,
    inText: false,
    para: null,
    tableDepth: 0,
    row: [],
    cell: null,
    rows: [],
    deleted: 0,
  };

  for (const ev of xmlEvents(xml)) {
    if (ev.type === "text") {
      if (state.inText && state.deleted === 0 && state.para !== null) state.para += ev.text;
    } else if (ev.type === "open") {
      handleDocxOpen(state, ev.name, ev.attrs);
    } else {
      handleDocxClose(state, ev.name);
    }
  }
  const structure = state.pages.filter((p) => p.blocks.length > 0);
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

function relationships(
  zip: ZipArchive,
  relsPath: string,
): Map<string, { type: string; target: string }> {
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

interface SlideParserState {
  mode: "slide" | "notes";
  blocks: string[];
  descriptions: string[];
  inText: boolean;
  para: string | null;
  shapeParas: string[];
  skipShape: boolean;
  tableDepth: number;
  rows: string[];
  row: string[];
  cell: string[] | null;
}

function handleSlideOpen(
  state: SlideParserState,
  name: string,
  attrs: Record<string, string>,
): void {
  switch (name) {
    case "p:sp":
      state.shapeParas = [];
      state.skipShape = false;
      break;
    case "p:ph":
      if (state.mode === "notes" && NOTES_SKIP_PLACEHOLDERS.has(attrs.type ?? "body")) {
        state.skipShape = true;
      }
      break;
    case "p:cNvPr":
      if (state.mode === "slide" && attrs.descr?.trim()) {
        state.descriptions.push(describe(attrs.descr));
      }
      break;
    case "a:p":
      state.para = "";
      break;
    case "a:t":
      state.inText = true;
      break;
    case "a:br":
      if (state.para !== null) state.para += "\n";
      break;
    case "a:tbl":
      if (state.tableDepth === 0) state.rows = [];
      state.tableDepth++;
      break;
    case "a:tr":
      if (state.tableDepth === 1) state.row = [];
      break;
    case "a:tc":
      if (state.tableDepth === 1) state.cell = [];
      break;
  }
}

function closeSlideParagraph(state: SlideParserState): void {
  if (state.para === null) return;
  if (state.tableDepth > 0 && state.cell) state.cell.push(state.para);
  else state.shapeParas.push(state.para);
  state.para = null;
}

function closeSlideCell(state: SlideParserState): void {
  if (state.tableDepth !== 1 || !state.cell) return;
  state.row.push(state.cell.map(clean).filter(Boolean).join(" "));
  state.cell = null;
}

function handleSlideClose(state: SlideParserState, name: string): void {
  switch (name) {
    case "a:t":
      state.inText = false;
      break;
    case "a:p":
      closeSlideParagraph(state);
      break;
    case "a:tc":
      closeSlideCell(state);
      break;
    case "a:tr":
      if (state.tableDepth === 1 && state.row.some(Boolean)) state.rows.push(state.row.join(" | "));
      break;
    case "a:tbl":
      state.tableDepth--;
      if (state.tableDepth === 0 && state.rows.length) state.blocks.push(state.rows.join("\n"));
      break;
    case "p:sp": {
      const text = state.shapeParas.map(clean).filter(Boolean).join("\n");
      if (text && !state.skipShape) state.blocks.push(text);
      state.shapeParas = [];
      break;
    }
  }
}

/** Walks a slide or notes part: text per shape, tables as rows, alt-text descriptions. */
function walkSlide(xml: string, mode: "slide" | "notes"): ShapeText {
  const state: SlideParserState = {
    mode,
    blocks: [],
    descriptions: [],
    inText: false,
    para: null,
    shapeParas: [],
    skipShape: false,
    tableDepth: 0,
    rows: [],
    row: [],
    cell: null,
  };

  for (const ev of xmlEvents(xml)) {
    if (ev.type === "text") {
      if (state.inText && state.para !== null) state.para += ev.text;
    } else if (ev.type === "open") {
      handleSlideOpen(state, ev.name, ev.attrs);
    } else {
      handleSlideClose(state, ev.name);
    }
  }
  return { blocks: state.blocks, descriptions: state.descriptions };
}

function readSlideOrder(zip: ZipArchive): string[] {
  const rels = relationships(zip, "ppt/_rels/presentation.xml.rels");
  const order: string[] = [];
  for (const ev of xmlEvents(readPart(zip, "ppt/presentation.xml"))) {
    if (ev.type === "open" && ev.name === "p:sldId") {
      const rel = rels.get(ev.attrs["r:id"] ?? "");
      if (rel) order.push(resolvePart("ppt", rel.target));
    }
  }
  return order;
}

function readSlideNotes(zip: ZipArchive, slidePath: string): string | null {
  const dir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const slideRels = relationships(zip, `${dir}/_rels/${slidePath.slice(dir.length + 1)}.rels`);
  let notes: string | null = null;
  for (const rel of slideRels.values()) {
    if (!rel.type.endsWith("/notesSlide")) continue;
    const notesPath = resolvePart(dir, rel.target);
    if (zip.has(notesPath)) {
      notes = walkSlide(readPart(zip, notesPath), "notes").blocks.join("\n") || null;
    }
  }
  return notes;
}

export function extractPptx(bytes: Buffer, limits?: ZipLimits): OfficeDocument {
  const zip = toZip(bytes, limits);
  if (!zip.has("ppt/presentation.xml")) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  const structure: OfficePage[] = [];
  for (const slidePath of readSlideOrder(zip)) {
    if (!zip.has(slidePath)) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
    const slide = walkSlide(readPart(zip, slidePath), "slide");
    const notes = readSlideNotes(zip, slidePath);
    structure.push({
      blocks: [...slide.blocks, ...slide.descriptions],
      descriptions: slide.descriptions,
      notes,
    });
  }
  // Every slide keeps its page number (slide n = page n), even when empty, so numbering matches the deck.
  const pages = structure
    .map((s, i) => composePage(i + 1, s.blocks, s.notes))
    .filter((p) => p.text.length > 0);
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

function resolveOfficeFormat(mediaType: string): "docx" | "pptx" {
  if (mediaType === PPTX_MEDIA_TYPE) return "pptx";
  if (mediaType === DOCX_MEDIA_TYPE) return "docx";
  throw new IngestionFailure("UnsupportedMediaType", "Unsupported Office format");
}

function mergeRenderedPptx(
  native: OfficeDocument,
  rendered: CanonicalDocument,
  pdfPages: Map<number, string>,
): CanonicalDocument {
  // LibreOffice exports one page per visible slide; if counts differ, keep the deterministic native pagination.
  if (rendered.pageCount !== native.structure.length) {
    return { pages: native.pages, pageCount: native.pages.length, ocrPages: [] };
  }
  const pages = native.structure
    .map((slide, i) => {
      const base = pdfPages.get(i + 1) ?? "";
      const extra = slide.descriptions.filter(
        (d) => !norm(base).includes(norm(d.replace(/^Image description: /, ""))),
      );
      return composePage(i + 1, [base, ...extra], slide.notes);
    })
    .filter((p) => p.text.length > 0);
  return { pages, pageCount: rendered.pageCount, ocrPages: rendered.ocrPages };
}

function mergeRenderedDocx(
  native: OfficeDocument,
  rendered: CanonicalDocument,
  pdfPages: Map<number, string>,
): CanonicalDocument {
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
    for (const [n, text] of pdfPages) {
      if (key && norm(text).includes(key)) page = n;
    }
    supplements.set(page, [...(supplements.get(page) ?? []), block]);
  }
  const pages: CanonicalPage[] = [];
  for (let n = 1; n <= rendered.pageCount; n++) {
    const page = composePage(n, [pdfPages.get(n) ?? "", ...(supplements.get(n) ?? [])], null);
    if (page.text) pages.push(page);
  }
  return { pages, pageCount: rendered.pageCount, ocrPages: rendered.ocrPages };
}

export async function normalizeOffice(
  bytes: Buffer,
  mediaType: string,
  options: NormalizeOfficeOptions = {},
): Promise<CanonicalDocument> {
  const format = resolveOfficeFormat(mediaType);
  const native =
    format === "pptx" ? extractPptx(bytes, options.limits) : extractDocx(bytes, options.limits);
  if (!options.renderer) {
    return { pages: native.pages, pageCount: native.pages.length, ocrPages: [] };
  }

  const pdf = await options.renderer.convertToPdf({ bytes, format, object: options.object });
  const rendered = await extractPdf(
    pdf,
    options.ocr ?? { name: "none", recognize: () => Promise.resolve(new Map()) },
  );
  const pdfPages = new Map(rendered.pages.map((p) => [p.page_number, p.text]));
  return format === "pptx"
    ? mergeRenderedPptx(native, rendered, pdfPages)
    : mergeRenderedDocx(native, rendered, pdfPages);
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
    const object =
      ctx.source.object_name && ctx.source.object_generation
        ? { name: ctx.source.object_name, generation: ctx.source.object_generation }
        : undefined;
    const doc = await normalizeOffice(bytes, ctx.source.media_type, {
      renderer: options.renderer,
      ocr: ctx.deps.ocr,
      object,
      limits: options.limits,
    });
    return { doc, viewerKind: "pages", byteSize: bytes.length, screen: false };
  };
}
