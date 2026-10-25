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
  it("enforces <=16.0ms P95 frame budget (60fps) across pan, zoom, expand, and collapse without discarding slow or failed frames", () => {
    expect(MINDMAP_FRAME_BUDGET_MS).toBe(16);
    expect(MINDMAP_MIN_FRAME_SAMPLES).toBeGreaterThanOrEqual(20);

    const samples: MindmapFrameSample[] = Array.from({ length: 40 }, (_, i) => ({
      frame_index: i + 1,
      operation: (["pan", "zoom", "expand", "collapse"] as const)[i % 4]!,
      node_count: 120,
      duration_ms: 4 + (i % 10), // 4..13 ms <= 16 ms
      dropped: false,
    }));

    const report = evaluateMindmapFrameSamples(samples);
    expect(report.sample_count).toBe(40);
    expect(report.p95_frame_ms).toBeLessThanOrEqual(16);
    expect(report.estimated_fps).toBeGreaterThanOrEqual(60);
    expect(report.passed).toBe(true);

    // Slow/dropped frames are retained and fail the 16ms gate
    const slowSamples: MindmapFrameSample[] = samples.map((s, idx) =>
      idx >= 36 ? { ...s, duration_ms: 28, dropped: true } : s
    );
    const failedReport = evaluateMindmapFrameSamples(slowSamples);
    expect(failedReport.p95_frame_ms).toBe(28);
    expect(failedReport.passed).toBe(false);
  });
});
