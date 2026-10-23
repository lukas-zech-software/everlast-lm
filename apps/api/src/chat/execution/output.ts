import { CanonicalNumberSchema, type CodeExecutionFailureCode, type ComputedResult } from "@everlast/contracts";
import { OUTPUT_FILE_RE, type HarnessResult, type SandboxFile } from "./runtime.ts";

/**
 * Validation of everything returned by hostile code before publication (FR-GC-08, FR-GC-02, NFR-SEC-02;
 * specs/010 T020). Values must be canonical finite numbers citing only the manifest's supporting chunks; PNGs must
 * decode structurally; SVGs pass a strict allowlist (no scripts, handlers, foreignObject, external references,
 * fonts, DTDs) and are re-serialized from the parsed tokens. Anything else is rejected, never repaired into a
 * guessed result.
 */

export const MAX_CHART_BYTES = 10_000_000;
export const MAX_CHARTS = 5;
export const MAX_RESULTS = 50;
const MAX_DIMENSION = 8_000;

export class OutputError extends Error {
  readonly failureCode: CodeExecutionFailureCode;
  constructor(failureCode: CodeExecutionFailureCode, message: string) {
    super(message);
    this.name = "OutputError";
    this.failureCode = failureCode;
  }
}

const plain = (text: string, max: number) =>
  text
    .replace(/\[\[/g, "[")
    .replace(/\]\]/g, "]")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function validateComputedResults(results: HarnessResult[], supportingChunkIds: readonly string[]): ComputedResult[] {
  if (results.length === 0) throw new OutputError("InvalidOutput", "The code reported no result");
  if (results.length > MAX_RESULTS) throw new OutputError("InvalidOutput", "Too many results");
  const allowed = new Set(supportingChunkIds);
  return results.map((r) => {
    if (!CanonicalNumberSchema.safeParse(r.value).success) throw new OutputError("InvalidOutput", "A result is not a finite number");
    const label = plain(r.label, 200);
    if (!label) throw new OutputError("InvalidOutput", "A result has no label");
    const unit = r.unit === null ? null : plain(r.unit, 40) || null;
    const sources = r.sources.length > 0 ? Array.from(new Set(r.sources)) : [...supportingChunkIds];
    if (sources.some((s) => !allowed.has(s))) throw new OutputError("CitationInvalid", "A result cites data outside the supplied inputs");
    return { label, value: r.value, unit, citations: sources };
  });
}

// ---- PNG --------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Structural PNG check: signature, IHDR first, every chunk CRC, IDAT present, IEND last, no trailing bytes. */
export function validatePng(buf: Buffer): { width: number; height: number } {
  if (buf.length < 8 + 25 + 12 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new OutputError("InvalidOutput", "not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let index = 0;
  for (;;) {
    if (offset + 12 > buf.length) throw new OutputError("InvalidOutput", "truncated PNG");
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type) || offset + 12 + length > buf.length) throw new OutputError("InvalidOutput", "malformed PNG chunk");
    const body = buf.subarray(offset + 4, offset + 8 + length);
    if (crc32(body) !== buf.readUInt32BE(offset + 8 + length)) throw new OutputError("InvalidOutput", "PNG CRC mismatch");
    if (index === 0) {
      if (type !== "IHDR" || length !== 13) throw new OutputError("InvalidOutput", "PNG must start with IHDR");
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
      if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new OutputError("InvalidOutput", "PNG dimensions out of range");
    }
    if (type === "IDAT") sawIdat = true;
    offset += 12 + length;
    index++;
    if (type === "IEND") break;
  }
  if (!sawIdat || offset !== buf.length) throw new OutputError("InvalidOutput", "PNG without image data or with trailing bytes");
  return { width, height };
}

