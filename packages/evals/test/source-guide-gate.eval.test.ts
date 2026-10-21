import { describe, expect, it } from "vitest";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";

/**
 * Gate v2.0 #1 harness (SRS §5.4, FR-SI-02, FR-018): the release check runs `generateSourceGuide` over the
 * golden corpus in two languages and adds the Ready-watcher dispatch delay to every sample. These tests use a
 * TEST DOUBLE model; they prove the harness counts, validates support and fails honestly. The live Vertex
 * Flash-Lite run is UNAVAILABLE without Vertex configuration.
 */

const fakeModel = (opts: { delayMs?: number; badChunk?: boolean } = {}): StructuredGenerationClient =>
  ({
    async generateSourceGuide({ source }: { source: { word_count: number; chunks: Array<{ chunk_id: string }> } }) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const short = source.word_count < 50;
      const summary = short ? "This source lists one short fact." : Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ") + ".";
      return {
        summary_md: summary,
        key_topics: short ? ["Alpha", "Beta"] : ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"],
        supporting_chunk_ids: [opts.badChunk ? "99999999-9999-4999-8999-999999999999" : source.chunks[0]!.chunk_id],
      };
    },
  }) as unknown as StructuredGenerationClient;

describe("Gate v2.0 #1 Source Guide harness (test double)", () => {
  it("covers 10 corpus documents in 2 languages and passes within the bound", async () => {
    const { runSourceGuideGate } = await import("../src/source-guide-gate.ts");
    const result = await runSourceGuideGate({ model: fakeModel(), modelId: "test-double", dispatchDelayMs: 1_000 });
    expect(result.cases).toHaveLength(20);
    expect(new Set(result.cases.map((c) => c.output_language))).toEqual(new Set(["en-US", "de-DE"]));
    expect(result.ready_rate).toBe(1);
    expect(result.p95_from_ready_ms).toBeGreaterThanOrEqual(1_000);
    expect(result.passed).toBe(true);
  });

  it("fails when the dispatch delay alone exceeds 10 s", async () => {
    const { runSourceGuideGate } = await import("../src/source-guide-gate.ts");
    const result = await runSourceGuideGate({ model: fakeModel(), modelId: "test-double", dispatchDelayMs: 10_000 });
    expect(result.passed).toBe(false);
  });

  it("fails when supporting chunk IDs are outside the source", async () => {
    const { runSourceGuideGate } = await import("../src/source-guide-gate.ts");
    const result = await runSourceGuideGate({ model: fakeModel({ badChunk: true }), modelId: "test-double", dispatchDelayMs: 0 });
    expect(result.ready_rate).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("reports UNAVAILABLE without Vertex configuration", async () => {
    const { runSourceGuideReleaseGate } = await import("../src/source-guide-gate.ts");
    expect(await runSourceGuideReleaseGate({})).toMatchObject({ status: "unavailable" });
  });
});
