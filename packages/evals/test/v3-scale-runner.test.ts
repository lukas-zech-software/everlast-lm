import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScaleFixture } from '../src/v3-scale-fixture.ts';
import { runScaleBenchmark } from '../src/v3-scale.ts';
import { collectFreshFinal } from '../src/v3-scale-client.ts';
import { buildScaleBenchmarkReport } from '../src/report.ts';
const raw=JSON.parse(readFileSync('packages/evals/fixtures/v3/scale-manifest.json','utf8'));
const {fixture_hash:oldHash,...recipe}=raw;const qualifiedRecipe={scope_manifest_hash:'a'.repeat(64),source_snapshot:[...recipe.active_source_ids].sort().map(source_id=>({source_id,revision:1})),...recipe,tokenizer_qualification:'qualified-tokenizer:1',runtime_qualification:'candidate'};
const fixture=loadScaleFixture({...qualifiedRecipe,fixture_hash:createHash('sha256').update(JSON.stringify(qualifiedRecipe)).digest('hex')});
const boot=randomUUID(), notebook=randomUUID();
const final=(kind='answer',id=fixture.needle_chunk_id)=>new Response(`event: final\ndata: ${JSON.stringify({replayed:false,messages:[{role:'assistant',kind,content:'142.8 bar',citations:[{chunk_id:id}]}]})}\n\n`,{headers:{'content-type':'text/event-stream'}});
const proof=({requestId,notebookId}:{requestId:string;notebookId:string})=>({request_id:requestId,notebook_id:notebookId,instance_boot_id:boot,revision:'candidate',terminal_status:'answer',readiness:{instance_boot_id:boot,revision:'candidate',ready_at_ms:1,dependencies:{sql:true,model:true,retrieval:true,cache:true,migrations:true,recovery:true}},stages:{},fixture_hash:fixture.fixture_hash,scope:{principal_subject:'owner-A',notebook_id:notebookId,sources:fixture.active_source_ids.map(source_id=>({source_id,revision:1})),source_token_total:1050123,manifest_hash:'a'.repeat(64),token_counting_model:'qualified-tokenizer',token_counting_version:'1',token_counting_qualification:'enterprise-eu'},prompt_leakage_count:0});
afterEach(()=>vi.unstubAllGlobals());
describe('NFR-PERF-01 C-02 NFR-EVAL-02/04 evidence-bound scale runner',()=>{
 it('retains 40 invalid attempts and unknown values when private serving evidence is missing',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>final()));
  const r=await runScaleBenchmark(fixture,{baseUrl:'http://localhost',token:'a',notebookId:notebook});
  expect(r.result).toBe('UNAVAILABLE');expect(r.core.attempt_count).toBe(40);
  expect(r.core.observations.every(o=>o.cohort==='invalid_environment'&&o.instance_boot_id===null&&o.active_token_total===null&&o.prompt_leakage_count===null)).toBe(true);
 });
 it('counts warm refusals among exactly 20 eligible submissions, retaining every failure',async()=>{
  let n=0;vi.stubGlobal('fetch',vi.fn(async()=>final(n++===0?'refusal':'answer')));
  const r=await runScaleBenchmark(fixture,{baseUrl:'http://localhost',token:'a',notebookId:notebook,clockUncertaintyMs:1,evidence:async args=>({...proof(args),terminal_status:n===1?'refusal':'answer'})});
  expect(r.result).toBe('FAIL');expect(r.core.attempt_count).toBe(20);expect(r.core.warm_count).toBe(20);
 });
 it('requires the needle citation and rejects mismatch of notebook, fixture or serving identity',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>final('answer',randomUUID())));
  const options={baseUrl:'http://localhost',token:'a',notebookId:notebook,clockUncertaintyMs:1,evidence:async(args:{requestId:string;notebookId:string})=>proof(args)};
  const r=await runScaleBenchmark(fixture,options);expect(r.result).toBe('FAIL');
  expect(r.core.observations.every(o=>!o.needle_correct&&o.active_token_total===1050123)).toBe(true);
  const mismatch=await runScaleBenchmark(fixture,{...options,evidence:async args=>({...proof(args),notebook_id:randomUUID()})});
  expect(mismatch.result).toBe('UNAVAILABLE');
 });
 it('does not silently run core-only concurrency or fall back to the same credentials/scope',async()=>{
  await expect(runScaleBenchmark(fixture,{baseUrl:'http://localhost',token:'a',notebookId:notebook,profile:'concurrency'})).rejects.toThrow(/concurrency/i);
 });
 it('runs genuine 10 request pairs with each Owner notebook fixture, and observes decoy leakage',async()=>{
  let inFlight=0,max=0;const second=randomUUID();
  const {fixture_hash:_,...recipe}=fixture;
  const recipe2={...recipe,active_source_ids:recipe.active_source_ids.map(()=>randomUUID()),needle_chunk_id:randomUUID(),decoy_source_id:randomUUID()};recipe2.needle_source_id=recipe2.active_source_ids[32]!;recipe2.source_snapshot=[...recipe2.active_source_ids].sort().map(source_id=>({source_id,revision:1}));
  const other=loadScaleFixture({...recipe2,fixture_hash:createHash('sha256').update(JSON.stringify(recipe2)).digest('hex')});
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
   inFlight++;max=Math.max(max,inFlight);await new Promise(r=>setTimeout(r,1));inFlight--;
   const body=JSON.parse(init.body as string);expect(body.active_source_ids).toEqual(url.includes(second)?other.active_source_ids:fixture.active_source_ids);
   return final('answer',url.includes(second)?other.needle_chunk_id:fixture.needle_chunk_id);
  }));
  const r=await runScaleBenchmark(fixture,{baseUrl:'http://localhost',token:'a',notebookId:notebook,profile:'concurrency',concurrencyNotebookId:second,concurrencyToken:'b',concurrencyFixture:other,clockUncertaintyMs:1,evidence:async args=>{
   const p=proof(args);return args.notebookId===second?{...p,fixture_hash:other.fixture_hash,scope:{...p.scope,principal_subject:'owner-B',sources:[...other.active_source_ids].sort().map(source_id=>({source_id,revision:1}))}}:p;
  }});
  expect(max).toBe(2);expect(r.concurrency?.count).toBe(20);expect(r.concurrency?.result).toBe('PASS');
 });
 it('bounds a stalled SSE read',async()=>{
  const response=new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/event-stream'}});
  await expect(collectFreshFinal(response,0,()=>1,{timeoutMs:5})).rejects.toThrow(/timeout/i);
 });
 it('rejects report manifest mismatch instead of accepting internally consistent wrong-fixture observations',()=>{
  expect(()=>buildScaleBenchmarkReport({benchmark_id:'b',manifest_hash:'b'.repeat(64),coreObservations:[{manifest_hash:'a'.repeat(64)} as never]})).toThrow();
 });
});

