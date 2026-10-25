/**
 * [011-studio-mindmaps-data-tables] T016, T022 — Mindmap generation submission→Completed latency
 * cohort aggregation and benchmark reporting (FR-ST-08, NFR-EVAL-02/04; FR-001, FR-003, FR-010, SC-002, SC-008).
 *
 * Rules (SC-002):
 * 1. Submission (`POST /api/notebooks/{notebookId}/studio/artifacts`) to durable `Completed` persistence
 *    (including queue/dispatch, model calls, citation/graph validation, and PostgreSQL publication): P95 <= 20,000 ms.
 * 2. Predeclared cohort of N >= 20 accepted runs.
 * 3. Nearest-rank P95 = `ceil(0.95 * N)`th sorted sample.
 * 4. Failed or unfinished runs stay in the cohort with duration `+Infinity` (no posthoc exclusions).
 */

export const MINDMAP_P95_BUDGET_MS = 20_000;
export const MINDMAP_MIN_COHORT_SIZE = 20;

export interface MindmapLatencySample {
  sample_id: string;
  stratum: "cold" | "warm";
  status: "Completed" | "Failed" | "Cancelled" | "Running" | "Queued";
  submitted_at_ms: number;
  completed_at_ms: number | null;
  duration_ms: number | null;
  node_count: number | null;
  error_code?: string | undefined;
}

export interface MindmapLatencyCohortReport {
  sample_count: number;
  cold_count: number;
  warm_count: number;
  p95_rank: number;
  p95_ms: number;
  budget_ms: number;
  passed: boolean;
  sorted_durations_ms: number[];
  samples: MindmapLatencySample[];
}

export function aggregateMindmapLatencyCohort(
  samples: readonly MindmapLatencySample[],
  budgetMs = MINDMAP_P95_BUDGET_MS
): MindmapLatencyCohortReport {
  if (samples.length < MINDMAP_MIN_COHORT_SIZE) {
    throw new Error(
      `Mindmap latency cohort requires at least ${MINDMAP_MIN_COHORT_SIZE} predeclared runs (received ${samples.length}).`
    );
  }

  const durations = samples.map((s) => {
    if (
      s.status !== "Completed" ||
      s.duration_ms === null ||
      !Number.isFinite(s.duration_ms) ||
      s.duration_ms < 0
    ) {
      return Number.POSITIVE_INFINITY;
    }
    return s.duration_ms;
  });

  const sorted = [...durations].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * samples.length);
  const p95 = sorted[rank - 1]!;
  const coldCount = samples.filter((s) => s.stratum === "cold").length;
  const warmCount = samples.filter((s) => s.stratum === "warm").length;

  return {
    sample_count: samples.length,
    cold_count: coldCount,
    warm_count: warmCount,
    p95_rank: rank,
    p95_ms: p95,
    budget_ms: budgetMs,
    passed: Number.isFinite(p95) && p95 <= budgetMs,
    sorted_durations_ms: sorted,
    samples: [...samples],
  };
}
