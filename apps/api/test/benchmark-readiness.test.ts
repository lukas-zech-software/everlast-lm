import { describe,expect,it } from 'vitest';
import { classifyReadiness, PrivateBenchmarkRecorder } from '../src/observability/benchmark.ts';
const evidence={instance_boot_id:'boot',revision:'rev',ready_at_ms:90,dependencies:{sql:true,model:true,retrieval:true,cache:true,migrations:true,recovery:true}};
describe('NFR-PERF-01 D17 prospective serving-instance readiness',()=>{
 it('requires same boot/revision and every dependency before submission, including uncertainty',()=>{
  const request={instance_boot_id:'boot',revision:'rev',client_submission_epoch_ms:100,clock_uncertainty_ms:5};
  expect(classifyReadiness(evidence,request)).toBe('warm');
  expect(classifyReadiness({...evidence,ready_at_ms:110},request)).toBe('wake');
  expect(classifyReadiness({...evidence,ready_at_ms:98},request)).toBe('invalid_environment');
  expect(classifyReadiness(evidence,{...request,instance_boot_id:'other'})).toBe('invalid_environment');
  expect(classifyReadiness(evidence,{...request,clock_uncertainty_ms:NaN})).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,model:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,migrations:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,recovery:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,dependencies:{...evidence.dependencies,retrieval:false,cache:false}},request)).toBe('invalid_environment');
  expect(classifyReadiness({...evidence,ready_at_ms:null},request)).toBe('invalid_environment');
  expect(classifyReadiness(evidence,{...request,clock_uncertainty_ms:-1})).toBe('invalid_environment');
 });
 it('records identifiers/stages only for approved synthetic scopes; never raw content or secrets',()=>{
  const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:['approved'],revision:'rev',sink:()=>{}});
  expect(recorder.begin('private','request')).toBeUndefined();
  const span=recorder.begin('approved','request');
  expect(span).toBeDefined();
  expect(recorder.readiness()).toMatchObject({revision:'rev',ready_at_ms:null});
 });
});

it('NFR-PERF-01 C-02 retains private scoped ledger and observed prompt counts without content',async()=>{
 const {randomUUID}=await import('node:crypto');
 const records:unknown[]=[];const notebook=randomUUID(),request=randomUUID();
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:[notebook],revision:'rev',sink:r=>records.push(r),fixtures:{[notebook]:{fixture_hash:'a'.repeat(64),forbidden_facts:['155.0 bar']}}});
 const span=recorder.begin(notebook,request)!;
 span.observePrompt({question:'pressure',chunks:[{text:'155.0 bar'}],history:[],guides:[]});
 span.finish('answer');
 expect(records).toHaveLength(1);expect(records[0]).toMatchObject({request_id:request,notebook_id:notebook,prompt_leakage_count:1,scope:null,fixture_hash:'a'.repeat(64)});
 expect(JSON.stringify(records)).not.toContain('155.0 bar');
});

it('NFR-PERF-01 does not qualify omitted or failing dependency probes',async()=>{
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:[],revision:'r',sink:()=>{}});
 const readiness=await recorder.qualifyDependencies({sql:async()=>true,model:async()=>{throw new Error('unavailable');}});
 expect(readiness.ready_at_ms).toBeNull();expect(readiness.dependencies).toMatchObject({sql:true,model:false,cache:false,recovery:false});
});

