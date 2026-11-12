import { describe, expect, it } from "vitest";
import {
  evaluateMindmapFrameSamples,
  MINDMAP_FRAME_BUDGET_MS,
  MINDMAP_MIN_FRAME_SAMPLES,
  type MindmapFrameSample,
} from "../src/studio/mindmap-viewer.ts";

/**
 * [011-studio-mindmaps-data-tables] T029 — Browser performance record and 60fps / <=16ms frame-budget
 * aggregation tests for 120-node mindmap pan/zoom/expand/collapse interactions (FR-ST-09; FR-004, SC-003).
 */

describe("[011-studio-mindmaps-data-tables] T029: 120-node mindmap interaction frame-budget evaluation (SC-003)", () => {
  it("enforces <=33.3ms P95 frame budget (>=30fps) across pan, zoom, expand, and collapse without discarding slow or failed frames", () => {
    expect(MINDMAP_FRAME_BUDGET_MS).toBe(33.3);
    expect(MINDMAP_MIN_FRAME_SAMPLES).toBeGreaterThanOrEqual(20);

    const samples: MindmapFrameSample[] = Array.from({ length: 40 }, (_, i) => ({
      frame_index: i + 1,
      operation: (["pan", "zoom", "expand", "collapse"] as const)[i % 4]!,
      node_count: 120,
      duration_ms: 4 + (i % 10), // 4..13 ms <= 33.3 ms
      dropped: false,
    }));

    const report = evaluateMindmapFrameSamples(samples);
    expect(report.sample_count).toBe(40);
    expect(report.p95_frame_ms).toBeLessThanOrEqual(33.3);
    expect(report.estimated_fps).toBeGreaterThanOrEqual(30);
    expect(report.passed).toBe(true);

    // Slow/dropped frames are retained and fail the 33.3ms gate
    const slowSamples: MindmapFrameSample[] = samples.map((s, idx) =>
      idx >= 36 ? { ...s, duration_ms: 45, dropped: true } : s
    );
    const failedReport = evaluateMindmapFrameSamples(slowSamples);
    expect(failedReport.p95_frame_ms).toBe(45);
    expect(failedReport.passed).toBe(false);
  });
});


describe("[011-studio-mindmaps-data-tables] T057: frame evidence integrity (FR-ST-09, SC-003)", () => {
  const frames = (): MindmapFrameSample[] => Array.from({ length: 20 }, (_, i) => ({ frame_index: i + 1, operation: (["pan", "zoom", "expand", "collapse"] as const)[i % 4]!, node_count: 120, duration_ms: 10, dropped: false }));
  it("rejects duplicate identities, wrong node counts and missing operations", () => {
    const duplicates = frames(); duplicates[1]!.frame_index = duplicates[0]!.frame_index;
    expect(() => evaluateMindmapFrameSamples(duplicates)).toThrow(/unique|duplicate/i);
    expect(() => evaluateMindmapFrameSamples(frames().map(s => ({ ...s, node_count: 12 })))).toThrow(/120/);
    expect(() => evaluateMindmapFrameSamples(frames().map(s => ({ ...s, operation: "pan" })))).toThrow(/operation/i);
  });
});
