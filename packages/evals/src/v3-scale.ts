import { randomUUID } from 'node:crypto';
import { BenchmarkPrivateEvidenceSchema, classifyReadiness, type BenchmarkObservation, type BenchmarkPrivateEvidence } from '@everlast/contracts';
import { loadScaleFixture, type ScaleFixture } from './v3-scale-fixture.ts';
import { collectFreshFinal, type FinalReceipt } from './v3-scale-client.ts';
import { buildScaleBenchmarkReport, type ScaleBenchmarkReport } from './report.ts';

export interface ScaleBenchmarkOptions {
 baseUrl:string;token:string;notebookId:string;profile?:'core'|'concurrency';
 concurrencyNotebookId?:string;concurrencyToken?:string;concurrencyFixture?:ScaleFixture;
 clock?:()=>number;epochClock?:()=>number;clockUncertaintyMs?:number;timeoutMs?:number;
 /** Private channel provisioned separately by the operator. No public telemetry endpoint. */
 evidence?:(request:{requestId:string;notebookId:string})=>Promise<unknown>;
}
export function correlateScaleEvidence(raw:unknown,fixture:ScaleFixture,input:{requestId:string;notebookId:string;epochMs:number;uncertainty:number}):{evidence:BenchmarkPrivateEvidence|null;cohort:BenchmarkObservation['cohort'];error?:string}{
 const parsed=BenchmarkPrivateEvidenceSchema.safeParse(raw);
 if(!parsed.success) return {evidence:null,cohort:'invalid_environment',error:'Missing/malformed private serving evidence'};
 const e=parsed.data,s=e.scope;
 const expected=[...fixture.active_source_ids].sort().join(',');
 if(e.request_id!==input.requestId || e.notebook_id!==input.notebookId || e.fixture_hash!==fixture.fixture_hash || !s || s.notebook_id!==input.notebookId || s.sources.map(p=>p.source_id).join(',')!==expected || e.instance_boot_id!==e.readiness.instance_boot_id || e.revision!==e.readiness.revision)
  return {evidence:null,cohort:'invalid_environment',error:'Private evidence request/fixture/scope/serving mismatch'};
 if(s.token_counting_qualification!=='enterprise-eu' || fixture.tokenizer_qualification!==`${s.token_counting_model}:${s.token_counting_version}` || fixture.runtime_qualification!==e.revision)
  return {evidence:e,cohort:'invalid_environment',error:'Original-only tokenizer/model or candidate revision qualification mismatch'};
 if(!fixture.source_snapshot||!fixture.scope_manifest_hash||s.manifest_hash!==fixture.scope_manifest_hash||JSON.stringify(s.sources)!==JSON.stringify(fixture.source_snapshot))return {evidence:e,cohort:'invalid_environment',error:'Frozen original ledger/revision snapshot unavailable or mismatched'};
 const cohort=classifyReadiness(e.readiness,{instance_boot_id:e.instance_boot_id,revision:e.revision,client_submission_epoch_ms:input.epochMs,clock_uncertainty_ms:input.uncertainty});
 return {evidence:e,cohort,...(cohort==='invalid_environment'?{error:'Dependency readiness or clock correlation unavailable'}:{})};
}
/** NFR-PERF-01: exactly twenty eligible warm submissions, including failures, never twenty selected successes. */
export async function runScaleBenchmark(fixture:ScaleFixture,options:ScaleBenchmarkOptions):Promise<ScaleBenchmarkReport>{
 fixture=loadScaleFixture(fixture);
 if(options.profile && !['core','concurrency'].includes(options.profile)) throw new Error('Invalid benchmark profile');
 const concurrent=options.profile==='concurrency';
 if(concurrent && (!options.concurrencyNotebookId || options.concurrencyNotebookId===options.notebookId || !options.concurrencyToken || options.concurrencyToken===options.token || !options.concurrencyFixture)) throw new Error('UNAVAILABLE: concurrency requires distinct Owner notebooks, credentials and fixtures');
 const other=options.concurrencyFixture?loadScaleFixture(options.concurrencyFixture):undefined;
 if(other && other.active_source_ids.some(id=>fixture.active_source_ids.includes(id))) throw new Error('UNAVAILABLE: concurrency scopes must be Owner-isolated');
 const clock=options.clock??(()=>performance.now()),epochClock=options.epochClock??Date.now;
 const timeoutMs=options.timeoutMs??30_000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>120_000) throw new Error('Invalid benchmark request timeout');
 const submit=async(target:{notebookId:string;token:string;fixture:ScaleFixture}):Promise<BenchmarkObservation>=>{
  const requestId=randomUUID(),runId=randomUUID(),epochMs=epochClock(),submissionMs=clock();
  let receipt:FinalReceipt={terminal_status:'error',client_first_validated_answer_ms:null,latency_ms:null,answer:'',cited_chunk_ids:[]};
  let failure:string|undefined;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;const requestDeadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Benchmark request timeout'));},timeoutMs);});
  try{
   const response=await Promise.race([fetch(`${options.baseUrl}/api/notebooks/${target.notebookId}/chat/turns`,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${target.token}`,'content-type':'application/json'},body:JSON.stringify({message:'What must the reactor coolant pressure be?',active_source_ids:target.fixture.active_source_ids,request_id:requestId})}),requestDeadline]);
   receipt=await Promise.race([collectFreshFinal(response,submissionMs,clock,{timeoutMs}),requestDeadline]);
  }catch{failure=controller.signal.aborted?'Request timeout/cancelled':'Request/transport failure';}
  finally{clearTimeout(timer);}
  let raw:unknown,evidenceTimer:ReturnType<typeof setTimeout>|undefined;
  try{raw=await Promise.race([options.evidence?.({requestId,notebookId:target.notebookId}),new Promise<never>((_,reject)=>{evidenceTimer=setTimeout(()=>reject(new Error('Private evidence timeout')),timeoutMs);})]);}catch{failure='Private evidence collection failed';}finally{clearTimeout(evidenceTimer);}
  const {evidence:e,cohort,error}=correlateScaleEvidence(raw,target.fixture,{requestId,notebookId:target.notebookId,epochMs,uncertainty:options.clockUncertaintyMs??NaN});
  const terminalMatches=receipt.terminal_status==='error' || !e || e.terminal_status===receipt.terminal_status;
  const valid=terminalMatches?cohort:'invalid_environment';
  const answer=receipt.terminal_status==='answer';
  return {run_id:runId,request_id:requestId,manifest_hash:target.fixture.fixture_hash,cohort:valid,instance_boot_id:e?.instance_boot_id??null,replayed:receipt.terminal_status==='replayed',client_submission_monotonic_ms:submissionMs,client_first_validated_answer_ms:answer?receipt.client_first_validated_answer_ms:null,latency_ms:answer?receipt.latency_ms:null,terminal_status:receipt.terminal_status,
   active_token_total:e?.scope?.source_token_total??null,cited_chunk_ids:receipt.cited_chunk_ids,needle_correct:answer&&receipt.answer.includes(target.fixture.expected_fact)&&receipt.cited_chunk_ids.includes(target.fixture.needle_chunk_id),prompt_leakage_count:e?.prompt_leakage_count??null,answer_leakage_count:receipt.terminal_status==='error'?null:receipt.answer.includes(target.fixture.forbidden_fact)?1:0,
   client_completion_monotonic_ms:clock(),client_submission_epoch_ms:epochMs,clock_uncertainty_ms:Number.isFinite(options.clockUncertaintyMs)?options.clockUncertaintyMs!:null,
   notebook_id:target.notebookId,...(e?.scope?{principal_subject:e.scope.principal_subject,scope_manifest_hash:e.scope.manifest_hash,revision:e.revision}:{}),...((failure||error||!terminalMatches)?{evidence_error:failure??error??'Terminal status mismatch'}:{})};
 };
 const coreObservations:BenchmarkObservation[]=[];
 const target={notebookId:options.notebookId,token:options.token,fixture};
 let warm=0;
 for(let attempt=0;attempt<fixture.max_attempts&&warm<fixture.sample_count;attempt++){
  const row=await submit(target);coreObservations.push(row);if(row.cohort==='warm')warm++;
 }
 let concurrencyObservations:BenchmarkObservation[]|undefined;
 if(concurrent){
  concurrencyObservations=[];
  for(let pair=0;pair<10;pair++){
   const id=randomUUID();const rows=await Promise.all([submit(target),submit({notebookId:options.concurrencyNotebookId!,token:options.concurrencyToken!,fixture:other!})]);
   concurrencyObservations.push(...rows.map(row=>({...row,diagnostic_pair_id:id})));
  }
  const owners=new Set(concurrencyObservations.map(o=>o.principal_subject));
  if(owners.size!==2 || owners.has(undefined)) for(const row of concurrencyObservations){row.cohort='invalid_environment';row.evidence_error='Two distinct Owner principals not proven';}
 }
 return buildScaleBenchmarkReport({evidence_kind:'ordinary-api-collected',benchmark_id:`scale-${randomUUID()}`,manifest_hash:fixture.fixture_hash,coreObservations,concurrencyObservations});
}
