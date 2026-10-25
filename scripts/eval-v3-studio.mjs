#!/usr/bin/env node
/**
 * [011-studio-mindmaps-data-tables] T022, T024, T053 — Package 3.3 Studio mindmap latency benchmark & deterministic
 * evaluation runner (FR-ST-08/09/18, NFR-EVAL-02/04, Gate v3.0 #3; SC-002, SC-007, SC-008).
 *
 * Usage:
 *   node scripts/eval-v3-studio.mjs [--samples path/to/samples.json] [--out reports]
 *
 * - Runs the deterministic citation precision (1.0) & zero-leakage (0) evaluation (`runStudioStructureDeterministicEval`).
 * - Evaluates predeclared N >= 20 mindmap submission->Completed cohort samples against P95 <= 20,000 ms (`SC-002`).
 * - Without `--samples` or `STUDIO_BENCHMARK_IT=1` on the approved Vertex AI enterprise endpoint in `europe-west4`,
 *   exits 2 with `[UNAVAILABLE]` for the live latency gate (never a local mock latency pass).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildThreeSourceStudioFixture,
  STUDIO_STRUCTURE_FIXTURE_VERSION,
} from "../packages/testkit/src/studio-structure-fixtures.ts";
import { runStudioStructureDeterministicEval } from "../packages/evals/src/studio-structure-eval.ts";
import {
  aggregateMindmapLatencyCohort,
  MINDMAP_MIN_COHORT_SIZE,
  MINDMAP_P95_BUDGET_MS,
} from "../packages/evals/src/studio-structure-performance.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const outDir = arg("out") ?? "reports";
mkdirSync(outDir, { recursive: true });

const detReport = await runStudioStructureDeterministicEval();
const threeSource = buildThreeSourceStudioFixture();
const fixtureHash = createHash("sha256")
  .update(JSON.stringify(threeSource.chunks), "utf8")
  .digest("hex");

const samplesPath = arg("samples");

if (!samplesPath && process.env.STUDIO_BENCHMARK_IT !== "1") {
  const record = {
    status: "UNAVAILABLE",
    reason:
      "Live Vertex AI mindmap latency cohort (N>=20 in europe-west4) not executed; set STUDIO_BENCHMARK_IT=1 with approved cloud credentials or provide --samples.",
    fixture: {
      id: "studio-mindmap-3source-v1",
      version: STUDIO_STRUCTURE_FIXTURE_VERSION,
      sha256: fixtureHash,
    },
    target_p95_ms: MINDMAP_P95_BUDGET_MS,
    min_cohort_size: MINDMAP_MIN_COHORT_SIZE,
    deterministic_eval: detReport,
    recorded_at: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "v3-studio-benchmark.json"), JSON.stringify(record, null, 2));
  console.error(`[UNAVAILABLE] eval:v3-studio: ${record.reason}`);
  process.exit(2);
}

if (samplesPath) {
  const samples = JSON.parse(readFileSync(samplesPath, "utf8"));
  const cohort = aggregateMindmapLatencyCohort(samples, MINDMAP_P95_BUDGET_MS);
  const passed = detReport.passed && cohort.passed;
  const record = {
    status: passed ? "PASS" : "FAIL",
    passed,
    fixture: {
      id: "studio-mindmap-3source-v1",
      version: STUDIO_STRUCTURE_FIXTURE_VERSION,
      sha256: fixtureHash,
    },
    deterministic_eval: detReport,
    latency_cohort: cohort,
    recorded_at: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "v3-studio-benchmark.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ status: record.status, p95_ms: cohort.p95_ms, citation_precision: detReport.citation_precision }));
  process.exit(passed ? 0 : 1);
}

console.error("[UNAVAILABLE] eval:v3-studio: live STUDIO_BENCHMARK_IT=1 requires --samples or configured cloud runner.");
process.exit(2);
