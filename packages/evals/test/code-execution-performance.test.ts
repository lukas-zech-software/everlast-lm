import { describe, expect, it } from "vitest";
import {
  BOOT_EXECUTION_P95_TARGET_MS,
  COHORT_NAMES,
  DEFAULT_COHORT_REPETITIONS,
  evaluateCodeExecutionBenchmark,
  nearestRankP95,
  RUNNING_CODE_TARGET_MS,
  validateCodeExecutionPlan,
  type CodeExecutionBenchmarkObservation,
  type CodeExecutionBenchmarkPlan,
  type CohortName,
} from "../src/code-execution-performance.ts";

/**
 * [010-code-execution-sandbox] T043 — benchmark aggregation tests for Package 3.2 (FR-GC-08, NFR-PERF-01;
 * spec FR-004, SC-003, SC-004).
 *
 * Rules:
 * 1. Sufficient-intent submission → real `running_code` status <= 2,500 ms (`RUNNING_CODE_TARGET_MS`).
 * 2. Sandbox create → execution completion <= 4,000 ms nearest-rank P95 (`BOOT_EXECUTION_P95_TARGET_MS`).
 * 3. Predeclared cohorts (`cold_1u`, `warm_1u`, `cold_2u`, `warm_2u`) with fixed sample counts (N >= 20 default
 *    or declared positive integer per cohort), fixture ID, runtime/profile metadata.
 * 4. Nearest-rank P95: `Math.ceil(0.95 * N)`.
 * 5. Any failed or timed-out sample stays in the cohort (duration +Infinity) and fails its cohort (`pass = false`).
 * 6. Missing or mismatched sample count for a cohort -> cohort status `"UNAVAILABLE"` (never a pass).
 * 7. Retries are tracked separately (`retryAttempts`, `retryEndToEndMs`), never reset the submission clock, and
 *    `running_code` progress never counts as validated answer TTFT (`countsAsAnswerTtft: false`).
 */

const basePlan: CodeExecutionBenchmarkPlan = {
  fixture: {
    id: "latency-12m-pstdev-v1",
    version: 1,
    sha256: "b".repeat(64),
    question: "What is the exact population standard deviation of the monthly latency? Plot the trend.",
  },
  provider: {
    service: "aiplatform.googleapis.com/AgentEngineSandbox",
    region: "europe-west4",
    cpu: "2 vCPU",
    memory: "1.5 GB",
  },
  environment: "dev",
  declaredAt: "2026-10-24T12:00:00.000Z",
  cohorts: {
    cold_1u: { repetitions: 20, warm: false, concurrency: 1 },
    warm_1u: { repetitions: 20, warm: true, concurrency: 1 },
    cold_2u: { repetitions: 20, warm: false, concurrency: 2 },
    warm_2u: { repetitions: 20, warm: true, concurrency: 2 },
  },
};

function makeCohortObservations(
  cohort: CohortName,
  n: number,
  opts: {
    runningMs?: (i: number) => number | null;
    bootExecMs?: (i: number) => number | null;
    outcome?: (i: number) => CodeExecutionBenchmarkObservation["outcome"];
    attempts?: (i: number) => number;
    retryEndToEndMs?: (i: number) => number | null;
  } = {}
): CodeExecutionBenchmarkObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const sub = Date.parse("2026-10-24T12:00:00.000Z") + i * 60_000;
    const runDelta = opts.runningMs ? opts.runningMs(i) : 900;
    const createAt = sub + (runDelta ?? 900);
    const bootDelta = opts.bootExecMs ? opts.bootExecMs(i) : 2_100;
    const outcome = opts.outcome ? opts.outcome(i) : "succeeded";
    const attempts = opts.attempts ? opts.attempts(i) : 1;
    const retryTotal = opts.retryEndToEndMs ? opts.retryEndToEndMs(i) : attempts > 1 ? 5_200 : null;
    return {
      cohort,
      sampleIndex: i + 1,
      submittedAt: new Date(sub).toISOString(),
      runningCodeAt: runDelta === null ? null : new Date(sub + runDelta).toISOString(),
      sandboxCreatedAt: new Date(createAt).toISOString(),
      executionCompletedAt: bootDelta === null ? null : new Date(createAt + bootDelta).toISOString(),
      answerPublishedAt: bootDelta === null ? null : new Date(createAt + bootDelta + 350).toISOString(),
      outcome,
      attempts,
      retryEndToEndMs: retryTotal,
    };
  });
}

