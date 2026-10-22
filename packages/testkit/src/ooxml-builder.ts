import { deflateRawSync } from "node:zlib";

/**
 * Deterministic Office Open XML / media fixture builders (FR-SI-01 Subset B, C-01; specs/009 T002).
 * Produces real ZIP-packaged `.docx` / `.pptx` files with text, tables, speaker notes and image alt-text
 * descriptions, PCM `.wav` files, and minimal MP3/M4A containers. No external tool or real company content.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes a ZIP archive (deflate, fixed timestamp) with the entries in the given order. */
export function buildZip(entries: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------------------

export type DocxBlock =
  | { kind: "paragraph"; text: string; heading?: boolean }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; description: string; title?: string }
  | { kind: "pageBreak" };

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function docxBlock(block: DocxBlock, index: number): string {
  switch (block.kind) {
    case "paragraph":
      return `<w:p>${block.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${esc(block.text)}</w:t></w:r></w:p>`;
    case "table":
      return `<w:tbl>${block.rows
        .map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${esc(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
        .join("")}</w:tbl>`;
    case "image":
      return `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="${index + 1}" name="Picture ${index + 1}" descr="${esc(block.description)}"${
        block.title ? ` title="${esc(block.title)}"` : ""
      }/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"/></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    case "pageBreak":
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
}

export function buildDocx(blocks: DocxBlock[], options: { macros?: boolean } = {}): Buffer {
  const body = blocks.map(docxBlock).join("");
  const entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W_NS}><w:body>${body}<w:sectPr/></w:body></w:document>` },
  ];
  if (options.macros) entries.push({ name: "word/vbaProject.bin", data: "Sub AutoOpen()\nShell \"calc\"\nEnd Sub" });
  return buildZip(entries);
}

// ---------------------------------------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------------------------------------

export interface PptxSlide {
  texts: string[];
  table?: string[][];
  notes?: string;
  images?: { description: string }[];
}

const P_NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function slideXml(slide: PptxSlide): string {
  let id = 1;
  const shapes = slide.texts
    .map((text) => `<p:sp><p:nvSpPr><p:cNvPr id="${++id}" name="Text ${id}"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`)
    .join("");
  const table = slide.table
    ? `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${++id}" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${slide.table
        .map((row) => `<a:tr>${row.map((cell) => `<a:tc><a:txBody><a:p><a:r><a:t>${esc(cell)}</a:t></a:r></a:p></a:txBody></a:tc>`).join("")}</a:tr>`)
        .join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    : "";
  const pics = (slide.images ?? [])
    .map((img) => `<p:pic><p:nvPicPr><p:cNvPr id="${++id}" name="Picture" descr="${esc(img.description)}"/></p:nvPicPr></p:pic>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P_NS}><p:cSld><p:spTree>${shapes}${table}${pics}</p:spTree></p:cSld></p:sld>`;
}

function notesXml(notes: string, slideNumber: number): string {
  // Slide-number placeholder text must not be treated as note content.
  return `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P_NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${notes
    .split("\n")
    .map((line) => `<a:p><a:r><a:t>${esc(line)}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number"/><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${slideNumber}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
}

export function buildPptx(slides: PptxSlide[]): Buffer {
  const entries: { name: string; data: string }[] = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    },
  ];
  // Slide files are deliberately numbered in reverse so readers must follow presentation order, not file names.
  const fileNumber = (i: number) => slides.length - i;
  entries.push({
    name: "ppt/presentation.xml",
    data: `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P_NS}><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
  });
  entries.push({
    name: "ppt/_rels/presentation.xml.rels",
    data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${fileNumber(i)}.xml"/>`
      )
      .join("")}</Relationships>`,
  });
  slides.forEach((slide, i) => {
    const n = fileNumber(i);
    entries.push({ name: `ppt/slides/slide${n}.xml`, data: slideXml(slide) });
    if (slide.notes !== undefined) {
      entries.push({
        name: `ppt/slides/_rels/slide${n}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`,
      });
      entries.push({ name: `ppt/notesSlides/notesSlide${n}.xml`, data: notesXml(slide.notes, i + 1) });
    }
  });
  return buildZip(entries);
}

// ---------------------------------------------------------------------------------------------------------
// Audio containers
// ---------------------------------------------------------------------------------------------------------

/** 8 kHz mono 16-bit PCM WAV of silence with the given duration (header carries the exact duration). */
export function buildWav(durationMs: number, sampleRate = 8000): Buffer {
  const samples = Math.round((durationMs / 1000) * sampleRate);
  const dataBytes = samples * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

/** Minimal MP3 byte stream (ID3v2 header + MPEG-1 Layer III frame headers); transcribed only by test doubles. */
export function buildMp3(frames = 32): Buffer {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;
  return Buffer.concat([id3, ...Array.from({ length: frames }, () => frame)]);
}

/** Minimal ISO BMFF (M4A) `ftyp` box; transcribed only by test doubles. */
export function buildM4a(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftyp", 4, "ascii");
  box.write("M4A ", 8, "ascii");
  box.writeUInt32BE(0, 12);
  box.write("M4A ", 16, "ascii");
  box.write("isom", 20, "ascii");
  return box;
}
