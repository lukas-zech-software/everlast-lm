import { describe, expect, it } from "vitest";
import {
  renderInfographicSvg,
  StudioInfographicPayloadSchema,
  type StudioInfographicPayload,
} from "@everlast/contracts";
import { buildInfographicExportScene } from "../src/studio/infographic-export.ts";

/**
 * [015-studio-visuals-presentations] T016 — Infographic SVG / 2x PNG scene export unit tests (FR-ST-17, D9).
 */

const SRC = "42000000-0000-4000-8000-000000000101";
const CHUNK = "0190f420-0000-7000-8000-000000000001";
const ART = "42000000-bbbb-4000-8000-000000000001";

function makeInfographicPayload(): StudioInfographicPayload {
  const blocks = [
    {
      id: "b1",
      heading: "Detection",
      body: "Telemetry detects anomalies quickly.",
      badge_numbers: [1],
    },
    {
      id: "b2",
      heading: "Recovery",
      body: "Automated rollback completes safely.",
      badge_numbers: [1],
    },
  ];
  const { svg } = renderInfographicSvg({
    style: "process_flow",
    title: "Incident Response",
    blocks,
    citations: [{ badge_number: 1, label: "Runbook" }],
  });
  return StudioInfographicPayloadSchema.parse({
    style: "process_flow",
    title: "Incident Response",
    structured_blocks: blocks,
    rendered_svg: svg,
    source_chunk_ids: [CHUNK],
    citations: [
      {
        badge_number: 1,
        chunk_id: CHUNK,
        source_id: SRC,
        revision: 1,
        snippet: "Telemetry detects anomalies.",
      },
    ],
  });
}

describe("[015-studio-visuals-presentations] T016: Infographic export scene validation", () => {
  it("returns scale=1 SVG export scene and scale=2 PNG export scene with positive dimensions and sanitized SVG", () => {
    const payload = makeInfographicPayload();

    const svgScene = buildInfographicExportScene({
      artifactId: ART,
      title: "Incident Response",
      payload,
      body: { format: "svg" },
    });
    expect(svgScene.format).toBe("svg");
    expect(svgScene.scale).toBe(1);
    expect(svgScene.width).toBe(960);
    expect(svgScene.height).toBeGreaterThan(200);
    expect(svgScene.filename).toBe("incident-response.svg");
    expect(svgScene.svg).toContain("AI-generated");

    const pngScene = buildInfographicExportScene({
      artifactId: ART,
      title: "Incident Response",
      payload,
      body: { format: "png" },
    });
    expect(pngScene.format).toBe("png");
    expect(pngScene.scale).toBe(2);
    expect(pngScene.filename).toBe("incident-response.png");
  });

  it("rejects invalid export formats and unsafe SVG payloads", () => {
    const payload = makeInfographicPayload();
    expect(() =>
      buildInfographicExportScene({
        artifactId: ART,
        title: "Incident Response",
        payload,
        body: { format: "pdf" },
      }),
    ).toThrow();

    const tampered = {
      ...payload,
      rendered_svg: `<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>`,
    };
    expect(() =>
      buildInfographicExportScene({
        artifactId: ART,
        title: "Incident Response",
        payload: tampered,
        body: { format: "svg" },
      }),
    ).toThrow();
  });

  it("handles repeated-hyphen titles and width/height fallback SVG attributes linearly", () => {
    const payload = makeInfographicPayload();
    const repeatedHyphens = `${"-".repeat(10_000)}alpha${"-".repeat(10_000)}`;
    const slugScene = buildInfographicExportScene({
      artifactId: ART,
      title: repeatedHyphens,
      payload,
      body: { format: "svg" },
    });
    expect(slugScene.filename).toBe("alpha.svg");

    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500"><text x="10" y="20">AI-generated · Illustration</text></svg>`;
    const vbScene = buildInfographicExportScene({
      artifactId: ART,
      title: "Architecture",
      payload: { ...payload, rendered_svg: fallbackSvg },
      body: { format: "png" },
    });
    expect(vbScene.width).toBe(800);
    expect(vbScene.height).toBe(500);
  });
});
