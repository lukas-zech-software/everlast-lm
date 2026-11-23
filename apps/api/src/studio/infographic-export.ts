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

function extractSvgTagAttr(svg: string, attrName: string): string | null {
  const tagEnd = svg.indexOf(">");
  const openTag = tagEnd === -1 ? svg : svg.slice(0, tagEnd);
  const lowerTag = openTag.toLowerCase();
  const target = attrName.toLowerCase();
  let pos = 0;
  while (pos < lowerTag.length) {
    const idx = lowerTag.indexOf(target, pos);
    if (idx === -1) return null;
    const prev = idx > 0 ? lowerTag[idx - 1]! : "";
    if (prev !== " " && prev !== "\t" && prev !== "\n" && prev !== "\r") {
      pos = idx + target.length;
      continue;
    }
    let eq = idx + target.length;
    while (eq < openTag.length && /\s/.test(openTag[eq]!)) eq++;
    if (openTag[eq] !== "=") {
      pos = idx + target.length;
      continue;
    }
    let q = eq + 1;
    while (q < openTag.length && /\s/.test(openTag[q]!)) q++;
    const quote = openTag[q];
    if (quote !== '"' && quote !== "'") {
      pos = idx + target.length;
      continue;
    }
    const endQuote = openTag.indexOf(quote, q + 1);
    if (endQuote === -1) return null;
    return openTag.slice(q + 1, endQuote);
  }
  return null;
}

function parseNonNegativeFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let dots = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
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
    if (parts.length === 4) {
      const minX = parseNonNegativeFinite(parts[0]!);
      const minY = parseNonNegativeFinite(parts[1]!);
      const vbW = parseNonNegativeFinite(parts[2]!);
      const vbH = parseNonNegativeFinite(parts[3]!);
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
  const parsedW = wRaw !== null ? parseNonNegativeFinite(wRaw) : null;
  const parsedH = hRaw !== null ? parseNonNegativeFinite(hRaw) : null;
  const width = parsedW !== null ? Math.max(1, Math.round(parsedW)) : 960;
  const height = parsedH !== null ? Math.max(1, Math.round(parsedH)) : 640;
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
