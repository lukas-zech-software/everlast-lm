import { describe, expect, it } from "vitest";
import {
  STUDIO_INFOGRAPHIC_PLUGIN_TYPE,
  StudioInfographicPayloadSchema,
  validateSafeDeterministicSvg,
} from "@everlast/contracts";
import {
  buildThreeSourceStudioFixture,
  makeStudioChunk,
  makeStudioSourceId,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";
import { DeterministicInfographicModel } from "../src/studio/infographics/model.ts";
import { generateInfographic } from "../src/studio/infographics/pipeline.ts";
import { InfographicGeneratorPlugin } from "../src/studio/infographics/plugin.ts";
import { validateInfographicPayload } from "../src/studio/infographics/validation.ts";

/**
 * [015-studio-visuals-presentations] T015 — Infographic worker pipeline & D9 SVG validator unit tests
 * (FR-ST-17, D9, C-02, C-03, NFR-EVAL-02/04).
 */

describe("[015-studio-visuals-presentations] T015: Infographic worker pipeline, 5 styles, wrapping, and citation validation", () => {
  it("generates a 4-stage process_flow infographic from an incident response source with sanitized D9 SVG", async () => {
    const src = makeStudioSourceId(9);
    const workflowChunks = [
      makeStudioChunk(
        91,
        src,
        "Stage 1 Detection: Automated telemetry monitors Cloud Run endpoints continuously. Stage 2 Triage: On-call engineers classify severity within 5 minutes.",
      ),
      makeStudioChunk(
        92,
        src,
        "Stage 3 Containment: Affected revisions are fenced immediately with zero data leakage. Stage 4 Recovery: Post-incident verification restores normal service traffic.",
      ),
    ];
    const snapshot = [{ source_id: src, revision: 1 }];
    const model = new DeterministicInfographicModel();
    const plugin = new InfographicGeneratorPlugin(model);

    expect(plugin.manifest.plugin_type).toBe(STUDIO_INFOGRAPHIC_PLUGIN_TYPE);
    const plan = plugin.triggerJob({
      notebook_id: "42000000-0000-4000-8000-000000000001",
      subtype: "default",
      params: { style: "process_flow", focus_prompt: "4-stage incident response workflow" },
      snapshot,
      output_language: "en-US",
    });
    expect(plan.title).toContain("Infographic");

    const outcome = await plugin.generate({
      artifact_id: "42000000-bbbb-4000-8000-000000000001",
      notebook_id: "42000000-0000-4000-8000-000000000001",
      subtype: "default",
      params_json: plan.params_json,
      snapshot,
      chunks: workflowChunks,
      output_language: "en-US",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const payload = StudioInfographicPayloadSchema.parse(outcome.payload);
    expect(payload.style).toBe("process_flow");
    expect(payload.structured_blocks.length).toBeGreaterThanOrEqual(4);
    expect(validateSafeDeterministicSvg(payload.rendered_svg).valid).toBe(true);
    expect(payload.rendered_svg).toContain("AI-generated");
    expect(payload.rendered_svg).toContain("Detection");
    expect(payload.rendered_svg).toContain("Recovery");
    expect(validateInfographicPayload(payload, workflowChunks, snapshot)).toBeNull();
  });

  it("resolves auto style and handles all concrete styles + long labels with dynamic height expansion and zero leakage", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicInfographicModel();

    for (const style of [
      "auto",
      "comparison",
      "metrics_summary",
      "architecture_diagram",
    ] as const) {
      const outcome = await generateInfographic({
        chunks: fixture.chunks,
        snapshot: fixture.snapshot,
        model,
        style,
        signal: new AbortController().signal,
        reportProgress: () => undefined,
      });
      expect(outcome.status).toBe("completed");
      if (outcome.status !== "completed") continue;
      const p = StudioInfographicPayloadSchema.parse(outcome.payload);
      expect(["process_flow", "comparison", "metrics_summary", "architecture_diagram"]).toContain(
        p.style,
      );
      expect(validateInfographicPayload(p, fixture.chunks, fixture.snapshot)).toBeNull();
      expect(JSON.stringify(p)).not.toContain(STUDIO_LEAK_PROBE);
    }

    const empty = await generateInfographic({
      chunks: [],
      snapshot: fixture.snapshot,
      model,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(empty.status).toBe("refused");
  });

  it("rejects unsafe SVG or forged citations before publication", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicInfographicModel();
    const outcome = await generateInfographic({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model,
      style: "metrics_summary",
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;

    const badSvg = StudioInfographicPayloadSchema.parse(structuredClone(outcome.payload));
    badSvg.rendered_svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script></svg>`;
    expect(validateInfographicPayload(badSvg, fixture.chunks, fixture.snapshot)).not.toBeNull();

    const badCite = StudioInfographicPayloadSchema.parse(structuredClone(outcome.payload));
    const out = fixture.unselectedChunks[0]!;
    badCite.citations.push({
      badge_number: 99,
      source_id: out.source_id,
      chunk_id: out.chunk_id,
      revision: 1,
      snippet: out.text,
    });
    expect(validateInfographicPayload(badCite, fixture.chunks, fixture.snapshot)).not.toBeNull();
  });
});
