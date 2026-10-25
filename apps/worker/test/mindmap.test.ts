import { describe, expect, it } from "vitest";
import {
  buildThreeSourceStudioFixture,
  makeCodePointString,
  makeStudioChunk,
  makeStudioSourceId,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";
import { DeterministicMindmapModel } from "../src/studio/mindmaps/model.ts";
import { generateMindmap } from "../src/studio/mindmaps/pipeline.ts";
import { MindmapGeneratorPlugin } from "../src/studio/mindmaps/plugin.ts";
import { validateMindmapPayload } from "../src/studio/mindmaps/validation.ts";

/**
 * [011-studio-mindmaps-data-tables] T013 — Mindmap pipeline and validator unit tests
 * (FR-ST-08, C-03, FR-GC-02; FR-001, FR-002, FR-003, FR-013, FR-014, SC-001, SC-008).
 */

describe("[011-studio-mindmaps-data-tables] T013: Mindmap pipeline, structural invariants, boundaries, and citation validation", () => {
  it("generates a valid rooted acyclic tree of depth 2..5 and >=15 nodes from the 3-source multimodal fixture with zero leakage", async () => {
    const fixture = buildThreeSourceStudioFixture();
    const model = new DeterministicMindmapModel();
    const plugin = new MindmapGeneratorPlugin(model);

    const plan = plugin.triggerJob({
      notebook_id: "33000000-0000-4000-8000-000000000001",
      subtype: "default",
      params: {},
      snapshot: fixture.snapshot,
      output_language: "en-US",
    });
    expect(plan.title).toContain("Mindmap");

    const stages: string[] = [];
    const outcome = await plugin.generate({
      artifact_id: "33000000-aaaa-4000-8000-000000000001",
      notebook_id: "33000000-0000-4000-8000-000000000001",
      subtype: "default",
      params_json: {},
      snapshot: fixture.snapshot,
      chunks: fixture.chunks,
      output_language: "en-US",
      signal: new AbortController().signal,
      reportProgress: (stage) => stages.push(stage),
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const payload = outcome.payload as any;
    expect(payload.node_count).toBeGreaterThanOrEqual(15);
    expect(payload.node_count).toBeLessThanOrEqual(120);
    expect(payload.max_depth).toBeGreaterThanOrEqual(2);
    expect(payload.max_depth).toBeLessThanOrEqual(5);
    expect(payload.initial_expanded_depth).toBe(2);
    expect(payload.coverage?.all_original_chunks_visited).toBe(true);
    expect(validateMindmapPayload(payload, fixture.chunks, fixture.snapshot)).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(STUDIO_LEAK_PROBE);
    expect(stages).toContain("extracting");
  });

  it("enforces 119/120/121 node boundaries and 79/80/81 Unicode code-point label boundaries", () => {
    const fixture = buildThreeSourceStudioFixture();
    const c0 = fixture.chunks[0]!;
    const cite = {
      badge_number: 1,
      source_id: c0.source_id,
      chunk_id: c0.chunk_id,
      revision: c0.revision,
      snippet: "Cloud Platform Architecture",
    };

    const buildTreeWithCount = (count: number, rootLabel = "Cloud Platform Architecture") => {
      const children = Array.from({ length: count - 1 }, (_, i) => ({
        id: `n_${i + 1}`,
        label: `Node ${i + 1}`,
        summary: `Summary ${i + 1}`,
        label_citations: [cite],
        summary_citations: [cite],
        children: [],
      }));
      return {
        root_node: {
          id: "root",
          label: rootLabel,
          summary: "Root summary",
          label_citations: [cite],
          summary_citations: [cite],
          children,
        },
        node_count: count,
        max_depth: 2,
        initial_expanded_depth: 2 as const,
        insufficient_evidence_note: count < 15 ? "Limited evidence." : null,
        citations: [cite],
      };
    };

    expect(validateMindmapPayload(buildTreeWithCount(119), fixture.chunks, fixture.snapshot)).toBeNull();
    expect(validateMindmapPayload(buildTreeWithCount(120), fixture.chunks, fixture.snapshot)).toBeNull();
    expect(validateMindmapPayload(buildTreeWithCount(121), fixture.chunks, fixture.snapshot)).toMatch(/120/);

    expect(validateMindmapPayload(buildTreeWithCount(15, makeCodePointString(79)), fixture.chunks, fixture.snapshot)).toBeNull();
    expect(validateMindmapPayload(buildTreeWithCount(15, makeCodePointString(80)), fixture.chunks, fixture.snapshot)).toBeNull();
    expect(validateMindmapPayload(buildTreeWithCount(15, makeCodePointString(81)), fixture.chunks, fixture.snapshot)).toMatch(/80/);
  });

  it("explains evidence-limited lower node counts (<15) and refuses when sources have zero readable evidence", async () => {
    const src = makeStudioSourceId(1);
    const singleChunk = makeStudioChunk(1, src, "Single sparse statement about regional routing.");
    const snapshot = [{ source_id: src, revision: 1 }];
    const model = new DeterministicMindmapModel();

    const limited = await generateMindmap({
      chunks: [singleChunk],
      snapshot,
      model,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(limited.status).toBe("completed");
    if (limited.status === "completed") {
      const payload = limited.payload as any;
      expect(payload.node_count).toBeLessThan(15);
      expect(payload.insufficient_evidence_note).toBeTruthy();
      expect(validateMindmapPayload(payload, [singleChunk], snapshot)).toBeNull();
    }

    const empty = await generateMindmap({
      chunks: [],
      snapshot,
      model,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
    });
    expect(empty).toEqual({
      status: "refused",
      code: "InsufficientEvidence",
      message: expect.stringMatching(/no readable|insufficient/i),
    });
  });
});
