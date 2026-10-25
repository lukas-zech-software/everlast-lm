#!/usr/bin/env node
/**
 * [011-studio-mindmaps-data-tables] T035, T037, T053 — 120-node mindmap interaction frame-budget harness
 * (FR-ST-09, Gate v3.0 #3; FR-004, SC-003).
 *
 * Usage:
 *   node scripts/eval-v3-mindmap-viewer.mjs [--samples path/to/frames.json] [--out reports]
 *
 * Evaluates 120-node pan, zoom, expand, and collapse frame samples against <= 16.0 ms P95 (60fps)
 * without discarding slow or failed frames. Without `--samples` or `MINDMAP_VIEWER_BENCHMARK_IT=1`
 * on the declared hardware/browser profile, exits 2 with `[UNAVAILABLE]` (never a mock performance pass).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateMindmapFrameSamples,
  MINDMAP_FRAME_BUDGET_MS,
  MINDMAP_MIN_FRAME_SAMPLES,
} from "../apps/web/src/studio/mindmap-viewer.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const outDir = arg("out") ?? "reports";
mkdirSync(outDir, { recursive: true });

const samplesPath = arg("samples");

if (!samplesPath && process.env.MINDMAP_VIEWER_BENCHMARK_IT !== "1") {
  const record = {
    status: "UNAVAILABLE",
    reason:
      "Declared browser hardware profile 120-node frame capture not executed in this run; provide --samples or set MINDMAP_VIEWER_BENCHMARK_IT=1.",
    target_frame_budget_ms: MINDMAP_FRAME_BUDGET_MS,
    target_fps: 60,
    min_frame_samples: MINDMAP_MIN_FRAME_SAMPLES,
    node_count: 120,
    recorded_at: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "v3-mindmap-viewer-benchmark.json"), JSON.stringify(record, null, 2));
  console.error(`[UNAVAILABLE] eval:v3-mindmap-viewer: ${record.reason}`);
  process.exit(2);
}

if (samplesPath) {
  const samples = JSON.parse(readFileSync(samplesPath, "utf8"));
  const report = evaluateMindmapFrameSamples(samples, MINDMAP_FRAME_BUDGET_MS);
  const record = {
    status: report.passed ? "PASS" : "FAIL",
    passed: report.passed,
    node_count: 120,
    frame_report: report,
    recorded_at: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "v3-mindmap-viewer-benchmark.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ status: record.status, p95_frame_ms: report.p95_frame_ms, estimated_fps: report.estimated_fps }));
  process.exit(report.passed ? 0 : 1);
}

console.error("[UNAVAILABLE] eval:v3-mindmap-viewer: requires --samples JSON file.");
process.exit(2);
