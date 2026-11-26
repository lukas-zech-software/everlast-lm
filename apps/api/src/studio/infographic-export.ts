import {
  InfographicExportRequestSchema,
  StudioInfographicExportSceneSchema,
  StudioParamsError,
  validateSafeDeterministicSvg,
  type StudioInfographicExportScene,
  type StudioInfographicPayload,
} from "@everlast/contracts";

/**
 * [015-studio-visuals-presentations] T019 — Infographic SVG / 2x PNG export scene builder
 * (`FR-ST-17`, `D9`, `NFR-SEC-02`).
 */

function skipWhitespace(text: string, start: number): number {
  let pos = start;
  while (pos < text.length && /\s/.test(text.charAt(pos))) {
    pos += 1;
  }
  return pos;
}

type AttrReadResult =
  { kind: "value"; value: string } | { kind: "missing" } | { kind: "unterminated" };

function readQuotedAttrValue(openTag: string, afterName: number): AttrReadResult {
  const eq = skipWhitespace(openTag, afterName);
  if (openTag.charAt(eq) !== "=") {
    return { kind: "missing" };
  }
  const q = skipWhitespace(openTag, eq + 1);
  const quote = openTag.charAt(q);
  if (quote !== '"' && quote !== "'") {
    return { kind: "missing" };
  }
  const endQuote = openTag.indexOf(quote, q + 1);
  if (endQuote === -1) {
    return { kind: "unterminated" };
  }
  return { kind: "value", value: openTag.slice(q + 1, endQuote) };
}

function extractSvgTagAttr(svg: string, attrName: string): string | null {
  const tagEnd = svg.indexOf(">");
  const openTag = tagEnd === -1 ? svg : svg.slice(0, tagEnd);
  const lowerTag = openTag.toLowerCase();
  const target = attrName.toLowerCase();
  let pos = 0;
  while (pos < lowerTag.length) {
    const idx = lowerTag.indexOf(target, pos);
    if (idx === -1) {
      return null;
    }
    const prev = idx > 0 ? lowerTag.charAt(idx - 1) : "";
    if (!/\s/.test(prev)) {
      pos = idx + target.length;
      continue;
    }
    const result = readQuotedAttrValue(openTag, idx + target.length);
    if (result.kind === "unterminated") {
      return null;
    }
    if (result.kind === "value") {
      return result.value;
    }
    pos = idx + target.length;
  }
  return null;
}

function parseNonNegativeFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let dots = 0;
  for (const c of trimmed) {
    if (c === ".") {
      dots += 1;
      if (dots > 1) return null;
    } else if (c < "0" || c > "9") {
      return null;
    }
  }
  if (trimmed === ".") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseSvgDimensions(svg: string): { width: number; height: number } {
  const viewBoxRaw = extractSvgTagAttr(svg, "viewBox");
  if (viewBoxRaw !== null) {
    const parts = viewBoxRaw.trim().split(/\s+/);
    const [p0, p1, p2, p3] = parts;
    if (
      parts.length === 4 &&
      p0 !== undefined &&
      p1 !== undefined &&
      p2 !== undefined &&
      p3 !== undefined
    ) {
      const minX = parseNonNegativeFinite(p0);
      const minY = parseNonNegativeFinite(p1);
      const vbW = parseNonNegativeFinite(p2);
      const vbH = parseNonNegativeFinite(p3);
      if (minX === 0 && minY === 0 && vbW !== null && vbH !== null) {
        return {
          width: Math.max(1, Math.round(vbW)),
          height: Math.max(1, Math.round(vbH)),
        };
      }
    }
  }
  const wRaw = extractSvgTagAttr(svg, "width");
  const hRaw = extractSvgTagAttr(svg, "height");
  const parsedW = wRaw === null ? null : parseNonNegativeFinite(wRaw);
  const parsedH = hRaw === null ? null : parseNonNegativeFinite(hRaw);
  const width = parsedW === null ? 960 : Math.max(1, Math.round(parsedW));
  const height = parsedH === null ? 640 : Math.max(1, Math.round(parsedH));
  return { width, height };
}

function buildSafeFilename(title: string, artifactId: string, ext: "svg" | "png"): string {
  const raw = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = raw.length;
  while (start < end && raw[start] === "-") start++;
  while (end > start && raw[end - 1] === "-") end--;
  const slug = raw.slice(start, end).slice(0, 48);
  const base = slug || `infographic-${artifactId.slice(0, 8)}`;
  return `${base}.${ext}`;
}

export function buildInfographicExportScene(input: {
  artifactId: string;
  title: string;
  payload: StudioInfographicPayload;
  body: unknown;
}): StudioInfographicExportScene {
  const reqParsed = InfographicExportRequestSchema.safeParse(input.body);
  if (!reqParsed.success) {
    throw new StudioParamsError(reqParsed.error.issues.map((i) => i.message).join("; "));
  }
  const svgCheck = validateSafeDeterministicSvg(input.payload.rendered_svg);
  if (!svgCheck.valid) {
    throw new StudioParamsError(svgCheck.error ?? "Infographic SVG failed safety validation.");
  }

  const { width, height } = parseSvgDimensions(input.payload.rendered_svg);
  const format = reqParsed.data.format;
  const scale = format === "png" ? 2 : 1;
  const filename = buildSafeFilename(input.title, input.artifactId, format);

  return StudioInfographicExportSceneSchema.parse({
    format,
    svg: input.payload.rendered_svg,
    width,
    height,
    scale,
    filename,
  });
}