it('NFR-EVAL-02/04 rejects bare observation imports and wrong profile without dropping data',async()=>{
 const {importScaleCapture}=await import('../src/v3-scale-import.ts');
 expect(()=>importScaleCapture([],fixture,'core')).toThrow();
 expect(()=>importScaleCapture({schema:'everlast.scale-v3-capture/1',profile:'concurrency',manifest_hash:fixture.fixture_hash,observations:[],private_evidence:[]},fixture,'core')).toThrow(/profile/);
});

it('NFR-PERF-01 excludes local/unknown tokenizer evidence and wrong serving candidate from release acceptance',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>final()));
 for(const mutation of [{token_counting_qualification:'local-double'},{token_counting_version:'other-model-version'}]){
  const r=await runScaleBenchmark(fixture,{baseUrl:'http://localhost',token:'a',notebookId:notebook,clockUncertaintyMs:1,evidence:async args=>{const p=proof(args);return {...p,scope:{...p.scope,...mutation}};}});
  expect(r.result).toBe('UNAVAILABLE');
 }
});

it('C-02 NFR-EVAL-04 rejects changed scoped revisions even with matching source IDs and fixture label',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>final()));
 const result=await runScaleBenchmark(fixture,{baseUrl:'http://localhost',token:'a',notebookId:notebook,clockUncertaintyMs:1,evidence:async args=>{const p=proof(args);return {...p,scope:{...p.scope,sources:p.scope.sources.map(s=>({...s,revision:2}))}};}});
 expect(result.result).toBe('UNAVAILABLE');
});

it('NFR-PERF-01 uses the signed epoch offset without changing the elapsed timer', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => final()));
  const assertClockCurrent = vi.fn();
  const calibration = {offset_ms: 100, uncertainty_ms: 2, measured_at_ms: 900, expires_at_ms: 2000, measurement_id: 'fixture'};
  const privateEvidence: ReturnType<typeof proof>[] = [];
  const result = await runScaleBenchmark(fixture, {
    baseUrl: 'http://localhost', token: 'a', notebookId: notebook, epochClock: () => 1_000,
    clockSession: { calibration, assertClockCurrent },
    evidence: async args => {
      const record = proof(args);
      record.readiness.ready_at_ms = 1_050;
      privateEvidence.push(record);
      return record;
    },
  });
  expect(result.core.warm_count).toBe(20);
  expect(result.core.observations.every(row => row.client_submission_epoch_ms === 1_000)).toBe(true);
  expect(assertClockCurrent).toHaveBeenCalledWith(calibration, boot);
  const { importScaleCapture } = await import('../src/v3-scale-import.ts');
  const diagnostic = importScaleCapture({
    schema: 'everlast.scale-v3-capture/1', profile: 'core', manifest_hash: fixture.fixture_hash,
    observations: result.core.observations, private_evidence: privateEvidence, clock_calibration: calibration,
  }, fixture, 'core');
  expect(diagnostic).toMatchObject({ result: 'PASS', evidence_kind: 'imported-diagnostic', release_eligible: false });
});

it('NFR-PERF-01 retains the in-flight attempt and stops dispatch after a boot mismatch', async () => {
  const fetch = vi.fn(async () => final());
  vi.stubGlobal('fetch', fetch);
  const result = await runScaleBenchmark(fixture, {
    baseUrl: 'http://localhost', token: 'a', notebookId: notebook,
    clockSession: {
      calibration: { offset_ms: 0, uncertainty_ms: 0, measured_at_ms: 0, expires_at_ms: 60_000, measurement_id: 'fixture' },
      assertClockCurrent: (_calibration, instanceBootId) => { if (instanceBootId) throw new Error('boot mismatch'); },
    },
    evidence: async args => proof(args),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.core.observations).toHaveLength(1);
  expect(result.core.observations[0]).toMatchObject({ cohort: 'invalid_environment', evidence_error: 'Private clock continuity unavailable' });
  expect(result.result).toBe('UNAVAILABLE');
});