// ---- SVG allowlist ----------------------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "clipPath",
  "use", "style", "title", "desc", "linearGradient", "radialGradient", "stop", "pattern", "mask", "symbol", "marker",
]);
/** Dropped together with their content (descriptive only). */
const DROPPED_ELEMENTS = new Set(["metadata"]);
const ALLOWED_NAMESPACES = new Map([
  ["xmlns", "http://www.w3.org/2000/svg"],
  ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
]);
const ENTITY = /&(?!(?:lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/;

function unsafeCss(text: string): boolean {
  const lowered = text.toLowerCase();
  if (/@import|@font-face|expression\s*\(|javascript:|behavior\s*:|-moz-binding|\\/.test(lowered)) return true;
  for (const match of lowered.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/g)) if (!match[2]!.startsWith("#")) return true;
  return /url\s*\(/.test(lowered.replace(/url\s*\(\s*(['"]?)#[^)'"]*\1\s*\)/g, ""));
}

function escapeAttr(value: string): string {
  return value.replace(/&(?!(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function reject(message: string): never {
  throw new OutputError("SecurityViolation", `unsafe SVG: ${message}`);
}

/** Returns a re-serialized SVG containing only allow-listed elements/attributes; throws on anything active. */
export function sanitizeSvg(input: string): string {
  if (Buffer.byteLength(input) > MAX_CHART_BYTES) throw new OutputError("TemporaryStorageLimit", "SVG too large");
  const text = input.replace(/^﻿/, "");
  const out: string[] = [];
  const stack: string[] = [];
  let dropDepth = 0;
  let sawRoot = false;
  let i = 0;
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|[^<]+|</g;
  for (let m = token.exec(text); m; m = token.exec(text)) {
    if (m.index !== i) reject("unparsable content");
    i = token.lastIndex;
    const raw = m[0];
    if (raw.startsWith("<!--")) continue;
    if (raw.startsWith("<![CDATA[")) {
      if (stack.at(-1) !== "style" || unsafeCss(m[1] ?? "")) reject("CDATA outside a safe style");
      if (dropDepth === 0) out.push(raw);
      continue;
    }
    if (raw.startsWith("<!")) reject("DOCTYPE/declaration");
    if (raw.startsWith("<?")) {
      if (out.length > 0 || sawRoot || !/^<\?xml\s/.test(raw)) reject("processing instruction");
      continue;
    }
    if (m[2]) {
      const name = m[2];
      if (stack.at(-1) !== name) reject("mismatched closing tag");
      stack.pop();
      if (dropDepth > 0) dropDepth--;
      else out.push(`</${name}>`);
      continue;
    }
    if (m[3]) {
      const name = m[3];
      const selfClosing = m[5] === "/";
      if (!sawRoot && name !== "svg") reject("root element must be svg");
      sawRoot = true;
      if (dropDepth > 0 || DROPPED_ELEMENTS.has(name)) {
        if (!selfClosing) {
          stack.push(name);
          dropDepth++;
        }
        continue;
      }
      if (!ALLOWED_ELEMENTS.has(name)) reject(`element <${name}>`);
      const attrs: string[] = [];
      for (const a of (m[4] ?? "").matchAll(/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const attr = a[1]!;
        const value = a[2] ?? a[3] ?? "";
        if (!/^[A-Za-z_][\w:.-]*$/.test(attr) || /^on/i.test(attr)) reject(`attribute ${attr}`);
        if (ENTITY.test(value)) reject("entity reference");
        if (attr.startsWith("xmlns")) {
          if (ALLOWED_NAMESPACES.get(attr) !== value) reject(`namespace ${attr}`);
        } else if (attr === "href" || attr.endsWith(":href")) {
          if (!/^#[\w.:-]+$/.test(value)) reject("non-local reference");
        } else if (/javascript:|data:|vbscript:/i.test(value) || unsafeCss(value)) {
          reject(`attribute value of ${attr}`);
        }
        attrs.push(` ${attr}="${escapeAttr(value)}"`);
      }
      out.push(`<${name}${attrs.join("")}${selfClosing ? "/>" : ">"}`);
      if (!selfClosing) stack.push(name);
      continue;
    }
    if (raw === "<") reject("stray <");
    // Text node.
    if (dropDepth > 0) continue;
    if (ENTITY.test(raw)) reject("entity reference");
    if (stack.at(-1) === "style" && unsafeCss(raw)) reject("unsafe style");
    if (!sawRoot && raw.trim()) reject("text before root");
    out.push(raw);
  }
  if (i !== text.length || stack.length > 0 || !sawRoot) reject("unbalanced document");
  return out.join("");
}

export interface ValidChart {
  name: string;
  mimeType: "image/png" | "image/svg+xml";
  content: Buffer;
}

/** Accepts only chart_N.png / chart_N.svg whose bytes really are that format (MIME derived, not trusted). */
export function validateChartFiles(files: SandboxFile[]): ValidChart[] {
  const charts = files.filter((f) => OUTPUT_FILE_RE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (charts.length > MAX_CHARTS) throw new OutputError("InvalidOutput", "too many charts");
  return charts.map((f) => {
    if (f.content.length > MAX_CHART_BYTES) throw new OutputError("TemporaryStorageLimit", "chart too large");
    if (f.content.length === 0) throw new OutputError("InvalidOutput", "empty chart");
    if (f.name.endsWith(".png")) {
      validatePng(f.content);
      return { name: f.name, mimeType: "image/png" as const, content: f.content };
    }
    const svg = f.content.toString("utf8");
    if (!Buffer.from(svg, "utf8").equals(f.content)) throw new OutputError("InvalidOutput", "SVG is not UTF-8");
    return { name: f.name, mimeType: "image/svg+xml" as const, content: Buffer.from(sanitizeSvg(svg), "utf8") };
  });
}
