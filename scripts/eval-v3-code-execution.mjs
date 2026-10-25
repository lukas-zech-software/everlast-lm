#!/usr/bin/env node
/**
 * Package 3.2 code-execution performance & evidence benchmark runner (FR-GC-08, NFR-PERF-01; specs/010 T044/T046).
 *
 * Usage:
 *   node scripts/eval-v3-code-execution.mjs [--plan path/to/plan.json] [--observations path/to/observations.json] [--out reports]
 *
 * Evaluates predeclared cold/warm 1-user and 2-user cohorts against:
 *   - Submission → real `running_code` status ≤ 2,500 ms (`RUNNING_CODE_TARGET_MS`)
 *   - Sandbox create → execution completion ≤ 4,000 ms nearest-rank P95 (`BOOT_EXECUTION_P95_TARGET_MS`)
 *
 * Without CODE_EXECUTION_IT=1 + CODE_EXECUTION_REASONING_ENGINE (in europe-west4) or a complete pre-collected
 * `--observations` file matching the declared plan, exits 2 with `[UNAVAILABLE]` — never a fabricated pass.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_EXECUTION_FIXTURE_VERSION,
  LATENCY_TABLE_PAGE,
  POPULATION_STDDEV_QUESTION,
} from "../packages/testkit/src/code-execution-fixtures.ts";
import {
  COHORT_NAMES,
  DEFAULT_COHORT_REPETITIONS,
  evaluateCodeExecutionBenchmark,
  validateCodeExecutionPlan,
} from "../packages/evals/src/code-execution-performance.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const unavailable = (reason, reportPayload = null) => {
  if (reportPayload) {
    const out = arg("out") ?? "reports";
    mkdirSync(out, { recursive: true });
    const file = join(out, "v3-code-execution-benchmark.json");
    writeFileSync(file, JSON.stringify(reportPayload, null, 2));
  }
  console.error(`[UNAVAILABLE] eval:v3-code-execution: ${reason}`);
  process.exit(2);
};

const fixtureSha256 = createHash("sha256").update(LATENCY_TABLE_PAGE, "utf8").digest("hex");

const defaultPlan = {
  fixture: {
    id: "latency-12m-pstdev-v1",
    version: CODE_EXECUTION_FIXTURE_VERSION,
    sha256: fixtureSha256,
    question: POPULATION_STDDEV_QUESTION,
  },
  provider: {
    service: "aiplatform.googleapis.com/AgentEngineSandbox",
    region: "europe-west4",
    cpu: "2 vCPU",
    memory: "1.5 GB",
  },
  environment: process.env.EVERLAST_ENV ?? "dev",
  declaredAt: new Date().toISOString(),
  cohorts: {
    cold_1u: { repetitions: DEFAULT_COHORT_REPETITIONS, warm: false, concurrency: 1 },
    warm_1u: { repetitions: DEFAULT_COHORT_REPETITIONS, warm: true, concurrency: 1 },
    cold_2u: { repetitions: DEFAULT_COHORT_REPETITIONS, warm: false, concurrency: 2 },
    warm_2u: { repetitions: DEFAULT_COHORT_REPETITIONS, warm: true, concurrency: 2 },
  },
};

const planPath = arg("plan");
const observationsPath = arg("observations");
const plan = planPath ? JSON.parse(readFileSync(planPath, "utf8")) : defaultPlan;
validateCodeExecutionPlan(plan);

if (observationsPath) {
  const observations = JSON.parse(readFileSync(observationsPath, "utf8"));
  const result = evaluateCodeExecutionBenchmark(plan, observations);
  const out = arg("out") ?? "reports";
  mkdirSync(out, { recursive: true });
  const file = join(out, "v3-code-execution-benchmark.json");
  writeFileSync(file, JSON.stringify(result, null, 2));
  if (result.status === "UNAVAILABLE") {
    unavailable("incomplete cohort observations for declared plan", result);
  }
  console.log(
    JSON.stringify({
      status: result.status,
      pass: result.pass,
      countsAsAnswerTtft: result.countsAsAnswerTtft,
      cohorts: Object.fromEntries(
        COHORT_NAMES.map((c) => [
          c,
          {
            status: result.cohorts[c].status,
            runningCodeMaxMs: result.cohorts[c].runningCodeMaxMs,
            bootExecutionP95Ms: result.cohorts[c].bootExecutionP95Ms,
            failedSamples: result.cohorts[c].failedSamples.length,
          },
        ])
      ),
      report: file,
    })
  );
  process.exit(result.pass ? 0 : 1);
}

const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
const liveConfigured =
  process.env.CODE_EXECUTION_IT === "1" && /\/locations\/europe-west4\/reasoningEngines\/\d+$/.test(engine);

if (!liveConfigured) {
  const emptyResult = evaluateCodeExecutionBenchmark(plan, []);
  unavailable(
    "Agent Platform Code Execution sandbox is not configured (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE in europe-west4, or supply --observations)",
    emptyResult
  );
}