function allPassingObservations(): CodeExecutionBenchmarkObservation[] {
  return COHORT_NAMES.flatMap((c) => makeCohortObservations(c, 20));
}

describe("code-execution performance benchmark aggregation (FR-GC-08, NFR-PERF-01; T043)", () => {
  it("CE-PERF-01: constants and nearest-rank P95 ceil(0.95*N) preserve +Infinity for failed/timeout samples", () => {
    expect(RUNNING_CODE_TARGET_MS).toBe(2_500);
    expect(BOOT_EXECUTION_P95_TARGET_MS).toBe(4_000);
    expect(DEFAULT_COHORT_REPETITIONS).toBe(20);
    expect(COHORT_NAMES).toEqual(["cold_1u", "warm_1u", "cold_2u", "warm_2u"]);
    expect(nearestRankP95(Array.from({ length: 20 }, (_, i) => (i + 1) * 100))).toBe(1_900);
    expect(nearestRankP95([...Array.from({ length: 19 }, () => 2_000), Infinity])).toBe(2_000);
    expect(nearestRankP95([...Array.from({ length: 18 }, () => 2_000), Infinity, Infinity])).toBe(Infinity);
    expect(() => nearestRankP95([])).toThrow(/sample/i);
  });

  it("CE-PERF-02: plan validation requires declared fixture SHA-256, provider profile and all four cold/warm 1u/2u cohorts", () => {
    expect(validateCodeExecutionPlan(basePlan)).toBe(true);
    expect(() =>
      validateCodeExecutionPlan({
        ...basePlan,
        fixture: { ...basePlan.fixture, sha256: "invalid" },
      })
    ).toThrow(/sha256/i);
    expect(() =>
      validateCodeExecutionPlan({
        ...basePlan,
        cohorts: {
          ...basePlan.cohorts,
          cold_1u: { repetitions: 0, warm: false, concurrency: 1 },
        },
      })
    ).toThrow(/repetitions/i);
    expect(() =>
      validateCodeExecutionPlan({
        ...basePlan,
        cohorts: {
          ...basePlan.cohorts,
          warm_2u: { repetitions: 20, warm: true, concurrency: 1 },
        },
      })
    ).toThrow(/concurrency/i);
  });

  it("CE-PERF-03: all four cohorts pass when submission->running_code <= 2,500 ms and create->completion P95 <= 4,000 ms with zero failed samples", () => {
    const report = evaluateCodeExecutionBenchmark(basePlan, allPassingObservations());
    expect(report.status).toBe("PASS");
    expect(report.pass).toBe(true);
    expect(report.countsAsAnswerTtft).toBe(false);
    for (const name of COHORT_NAMES) {
      const c = report.cohorts[name];
      expect(c.status).toBe("PASS");
      expect(c.pass).toBe(true);
      expect(c.runningCodeMaxMs).toBe(900);
      expect(c.runningCodeP95Ms).toBe(900);
      expect(c.bootExecutionP95Ms).toBe(2_100);
      expect(c.failedSamples).toEqual([]);
    }
  });

  it("CE-PERF-04: boundary at 2,500 ms and 4,000 ms passes (inclusive); 2,501 ms or 4,001 ms fails the cohort and overall benchmark", () => {
    const exactBoundary = [
      ...makeCohortObservations("cold_1u", 20, { runningMs: () => 2_500, bootExecMs: () => 4_000 }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    expect(evaluateCodeExecutionBenchmark(basePlan, exactBoundary).pass).toBe(true);

    const slowRunning = [
      ...makeCohortObservations("cold_1u", 20, { runningMs: (i) => (i === 19 ? 2_501 : 1_000) }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    const slowRunReport = evaluateCodeExecutionBenchmark(basePlan, slowRunning);
    expect(slowRunReport.pass).toBe(false);
    expect(slowRunReport.status).toBe("FAIL");
    expect(slowRunReport.cohorts.cold_1u.pass).toBe(false);

    const slowBootP95 = [
      ...makeCohortObservations("cold_1u", 20, { bootExecMs: (i) => (i >= 18 ? 4_001 : 2_000) }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    const slowBootReport = evaluateCodeExecutionBenchmark(basePlan, slowBootP95);
    expect(slowBootReport.cohorts.cold_1u.bootExecutionP95Ms).toBe(4_001);
    expect(slowBootReport.cohorts.cold_1u.pass).toBe(false);
    expect(slowBootReport.pass).toBe(false);
  });

  it("CE-PERF-05: any failed or timed-out sample stays in the cohort as +Infinity and fails its cohort even if N=20 P95 would otherwise be <= 4,000 ms", () => {
    const oneTimeout = [
      ...makeCohortObservations("cold_1u", 20, {
        bootExecMs: (i) => (i === 0 ? null : 1_500),
        outcome: (i) => (i === 0 ? "timed_out" : "succeeded"),
      }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    const result = evaluateCodeExecutionBenchmark(basePlan, oneTimeout);
    // With 1/20 at +Infinity, ceil(0.95*20)=19th sample is still 1,500 ms, yet the rule mandates any failed/timeout sample fails its cohort!
    expect(result.cohorts.cold_1u.bootExecutionSamplesMs.filter((x) => x === Infinity)).toHaveLength(1);
    expect(result.cohorts.cold_1u.bootExecutionP95Ms).toBe(1_500);
    expect(result.cohorts.cold_1u.failedSamples).toEqual([{ sampleIndex: 1, outcome: "timed_out" }]);
    expect(result.cohorts.cold_1u.pass).toBe(false);
    expect(result.cohorts.cold_1u.status).toBe("FAIL");
    expect(result.pass).toBe(false);
    expect(result.status).toBe("FAIL");
  });

  it("CE-PERF-06: missing or incomplete cohort observations report UNAVAILABLE and never pass", () => {
    const missingWarm = makeCohortObservations("cold_1u", 20);
    const partial = evaluateCodeExecutionBenchmark(basePlan, missingWarm);
    expect(partial.pass).toBe(false);
    expect(partial.status).toBe("UNAVAILABLE");
    expect(partial.cohorts.cold_1u.status).toBe("PASS");
    expect(partial.cohorts.warm_1u.status).toBe("UNAVAILABLE");
    expect(partial.cohorts.cold_2u.status).toBe("UNAVAILABLE");
    expect(partial.cohorts.warm_2u.status).toBe("UNAVAILABLE");

    const empty = evaluateCodeExecutionBenchmark(basePlan, []);
    expect(empty.status).toBe("UNAVAILABLE");
    expect(empty.pass).toBe(false);
  });

  it("CE-PERF-07: retry attempts are reported separately without resetting the submission clock, and progress is never counted as answer TTFT", () => {
    const withRetries = [
      ...makeCohortObservations("cold_1u", 20, {
        runningMs: () => 1_100,
        bootExecMs: () => 2_200,
        attempts: (i) => (i < 3 ? 2 : 1),
        retryEndToEndMs: (i) => (i < 3 ? 5_800 : null),
      }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    const report = evaluateCodeExecutionBenchmark(basePlan, withRetries);
    expect(report.countsAsAnswerTtft).toBe(false);
    expect(report.cohorts.cold_1u.retrySummary).toEqual({
      retriedSampleCount: 3,
      totalExtraAttempts: 3,
      retryEndToEndMs: [5_800, 5_800, 5_800],
    });
    // First-attempt submission->running_code clock was not reset by the retry
    expect(report.cohorts.cold_1u.runningCodeMaxMs).toBe(1_100);
  });
});
