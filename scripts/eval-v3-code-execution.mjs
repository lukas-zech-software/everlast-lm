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
 * Imports pre-collected `--observations` only with an explicit predeclared `--plan`.
 * No live application collector is implemented: configuration alone still exits 2 with `[UNAVAILABLE]`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

const out = arg("out") ?? "reports";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceRevision = () => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
};
const provenance = {
  generatedAt: new Date().toISOString(),
  sourceRevision: sourceRevision(),
  sourceTreeDirty: (() => {
    try { return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0; }
    catch { return null; }
  })(),
  nodeVersion: process.version,
  collector: "none",
  planSha256: null,
  observationsSha256: null,
};
function writeReport(report) {
  mkdirSync(out, { recursive: true });
  const file = join(out, "v3-code-execution-benchmark.json");
  writeFileSync(file, JSON.stringify({ ...report, provenance }, (_key, value) =>
    typeof value === "number" && !Number.isFinite(value) ? String(value) : value, 2) + "\n");
  return file;
}
function unavailable(reason, report) {
  writeReport({ ...report, status: "UNAVAILABLE", pass: false, detail: reason });
  console.error(`[UNAVAILABLE] eval:v3-code-execution: ${reason}`);
  process.exit(2);
}

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
let plan = defaultPlan;
try {
  if (planPath) {
    const rawPlan = readFileSync(planPath, "utf8");
    provenance.planSha256 = hash(rawPlan);
    plan = JSON.parse(rawPlan);
  }
  validateCodeExecutionPlan(plan);
  if (!provenance.planSha256) provenance.planSha256 = hash(JSON.stringify(plan));
  if (observationsPath) {
    if (!planPath) unavailable("observations require an explicit predeclared --plan", evaluateCodeExecutionBenchmark(plan, []));
    const rawObservations = readFileSync(observationsPath, "utf8");
    provenance.observationsSha256 = hash(rawObservations);
    provenance.collector = "external-observations";
    const observations = JSON.parse(rawObservations);
    const result = evaluateCodeExecutionBenchmark(plan, observations);
    if (result.status === "UNAVAILABLE") unavailable("incomplete cohort observations for declared plan", result);
    const file = writeReport(result);
    console.log(JSON.stringify({
      status: result.status,
      pass: result.pass,
      countsAsAnswerTtft: result.countsAsAnswerTtft,
      cohorts: Object.fromEntries(COHORT_NAMES.map((name) => [name, {
        status: result.cohorts[name].status,
        runningCodeMaxMs: result.cohorts[name].runningCodeMaxMs,
        bootExecutionP95Ms: result.cohorts[name].bootExecutionP95Ms,
        failedSamples: result.cohorts[name].failedSamples.length,
      }])),
      report: file,
    }));
    process.exit(result.pass ? 0 : 1);
  }

  const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
  const liveConfigured = process.env.CODE_EXECUTION_IT === "1" && /\/locations\/europe-west4\/reasoningEngines\/\d+$/.test(engine);
  unavailable(liveConfigured
    ? "runtime is configured but live application collection is not implemented; supply a predeclared --plan and provenance-backed --observations"
    : "Agent Platform Code Execution sandbox is not configured (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE in europe-west4, or supply --plan and --observations)",
  evaluateCodeExecutionBenchmark(plan, []));
} catch (error) {
  const detail = error instanceof Error ? error.message : "invalid benchmark input";
  writeReport({ status: "FAIL", pass: false, detail });
  console.error(`[FAIL] eval:v3-code-execution: ${detail}`);
  process.exit(1);
}
