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
 * --collect requires an approved frozen plan/manifest, private producer evidence and two Owner credentials.
 * Configuration alone still exits 2 with `[UNAVAILABLE]`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OwnerPrivateDirectory } from "@everlast/cloud/private-benchmark";
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

import { collectCodeExecutionCohorts, CodeExecutionCollectionManifestSchema, codeExecutionRuntimeConfigDigest } from "../packages/evals/src/code-execution-collector.ts";
import { createCodeExecutionHttpTransport, createCodeExecutionPrivateFileReader } from "../packages/evals/src/code-execution-transport.ts";

const COLLECTION_DEADLINE_MS = 120_000;

export async function runCodeExecutionCli(argv, clockSession) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const out = clockSession?.directory ?? arg("out") ?? "reports";
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
    clockContinuity: "not-observed",
  };
  function writeReport(report) {
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const file = join(out, "v3-code-execution-benchmark.json");
    const text = JSON.stringify({ ...report, provenance }, (_key, value) =>
      typeof value === "number" && !Number.isFinite(value) ? String(value) : value, 2) + "\n";
    if (clockSession) new OwnerPrivateDirectory(resolve(out)).write("v3-code-execution-benchmark.json", text);
    else writeFileSync(file, text);
    return file;
  }
  function unavailable(reason, report) {
    writeReport({ ...report, status: "UNAVAILABLE", pass: false, detail: reason });
    console.error(`[UNAVAILABLE] eval:v3-code-execution: ${reason}`);
    return 2;
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
    if (clockSession && (!argv.includes("--collect") || observationsPath)) {
      return unavailable("guarded acquisition requires ordinary --collect", evaluateCodeExecutionBenchmark(plan, []));
    }
    if (argv.includes("--collect")) {
      const manifestPath = arg("collection-manifest"), evidencePath = arg("private-evidence");
      const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
      if (!planPath || observationsPath || !manifestPath || !evidencePath || process.env.CODE_EXECUTION_IT !== "1" || !/\/locations\/europe-west4\/reasoningEngines\/\d+$/.test(engine)) return unavailable("collection requires an explicit plan/manifest/private evidence and approved EU runtime configuration", evaluateCodeExecutionBenchmark(plan, []));
      const rawManifest = readFileSync(manifestPath, "utf8");
      if (process.env.CODE_EXECUTION_BENCHMARK_APPROVED_PLAN_SHA256 !== provenance.planSha256 || process.env.CODE_EXECUTION_BENCHMARK_APPROVED_MANIFEST_SHA256 !== hash(rawManifest)) return unavailable("frozen plan and manifest hashes do not match the authorized collection scope", evaluateCodeExecutionBenchmark(plan, []));
      const manifest = CodeExecutionCollectionManifestSchema.parse(JSON.parse(rawManifest));
      if (clockSession) {
        const waves = COHORT_NAMES.reduce((sum, name) => {
          const { repetitions, concurrency } = plan.cohorts[name];
          return sum + Math.ceil(repetitions / concurrency);
        }, 0);
        try {
          clockSession.assertClockCurrent(manifest.clock_calibration);
          if (manifest.candidate_commit !== clockSession.identity.candidate_commit ||
              manifest.serving_revision !== clockSession.identity.serving_revision) throw new Error("Serving identity mismatch");
          clockSession.reserveCollection(waves * COLLECTION_DEADLINE_MS);
        } catch {
          return unavailable("campaign binding or conservative duration unavailable", evaluateCodeExecutionBenchmark(plan, []));
        }
      }
      if(codeExecutionRuntimeConfigDigest(engine)!==manifest.runtime_config_sha256) return unavailable("approved runtime configuration does not match the frozen collection manifest", evaluateCodeExecutionBenchmark(plan,[]));
      const credentials = new Map();
      for (const actor of manifest.actors) {
        const token = actor.credential_env && process.env[actor.credential_env];
        if (!token) return unavailable("both private Owner credentials are required", evaluateCodeExecutionBenchmark(plan, []));
        credentials.set(actor.notebook_id, token);
      }
      if(new Set(credentials.values()).size!==2) return unavailable("two distinct private Owner credentials are required", evaluateCodeExecutionBenchmark(plan,[]));
      const reader = createCodeExecutionPrivateFileReader(evidencePath, manifest, plan.fixture.sha256);
      try { await reader.preflight(); } catch { return unavailable("qualified private producer evidence is unavailable or does not match the frozen scope", evaluateCodeExecutionBenchmark(plan, [])); }
      const submit = createCodeExecutionHttpTransport({ baseUrl: manifest.api_base_url, credentials });
      const result = await collectCodeExecutionCohorts(plan, manifest, {
        submit, measurement: reader.measurement, deadlineMs: COLLECTION_DEADLINE_MS,
        ...(clockSession ? { assertClockCurrent: clockSession.assertClockCurrent } : {}),
      });
      provenance.collector = "ordinary-application-sse";
      const exportCollection = () => writeReport({
        ...result.report, status: result.status, pass: result.status === "PASS", release_eligible: false,
        collection: { attempts: result.attempts, problems: result.problems, provenance: result.provenance },
      });
      let file;
      if (clockSession) {
        try {
          clockSession.assertClockCurrent(manifest.clock_calibration);
          provenance.clockContinuity = "observed-through-export";
          file = exportCollection();
          clockSession.assertClockCurrent(manifest.clock_calibration);
        } catch {
          result.status = "UNAVAILABLE";
          result.problems.push("clock_continuity_unavailable_at_export");
          provenance.clockContinuity = "invalid";
          file = exportCollection();
        }
      } else {
        file = exportCollection();
      }
      console.log(JSON.stringify({ status: result.status, pass: result.status === "PASS", attemptedRequests: result.attempts.length, report: file }));
      return result.status === "PASS" ? 0 : result.status === "UNAVAILABLE" ? 2 : 1;
    }
    if (observationsPath) {
      if (!planPath) return unavailable("observations require an explicit predeclared --plan", evaluateCodeExecutionBenchmark(plan, []));
      const rawObservations = readFileSync(observationsPath, "utf8");
      provenance.observationsSha256 = hash(rawObservations);
      provenance.collector = "external-observations";
      const observations = JSON.parse(rawObservations);
      const result = evaluateCodeExecutionBenchmark(plan, observations);
      if (result.status === "UNAVAILABLE") return unavailable("incomplete cohort observations for declared plan", result);
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
      return result.pass ? 0 : 1;
    }

    const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
    const liveConfigured = process.env.CODE_EXECUTION_IT === "1" && /\/locations\/europe-west4\/reasoningEngines\/\d+$/.test(engine);
    return unavailable(liveConfigured
      ? "runtime is configured; explicit --collect with approved frozen scope/private evidence is required, or supply --plan and provenance-backed --observations"
      : "Agent Platform Code Execution sandbox is not configured (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE in europe-west4, or supply --plan and --observations)",
    evaluateCodeExecutionBenchmark(plan, []));
  } catch (error) {
    const detail = argv.includes("--collect") ? "invalid collection configuration or private evidence" : error instanceof Error ? error.message : "invalid benchmark input";
    writeReport({ status: "FAIL", pass: false, detail });
    console.error(`[FAIL] eval:v3-code-execution: ${detail}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runCodeExecutionCli(process.argv.slice(2));
