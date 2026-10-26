import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrEngine } from "@everlast/cloud";

/**
 * Canonical text extraction (FR-SI-01). Every format becomes ordered pages of canonical text; chunk
 * locators and the Source Inspector both index this exact text by Unicode code point.
 */

export const MSG_UNREADABLE = "Could not read file (password-protected or corrupted)";
export const MSG_EMPTY = "File is empty";
export const MSG_NO_TEXT = "No extractable text found";
export const MSG_TOO_MANY_WORDS = "Exceeds 500,000 words limit";

export class IngestionFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IngestionFailure";
    this.code = code;
  }
}

export interface CanonicalPage {
  page_number: number;
  /** Physical PDF page; omitted for text-only sources. */
  physical_page?: number | undefined;
  text: string;
  /** Section boundaries as UTF-16 ranges [start, end) within `text`; chunks never cross them. */
  sections: [number, number][];
  /** Article section selector (web, `dom_path` locators; specs/009). */
  dom_selector?: string | undefined;
  /** Transcript segment interval in integer ms (audio/video, `time_span` locators; specs/009). */
  start_ms?: number | undefined;
  end_ms?: number | undefined;
}

export interface CanonicalDocument {
  pages: CanonicalPage[];
  pageCount: number;
  ocrPages: number[];
}

export { countWords } from "@everlast/contracts";

/** Logical page size for text-only sources (bounded rows and inspector pagination for 500k-word files). */
export const TEXT_PAGE_TARGET = 20_000;

/** Whole-page section, trimmed of surrounding whitespace (paragraphs are preferred cut points inside it). */
export function pageSection(text: string): [number, number][] {
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return end > start ? [[start, end]] : [];
}

/** Markdown sections: each ATX heading starts a new section (UTF-16 ranges, trimmed). */
export function markdownSections(text: string): [number, number][] {
  const sections: [number, number][] = [];
  const headings = [...text.matchAll(/^ {0,3}#{1,6}\s/gm)].map((m) => m.index!);
  const cuts = [0, ...headings.filter((i) => i > 0), text.length];
  for (let i = 0; i < cuts.length - 1; i++) {
    const segment = text.slice(cuts[i], cuts[i + 1]);
    const lead = segment.length - segment.trimStart().length;
    const trimmedEnd = segment.trimEnd().length;
    if (trimmedEnd > lead) sections.push([cuts[i]! + lead, cuts[i]! + trimmedEnd]);
  }
  return sections;
}

/**
 * Splits text into logical pages of about TEXT_PAGE_TARGET UTF-16 units, cutting at the last blank line
 * (else newline, else whitespace) before the target. Pages are exact consecutive substrings.
 */
export function splitLogicalPages(text: string, target = TEXT_PAGE_TARGET): string[] {
  const pages: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= target) {
      pages.push(text.slice(start));
      break;
    }
    const window = text.slice(start, start + target);
    let cut = window.lastIndexOf("\n\n");
    if (cut < target / 2) cut = window.lastIndexOf("\n");
    if (cut < target / 2) cut = window.search(/\s\S*$/);
    if (cut <= 0) cut = target;
    // Never split a surrogate pair.
    const code = text.charCodeAt(start + cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
    pages.push(text.slice(start, start + cut));
    start += cut;
  }
  return pages;
}

export function decodeUtf8Text(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  }
  if (text.includes("\u0000")) throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** Text formats; `note_markdown` (notes converted to a source, FR-NM-03) is parsed exactly like uploaded Markdown. */
export function extractPlainText(bytes: Buffer, mediaType: "text/plain" | "text/markdown" | "copied_text" | "note_markdown"): CanonicalDocument {
  if (bytes.length === 0) throw new IngestionFailure("EmptyFile", MSG_EMPTY);
  const text = decodeUtf8Text(bytes);
  if (!text.trim()) throw new IngestionFailure("EmptyFile", MSG_EMPTY);
  const pages = splitLogicalPages(text)
    .map((pageText, i) => ({
      page_number: i + 1,
      text: pageText,
      sections: mediaType === "text/markdown" || mediaType === "note_markdown" ? markdownSections(pageText) : pageSection(pageText),
    }))
    .filter((page) => page.sections.length > 0);
  return { pages, pageCount: pages.length, ocrPages: [] };
}

interface PdfTextItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
  height: number;
}

function pageTextFromItems(items: PdfTextItem[]): string {
  let out = "";
  let lastY: number | null = null;
  let lastHeight = 0;
  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5] ?? 0;
    if (lastY !== null) {
      const gap = lastY - y;
      const height = Math.max(lastHeight, item.height, 1);
      if (gap > height * 1.8) out = `${out.replace(/\s+$/, "")}\n\n`;
      else if (gap > height * 0.5 && !out.endsWith("\n")) out += "\n";
    }
    out += item.str;
    lastY = y;
    lastHeight = item.height;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractPdf(bytes: Buffer, ocr: OcrEngine): Promise<CanonicalDocument> {
  if (bytes.length === 0) throw new IngestionFailure("EmptyFile", MSG_EMPTY);
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch {
    // PasswordException, InvalidPDFException and any malformed structure share the card's message.
    throw new IngestionFailure("Unreadable", MSG_UNREADABLE);
  }
  try {
    const native: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      native.push(pageTextFromItems(content.items.filter((it) => "str" in it) as unknown as PdfTextItem[]));
      page.cleanup();
    }
    const scanned = native.flatMap((text, i) => (text.trim() ? [] : [i + 1]));
    const recognized = scanned.length > 0 ? await ocr.recognize(bytes, scanned) : new Map<number, string>();
    const pages: CanonicalPage[] = native.map((text, i) => {
      const pageNumber = i + 1;
      const pageText = text.trim() ? text : (recognized.get(pageNumber) ?? "").replace(/\r\n?/g, "\n").trim();
      return { page_number: pageNumber, physical_page: pageNumber, text: pageText, sections: pageSection(pageText) };
    });
    return { pages: pages.filter((p) => p.text.length > 0), pageCount: pdf.numPages, ocrPages: [...recognized.keys()] };
  } finally {
    await loadingTask.destroy();
  }
}
