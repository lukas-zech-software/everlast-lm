import { z } from 'zod';
import { BenchmarkObservationSchema } from '@everlast/contracts';
import { buildScaleBenchmarkReport } from './report.ts';
import { correlateScaleEvidence } from './v3-scale.ts';
import { loadScaleFixture, type ScaleFixture } from './v3-scale-fixture.ts';
/** NFR-EVAL-02/04: reject old bare rows, mixed fixtures and silently dropped diagnostics. */
const capture=z.object({schema:z.literal('everlast.scale-v3-capture/1'),profile:z.enum(['core','concurrency']),manifest_hash:z.string().regex(/^[a-f0-9]{64}$/),observations:z.array(BenchmarkObservationSchema).max(40),concurrency_observations:z.array(BenchmarkObservationSchema).length(20).optional(),concurrency_fixture:z.unknown().optional(),private_evidence:z.array(z.unknown()).max(60)}).strict();
export function importScaleCapture(raw:unknown,fixture:ScaleFixture,profile:'core'|'concurrency'){
 const c=capture.parse(raw);
 if(c.manifest_hash!==fixture.fixture_hash || c.profile!==profile)throw new Error('Capture fixture/profile mismatch');
 if(profile==='core' && (c.concurrency_observations || c.concurrency_fixture))throw new Error('Unexpected diagnostic data in core capture');
 const other=profile==='concurrency'?loadScaleFixture(c.concurrency_fixture):undefined;
 if(profile==='concurrency' && !c.concurrency_observations)throw new Error('Missing concurrency observations');
 const rows=[...c.observations,...(c.concurrency_observations??[])];
 const evidence=new Map<string,unknown>();
 for(const record of c.private_evidence){
  const id=(record as {request_id?:unknown}|null)?.request_id;
  if(typeof id!=='string'||evidence.has(id))throw new Error('Malformed or duplicate private request evidence');evidence.set(id,record);
 }
 if([...evidence.keys()].some(id=>!rows.some(o=>o.request_id===id)))throw new Error('Unmatched private evidence');
 for(const row of rows){
  const f=row.manifest_hash===fixture.fixture_hash?fixture:other?.fixture_hash===row.manifest_hash?other:null;
  if(!f || !row.notebook_id)throw new Error('Observation fixture/notebook provenance missing');
  const correlated=correlateScaleEvidence(evidence.get(row.request_id),f,{requestId:row.request_id,notebookId:row.notebook_id,epochMs:row.client_submission_epoch_ms??NaN,uncertainty:row.clock_uncertainty_ms??NaN});
  const e=correlated.evidence;
  if(row.cohort!==correlated.cohort || row.instance_boot_id!==(e?.instance_boot_id??null) || row.active_token_total!==(e?.scope?.source_token_total??null) || row.prompt_leakage_count!==(e?.prompt_leakage_count??null) || row.needle_correct&&!row.cited_chunk_ids.includes(f.needle_chunk_id) || e&&row.principal_subject!==e.scope?.principal_subject)
   throw new Error('Observation/private evidence provenance mismatch');
 }
 if(c.concurrency_observations){
  const rows=c.concurrency_observations,notebooks=new Set(rows.map(o=>o.notebook_id)),owners=new Set(rows.map(o=>o.principal_subject));
  const pairs=new Map<string,typeof rows>();
  for(const row of rows){if(!row.diagnostic_pair_id)throw new Error('Missing concurrency pair provenance');const pair=pairs.get(row.diagnostic_pair_id)??[];pair.push(row);pairs.set(row.diagnostic_pair_id,pair);}
  if(pairs.size!==10||[...pairs.values()].some(pair=>pair.length!==2||Math.max(...pair.map(o=>o.client_submission_monotonic_ms))>=Math.min(...pair.map(o=>o.client_completion_monotonic_ms??-1))))throw new Error('Concurrency intervals do not overlap');
  if(notebooks.size!==2||owners.size!==2||owners.has(undefined)||[...notebooks].some(n=>rows.filter(o=>o.notebook_id===n).length!==10))throw new Error('Concurrency requires 10 observations per isolated Owner notebook');
 }
 return buildScaleBenchmarkReport({evidence_kind:'imported-diagnostic',benchmark_id:`import-${fixture.fixture_hash.slice(0,8)}`,manifest_hash:fixture.fixture_hash,coreObservations:c.observations,concurrencyObservations:c.concurrency_observations});
}
