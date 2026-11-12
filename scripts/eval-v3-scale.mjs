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
import { basename, dirname, join, resolve } from 'node:path';
import { BenchmarkPrivateEvidenceSchema } from '../packages/contracts/src/index.ts';
import { OwnerPrivateDirectory } from '@everlast/cloud/private-benchmark';
import { loadScaleFixture } from '../packages/evals/src/v3-scale-fixture.ts';
import { buildScaleBenchmarkReport } from '../packages/evals/src/report.ts';
import { runScaleBenchmark } from '../packages/evals/src/v3-scale.ts';
import { importScaleCapture } from '../packages/evals/src/v3-scale-import.ts';

const REQUEST_TIMEOUT_MS = 30_000;

export async function runScaleCli(argv, clockSession) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const manifestPath = arg('manifest') ?? 'packages/evals/fixtures/v3/scale-manifest.json';
  const outDir = clockSession?.directory ?? arg('out') ?? 'reports';
  const directory = clockSession ? new OwnerPrivateDirectory(resolve(outDir)) : undefined;
  if (!directory) mkdirSync(outDir, { recursive: true });
  const write = (name, data) => {
    const json = JSON.stringify(data, null, 2) + '\n';
    if (directory) directory.write(name, json);
    else writeFileSync(join(outDir, name), json, { mode: 0o600 });
  };

  let fixture;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    fixture = loadScaleFixture(raw);
  } catch (err) {
    console.error(`[UNAVAILABLE] Failed to load scale fixture: ${err.message}`);
    return 2;
  }

  const profile=arg('profile')??'core';
  if(!['core','concurrency'].includes(profile)){console.error('[UNAVAILABLE] Unknown profile');return 2;}
  const observationsPath = arg('observations');
  if (observationsPath && clockSession) return 2;
  if (observationsPath) {
    try {
      const rawObs = JSON.parse(readFileSync(observationsPath, 'utf8'));
      const report = importScaleCapture(rawObs,fixture,profile);
      write('v3-scale-benchmark.json', report);
      console.log(JSON.stringify({ result: report.result==='PASS'&&report.evidence_kind==='imported-diagnostic'?'DIAGNOSTIC_PASS':report.result, evidence_kind:report.evidence_kind, release_eligible:false, p95_ms: report.core.p95_ms, warm_count: report.core.warm_count }));
      return report.result === 'PASS' ? 0 : report.result === 'FAIL' ? 1 : 2;
    } catch (err) {
      console.error(`[UNAVAILABLE] Failed to evaluate observations: ${err.message}`);
      return 2;
    }
  }

  const baseUrl = arg('url') ?? process.env.BENCHMARK_BASE_URL ?? process.env.API_URL;
  const token = arg('token') ?? process.env.BENCHMARK_TOKEN ?? process.env.AUTH_TOKEN;
  const notebookId = arg('notebook') ?? process.env.BENCHMARK_NOTEBOOK_ID;
  const evidencePath=arg('evidence')??process.env.BENCHMARK_EVIDENCE_FILE;
  const uncertainty=clockSession?.calibration.uncertainty_ms??Number(arg('clock-uncertainty-ms')??process.env.BENCHMARK_CLOCK_UNCERTAINTY_MS);
  const secondNotebook=arg('concurrency-notebook')??process.env.BENCHMARK_CONCURRENCY_NOTEBOOK_ID;
  const secondToken=process.env.BENCHMARK_CONCURRENCY_TOKEN;
  const secondManifest=arg('concurrency-manifest');

  let durationAvailable=true;
  if (clockSession) {
    try {
      if (fixture.runtime_qualification !== clockSession.identity.serving_revision) throw new Error('Serving revision mismatch');
      clockSession.reserveCollection((fixture.max_attempts + (profile === 'concurrency' ? 10 : 0)) * 2 * REQUEST_TIMEOUT_MS);
    } catch { durationAvailable=false; }
  }
  if (!durationAvailable || !baseUrl || !token || !notebookId || !evidencePath || !Number.isFinite(uncertainty) || uncertainty<0 || !fixture.scope_manifest_hash || !fixture.source_snapshot || fixture.tokenizer_qualification==='UNAVAILABLE' || fixture.runtime_qualification==='UNAVAILABLE' || (profile==='concurrency'&&(!secondNotebook||!secondToken||!secondManifest))) {
    const unavailableReport = {
      schema: 'everlast.scale-v3-report/1',
      benchmark_id: `scale-${fixture.fixture_hash.slice(0, 8)}`,
      manifest_hash: fixture.fixture_hash,
      timestamp: new Date().toISOString(),
      result: 'UNAVAILABLE',
      missing_prerequisites: durationAvailable ? 'Qualified deployment/tokenizer/runtime, private evidence, clock uncertainty and requested profile scopes required' : 'Serving binding or conservative campaign duration unavailable',
      core: { result: 'UNAVAILABLE', p95_ms: null, percentile_method: 'nearest_rank', p95_rank: 19, warm_count: 0, wake_count: 0, attempt_count: 0, observations: [], wake_latencies_ms: [], budget_ms: 2500 }
    };
    write('v3-scale-benchmark.json', unavailableReport);
    console.error('[UNAVAILABLE] eval:v3-scale: Live deployed benchmark environment not configured');
    return 2;
  }

  try {
    const privateRecords=[];
    const evidenceFile=resolve(evidencePath);
    const evidenceDirectory=clockSession?new OwnerPrivateDirectory(dirname(evidenceFile)):undefined;
    const secondFixture=secondManifest?loadScaleFixture(JSON.parse(readFileSync(secondManifest,'utf8'))):undefined;
    const report = await runScaleBenchmark(fixture, {
      baseUrl,
      token,
      notebookId,
      profile,
      clockUncertaintyMs:uncertainty,
      clockSession,
      timeoutMs: REQUEST_TIMEOUT_MS,
      concurrencyNotebookId:secondNotebook,
      concurrencyToken:secondToken,
      concurrencyFixture:secondFixture,
      evidence:async ({requestId})=>{
        // Operator-private sidecar/export only. Malformed lines invalidate collection rather than disappearing.
        const text=evidenceDirectory
          ? evidenceDirectory.read(basename(evidenceFile))?.toString('utf8')??''
          : readFileSync(evidenceFile,'utf8');
        if(Buffer.byteLength(text)>50_000_000)throw new Error('Private evidence file exceeds bound');
        const rows=text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
        const matched=rows.filter(row=>row.request_id===requestId);
        if(matched.length!==1)throw new Error('Missing/duplicate private request evidence');
        const record=BenchmarkPrivateEvidenceSchema.parse(matched[0]);
        privateRecords.push(record);return record;
      },
    });
    const capture={
      schema:'everlast.scale-v3-capture/1',profile,manifest_hash:fixture.fixture_hash,
      observations:report.core.observations,
      ...(profile==='concurrency'?{concurrency_observations:report.concurrency?.observations,concurrency_fixture:secondFixture}:{}),
      private_evidence:privateRecords,
      ...(clockSession?{clock_calibration:clockSession.calibration}:{}),
    };
    write('v3-scale-capture.json',capture);
    const writeReport = clockContinuity => write('v3-scale-benchmark.json', { ...report, clock_continuity: clockContinuity });
    if (clockSession) {
      try {
        clockSession.assertClockCurrent(clockSession.calibration);
        writeReport('observed-through-export');
        clockSession.assertClockCurrent(clockSession.calibration);
      } catch {
        report.result='UNAVAILABLE';
        writeReport('invalid');
      }
    } else {
      writeReport('not-observed');
    }
    console.log(JSON.stringify({ result: report.result==='PASS'&&report.evidence_kind==='imported-diagnostic'?'DIAGNOSTIC_PASS':report.result, evidence_kind:report.evidence_kind, release_eligible:false, p95_ms: report.core.p95_ms, warm_count: report.core.warm_count }));
    return report.result === 'PASS' ? 0 : report.result === 'FAIL' ? 1 : 2;
  } catch (err) {
    console.error(`[ERROR] eval:v3-scale failed: ${err.message}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runScaleCli(process.argv.slice(2));
