import { describe, expect, it } from "vitest";
import { runStudioVisualsDeterministicEval } from "../src/studio-v4-eval.ts";

/**
 * [015-studio-visuals-presentations] T021 — Deterministic Gate v4.0 #3 eval tests
 * (`NFR-EVAL-02 = 1.0`, `NFR-EVAL-04 = 0`, OOXML `.pptx`, 16:9 `.pdf` via pdfjs-dist, D9 SVG).
 */

describe("[015-studio-visuals-presentations] T021: Studio Visuals & Presentations deterministic Gate v4.0 #3", () => {
  it("achieves 1.0 citation precision, 0 leakage, OOXML/PDF 8-slide parity, bullet overflow routing, and D9 SVG safety", async () => {
    const report = await runStudioVisualsDeterministicEval();
    expect(report.citation_precision).toBe(1);
    expect(report.leakage_count).toBe(0);
    expect(report.slide_count).toBe(8);
    expect(report.bullet_overflow_routed_to_notes).toBe(true);
    expect(report.ooxml_pptx_verified).toBe(true);
    expect(report.pdf_16x9_verified).toBe(true);
    expect(report.infographic_dynamic_wrap_verified).toBe(true);
    expect(report.invalid_citation_rejected).toBe(true);
    expect(report.xss_svg_rejected).toBe(true);
    expect(report.passed).toBe(true);
  });
});
