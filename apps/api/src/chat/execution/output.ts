import {
  CanonicalNumberSchema,
  type CodeExecutionFailureCode,
  type ComputedResult,
} from "@everlast/contracts";
import { plainLabel } from "../sanitize.ts";
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

const plain = plainLabel;

export function validateComputedResults(
  results: HarnessResult[],
  supportingChunkIds: readonly string[],
): ComputedResult[] {
  if (results.length === 0) throw new OutputError("InvalidOutput", "The code reported no result");
  if (results.length > MAX_RESULTS) throw new OutputError("InvalidOutput", "Too many results");
  const allowed = new Set(supportingChunkIds);
  return results.map((r) => {
    if (!CanonicalNumberSchema.safeParse(r.value).success)
      throw new OutputError("InvalidOutput", "A result is not a finite number");
    const label = plain(r.label, 200);
    if (!label) throw new OutputError("InvalidOutput", "A result has no label");
    const unit = r.unit === null ? null : plain(r.unit, 40) || null;
    const sources = r.sources.length > 0 ? [...new Set(r.sources)] : [...supportingChunkIds];
    if (sources.some((s) => !allowed.has(s)))
      throw new OutputError("CitationInvalid", "A result cites data outside the supplied inputs");
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
  for (const b of buf) {
    c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readValidatedPngChunk(
  buf: Buffer,
  offset: number,
): { type: string; length: number; nextOffset: number } {
  if (offset + 12 > buf.length) {
    throw new OutputError("InvalidOutput", "truncated PNG");
  }
  const length = buf.readUInt32BE(offset);
  const type = buf.subarray(offset + 4, offset + 8).toString("latin1");
  if (!/^[A-Za-z]{4}$/.test(type) || offset + 12 + length > buf.length) {
    throw new OutputError("InvalidOutput", "malformed PNG chunk");
  }
  const body = buf.subarray(offset + 4, offset + 8 + length);
  if (crc32(body) !== buf.readUInt32BE(offset + 8 + length)) {
    throw new OutputError("InvalidOutput", "PNG CRC mismatch");
  }
  return { type, length, nextOffset: offset + 12 + length };
}

function readIhdrDimensions(
  buf: Buffer,
  offset: number,
  type: string,
  length: number,
): { width: number; height: number } {
  if (type !== "IHDR" || length !== 13) {
    throw new OutputError("InvalidOutput", "PNG must start with IHDR");
  }
  const width = buf.readUInt32BE(offset + 8);
  const height = buf.readUInt32BE(offset + 12);
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new OutputError("InvalidOutput", "PNG dimensions out of range");
  }
  return { width, height };
}

/** Structural PNG check: signature, IHDR first, every chunk CRC, IDAT present, IEND last, no trailing bytes. */
export function validatePng(buf: Buffer): { width: number; height: number } {
  if (buf.length < 8 + 25 + 12 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new OutputError("InvalidOutput", "not a PNG");
  }
  let offset = 8;
  let dimensions = { width: 0, height: 0 };
  let sawIdat = false;
  let index = 0;
  for (;;) {
    const chunk = readValidatedPngChunk(buf, offset);
    if (index === 0) {
      dimensions = readIhdrDimensions(buf, offset, chunk.type, chunk.length);
    }
    if (chunk.type === "IDAT") {
      sawIdat = true;
    }
    offset = chunk.nextOffset;
    index++;
    if (chunk.type === "IEND") {
      break;
    }
  }
  if (!sawIdat || offset !== buf.length) {
    throw new OutputError("InvalidOutput", "PNG without image data or with trailing bytes");
  }
  return dimensions;
}

// ---- SVG allowlist ----------------------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "clipPath",
  "use",
  "style",
  "title",
  "desc",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "mask",
  "symbol",
  "marker",
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
  if (lowered.includes("/*") || lowered.includes("*/")) return true;
  if (/@import|@font-face|expression\s*\(|javascript:|behavior\s*:|-moz-binding|\\/.test(lowered))
    return true;
  for (const match of lowered.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/g)) {
    if (!(match[2] ?? "").startsWith("#")) {
      return true;
    }
  }
  return /url\s*\(/.test(lowered.replace(/url\s*\(\s*(['"]?)#[^)'"]*\1\s*\)/g, ""));
}

/** Decode once, as XML does, before checking CSS and references. */
function decodeXml(value: string): string {
  if (ENTITY.test(value)) reject("entity reference");
  return value.replace(/&(?:lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (entity) => {
    const named: Record<string, string> = {
      "&lt;": "<",
      "&gt;": ">",
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
    };
    if (named[entity]) return named[entity];
    const point = entity.startsWith("&#x")
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number(entity.slice(2, -1));
    if (!(
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 32 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff)
    ))
      reject("invalid XML character");
    return String.fromCodePoint(point);
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function reject(message: string): never {
  throw new OutputError("SecurityViolation", `unsafe SVG: ${message}`);
}

interface SvgParseState {
  out: string[];
  stack: string[];
  dropDepth: number;
  sawRoot: boolean;
}

function validateSvgAttribute(attr: string, value: string): void {
  if (!/^[A-Za-z_][\w:.-]*$/.test(attr) || /^on/i.test(attr)) {
    reject(`attribute ${attr}`);
  }
  if (attr.startsWith("xmlns")) {
    if (ALLOWED_NAMESPACES.get(attr) !== value) {
      reject(`namespace ${attr}`);
    }
    return;
  }
  if (attr === "href" || attr.endsWith(":href")) {
    if (!/^#[\w.:-]+$/.test(value)) {
      reject("non-local reference");
    }
    return;
  }
  if (/javascript:|data:|vbscript:/i.test(value) || unsafeCss(value)) {
    reject(`attribute value of ${attr}`);
  }
}

function sanitizeSvgAttributes(rawAttrs: string): string {
  const attrs: string[] = [];
  for (const match of rawAttrs.matchAll(/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const attr = match[1];
    if (!attr) {
      continue;
    }
    const value = decodeXml(match[2] ?? match[3] ?? "");
    validateSvgAttribute(attr, value);
    attrs.push(` ${attr}="${escapeAttr(value)}"`);
  }
  return attrs.join("");
}

function handleSvgMetaToken(state: SvgParseState, raw: string): boolean {
  if (raw.startsWith("<!--")) {
    if (state.stack.at(-1) === "style") {
      reject("comment inside style");
    }
    return true;
  }
  if (raw.startsWith("<![CDATA[")) {
    reject("CDATA is not supported");
  }
  if (raw.startsWith("<!")) {
    reject("DOCTYPE/declaration");
  }
  if (raw.startsWith("<?")) {
    if (state.out.length > 0 || state.sawRoot || !/^<\?xml\s/.test(raw)) {
      reject("processing instruction");
    }
    return true;
  }
  return false;
}

function handleSvgClosingTag(state: SvgParseState, name: string): void {
  if (state.stack.at(-1) !== name) {
    reject("mismatched closing tag");
  }
  state.stack.pop();
  if (state.dropDepth > 0) {
    state.dropDepth--;
  } else {
    state.out.push(`</${name}>`);
  }
}

function handleSvgStartTag(
  state: SvgParseState,
  name: string,
  rawAttrs: string,
  selfClosing: boolean,
): void {
  if (state.stack.at(-1) === "style") {
    reject("element inside style");
  }
  if (!state.sawRoot && name !== "svg") {
    reject("root element must be svg");
  }
  state.sawRoot = true;
  if (state.dropDepth > 0 || DROPPED_ELEMENTS.has(name)) {
    if (!selfClosing) {
      state.stack.push(name);
      state.dropDepth++;
    }
    return;
  }
  if (!ALLOWED_ELEMENTS.has(name)) {
    reject(`element <${name}>`);
  }
  const attrs = sanitizeSvgAttributes(rawAttrs);
  state.out.push(`<${name}${attrs}${selfClosing ? "/>" : ">"}`);
  if (!selfClosing) {
    state.stack.push(name);
  }
}

function handleSvgTextNode(state: SvgParseState, raw: string): void {
  if (raw === "<") {
    reject("stray <");
  }
  if (state.dropDepth > 0) {
    return;
  }
  if (ENTITY.test(raw)) {
    reject("entity reference");
  }
  if (state.stack.at(-1) === "style" && unsafeCss(decodeXml(raw))) {
    reject("unsafe style");
  }
  if (!state.sawRoot && raw.trim()) {
    reject("text before root");
  }
  state.out.push(raw);
}

/** Returns a re-serialized SVG containing only allow-listed elements/attributes; throws on anything active. */
export function sanitizeSvg(input: string): string {
  if (Buffer.byteLength(input) > MAX_CHART_BYTES) {
    throw new OutputError("TemporaryStorageLimit", "SVG too large");
  }
  const text = input.replace(/^\uFEFF/, "");
  const state: SvgParseState = { out: [], stack: [], dropDepth: 0, sawRoot: false };
  let i = 0;
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|[^<]+|</g;
  for (let m = token.exec(text); m; m = token.exec(text)) {
    if (m.index !== i) {
      reject("unparsable content");
    }
    i = token.lastIndex;
    const raw = m[0];
    if (handleSvgMetaToken(state, raw)) {
      continue;
    }
    if (m[2]) {
      handleSvgClosingTag(state, m[2]);
    } else if (m[3]) {
      handleSvgStartTag(state, m[3], m[4] ?? "", m[5] === "/");
    } else {
      handleSvgTextNode(state, raw);
    }
  }
  if (i !== text.length || state.stack.length > 0 || !state.sawRoot) {
    reject("unbalanced document");
  }
  return state.out.join("");
}

export interface ValidChart {
  name: string;
  mimeType: "image/png" | "image/svg+xml";
  content: Buffer;
}

/** Accepts only chart_N.png / chart_N.svg whose bytes really are that format (MIME derived, not trusted). */
export function validateChartFiles(files: SandboxFile[]): ValidChart[] {
  const charts = files
    .filter((f) => OUTPUT_FILE_RE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (charts.length > MAX_CHARTS) throw new OutputError("InvalidOutput", "too many charts");
  return charts.map((f) => {
    if (f.content.length > MAX_CHART_BYTES)
      throw new OutputError("TemporaryStorageLimit", "chart too large");
    if (f.content.length === 0) throw new OutputError("InvalidOutput", "empty chart");
    if (f.name.endsWith(".png")) {
      validatePng(f.content);
      return { name: f.name, mimeType: "image/png" as const, content: f.content };
    }
    const svg = f.content.toString("utf8");
    if (!Buffer.from(svg, "utf8").equals(f.content))
      throw new OutputError("InvalidOutput", "SVG is not UTF-8");
    return {
      name: f.name,
      mimeType: "image/svg+xml" as const,
      content: Buffer.from(sanitizeSvg(svg), "utf8"),
    };
  });
}
