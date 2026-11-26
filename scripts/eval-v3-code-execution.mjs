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
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { OwnerPrivateDirectory } from "@everlast/cloud/private-benchmark";
import {
  assertDevOnlyEnvironment,
  withDevTestEnvironment,
} from "../packages/testkit/src/live-fixtures.ts";
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
import {
  collectCodeExecutionCohorts,
  CodeExecutionCollectionManifestSchema,
  codeExecutionRuntimeConfigDigest,
} from "../packages/evals/src/code-execution-collector.ts";
import {
  createCodeExecutionHttpTransport,
  createCodeExecutionPrivateFileReader,
} from "../packages/evals/src/code-execution-transport.ts";

const COLLECTION_DEADLINE_MS = 120_000;
const REASONING_ENGINE_RE = /\/locations\/europe-west4\/reasoningEngines\/\d+$/;

const hash = (value) => createHash("sha256").update(value).digest("hex");

function readArg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function resolveStatusExitCode(status) {
  if (status === "PASS") {
    return 0;
  }
  if (status === "UNAVAILABLE") {
    return 2;
  }
  return 1;
}

function createProvenance() {
  let sourceRevision = "unknown";
  try {
    sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Keep "unknown" when git metadata is unavailable
  }
  let sourceTreeDirty = null;
  try {
    sourceTreeDirty =
      execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  } catch {
    // Keep null when git metadata is unavailable
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceRevision,
    sourceTreeDirty,
    nodeVersion: process.version,
    collector: "none",
    planSha256: null,
    observationsSha256: null,
    clockContinuity: "not-observed",
  };
}

