#!/usr/bin/env node
/** [011-studio-mindmaps-data-tables] T060, FR-ST-08/09/18, SC-002: dev Studio live smoke check or C-03 API timing collector. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runStudioStructureDeterministicEval } from "../packages/evals/src/studio-structure-eval.ts";
import { aggregateMindmapLatencyCohort } from "../packages/evals/src/studio-structure-performance.ts";
import { collectStudioLatency, validateStudioBenchmarkPlan } from "../packages/evals/src/studio-benchmark-collector.ts";
import { assertDevOnlyEnvironment, withDevTestEnvironment } from "../packages/testkit/src/live-fixtures.ts";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const out = arg("out") ?? "reports";
mkdirSync(out, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const provenance = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), node: process.version };
const write = (record) => writeFileSync(join(out, "v3-studio-benchmark.json"), JSON.stringify(record, null, 2));
const unavailable = (reason) => { write({ status: "UNAVAILABLE", release_eligible: false, reason, provenance, recorded_at: new Date().toISOString() }); console.error(`[UNAVAILABLE] eval:v3-studio: ${reason}`); process.exitCode = 2; };

try {
  if (process.argv.includes("--smoke")) {
    assertDevOnlyEnvironment(process.env);
    if (!(process.env.VERTEX_PROJECT ?? process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT)?.trim()) {
      unavailable("VERTEX_PROJECT / GCP_PROJECT_ID is required on dev for --smoke.");
    } else {
      await withDevTestEnvironment({ env: process.env }, async () => {
        const { createEnterpriseStructuredGenerator } = await import("@everlast/cloud");
        const { VertexMindmapModel } = await import("../apps/worker/src/studio/mindmaps/model.ts");
        const { generateMindmap } = await import("../apps/worker/src/studio/mindmaps/pipeline.ts");
        const { validateMindmapPayload } = await import("../apps/worker/src/studio/mindmaps/validation.ts");
        const { VertexDataTableModel } = await import("../apps/worker/src/studio/tables/model.ts");
        const { generateDataTable } = await import("../apps/worker/src/studio/tables/pipeline.ts");
        const { validateDataTablePayload } = await import("../apps/worker/src/studio/tables/validation.ts");
        const { buildThreeSourceStudioFixture, buildThreeVendorTableFixture } = await import("../packages/testkit/src/studio-structure-fixtures.ts");

        const generator = createEnterpriseStructuredGenerator("flash", process.env);
        const mmFixture = buildThreeSourceStudioFixture();
        const mm = await generateMindmap({ chunks: mmFixture.chunks, snapshot: mmFixture.snapshot, model: new VertexMindmapModel(generator), signal: AbortSignal.timeout(60_000), reportProgress: () => {} });
        const mmErr = mm.status === "completed" ? validateMindmapPayload(mm.payload, mmFixture.chunks, mmFixture.snapshot) : mm.message;

        const dtFixture = buildThreeVendorTableFixture();
        const dt = await generateDataTable({ chunks: dtFixture.chunks, snapshot: dtFixture.snapshot, model: new VertexDataTableModel(generator), signal: AbortSignal.timeout(60_000), reportProgress: () => {} });
        const dtErr = dt.status === "completed" ? validateDataTablePayload(dt.payload, dtFixture.chunks, dtFixture.snapshot) : dt.message;

        const deterministic = await runStudioStructureDeterministicEval();
        const passed = mmErr === null && dtErr === null && deterministic.passed;
        write({ status: passed ? "PASS" : "FAIL", mode: "dev-smoke", passed, mindmap: { status: mm.status, error: mmErr }, data_table: { status: dt.status, error: dtErr }, deterministic_eval: deterministic, provenance, recorded_at: new Date().toISOString() });
        console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL", mindmap: mm.status, data_table: dt.status }));
        process.exitCode = passed ? 0 : 1;
      });
    }
  } else {
    let samples;
    let plan;
    if (process.argv.includes("--collect")) {
      if (process.env.STUDIO_BENCHMARK_IT !== "1" || !arg("plan") || !process.env.STUDIO_BENCHMARK_TOKEN) {
        unavailable("Collection requires STUDIO_BENCHMARK_IT=1, --plan and securely injected STUDIO_BENCHMARK_TOKEN.");
      } else {
        const bytes = readFileSync(arg("plan"));
        plan = validateStudioBenchmarkPlan(JSON.parse(bytes));
        provenance.plan_sha256 = hash(bytes);
        const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(plan.base_url);
        const runCollect = () => collectStudioLatency(plan, process.env.STUDIO_BENCHMARK_TOKEN, (observations) => {
          writeFileSync(join(out, "v3-studio-observations.json"), JSON.stringify({ plan, provenance, samples: observations, recorded_at: new Date().toISOString() }, null, 2));
        });
        samples = isLoopback ? await runCollect() : await withDevTestEnvironment({ env: process.env }, runCollect);
      }
    } else if (arg("samples")) {
      const bytes = readFileSync(arg("samples"));
      const imported = JSON.parse(bytes);
      provenance.observations_sha256 = hash(bytes);
      samples = Array.isArray(imported) ? imported : imported.samples;
    } else unavailable("Use --smoke on dev, --collect --plan <plan.json>, or --samples.");
    if (samples) {
      const cohort = aggregateMindmapLatencyCohort(samples);
      const deterministic = await runStudioStructureDeterministicEval();
      const acceptedCount = samples.filter((s) => s.artifact_id).length;
      const completeAdmission = !plan || (acceptedCount === plan.runs.length && new Set(samples.map((s) => s.artifact_id)).size === acceptedCount);
      const passed = cohort.passed && deterministic.passed && completeAdmission;
      const record = { status: passed ? "DIAGNOSTIC_PASS" : "FAIL", passed, release_eligible: false, plan, provenance, accepted_count: acceptedCount, declared_count: plan?.runs.length, complete_admission: completeAdmission, latency_cohort: cohort, deterministic_eval: deterministic, recorded_at: new Date().toISOString() };
      write(record);
      console.log(JSON.stringify({ status: record.status, p95_ms: cohort.p95_ms, release_eligible: record.release_eligible }));
      process.exitCode = passed ? 0 : 1;
    }
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : "Invalid benchmark evidence";
  if (reason.startsWith("UNAVAILABLE")) unavailable(reason);
  else {
    write({ status: "FAIL", release_eligible: false, reason, provenance, recorded_at: new Date().toISOString() });
    console.error(`[FAIL] eval:v3-studio: ${reason}`);
    process.exitCode = 1;
  }
}
