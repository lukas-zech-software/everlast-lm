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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScaleFixture } from '../packages/evals/src/v3-scale-fixture.ts';
import { aggregateScaleLatency, aggregateScaleConcurrency } from '../packages/evals/src/latency.ts';
import { buildScaleBenchmarkReport } from '../packages/evals/src/report.ts';
import { runScaleBenchmark } from '../packages/evals/src/v3-scale.ts';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const manifestPath = arg('manifest') ?? 'packages/evals/fixtures/v3/scale-manifest.json';
const outDir = arg('out') ?? 'reports';
mkdirSync(outDir, { recursive: true });

let fixture;
try {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  fixture = loadScaleFixture(raw);
} catch (err) {
  console.error(`[UNAVAILABLE] Failed to load scale fixture: ${err.message}`);
  process.exit(2);
}

const observationsPath = arg('observations');
if (observationsPath) {
  try {
    const rawObs = JSON.parse(readFileSync(observationsPath, 'utf8'));
    const core = Array.isArray(rawObs) ? rawObs : (rawObs.observations ?? rawObs.core ?? []);
    const report = buildScaleBenchmarkReport({
      benchmark_id: `scale-${fixture.fixture_hash.slice(0, 8)}`,
      manifest_hash: fixture.fixture_hash,
      coreObservations: core,
    });
    const outFile = join(outDir, 'v3-scale-benchmark.json');
    writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ result: report.result, p95_ms: report.core.p95_ms, warm_count: report.core.warm_count }));
    process.exit(report.result === 'PASS' ? 0 : report.result === 'FAIL' ? 1 : 2);
  } catch (err) {
    console.error(`[UNAVAILABLE] Failed to evaluate observations: ${err.message}`);
    process.exit(2);
  }
}

const baseUrl = arg('url') ?? process.env.BENCHMARK_BASE_URL ?? process.env.API_URL;
const token = arg('token') ?? process.env.BENCHMARK_TOKEN ?? process.env.AUTH_TOKEN;
const notebookId = arg('notebook') ?? process.env.BENCHMARK_NOTEBOOK_ID;
const profile = arg('profile') === 'concurrency' ? 'concurrency' : 'core';

if (!baseUrl || !token || !notebookId) {
  const unavailableReport = {
    schema: 'everlast.scale-v3-report/1',
    benchmark_id: `scale-${fixture.fixture_hash.slice(0, 8)}`,
    manifest_hash: fixture.fixture_hash,
    timestamp: new Date().toISOString(),
    result: 'UNAVAILABLE',
    missing_prerequisites: 'Live deployed benchmark environment not configured (API_URL/BENCHMARK_TOKEN/BENCHMARK_NOTEBOOK_ID required)',
    core: { result: 'UNAVAILABLE', p95_ms: null, percentile_method: 'nearest_rank', p95_rank: 19, warm_count: 0, wake_count: 0, attempt_count: 0, observations: [], wake_latencies_ms: [], budget_ms: 2500 }
  };
  const outFile = join(outDir, 'v3-scale-benchmark.json');
  writeFileSync(outFile, JSON.stringify(unavailableReport, null, 2) + '\n');
  console.error('[UNAVAILABLE] eval:v3-scale: Live deployed benchmark environment not configured');
  process.exit(2);
}

try {
  const report = await runScaleBenchmark(fixture, {
    baseUrl,
    token,
    notebookId,
    profile,
  });
  const outFile = join(outDir, 'v3-scale-benchmark.json');
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, p95_ms: report.core.p95_ms, warm_count: report.core.warm_count }));
  process.exit(report.result === 'PASS' ? 0 : report.result === 'FAIL' ? 1 : 2);
} catch (err) {
  console.error(`[ERROR] eval:v3-scale failed: ${err.message}`);
  process.exit(1);
}
