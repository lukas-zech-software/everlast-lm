/**
 * Package 3.2 code-execution performance benchmark aggregation (FR-GC-08, NFR-PERF-01; specs/010 T043/T044).
 *
 * Clocks and rules (spec FR-004, SC-003, SC-004; plan.md):
 * 1. Submission → real `running_code` status: ≤ 2,500 ms (`RUNNING_CODE_TARGET_MS`) from sufficient-intent submission.
 * 2. Sandbox create → execution completion: ≤ 4,000 ms nearest-rank P95 (`BOOT_EXECUTION_P95_TARGET_MS`).
 * 3. Predeclared cohorts (`cold_1u`, `warm_1u`, `cold_2u`, `warm_2u`) with fixed sample count (default N = 20).
 * 4. Nearest-rank P95: `Math.ceil(0.95 * N)`.
 * 5. Every attempted sample stays in its cohort; failed or timed-out samples record duration `+Infinity` and fail
 *    that cohort (`pass = false`, `status = "FAIL"`).
 * 6. Missing or mismatched sample counts for a cohort produce `status = "UNAVAILABLE"` (never a pass).
 * 7. Retry attempts and total retry duration are retained separately (`retrySummary`), never resetting the
 *    submission clock, and `running_code` progress is never counted as validated answer TTFT (`countsAsAnswerTtft: false`).
 */

export const RUNNING_CODE_TARGET_MS = 2_500;
export const BOOT_EXECUTION_P95_TARGET_MS = 4_000;
export const DEFAULT_COHORT_REPETITIONS = 20;
export const COHORT_NAMES = ["cold_1u", "warm_1u", "cold_2u", "warm_2u"] as const;

export type CohortName = (typeof COHORT_NAMES)[number];

export interface CohortDeclaration {
  repetitions: number;
  warm: boolean;
  concurrency: number;
}

export interface CodeExecutionBenchmarkPlan {
  fixture: {
    id: string;
    version: number;
    sha256: string;
    question: string;
  };
  provider: {
    service: string;
    region: string;
    cpu: string;
    memory: string;
  };
  environment: string;
  declaredAt: string;
  cohorts: Record<CohortName, CohortDeclaration>;
}

export interface CodeExecutionBenchmarkObservation {
  cohort: CohortName;
  sampleIndex: number;
  submittedAt: string;
  runningCodeAt: string | null;
  sandboxCreatedAt: string | null;
  executionCompletedAt: string | null;
  answerPublishedAt: string | null;
  outcome: "succeeded" | "failed" | "timed_out" | "unfinished";
  attempts: number;
  retryEndToEndMs: number | null;
}

export interface CohortBenchmarkResult {
  cohort: CohortName;
  declaredRepetitions: number;
  observedSamples: number;
  status: "PASS" | "FAIL" | "UNAVAILABLE";
  pass: boolean;
  runningCodeSamplesMs: number[];
  runningCodeMaxMs: number | null;
  runningCodeP95Ms: number | null;
  bootExecutionSamplesMs: number[];
  bootExecutionP95Ms: number | null;
  failedSamples: { sampleIndex: number; outcome: CodeExecutionBenchmarkObservation["outcome"] }[];
  retrySummary: {
    retriedSampleCount: number;
    totalExtraAttempts: number;
    retryEndToEndMs: number[];
  };
  detail?: string;
}

export interface CodeExecutionBenchmarkReport {
  plan: CodeExecutionBenchmarkPlan;
  status: "PASS" | "FAIL" | "UNAVAILABLE";
  pass: boolean;
  countsAsAnswerTtft: false;
  targets: {
    runningCodeMs: number;
    bootExecutionP95Ms: number;
  };
  cohorts: Record<CohortName, CohortBenchmarkResult>;
}

