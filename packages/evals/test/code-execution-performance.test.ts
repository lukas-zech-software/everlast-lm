import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * 3. Predeclared cohorts (`cold_1u`, `warm_1u`, `cold_2u`, `warm_2u`) with fixed sample counts (N >= 20
 *    declared before collection per cohort), fixture ID, runtime/profile metadata.
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
    expect(RUNNING_CODE_TARGET_MS).toBe(10_000);
    expect(BOOT_EXECUTION_P95_TARGET_MS).toBe(15_000);
    expect(DEFAULT_COHORT_REPETITIONS).toBe(5);
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

  it("CE-PERF-04: boundary at 10,000 ms and 15,000 ms passes (inclusive); 10,001 ms or 15,001 ms fails the cohort and overall benchmark", () => {
    const exactBoundary = [
      ...makeCohortObservations("cold_1u", 20, { runningMs: () => 10_000, bootExecMs: () => 15_000 }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    expect(evaluateCodeExecutionBenchmark(basePlan, exactBoundary).pass).toBe(true);

    const slowRunning = [
      ...makeCohortObservations("cold_1u", 20, { runningMs: (i) => (i === 19 ? 10_001 : 1_000) }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    const slowRunReport = evaluateCodeExecutionBenchmark(basePlan, slowRunning);
    expect(slowRunReport.pass).toBe(false);
    expect(slowRunReport.status).toBe("FAIL");
    expect(slowRunReport.cohorts.cold_1u.pass).toBe(false);

    const slowBootP95 = [
      ...makeCohortObservations("cold_1u", 20, { bootExecMs: (i) => (i >= 18 ? 15_001 : 2_000) }),
      ...makeCohortObservations("warm_1u", 20),
      ...makeCohortObservations("cold_2u", 20),
      ...makeCohortObservations("warm_2u", 20),
    ];
    const slowBootReport = evaluateCodeExecutionBenchmark(basePlan, slowBootP95);
    expect(slowBootReport.cohorts.cold_1u.bootExecutionP95Ms).toBe(15_001);
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

  // [010-code-execution-sandbox] T049: evidence integrity per FR-GC-08, NFR-PERF-01, Gate v3.0 #2.
  it("CE-PERF-08: duplicated identities and unknown or out-of-range samples cannot satisfy a declared cohort", () => {
    for (const patch of [{ sampleIndex: 2 }, { sampleIndex: 0 }, { sampleIndex: 21 }, { cohort: "undeclared" }]) {
      const observations = allPassingObservations();
      Object.assign(observations[0]!, patch);
      expect(() => evaluateCodeExecutionBenchmark(basePlan, observations)).toThrow(/sample|cohort/i);
    }
  });

  it("CE-PERF-09: successful observations require complete, chronological UTC events after predeclaration", () => {
    for (const patch of [
      { submittedAt: "invalid" },
      { submittedAt: "2026-10-23T12:00:00.000Z" },
      { runningCodeAt: "2026-10-24T11:59:59.000Z" },
      { sandboxCreatedAt: "2026-10-24T11:59:59.000Z" },
      { executionCompletedAt: "2026-10-24T11:59:59.000Z" },
      { answerPublishedAt: null },
      { answerPublishedAt: "2026-10-24T12:00:00.000Z" },
    ]) {
      const observations = allPassingObservations();
      Object.assign(observations[0]!, patch);
      expect(() => evaluateCodeExecutionBenchmark(basePlan, observations)).toThrow(/timestamp|chronolog|declar|success/i);
    }
  });

  it("CE-PERF-10: invalid outcome and retry metadata are rejected rather than omitted from failure accounting", () => {
    for (const patch of [
      { outcome: "unknown" }, { attempts: 0 }, { attempts: 3 }, { attempts: 1.5 },
      { attempts: 2, retryEndToEndMs: null }, { attempts: 2, retryEndToEndMs: -1 },
      { attempts: 2, retryEndToEndMs: Infinity },
    ]) {
      const observations = allPassingObservations();
      Object.assign(observations[0]!, patch);
      expect(() => evaluateCodeExecutionBenchmark(basePlan, observations)).toThrow(/outcome|attempt|retry/i);
    }
  });

  it("CE-PERF-11: minimum N=20, UTC declaration and accepted managed profile are enforced", () => {
    for (const plan of [
      { ...basePlan, declaredAt: "invalid" },
      { ...basePlan, provider: { ...basePlan.provider, region: "us-central1" } },
      { ...basePlan, cohorts: { ...basePlan.cohorts, cold_1u: { ...basePlan.cohorts.cold_1u, repetitions: 1 } } },
    ]) expect(() => validateCodeExecutionPlan(plan)).toThrow(/declar|provider|region|repetitions/i);
    expect(evaluateCodeExecutionBenchmark(basePlan, allPassingObservations())).toHaveProperty("observations", allPassingObservations());
  });

  function runCli(args: string[], extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, ["scripts/eval-v3-code-execution.mjs", ...args], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, CODE_EXECUTION_IT: "", CODE_EXECUTION_REASONING_ENGINE: "", ...extraEnv },
      encoding: "utf8",
      timeout: 15_000,
    });
  }

  it("CE-PERF-12: configured runtime without a collector writes an explicit UNAVAILABLE report and exits 2", () => {
    const out = mkdtempSync(join(tmpdir(), "everlast-code-eval-"));
    try {
      const result = runCli(["--out", out], {
        CODE_EXECUTION_IT: "1",
        CODE_EXECUTION_REASONING_ENGINE: "projects/test/locations/europe-west4/reasoningEngines/123",
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("UNAVAILABLE");
      expect(JSON.parse(readFileSync(join(out, "v3-code-execution-benchmark.json"), "utf8"))).toMatchObject({ status: "UNAVAILABLE", pass: false });
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it("CE-PERF-13: importing observations without an explicit predeclared plan cannot manufacture a passing run", () => {
    const out = mkdtempSync(join(tmpdir(), "everlast-code-eval-"));
    try {
      const input = join(out, "observations.json");
      writeFileSync(input, JSON.stringify(allPassingObservations()));
      const result = runCli(["--observations", input, "--out", out]);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/predeclared.*plan|plan.*predeclared/i);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it("CE-PERF-14: explicit evidence import preserves observations and hashes; invalid evidence writes a FAIL report", () => {
    const out = mkdtempSync(join(tmpdir(), "everlast-code-eval-"));
    try {
      const plan = join(out, "plan.json");
      const input = join(out, "observations.json");
      writeFileSync(plan, JSON.stringify(basePlan));
      writeFileSync(input, JSON.stringify(allPassingObservations()));
      const args = ["--plan", plan, "--observations", input, "--out", out];
      const result = runCli(args);
      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(join(out, "v3-code-execution-benchmark.json"), "utf8"));
      expect(report.observations).toEqual(allPassingObservations());
      expect(report.provenance).toMatchObject({ collector: "external-observations", planSha256: expect.stringMatching(/^[0-9a-f]{64}$/), observationsSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      writeFileSync(input, JSON.stringify([{ ...allPassingObservations()[0], attempts: 0 }]));
      expect(runCli(args).status).toBe(1);
      const invalid = JSON.parse(readFileSync(join(out, "v3-code-execution-benchmark.json"), "utf8"));
      expect(invalid).toMatchObject({ status: "FAIL", pass: false });
      expect(invalid.detail).toMatch(/attempt/i);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});

/** FR-GC-08: failure before any actual code attempt never fabricates attempt1. */
it("retains a failed zero-attempt observation without inventing an execution",()=>{
 const p:CodeExecutionBenchmarkPlan={fixture:{id:"f",version:1,sha256:"a".repeat(64),question:"q"},provider:{service:"aiplatform.googleapis.com/AgentEngineSandbox",region:"europe-west4",cpu:"2 vCPU",memory:"1.5 GB"},environment:"test",declaredAt:"2026-11-10T00:00:00.000Z",cohorts:{cold_1u:{repetitions:20,warm:false,concurrency:1},warm_1u:{repetitions:20,warm:true,concurrency:1},cold_2u:{repetitions:20,warm:false,concurrency:2},warm_2u:{repetitions:20,warm:true,concurrency:2}}};
 const o={cohort:"cold_1u" as const,sampleIndex:1,submittedAt:"2026-11-10T00:00:01.000Z",runningCodeAt:null,sandboxCreatedAt:null,executionCompletedAt:null,answerPublishedAt:null,outcome:"failed" as const,attempts:0,retryEndToEndMs:null};
 expect(evaluateCodeExecutionBenchmark(p,[o]).observations[0]!.attempts).toBe(0);
});