function buildDefaultPlan() {
  const fixtureSha256 = createHash("sha256").update(LATENCY_TABLE_PAGE, "utf8").digest("hex");
  return {
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
}

async function runSmokeMode(ctx, plan) {
  assertDevOnlyEnvironment(process.env);
  const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
  if (!REASONING_ENGINE_RE.test(engine)) {
    return ctx.unavailable(
      "CODE_EXECUTION_REASONING_ENGINE in europe-west4 is required on dev for --smoke",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  return withDevTestEnvironment({ env: process.env }, async () => {
    const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
    const { GoogleAuth } = await import(apiRequire.resolve("google-auth-library"));
    const { AgentPlatformSandboxRuntime, REQUIRED_LIBRARIES, runAttempt } =
      await import("../apps/api/src/chat/execution/runtime.ts");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const runtime = new AgentPlatformSandboxRuntime({
      reasoningEngine: engine,
      location: "europe-west4",
      accessToken: async () => (await (await auth.getClient()).getAccessToken()).token ?? "",
    });
    const started = Date.now();
    const code = `${REQUIRED_LIBRARIES.map((l) => `import ${l}`).join("\n")}\nimport statistics\nemit('sd', statistics.pstdev(range(1, 13)), unit='ms')`;
    const outcome = await runAttempt({ runtime, attemptId: randomUUID(), code, files: [] });
    const pass =
      outcome.kind === "completed" &&
      Math.abs(Number(outcome.results[0]?.value) - Math.sqrt(143 / 12)) < 1e-9;
    ctx.provenance.collector = "dev-smoke";
    const file = ctx.writeReport({
      status: pass ? "PASS" : "FAIL",
      pass,
      mode: "dev-smoke",
      elapsedMs: Date.now() - started,
      outcome,
    });
    console.log(
      JSON.stringify({
        status: pass ? "PASS" : "FAIL",
        pass,
        elapsedMs: Date.now() - started,
        report: file,
      }),
    );
    return pass ? 0 : 1;
  });
}

function reserveClockSession(clockSession, manifest, plan) {
  if (!clockSession) {
    return true;
  }
  const waves = COHORT_NAMES.reduce((sum, name) => {
    const { repetitions, concurrency } = plan.cohorts[name];
    return sum + Math.ceil(repetitions / concurrency);
  }, 0);
  try {
    clockSession.assertClockCurrent(manifest.clock_calibration);
    if (
      manifest.candidate_commit !== clockSession.identity.candidate_commit ||
      manifest.serving_revision !== clockSession.identity.serving_revision
    ) {
      throw new Error("Serving identity mismatch");
    }
    clockSession.reserveCollection(waves * COLLECTION_DEADLINE_MS);
    return true;
  } catch {
    return false;
  }
}

function loadCollectCredentials(manifest) {
  const credentials = new Map();
  for (const actor of manifest.actors) {
    const token = actor.credential_env && process.env[actor.credential_env];
    if (!token) {
      return { error: "both private Owner credentials are required" };
    }
    credentials.set(actor.notebook_id, token);
  }
  if (new Set(credentials.values()).size !== 2) {
    return { error: "two distinct private Owner credentials are required" };
  }
  return { credentials };
}

function exportCollectionWithClock(ctx, manifest, result) {
  const exportCollection = () =>
    ctx.writeReport({
      ...result.report,
      status: result.status,
      pass: result.status === "PASS",
      release_eligible: false,
      collection: {
        attempts: result.attempts,
        problems: result.problems,
        provenance: result.provenance,
      },
    });
  if (!ctx.clockSession) {
    return exportCollection();
  }
  try {
    ctx.clockSession.assertClockCurrent(manifest.clock_calibration);
    ctx.provenance.clockContinuity = "observed-through-export";
    const file = exportCollection();
    ctx.clockSession.assertClockCurrent(manifest.clock_calibration);
    return file;
  } catch {
    result.status = "UNAVAILABLE";
    result.problems.push("clock_continuity_unavailable_at_export");
    ctx.provenance.clockContinuity = "invalid";
    return exportCollection();
  }
}

async function runCollectMode(ctx, plan, planPath, observationsPath) {
  const manifestPath = readArg(ctx.argv, "collection-manifest");
  const evidencePath = readArg(ctx.argv, "private-evidence");
  const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
  if (
    !planPath ||
    observationsPath ||
    !manifestPath ||
    !evidencePath ||
    process.env.CODE_EXECUTION_IT !== "1" ||
    !REASONING_ENGINE_RE.test(engine)
  ) {
    return ctx.unavailable(
      "collection requires an explicit plan/manifest/private evidence and approved EU runtime configuration",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  const rawManifest = readFileSync(manifestPath, "utf8");
  if (
    process.env.CODE_EXECUTION_BENCHMARK_APPROVED_PLAN_SHA256 !== ctx.provenance.planSha256 ||
    process.env.CODE_EXECUTION_BENCHMARK_APPROVED_MANIFEST_SHA256 !== hash(rawManifest)
  ) {
    return ctx.unavailable(
      "frozen plan and manifest hashes do not match the authorized collection scope",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  const manifest = CodeExecutionCollectionManifestSchema.parse(JSON.parse(rawManifest));
  if (!reserveClockSession(ctx.clockSession, manifest, plan)) {
    return ctx.unavailable(
      "campaign binding or conservative duration unavailable",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  if (codeExecutionRuntimeConfigDigest(engine) !== manifest.runtime_config_sha256) {
    return ctx.unavailable(
      "approved runtime configuration does not match the frozen collection manifest",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  const credResult = loadCollectCredentials(manifest);
  if (credResult.error) {
    return ctx.unavailable(credResult.error, evaluateCodeExecutionBenchmark(plan, []));
  }
  const reader = createCodeExecutionPrivateFileReader(evidencePath, manifest, plan.fixture.sha256);
  try {
    await reader.preflight();
  } catch {
    return ctx.unavailable(
      "qualified private producer evidence is unavailable or does not match the frozen scope",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  const submit = createCodeExecutionHttpTransport({
    baseUrl: manifest.api_base_url,
    credentials: credResult.credentials,
  });
  const result = await withDevTestEnvironment({ env: process.env }, () =>
    collectCodeExecutionCohorts(plan, manifest, {
      submit,
      measurement: reader.measurement,
      deadlineMs: COLLECTION_DEADLINE_MS,
      ...(ctx.clockSession ? { assertClockCurrent: ctx.clockSession.assertClockCurrent } : {}),
    }),
  );
  ctx.provenance.collector = "ordinary-application-sse";
  const file = exportCollectionWithClock(ctx, manifest, result);
  console.log(
    JSON.stringify({
      status: result.status,
      pass: result.status === "PASS",
      attemptedRequests: result.attempts.length,
      report: file,
    }),
  );
  return resolveStatusExitCode(result.status);
}

function runObservationsMode(ctx, plan, planPath, observationsPath) {
  if (!planPath) {
    return ctx.unavailable(
      "observations require an explicit predeclared --plan",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  }
  const rawObservations = readFileSync(observationsPath, "utf8");
  ctx.provenance.observationsSha256 = hash(rawObservations);
  ctx.provenance.collector = "external-observations";
  const observations = JSON.parse(rawObservations);
  const result = evaluateCodeExecutionBenchmark(plan, observations);
  if (result.status === "UNAVAILABLE") {
    return ctx.unavailable("incomplete cohort observations for declared plan", result);
  }
  const file = ctx.writeReport(result);
  console.log(
    JSON.stringify({
      status: result.status,
      pass: result.pass,
      countsAsAnswerTtft: result.countsAsAnswerTtft,
      cohorts: Object.fromEntries(
        COHORT_NAMES.map((name) => [
          name,
          {
            status: result.cohorts[name].status,
            runningCodeMaxMs: result.cohorts[name].runningCodeMaxMs,
            bootExecutionP95Ms: result.cohorts[name].bootExecutionP95Ms,
            failedSamples: result.cohorts[name].failedSamples.length,
          },
        ]),
      ),
      report: file,
    }),
  );
  return result.pass ? 0 : 1;
}

export async function runCodeExecutionCli(argv, clockSession) {
  const out = clockSession?.directory ?? readArg(argv, "out") ?? "reports";
  const provenance = createProvenance();
  function writeReport(report) {
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const file = join(out, "v3-code-execution-benchmark.json");
    const serialized = JSON.stringify(
      { ...report, provenance },
      (_key, value) =>
        typeof value === "number" && !Number.isFinite(value) ? String(value) : value,
      2,
    );
    const text = `${serialized}\n`;
    if (clockSession) {
      new OwnerPrivateDirectory(resolve(out)).write("v3-code-execution-benchmark.json", text);
    } else {
      writeFileSync(file, text);
    }
    return file;
  }
  function unavailable(reason, report) {
    writeReport({ ...report, status: "UNAVAILABLE", pass: false, detail: reason });
    console.error(`[UNAVAILABLE] eval:v3-code-execution: ${reason}`);
    return 2;
  }

  const ctx = { argv, clockSession, provenance, writeReport, unavailable };
  const planPath = readArg(argv, "plan");
  const observationsPath = readArg(argv, "observations");
  let plan = buildDefaultPlan();
  try {
    if (planPath) {
      const rawPlan = readFileSync(planPath, "utf8");
      provenance.planSha256 = hash(rawPlan);
      plan = JSON.parse(rawPlan);
    }
    validateCodeExecutionPlan(plan);
    if (!provenance.planSha256) {
      provenance.planSha256 = hash(JSON.stringify(plan));
    }
    if (argv.includes("--smoke")) {
      return await runSmokeMode(ctx, plan);
    }
    if (clockSession && (!argv.includes("--collect") || observationsPath)) {
      return unavailable(
        "guarded acquisition requires ordinary --collect",
        evaluateCodeExecutionBenchmark(plan, []),
      );
    }
    if (argv.includes("--collect")) {
      return await runCollectMode(ctx, plan, planPath, observationsPath);
    }
    if (observationsPath) {
      return runObservationsMode(ctx, plan, planPath, observationsPath);
    }

    const engine = process.env.CODE_EXECUTION_REASONING_ENGINE ?? "";
    const liveConfigured =
      process.env.CODE_EXECUTION_IT === "1" && REASONING_ENGINE_RE.test(engine);
    return unavailable(
      liveConfigured
        ? "runtime is configured; explicit --collect with approved frozen scope/private evidence is required, or supply --plan and provenance-backed --observations"
        : "Agent Platform Code Execution sandbox is not configured (set CODE_EXECUTION_IT=1 and CODE_EXECUTION_REASONING_ENGINE in europe-west4, or supply --plan and --observations)",
      evaluateCodeExecutionBenchmark(plan, []),
    );
  } catch (error) {
    let detail = error instanceof Error ? error.message : "invalid benchmark input";
    if (argv.includes("--collect")) {
      detail = "invalid collection configuration or private evidence";
    }
    writeReport({ status: "FAIL", pass: false, detail });
    console.error(`[FAIL] eval:v3-code-execution: ${detail}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCodeExecutionCli(process.argv.slice(2));
}
