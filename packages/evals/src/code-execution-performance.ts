/**
 * Package 3.2 code-execution performance benchmark aggregation (FR-GC-08, NFR-PERF-01; specs/010 T043/T044).
 *
 * Clocks and rules (spec FR-004, SC-003, SC-004; plan.md):
 * 1. Submission → real `running_code` status: ≤ 2,500 ms (`RUNNING_CODE_TARGET_MS`) from sufficient-intent submission.
 * 2. Sandbox create → execution completion: ≤ 4,000 ms nearest-rank P95 (`BOOT_EXECUTION_P95_TARGET_MS`).
 * 3. Predeclared cohorts (`cold_1u`, `warm_1u`, `cold_2u`, `warm_2u`) with fixed sample count (N >= 20).
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
  /** Client monotonic submission-to-received-status duration when collected over HTTP. */
  clientRunningCodeMs?: number;
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
  observations: CodeExecutionBenchmarkObservation[];
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
  if (!plan?.fixture?.id || !Number.isInteger(plan.fixture.version) || plan.fixture.version < 1 || !plan.fixture.question) {
    throw new Error("Plan must declare fixture id, version and question");
  }
  if (!/^[0-9a-f]{64}$/.test(plan.fixture.sha256)) {
    throw new Error("Plan must declare a 64-hex fixture sha256");
  }
  if (plan.provider?.service !== "aiplatform.googleapis.com/AgentEngineSandbox" || plan.provider.region !== "europe-west4" ||
      plan.provider.cpu !== "2 vCPU" || plan.provider.memory !== "1.5 GB") {
    throw new Error("Plan provider must match the accepted AgentEngineSandbox europe-west4 2 vCPU / 1.5 GB profile");
  }
  if (!plan.environment || !plan.declaredAt) {
    throw new Error("Plan must declare environment and declaredAt timestamp");
  }
  timestamp(plan.declaredAt, "Plan declaredAt");
  if (Object.keys(plan.cohorts ?? {}).some((name) => !COHORT_NAMES.includes(name as CohortName))) {
    throw new Error("Plan contains an undeclared cohort");
  }
  const expectedSpec: Record<CohortName, { warm: boolean; concurrency: number }> = {
    cold_1u: { warm: false, concurrency: 1 },
    warm_1u: { warm: true, concurrency: 1 },
    cold_2u: { warm: false, concurrency: 2 },
    warm_2u: { warm: true, concurrency: 2 },
  };
  for (const name of COHORT_NAMES) {
    const decl = plan.cohorts?.[name];
    if (!decl || !Number.isSafeInteger(decl.repetitions) || decl.repetitions < DEFAULT_COHORT_REPETITIONS) {
      throw new Error(`Cohort ${name} must declare an integer repetitions count of at least ${DEFAULT_COHORT_REPETITIONS}`);
    }
    const spec = expectedSpec[name];
    if (decl.warm !== spec.warm || decl.concurrency !== spec.concurrency) {
      throw new Error(`Cohort ${name} must match warm=${spec.warm} and concurrency=${spec.concurrency}`);
    }
  }
  return true;
}

/** FR-GC-08/NFR-PERF-01: never derive passing timings from malformed or post-hoc evidence. */
function timestamp(value: string, label: string): number {
  const ms = Date.parse(value);
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw new Error(`${label} must be a valid UTC timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)`);
  }
  return ms;
}

