import { deflateSync } from "node:zlib";

/**
 * Deterministic PDF fixture builder for ingestion tests and the golden eval corpus (FR-SI-01, Gate v1.0 #1).
 * Produces real PDF 1.4 files: text pages (Helvetica, WinAnsi), image-only "scanned" pages without a text
 * layer, and encrypted files whose user password is not empty. No external tool or real company content.
 */

export type PdfPage =
  | { kind: "text"; lines: string[] }
  | { kind: "image"; width?: number; height?: number }
  | { kind: "vector" };

export interface PdfOptions {
  /** Adds a Standard security handler dictionary that requires a non-empty user password. */
  encrypted?: boolean;
}

/** WinAnsiEncoding code points 0x80–0x9F that differ from Latin-1 (PDF 32000-1 Annex D). */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
  "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

function escapePdfString(text: string): string {
  // Encode to WinAnsi byte values; characters outside it become "?" so fixtures stay deterministic.
  const encoded = Array.from(text)
    .map((ch) => {
      if (WIN_ANSI[ch] !== undefined) return String.fromCharCode(WIN_ANSI[ch]!);
      const code = ch.charCodeAt(0);
      return code <= 0xff && (code < 0x80 || code > 0x9f) ? ch : "?";
    })
    .join("");
  return encoded.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function latin1(text: string): Buffer {
  return Buffer.from(text, "latin1");
}

export function buildPdf(pages: PdfPage[], options: PdfOptions = {}): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string): number => {
    objects.push(typeof body === "string" ? latin1(body) : body);
    return objects.length;
  };
  const stream = (dict: string, data: Buffer): Buffer =>
    Buffer.concat([latin1(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, latin1("\nendstream")]);

  const catalogId = add(""); // placeholder, filled later
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];

  for (const page of pages) {
    let resources = `<< /Font << /F1 ${fontId} 0 R >> >>`;
    let content: string;
    if (page.kind === "text") {
      const ops = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td"];
      for (const line of page.lines) ops.push(`(${escapePdfString(line)}) Tj T*`);
      ops.push("ET");
      content = ops.join("\n");
    } else if (page.kind === "image") {
      const w = page.width ?? 64;
      const h = page.height ?? 64;
      const pixels = Buffer.alloc(w * h, 0);
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 255; // deterministic noise "scan"
      const imageId = add(stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(pixels)));
      resources = `<< /XObject << /Im1 ${imageId} 0 R >> >>`;
      content = "q 480 0 0 680 56 80 cm /Im1 Do Q";
    } else {
      content = "0.2 0.4 0.8 rg 56 400 300 200 re f 1 0 0 RG 4 w 56 300 m 400 700 l S";
    }
    const contentId = add(stream("", latin1(content)));
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents ${contentId} 0 R >>`)
    );
  }

  objects[catalogId - 1] = latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

  let encryptRef = "";
  if (options.encrypted) {
    const hex32 = "8a".repeat(32);
    const encryptId = add(`<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${"5c".repeat(32)}> /P -44 >>`);
    encryptRef = ` /Encrypt ${encryptId} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]`;
  }

  const parts: Buffer[] = [latin1("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([latin1(`${i + 1} 0 obj\n`), body, latin1("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xrefStart = length;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(latin1(xref));
  parts.push(latin1(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${encryptRef} >>\nstartxref\n${xrefStart}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** Wraps long prose into PDF text lines (~95 chars) so each page holds realistic paragraph text. */
export function wrapLines(text: string, width = 95): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
    out.push("");
  }
  return out;
}
