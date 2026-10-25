import { describe, expect, it } from "vitest";
import {
  aggregateMindmapLatencyCohort,
  MINDMAP_P95_BUDGET_MS,
  MINDMAP_MIN_COHORT_SIZE,
  type MindmapLatencySample,
} from "../src/studio-structure-performance.ts";

/**
 * [011-studio-mindmaps-data-tables] T016 — Mindmap generation latency record and P95 cohort aggregation tests
 * (FR-ST-08, NFR-EVAL-02/04; FR-001, FR-003, FR-010, SC-002, SC-008).
 */

describe("[011-studio-mindmaps-data-tables] T016: Mindmap submission->Completed P95 cohort aggregation (SC-002)", () => {
  it("enforces predeclared N>=20 cohort, nearest-rank ceil(0.95*N), and treats failed or unfinished runs as +Infinity", () => {
    expect(MINDMAP_P95_BUDGET_MS).toBe(20_000);
    expect(MINDMAP_MIN_COHORT_SIZE).toBe(20);

    const samples: MindmapLatencySample[] = Array.from({ length: 20 }, (_, i) => ({
      sample_id: `run-${i + 1}`,
      stratum: i < 5 ? "cold" : "warm",
      status: "Completed",
      submitted_at_ms: 1000,
      completed_at_ms: 1000 + (i + 1) * 800,
      duration_ms: (i + 1) * 800,
      node_count: 24,
    }));

    const report = aggregateMindmapLatencyCohort(samples);
    // ceil(0.95 * 20) = 19th sorted value = 19 * 800 = 15200 ms <= 20000 ms
    expect(report.sample_count).toBe(20);
    expect(report.p95_rank).toBe(19);
    expect(report.p95_ms).toBe(15_200);
    expect(report.passed).toBe(true);
    expect(report.cold_count).toBe(5);
    expect(report.warm_count).toBe(15);

    // If 2 runs fail or remain unfinished, the 19th sorted value is +Infinity -> fails!
    const withFailures: MindmapLatencySample[] = samples.map((s, idx) =>
      idx >= 18 ? { ...s, status: "Failed", completed_at_ms: null, duration_ms: null } : s
    );
    const failedReport = aggregateMindmapLatencyCohort(withFailures);
    expect(failedReport.p95_ms).toBe( Number.POSITIVE_INFINITY );
    expect(failedReport.passed).toBe(false);

    // Fewer than 20 predeclared runs is rejected as invalid cohort
    expect(() => aggregateMindmapLatencyCohort(samples.slice(0, 19))).toThrow(/20/);
  });
});
