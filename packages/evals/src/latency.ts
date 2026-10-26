import { BenchmarkObservationSchema, type BenchmarkObservation } from '@everlast/contracts';

/** NFR-PERF-01 / D17: never select or reclassify observations based on observed latency. */
export function aggregateScaleLatency(input:readonly BenchmarkObservation[]) {
 const observations=input.map(o=>BenchmarkObservationSchema.parse(o));
 const warm=observations.filter(o=>o.cohort==='warm');
 const wake=observations.filter(o=>o.cohort==='wake');
 const unavailable=observations.length>40 || warm.length!==20 || observations.some(o=>o.cohort==='invalid_environment')
  || new Set(observations.map(o=>o.request_id)).size!==observations.length
  || new Set(observations.map(o=>o.run_id)).size!==observations.length
  || new Set(observations.map(o=>o.manifest_hash)).size!==1;
 const failed=warm.some(o=>o.terminal_status!=='answer' || o.replayed || o.latency_ms===null || !o.needle_correct
  || !o.cited_chunk_ids.length || o.active_token_total<1050000 || o.prompt_leakage_count!==0 || o.answer_leakage_count!==0);
 const sorted=warm.map(o=>o.latency_ms??Infinity).sort((a,b)=>a-b);
 const value=sorted[18]??Infinity;
 const result=unavailable?'UNAVAILABLE':failed || value>2500?'FAIL':'PASS';
 return {result:result as 'PASS'|'FAIL'|'UNAVAILABLE',p95_ms:result==='PASS'?value:null,percentile_method:'nearest_rank' as const,p95_rank:19,
  warm_count:warm.length,wake_count:wake.length,attempt_count:observations.length,observations,
  wake_latencies_ms:wake.map(o=>o.latency_ms),budget_ms:2500};
}
