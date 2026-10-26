import { randomUUID } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import type { BenchmarkObservation } from '@everlast/contracts';
import { aggregateScaleLatency } from '../src/latency.ts';
const sample=(ms=2500):BenchmarkObservation=>({run_id:randomUUID(),request_id:randomUUID(),manifest_hash:'a'.repeat(64),cohort:'warm',instance_boot_id:randomUUID(),replayed:false,client_submission_monotonic_ms:100,client_first_validated_answer_ms:100+ms,latency_ms:ms,terminal_status:'answer',active_token_total:1050000,cited_chunk_ids:[randomUUID()],needle_correct:true,prompt_leakage_count:0,answer_leakage_count:0});
const cohort=()=>Array.from({length:20},()=>sample());
describe('NFR-PERF-01 NFR-EVAL-02/04 fixed warm acceptance',()=>{
 it('uses the 19th sorted value, inclusive 2500ms, without deleting a slow run',()=>{
  const rows=cohort();rows[19]=sample(99999);
  expect(aggregateScaleLatency(rows)).toMatchObject({result:'PASS',p95_ms:2500,warm_count:20});
  rows[18]=sample(2501);
  expect(aggregateScaleLatency(rows).result).toBe('FAIL');
 });
 it('fails a warm refusal even when percentile would pass, round trips null failure timing',()=>{
  const rows=cohort();rows[0]={...sample(),terminal_status:'refusal',latency_ms:null,client_first_validated_answer_ms:null,needle_correct:false};
  const report=aggregateScaleLatency(rows);
  expect(report).toMatchObject({result:'FAIL',p95_ms:null});
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  expect(report.observations).toHaveLength(20);
 });
 it('requires complete 20 warm, at most 40 attempts, no unknown environment or favorable extras',()=>{
  expect(aggregateScaleLatency(cohort().slice(1)).result).toBe('UNAVAILABLE');
  expect(aggregateScaleLatency([...cohort(),sample()]).result).toBe('UNAVAILABLE');
  expect(aggregateScaleLatency([...cohort(),{...sample(),cohort:'invalid_environment'}]).result).toBe('UNAVAILABLE');
  expect(aggregateScaleLatency([...cohort(),...Array.from({length:21},()=>({...sample(),cohort:'wake' as const}))]).result).toBe('UNAVAILABLE');
 });
 it('reports wake latencies without threshold and rejects wrong fact, leakage, replay or missing citations',()=>{
  const rows=cohort();
  expect(aggregateScaleLatency([{...sample(99999),cohort:'wake'},...rows])).toMatchObject({result:'PASS',wake_count:1});
  for(const mutation of [{needle_correct:false},{prompt_leakage_count:1},{answer_leakage_count:1},{cited_chunk_ids:[]},{active_token_total:1049999}])
   expect(aggregateScaleLatency([{...rows[0]!,...mutation},...rows.slice(1)]).result).toBe('FAIL');
 });
 it('rejects duplicate request identities and mixed manifests',()=>{
  const rows=cohort();rows[1]={...rows[0]!};
  expect(aggregateScaleLatency(rows).result).toBe('UNAVAILABLE');
  rows[1]={...sample(),manifest_hash:'b'.repeat(64)};
  expect(aggregateScaleLatency(rows).result).toBe('UNAVAILABLE');
 });
});
