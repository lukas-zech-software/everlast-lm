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

function parseSvgDimensions(svg: string): { width: number; height: number } {
  const vb = /viewBox="0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/i.exec(svg);
  if (vb?.[1] && vb[2]) {
    const width = Math.max(1, Math.round(Number(vb[1])));
    const height = Math.max(1, Math.round(Number(vb[2])));
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  }
  const wMatch = /width="(\d+(?:\.\d+)?)"/i.exec(svg);
  const hMatch = /height="(\d+(?:\.\d+)?)"/i.exec(svg);
  const width = wMatch?.[1] ? Math.max(1, Math.round(Number(wMatch[1]))) : 960;
  const height = hMatch?.[1] ? Math.max(1, Math.round(Number(hMatch[1]))) : 640;
  return { width, height };
}

function buildSafeFilename(title: string, artifactId: string, ext: "svg" | "png"): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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
