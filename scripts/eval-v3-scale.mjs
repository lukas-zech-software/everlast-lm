#!/usr/bin/env node
/**
 * Package 3.4 long-context and latency scaling benchmark runner (NFR-PERF-01, C-02/C-03; specs/012 T019).
 *
 * Usage:
 *   node scripts/eval-v3-scale.mjs [--manifest path/to/manifest.json] [--observations path/to/observations.json] [--out reports] [--profile core|concurrency]
 *
 * Evaluates the declared 20-warm sample against:
 *   - Nearest-rank 19th latency <= 2,500 ms (NFR-PERF-01)
 *   - Every response states "142.8 bar" with inline citation to chk_needle_77
 *   - Zero decoy leakage (155.0 bar) across prompt/history/cache/answer
 *
 * Exits nonzero (code 1 for FAIL, code 2 for UNAVAILABLE). Never fabricates a pass.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BenchmarkPrivateEvidenceSchema } from "../packages/contracts/src/index.ts";
import { OwnerPrivateDirectory } from "@everlast/cloud/private-benchmark";
import {
  assertDevOnlyEnvironment,
  withDevTestEnvironment,
} from "../packages/testkit/src/live-fixtures.ts";
import { loadScaleFixture } from "../packages/evals/src/v3-scale-fixture.ts";
import { runScaleBenchmark } from "../packages/evals/src/v3-scale.ts";
import { importScaleCapture } from "../packages/evals/src/v3-scale-import.ts";

const REQUEST_TIMEOUT_MS = 30_000;

function readArg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function resultToExitCode(result) {
  if (result === "PASS") {
    return 0;
  }
  if (result === "FAIL") {
    return 1;
  }
  return 2;
}

async function runScaleSmoke(write) {
  try {
    assertDevOnlyEnvironment(process.env);
  } catch (err) {
    console.error(
      `[UNAVAILABLE] eval:v3-scale: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }
  if (
    !(
      process.env.VERTEX_PROJECT ??
      process.env.GCP_PROJECT_ID ??
      process.env.GOOGLE_CLOUD_PROJECT
    )?.trim()
  ) {
    const msg = "VERTEX_PROJECT / GCP_PROJECT_ID is required on dev for --smoke";
    write("v3-scale-benchmark.json", {
      schema: "everlast.scale-v3-report/1",
      mode: "dev-smoke",
      result: "UNAVAILABLE",
      missing_prerequisites: msg,
    });
    console.error(`[UNAVAILABLE] eval:v3-scale: ${msg}`);
    return 2;
  }
  return withDevTestEnvironment({ env: process.env }, async () => {
    const { createOperationalCacheFromEnv } =
      await import("../apps/api/src/observability/benchmark.ts");
    const cache = createOperationalCacheFromEnv(process.env);
    const sourceId = randomUUID();
    const filler =
      "Reactor coolant loop pressure calibration telemetry verification block. ".repeat(120);
    const chunks = Array.from({ length: 40 }, (_, i) => ({
      chunk_id: randomUUID(),
      source_id: sourceId,
      revision: 1,
      token_count: 1000,
      locator: { page_number: i + 1, start_offset: 0, end_offset: filler.length },
      text:
        i === 32
          ? `${filler} Critical setpoint: Reactor coolant pressure must be 142.8 bar.`
          : filler,
    }));
    let created;
    const started = Date.now();
    try {
      created = await cache.create({ pages: [chunks], signal: AbortSignal.timeout(45_000) });
    } finally {
      if (created?.handle) {
        await cache.delete(created.handle).catch(() => {});
      }
    }
    const elapsedMs = Date.now() - started;
    write("v3-scale-benchmark.json", {
      schema: "everlast.scale-v3-report/1",
      mode: "dev-smoke",
      result: "PASS",
      cache_created: Boolean(created?.handle),
      elapsed_ms: elapsedMs,
    });
    console.log(
      JSON.stringify({
        result: "PASS",
        mode: "dev-smoke",
        cache_created: Boolean(created?.handle),
        elapsed_ms: elapsedMs,
      }),
    );
    return 0;
  });
}

function runScaleObservations(observationsPath, fixture, profile, write) {
  try {
    const rawObs = JSON.parse(readFileSync(observationsPath, "utf8"));
    const report = importScaleCapture(rawObs, fixture, profile);
    write("v3-scale-benchmark.json", report);
    const displayResult =
      report.result === "PASS" && report.evidence_kind === "imported-diagnostic"
        ? "DIAGNOSTIC_PASS"
        : report.result;
    console.log(
      JSON.stringify({
        result: displayResult,
        evidence_kind: report.evidence_kind,
        release_eligible: false,
        p95_ms: report.core.p95_ms,
        warm_count: report.core.warm_count,
      }),
    );
    return resultToExitCode(report.result);
  } catch (err) {
    console.error(`[UNAVAILABLE] Failed to evaluate observations: ${err.message}`);
    return 2;
  }
}

function checkDurationAvailable(clockSession, fixture, profile) {
  if (!clockSession) {
    return true;
  }
  try {
    if (fixture.runtime_qualification !== clockSession.identity.serving_revision) {
      throw new Error("Serving revision mismatch");
    }
    clockSession.reserveCollection(
      (fixture.max_attempts + (profile === "concurrency" ? 10 : 0)) * 2 * REQUEST_TIMEOUT_MS,
    );
    return true;
  } catch {
    return false;
  }
}

function isLiveConfigReady(params) {
  const {
    durationAvailable,
    baseUrl,
    token,
    notebookId,
    evidencePath,
    uncertainty,
    fixture,
    profile,
    secondNotebook,
    secondToken,
    secondManifest,
  } = params;
  const hasCoreArgs = Boolean(durationAvailable && baseUrl && token && notebookId && evidencePath);
  const hasValidClock = Number.isFinite(uncertainty) && uncertainty >= 0;
  const hasQualifiedFixture =
    Boolean(fixture.scope_manifest_hash && fixture.source_snapshot) &&
    fixture.tokenizer_qualification !== "UNAVAILABLE" &&
    fixture.runtime_qualification !== "UNAVAILABLE";
  const hasConcurrencyArgs =
    profile !== "concurrency" || Boolean(secondNotebook && secondToken && secondManifest);
  return hasCoreArgs && hasValidClock && hasQualifiedFixture && hasConcurrencyArgs;
}

function createEvidenceReader(evidenceFile, evidenceDirectory, privateRecords) {
  return ({ requestId }) => {
    // Operator-private sidecar/export only. Malformed lines invalidate collection rather than disappearing.
    const text = evidenceDirectory
      ? (evidenceDirectory.read(basename(evidenceFile))?.toString("utf8") ?? "")
      : readFileSync(evidenceFile, "utf8");
    if (Buffer.byteLength(text) > 50_000_000) {
      throw new Error("Private evidence file exceeds bound");
    }
    const rows = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const matched = rows.filter((row) => row.request_id === requestId);
    if (matched.length !== 1) {
      throw new Error("Missing/duplicate private request evidence");
    }
    const record = BenchmarkPrivateEvidenceSchema.parse(matched[0]);
    privateRecords.push(record);
    return Promise.resolve(record);
  };
}

function writeCapturedScaleReport(report, clockSession, write) {
  const writeReport = (clockContinuity) =>
    write("v3-scale-benchmark.json", { ...report, clock_continuity: clockContinuity });
  if (!clockSession) {
    writeReport("not-observed");
    return;
  }
  try {
    clockSession.assertClockCurrent(clockSession.calibration);
    writeReport("observed-through-export");
    clockSession.assertClockCurrent(clockSession.calibration);
  } catch {
    report.result = "UNAVAILABLE";
    writeReport("invalid");
  }
}

function readLiveParams(argv, clockSession, fixture, profile) {
  return {
    durationAvailable: checkDurationAvailable(clockSession, fixture, profile),
    baseUrl: readArg(argv, "url") ?? process.env.BENCHMARK_BASE_URL ?? process.env.API_URL,
    token: readArg(argv, "token") ?? process.env.BENCHMARK_TOKEN ?? process.env.AUTH_TOKEN,
    notebookId: readArg(argv, "notebook") ?? process.env.BENCHMARK_NOTEBOOK_ID,
    evidencePath: readArg(argv, "evidence") ?? process.env.BENCHMARK_EVIDENCE_FILE,
    uncertainty:
      clockSession?.calibration.uncertainty_ms ??
      Number(readArg(argv, "clock-uncertainty-ms") ?? process.env.BENCHMARK_CLOCK_UNCERTAINTY_MS),
    secondNotebook:
      readArg(argv, "concurrency-notebook") ?? process.env.BENCHMARK_CONCURRENCY_NOTEBOOK_ID,
    secondToken: process.env.BENCHMARK_CONCURRENCY_TOKEN,
    secondManifest: readArg(argv, "concurrency-manifest"),
    fixture,
    profile,
  };
}

function writeUnavailableLiveReport(fixture, durationAvailable, write) {
  write("v3-scale-benchmark.json", {
    schema: "everlast.scale-v3-report/1",
    benchmark_id: `scale-${fixture.fixture_hash.slice(0, 8)}`,
    manifest_hash: fixture.fixture_hash,
    timestamp: new Date().toISOString(),
    result: "UNAVAILABLE",
    missing_prerequisites: durationAvailable
      ? "Qualified deployment/tokenizer/runtime, private evidence, clock uncertainty and requested profile scopes required"
      : "Serving binding or conservative campaign duration unavailable",
    core: {
      result: "UNAVAILABLE",
      p95_ms: null,
      percentile_method: "nearest_rank",
      p95_rank: 19,
      warm_count: 0,
      wake_count: 0,
      attempt_count: 0,
      observations: [],
      wake_latencies_ms: [],
      budget_ms: 2500,
    },
  });
  console.error("[UNAVAILABLE] eval:v3-scale: Live deployed benchmark environment not configured");
  return 2;
}

async function runLiveScaleCapture(fixture, liveParams, clockSession, write) {
  const { profile } = liveParams;
  try {
    const privateRecords = [];
    const evidenceFile = resolve(liveParams.evidencePath);
    const evidenceDirectory = clockSession
      ? new OwnerPrivateDirectory(dirname(evidenceFile))
      : undefined;
    const secondFixture = liveParams.secondManifest
      ? loadScaleFixture(JSON.parse(readFileSync(liveParams.secondManifest, "utf8")))
      : undefined;
    const report = await runScaleBenchmark(fixture, {
      baseUrl: liveParams.baseUrl,
      token: liveParams.token,
      notebookId: liveParams.notebookId,
      profile,
      clockUncertaintyMs: liveParams.uncertainty,
      clockSession,
      timeoutMs: REQUEST_TIMEOUT_MS,
      concurrencyNotebookId: liveParams.secondNotebook,
      concurrencyToken: liveParams.secondToken,
      concurrencyFixture: secondFixture,
      evidence: createEvidenceReader(evidenceFile, evidenceDirectory, privateRecords),
    });
    const capture = {
      schema: "everlast.scale-v3-capture/1",
      profile,
      manifest_hash: fixture.fixture_hash,
      observations: report.core.observations,
      ...(profile === "concurrency"
        ? {
            concurrency_observations: report.concurrency?.observations,
            concurrency_fixture: secondFixture,
          }
        : {}),
      private_evidence: privateRecords,
      ...(clockSession ? { clock_calibration: clockSession.calibration } : {}),
    };
    write("v3-scale-capture.json", capture);
    writeCapturedScaleReport(report, clockSession, write);
    const displayResult =
      report.result === "PASS" && report.evidence_kind === "imported-diagnostic"
        ? "DIAGNOSTIC_PASS"
        : report.result;
    console.log(
      JSON.stringify({
        result: displayResult,
        evidence_kind: report.evidence_kind,
        release_eligible: false,
        p95_ms: report.core.p95_ms,
        warm_count: report.core.warm_count,
      }),
    );
    return resultToExitCode(report.result);
  } catch (err) {
    console.error(`[ERROR] eval:v3-scale failed: ${err.message}`);
    return 1;
  }
}

export async function runScaleCli(argv, clockSession) {
  const manifestPath =
    readArg(argv, "manifest") ?? "packages/evals/fixtures/v3/scale-manifest.json";
  const outDir = clockSession?.directory ?? readArg(argv, "out") ?? "reports";
  const directory = clockSession ? new OwnerPrivateDirectory(resolve(outDir)) : undefined;
  if (!directory) {
    mkdirSync(outDir, { recursive: true });
  }
  const write = (name, data) => {
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    if (directory) {
      directory.write(name, serialized);
    } else {
      writeFileSync(join(outDir, name), serialized, { mode: 0o600 });
    }
  };

  if (argv.includes("--smoke")) {
    return runScaleSmoke(write);
  }

  let fixture;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    fixture = loadScaleFixture(raw);
  } catch (err) {
    console.error(`[UNAVAILABLE] Failed to load scale fixture: ${err.message}`);
    return 2;
  }

  const profile = readArg(argv, "profile") ?? "core";
  if (!["core", "concurrency"].includes(profile)) {
    console.error("[UNAVAILABLE] Unknown profile");
    return 2;
  }
  const observationsPath = readArg(argv, "observations");
  if (observationsPath && clockSession) {
    return 2;
  }
  if (observationsPath) {
    return runScaleObservations(observationsPath, fixture, profile, write);
  }

  const liveParams = readLiveParams(argv, clockSession, fixture, profile);
  if (!isLiveConfigReady(liveParams)) {
    return writeUnavailableLiveReport(fixture, liveParams.durationAvailable, write);
  }
  return runLiveScaleCapture(fixture, liveParams, clockSession, write);
}

if (import.meta.main) {
  process.exitCode = await runScaleCli(process.argv.slice(2));
}
