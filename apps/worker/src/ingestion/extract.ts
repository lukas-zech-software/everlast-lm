import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrEngine } from "@everlast/cloud";
import { IngestionFailure, MSG_EMPTY, MSG_UNREADABLE, pageSection, type CanonicalDocument, type CanonicalPage } from "@everlast/notes/normalizer";

/** Canonical text extraction (FR-SI-01); the format-neutral parts live in `@everlast/notes/normalizer`. */
export * from "@everlast/notes/normalizer";

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