export function nearestRankP95(samples: number[]): number {
  if (samples.length === 0) throw new Error("No samples provided for nearest-rank P95");
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

export function validateCodeExecutionPlan(plan: CodeExecutionBenchmarkPlan): true {
  if (!plan.fixture?.id || !Number.isInteger(plan.fixture.version) || plan.fixture.version < 1 || !plan.fixture.question) {
    throw new Error("Plan must declare fixture id, version and question");
  }
  if (!/^[0-9a-f]{64}$/.test(plan.fixture.sha256)) {
    throw new Error("Plan must declare a 64-hex fixture sha256");
  }
  if (!plan.provider?.service || !plan.provider?.region || !plan.provider?.cpu || !plan.provider?.memory) {
    throw new Error("Plan must declare provider service, region, cpu and memory profile");
  }
  if (!plan.environment || !plan.declaredAt) {
    throw new Error("Plan must declare environment and declaredAt timestamp");
  }
  const expectedSpec: Record<CohortName, { warm: boolean; concurrency: number }> = {
    cold_1u: { warm: false, concurrency: 1 },
    warm_1u: { warm: true, concurrency: 1 },
    cold_2u: { warm: false, concurrency: 2 },
    warm_2u: { warm: true, concurrency: 2 },
  };
  for (const name of COHORT_NAMES) {
    const decl = plan.cohorts?.[name];
    if (!decl || !Number.isInteger(decl.repetitions) || decl.repetitions < 1) {
      throw new Error(`Cohort ${name} must declare a positive integer repetitions count`);
    }
    const spec = expectedSpec[name];
    if (decl.warm !== spec.warm || decl.concurrency !== spec.concurrency) {
      throw new Error(`Cohort ${name} must match warm=${spec.warm} and concurrency=${spec.concurrency}`);
    }
  }
  return true;
}

export function evaluateCodeExecutionBenchmark(
  plan: CodeExecutionBenchmarkPlan,
  observations: CodeExecutionBenchmarkObservation[]
): CodeExecutionBenchmarkReport {
  validateCodeExecutionPlan(plan);

  const cohorts = {} as Record<CohortName, CohortBenchmarkResult>;
  for (const name of COHORT_NAMES) {
    const decl = plan.cohorts[name];
    const items = observations.filter((o) => o.cohort === name);
    if (items.length !== decl.repetitions) {
      cohorts[name] = {
        cohort: name,
        declaredRepetitions: decl.repetitions,
        observedSamples: items.length,
        status: "UNAVAILABLE",
        pass: false,
        runningCodeSamplesMs: [],
        runningCodeMaxMs: null,
        runningCodeP95Ms: null,
        bootExecutionSamplesMs: [],
        bootExecutionP95Ms: null,
        failedSamples: [],
        retrySummary: { retriedSampleCount: 0, totalExtraAttempts: 0, retryEndToEndMs: [] },
        detail: `Declared ${decl.repetitions} samples for ${name}, observed ${items.length}`,
      };
      continue;
    }

    const runningCodeSamplesMs = items.map((o) => {
      if (!o.runningCodeAt) return Infinity;
      const ms = Date.parse(o.runningCodeAt) - Date.parse(o.submittedAt);
      return Number.isFinite(ms) && ms >= 0 ? ms : Infinity;
    });

    const bootExecutionSamplesMs = items.map((o) => {
      if (o.outcome !== "succeeded" || !o.sandboxCreatedAt || !o.executionCompletedAt) return Infinity;
      const ms = Date.parse(o.executionCompletedAt) - Date.parse(o.sandboxCreatedAt);
      return Number.isFinite(ms) && ms >= 0 ? ms : Infinity;
    });

    const failedSamples = items
      .filter((o) => o.outcome !== "succeeded" || !o.sandboxCreatedAt || !o.executionCompletedAt || !o.runningCodeAt)
      .map((o) => ({ sampleIndex: o.sampleIndex, outcome: o.outcome }));

    const runningCodeMaxMs = Math.max(...runningCodeSamplesMs);
    const runningCodeP95Ms = nearestRankP95(runningCodeSamplesMs);
    const bootExecutionP95Ms = nearestRankP95(bootExecutionSamplesMs);

    const retried = items.filter((o) => o.attempts > 1);
    const retrySummary = {
      retriedSampleCount: retried.length,
      totalExtraAttempts: retried.reduce((acc, o) => acc + Math.max(0, o.attempts - 1), 0),
      retryEndToEndMs: retried.map((o) => o.retryEndToEndMs ?? Infinity),
    };

    const pass =
      failedSamples.length === 0 &&
      runningCodeMaxMs <= RUNNING_CODE_TARGET_MS &&
      bootExecutionP95Ms <= BOOT_EXECUTION_P95_TARGET_MS;

    cohorts[name] = {
      cohort: name,
      declaredRepetitions: decl.repetitions,
      observedSamples: items.length,
      status: pass ? "PASS" : "FAIL",
      pass,
      runningCodeSamplesMs,
      runningCodeMaxMs,
      runningCodeP95Ms,
      bootExecutionSamplesMs,
      bootExecutionP95Ms,
      failedSamples,
      retrySummary,
    };
  }

  const statuses = COHORT_NAMES.map((c) => cohorts[c].status);
  const status: "PASS" | "FAIL" | "UNAVAILABLE" = statuses.includes("FAIL")
    ? "FAIL"
    : statuses.includes("UNAVAILABLE")
      ? "UNAVAILABLE"
      : "PASS";

  return {
    plan,
    status,
    pass: status === "PASS",
    countsAsAnswerTtft: false,
    targets: {
      runningCodeMs: RUNNING_CODE_TARGET_MS,
      bootExecutionP95Ms: BOOT_EXECUTION_P95_TARGET_MS,
    },
    cohorts,
  };
}