it('NFR-SEC-02 persists private records by atomic replacement and rejects existing public/symlink targets',async()=>{
 const {mkdtempSync,statSync,chmodSync,rmSync,symlinkSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {randomUUID}=await import('node:crypto');
 const {createPrivateBenchmarkSink}=await import('../src/observability/benchmark.ts');
 const dir=mkdtempSync(join(tmpdir(),'012-private-'));const file=join(dir,'records.jsonl'),id=randomUUID();
 try{
  const sink=createPrivateBenchmarkSink(file);const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:[id],revision:'candidate',sink});
  recorder.begin(id,randomUUID())!.finish('error');const inode=statSync(file).ino;
  recorder.begin(id,randomUUID())!.finish('error');expect(statSync(file).ino).not.toBe(inode);expect(statSync(file).mode&0o777).toBe(0o600);
  chmodSync(file,0o644);expect(()=>createPrivateBenchmarkSink(file)).toThrow(/private|permission/i);
  const link=join(dir,'link');symlinkSync(file,link);expect(()=>createPrivateBenchmarkSink(link)).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('FR-GC-08 NFR-PERF-01 binds canonical private trace, requires actual dependency probes, and never exposes raw runtime configuration',async()=>{
 const {createHash,randomUUID}=await import('node:crypto');const {mkdtempSync,readFileSync,statSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {CodeExecutionPrivateEvidenceFileSchema}=await import('@everlast/contracts');
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const dir=mkdtempSync(join(tmpdir(),'012-code-evidence-')),notebook=randomUUID(),other=randomUUID(),request=randomUUID(),owner=randomUUID(),source=randomUUID(),now=Date.now();
 const runtime={reasoning_engine:'projects/local-diagnostic/locations/europe-west4/reasoningEngines/123',region:'europe-west4' as const,vcpu:2 as const,memory_gb:1.5 as const,network:'none' as const,file_io_mb:100 as const,deadline_ms:15000 as const};
 const calibration={offset_ms:0,uncertainty_ms:1,measured_at_ms:now-10,expires_at_ms:now+60000,measurement_id:'LOCAL clock double, not release calibration'};
 const qualification='LOCAL probe doubles, not deployed acceptance';const file=join(dir,'code.json');
 const metadata={schema_version:1 as const,candidate_commit:'a'.repeat(40),serving_revision:'local',fixture_sha256:'f'.repeat(64),classification_basis:'application-serving-readiness' as const,qualification_sha256:createHash('sha256').update(qualification).digest('hex'),runtime_config_sha256:hash(runtime),clock_calibration_sha256:hash(calibration),approved_notebook_ids:[notebook,other]};
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:[notebook,other],revision:'local',sink:()=>{},executionEvidence:{file,metadata,runtime,calibration,qualification}});
 const input={notebook_id:notebook,owner_id:owner,request_id:request,source_snapshot:[{source_id:source,revision:1}]};
 try{
  expect(recorder.beginExecution(input)).toBeUndefined(); // constructor/configuration never qualifies.
  await recorder.qualifyDependencies({sql:async()=>true,model:async()=>true,retrieval:async()=>true,cache:async()=>true,migrations:async()=>true,recovery:async()=>true});
  const span=recorder.beginExecution(input)!;expect(span).toBeDefined();
  const at=new Date(now).toISOString();span.timing({phase:'sandbox_created_at',at});span.timing({phase:'running_code_at',at});span.timing({phase:'execution_completed_at',at});
  const trace={schema_version:1 as const,execution_id:randomUUID(),state:'Failed' as const,attempts:[],final_attempt_id:null,published_artifact_ids:[],failure_code:'ProviderUnavailable' as const,computed_results:[]};
  span.finish(trace,null);span.finish(trace,null);
  const result=CodeExecutionPrivateEvidenceFileSchema.parse(JSON.parse(readFileSync(file,'utf8')));
  expect(result.measurements).toHaveLength(1);expect(result.measurements[0]).toMatchObject({...input,trace_sha256:hash(trace),execution_state:'Failed',sandbox_created_at:at,execution_completed_at:at,answer_published_at:null});expect(statSync(file).mode&0o777).toBe(0o600);
  expect(readFileSync(file,'utf8')).not.toContain('reasoningEngines');
  expect(recorder.beginExecution({...input,notebook_id:randomUUID()})).toBeUndefined();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('NFR-PERF-01 operational signed approval invokes actual ports only after exact boot/scope binding; missing/failed/stale/timeout stays unavailable',async()=>{
 const {generateKeyPairSync,sign,randomUUID}=await import('node:crypto');const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const key=publicKey.export({type:'spki',format:'pem'}).toString(),a=randomUUID(),b=randomUUID();
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:[a,b],revision:'serving',sink:()=>{}});
 await recorder.qualifyDependencies({sql:async()=>true,migrations:async()=>true,recovery:async()=>true});
 const plan=()=>({id:randomUUID(),instance_boot_id:recorder.readiness().instance_boot_id,revision:'serving',issued_at:Date.now()-5,expires_at:Date.now()+60000,timeout_ms:50,operations:['retrieval','model','cache','runtime_observation'],actors:[a,b].map(notebook_id=>({owner_id:randomUUID(),notebook_id,sources:[{source_id:randomUUID(),revision:1}]}))});
 let calls=0;const probe=async()=>{calls++;};const ports={retrieval:probe,model:probe,cache:probe,runtime_observation:probe};
 const invoke=(body:unknown,p=ports)=>{const payload=JSON.stringify(body);return recorder.refreshOperational({payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64'),publicKey:key,ports:p});};
 expect(await invoke({...plan(),instance_boot_id:randomUUID()})).toBe(false);expect(calls).toBe(0);
 expect(await invoke({...plan(),expires_at:Date.now()-1})).toBe(false);expect(calls).toBe(0);
 const accepted=plan();expect(await invoke(accepted)).toBe(true);expect(calls).toBe(8);expect(recorder.readiness().dependencies.model).toBe(true);
 expect(await invoke(accepted)).toBe(false);expect(calls).toBe(8);
 expect(await recorder.refreshOperational({payload:JSON.stringify(plan()),signature:'bad',publicKey:key,ports})).toBe(false);expect(calls).toBe(8);
 expect(await invoke(plan(),{...ports,model:async()=>{throw new Error('actual model failed');}})).toBe(false);expect(recorder.readiness().ready_at_ms).toBeNull();
 expect(await invoke({...plan(),timeout_ms:5},{...ports,model:()=>new Promise(()=>{})})).toBe(false);expect(recorder.readiness().ready_at_ms).toBeNull();
});