function validateObservations(plan: CodeExecutionBenchmarkPlan, observations: CodeExecutionBenchmarkObservation[]): void {
  if (!Array.isArray(observations)) throw new Error("Observations must be an array of cohort samples");
  const seen = new Set<string>();
  for (const item of observations) {
    if (!item || !COHORT_NAMES.includes(item.cohort)) throw new Error("Observation has an undeclared cohort");
    if (!Number.isSafeInteger(item.sampleIndex) || item.sampleIndex < 1 || item.sampleIndex > plan.cohorts[item.cohort].repetitions) {
      throw new Error(`Cohort ${item.cohort} sampleIndex is outside its declared range`);
    }
    const identity = `${item.cohort}:${item.sampleIndex}`;
    if (seen.has(identity)) throw new Error(`Duplicate cohort sample ${identity}`);
    seen.add(identity);
    if (!["succeeded", "failed", "timed_out", "unfinished"].includes(item.outcome)) throw new Error(`Sample ${identity} has an invalid outcome`);
    if (![0,1,2].includes(item.attempts) || (item.outcome === "succeeded" && item.attempts === 0)) throw new Error(`Sample ${identity} has invalid actual attempt count`);
    if (item.clientRunningCodeMs !== undefined && (!Number.isFinite(item.clientRunningCodeMs) || item.clientRunningCodeMs < 0)) throw new Error(`Sample ${identity} has invalid client status timing`);
    if ((item.attempts === 2 && !((item.retryEndToEndMs === null && item.outcome !== "succeeded") || (typeof item.retryEndToEndMs === "number" && Number.isFinite(item.retryEndToEndMs) && item.retryEndToEndMs >= 0))) ||
        (item.attempts < 2 && item.retryEndToEndMs !== null)) {
      throw new Error(`Sample ${identity} has invalid retry metadata`);
    }
    let previous = timestamp(item.submittedAt, `Sample ${identity} submittedAt`);
    if (previous < timestamp(plan.declaredAt, "Plan declaredAt")) throw new Error(`Sample ${identity} precedes its plan declaration`);
    // Creation is the creation-request boundary; running_code is emitted after creation, before completion.
    for (const key of ["sandboxCreatedAt", "runningCodeAt", "executionCompletedAt", "answerPublishedAt"] as const) {
      const value = item[key];
      if (value === null && item.outcome !== "succeeded") continue;
      if (value === null) throw new Error(`Successful sample ${identity} requires all event timestamps`);
      const current = timestamp(value, `Sample ${identity} ${key}`);
      if (current < previous) throw new Error(`Sample ${identity} has invalid event chronology at ${key}`);
      previous = current;
    }
  }
}

export function evaluateCodeExecutionBenchmark(
  plan: CodeExecutionBenchmarkPlan,
  observations: CodeExecutionBenchmarkObservation[]
): CodeExecutionBenchmarkReport {
  validateCodeExecutionPlan(plan);
  validateObservations(plan, observations);

  const cohorts = {} as Record<CohortName, CohortBenchmarkResult>;
  for (const name of COHORT_NAMES) {
    const decl = plan.cohorts[name];
    const items = observations.filter((o) => o.cohort === name);
    const failedSamples = items
      .filter((o) => o.outcome !== "succeeded" || !o.sandboxCreatedAt || !o.executionCompletedAt || !o.runningCodeAt)
      .map((o) => ({ sampleIndex: o.sampleIndex, outcome: o.outcome }));

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
        failedSamples,
        retrySummary: { retriedSampleCount: 0, totalExtraAttempts: 0, retryEndToEndMs: [] },
        detail: `Declared ${decl.repetitions} samples for ${name}, observed ${items.length}`,
      };
      continue;
    }

    const runningCodeSamplesMs = items.map((o) => {
      if (!o.runningCodeAt) return Infinity;
      if (o.clientRunningCodeMs !== undefined) return o.clientRunningCodeMs;
      const ms = Date.parse(o.runningCodeAt) - Date.parse(o.submittedAt);
      return Number.isFinite(ms) && ms >= 0 ? ms : Infinity;
    });

    const bootExecutionSamplesMs = items.map((o) => {
      if (o.outcome !== "succeeded" || !o.sandboxCreatedAt || !o.executionCompletedAt) return Infinity;
      const ms = Date.parse(o.executionCompletedAt) - Date.parse(o.sandboxCreatedAt);
      return Number.isFinite(ms) && ms >= 0 ? ms : Infinity;
    });

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
    observations,
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
