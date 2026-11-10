#!/usr/bin/env node
/** [011-studio-mindmaps-data-tables] T060, FR-ST-08/09/18, SC-002: collect ordinary C-03 API timing or aggregate diagnostics. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runStudioStructureDeterministicEval } from "../packages/evals/src/studio-structure-eval.ts";
import { aggregateMindmapLatencyCohort } from "../packages/evals/src/studio-structure-performance.ts";
import { collectStudioLatency, validateStudioBenchmarkPlan } from "../packages/evals/src/studio-benchmark-collector.ts";
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const out = arg("out") ?? "reports";
mkdirSync(out, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const provenance = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), node: process.version };
const write = record => writeFileSync(join(out, "v3-studio-benchmark.json"), JSON.stringify(record, null, 2));
const unavailable = reason => { write({ status: "UNAVAILABLE", release_eligible: false, reason, provenance, recorded_at: new Date().toISOString() }); console.error(`[UNAVAILABLE] eval:v3-studio: ${reason}`); process.exitCode = 2; };
try {
  let samples;
  let plan;
  if (process.argv.includes("--collect")) {
    if (process.env.STUDIO_BENCHMARK_IT !== "1" || !arg("plan") || !process.env.STUDIO_BENCHMARK_TOKEN) {
      unavailable("Collection requires STUDIO_BENCHMARK_IT=1, --plan and securely injected STUDIO_BENCHMARK_TOKEN.");
    } else {
      const bytes = readFileSync(arg("plan"));
      plan = validateStudioBenchmarkPlan(JSON.parse(bytes));
      provenance.plan_sha256 = hash(bytes);
      samples = await collectStudioLatency(plan, process.env.STUDIO_BENCHMARK_TOKEN, observations => {
        writeFileSync(join(out, "v3-studio-observations.json"), JSON.stringify({ plan, provenance, samples: observations, recorded_at: new Date().toISOString() }, null, 2));
      });
    }
  } else if (arg("samples")) {
    const bytes = readFileSync(arg("samples"));
    const imported = JSON.parse(bytes);
    provenance.observations_sha256 = hash(bytes);
    // Bare arrays preserve diagnostic compatibility; imported timings never become a fresh live collection.
    samples = Array.isArray(imported) ? imported : imported.samples;
  } else unavailable("No collection executed. Use --collect --plan <plan.json>, or --samples for diagnostic aggregation; a flag alone is insufficient.");
  if (samples) {
    const cohort = aggregateMindmapLatencyCohort(samples);
    const deterministic = await runStudioStructureDeterministicEval();
    const acceptedCount = samples.filter(s => s.artifact_id).length;
    const completeAdmission = !plan || (acceptedCount === plan.runs.length && new Set(samples.map(s => s.artifact_id)).size === acceptedCount);
    const passed = cohort.passed && deterministic.passed && completeAdmission;
    const eligible = false; // A declared enterprise label alone cannot qualify runtime/fixture/cold-start evidence.
    const record = { status: passed ? eligible ? "PASS" : "DIAGNOSTIC_PASS" : "FAIL", passed, release_eligible: !!eligible, plan, provenance, accepted_count: acceptedCount, declared_count: plan?.runs.length, complete_admission: completeAdmission, latency_cohort: cohort, deterministic_eval: deterministic, recorded_at: new Date().toISOString() };
    write(record);
    console.log(JSON.stringify({ status: record.status, p95_ms: cohort.p95_ms, release_eligible: record.release_eligible }));
    process.exitCode = passed ? 0 : 1;
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : "Invalid benchmark evidence";
  write({ status: "FAIL", release_eligible: false, reason, provenance, recorded_at: new Date().toISOString() });
  console.error(`[FAIL] eval:v3-studio: ${reason}`);
  process.exitCode = 1;
}
