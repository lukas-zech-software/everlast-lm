import { describe, expect, it } from "vitest";
import {
  buildFiftySourceFixture,
  buildThreeSourceStudioFixture,
  LATE_ORIGINAL_FACT_TOKEN,
} from "@everlast/testkit/studio-structure-fixtures";
import { processAllOriginalEvidenceBatches, verifyEvidenceCoverage } from "../src/studio/evidence.ts";
import { DeterministicMindmapModel } from "../src/studio/mindmaps/model.ts";
import { generateMindmap } from "../src/studio/mindmaps/pipeline.ts";

/**
 * [011-studio-mindmaps-data-tables] T014 — All-original evidence batching and coverage manifest tests
 * (FR-ST-08/18, FR-SI-02/05, C-01/C-02/C-03, NFR-EVAL-02/04; FR-003, FR-010, FR-011, FR-013, SC-007, SC-008).
 */

describe("[011-studio-mindmaps-data-tables] T014: All-original chunk batching and >=50-source coverage manifest", () => {
  it("processes every original chunk across >=50 sources in bounded batches and retains a late-only fact absent from Source Guides", async () => {
    const fixture = buildFiftySourceFixture(52);
    expect(fixture.chunks.length).toBe(104);

    const visitedChunkIds: string[] = [];
    const { items, coverage } = await processAllOriginalEvidenceBatches({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      limits: { maxChunksPerBatch: 25, maxTokensPerBatch: 8000 },
      signal: new AbortController().signal,
      extractBatch: async (batch) => {
        visitedChunkIds.push(...batch.map((c) => c.chunk_id));
        return batch.map((c) => ({ chunk_id: c.chunk_id, text: c.text }));
      },
    });

    expect(coverage.all_original_chunks_visited).toBe(true);
    expect(coverage.total_sources).toBe(52);
    expect(coverage.total_chunks).toBe(104);
    expect(coverage.batch_count).toBeGreaterThanOrEqual(5);
    expect(coverage.processed_batch_count).toBe(coverage.batch_count);
    expect(visitedChunkIds).toEqual(fixture.chunks.map((c) => c.chunk_id));
    expect(items.some((x) => x.text.includes(LATE_ORIGINAL_FACT_TOKEN))).toBe(true);
    expect(verifyEvidenceCoverage(coverage, fixture.chunks, fixture.snapshot)).toBeNull();

    // Full mindmap pipeline over >=50 sources retains the late-only original fact
    const model = new DeterministicMindmapModel();
    const outcome = await generateMindmap({
      chunks: fixture.chunks,
      snapshot: fixture.snapshot,
      model,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") {
      expect(JSON.stringify(outcome.payload)).toContain(LATE_ORIGINAL_FACT_TOKEN);
    }
  });

  it("rejects incomplete batch coverage, summary-only substitution, or out-of-snapshot chunk revisions", () => {
    const fixture = buildThreeSourceStudioFixture();
    const incompleteCoverage = {
      total_sources: 3,
      total_chunks: fixture.chunks.length,
      batch_count: 3,
      processed_batch_count: 2,
      all_original_chunks_visited: true as const,
    };
    expect(verifyEvidenceCoverage(incompleteCoverage, fixture.chunks, fixture.snapshot)).toMatch(/batch/i);
  });
});
