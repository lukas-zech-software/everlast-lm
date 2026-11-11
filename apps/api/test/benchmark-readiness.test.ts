import { describe,expect,it,vi } from 'vitest';
import { classifyReadiness, PrivateBenchmarkRecorder, OPERATIONAL_PROVIDER_BUDGET } from '../src/observability/benchmark.ts';
const cacheSdk=vi.hoisted(()=>({embed:vi.fn(),options:vi.fn(),countTokens:vi.fn(),create:vi.fn(),delete:vi.fn()}));
vi.mock('@google/genai',async importOriginal=>({...await importOriginal<typeof import('@google/genai')>(),GoogleGenAI:class{constructor(options:unknown){cacheSdk.options(options);}models={countTokens:cacheSdk.countTokens,embedContent:cacheSdk.embed};caches={create:cacheSdk.create,delete:cacheSdk.delete};}}));
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
  expect(recorder.executionIdentity(notebook)).toBeDefined();expect(recorder.executionIdentity(randomUUID())).toBeUndefined();
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

it('NFR-PERF-01 keeps the effect lock after timeout until an abort-ignoring port actually settles; late success never qualifies',async()=>{
 const {generateKeyPairSync,sign,randomUUID}=await import('node:crypto');const {publicKey,privateKey}=generateKeyPairSync('ed25519');const key=publicKey.export({type:'spki',format:'pem'}).toString();const ids=[randomUUID(),randomUUID()];
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:ids,revision:'r',sink:()=>{}});await recorder.qualifyDependencies({sql:async()=>true,migrations:async()=>true,recovery:async()=>true});
 const plan=()=>({id:randomUUID(),instance_boot_id:recorder.readiness().instance_boot_id,revision:'r',issued_at:Date.now()-1,expires_at:Date.now()+60000,timeout_ms:5,operations:['retrieval','model','cache','runtime_observation'],actors:ids.map(notebook_id=>({owner_id:randomUUID(),notebook_id,sources:[{source_id:randomUUID(),revision:1}]}))});
 let release!:()=>void,calls=0;const blocked=new Promise<void>(resolve=>{release=resolve;});const noop=async()=>{};const ports={retrieval:async()=>{calls++;await blocked;},model:noop,cache:noop,runtime_observation:noop};
 const invoke=()=>{const payload=JSON.stringify(plan());return recorder.refreshOperational({payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64'),publicKey:key,ports});};
 expect(await invoke()).toBe(false);expect(calls).toBe(1);expect(await invoke()).toBe(false);expect(calls).toBe(1);
 release();await new Promise(resolve=>setTimeout(resolve,1));expect(recorder.readiness().ready_at_ms).toBeNull();
});

it('NFR-PERF-01 private coordinator pins its trust root, binds all configured hashes, refreshes once and expires without public proof',async()=>{
 const {createHash,generateKeyPairSync,sign,randomUUID}=await import('node:crypto');const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),rogue=generateKeyPairSync('ed25519');const dir=mkdtempSync(join(tmpdir(),'012-coordinator-')),ids=[randomUUID(),randomUUID()],now=Date.now();
 const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const runtime={reasoning_engine:'projects/test/locations/europe-west4/reasoningEngines/123',region:'europe-west4' as const,vcpu:2 as const,memory_gb:1.5 as const,network:'none' as const,file_io_mb:100 as const,deadline_ms:15000 as const};
 const calibration={offset_ms:0,uncertainty_ms:1,measured_at_ms:now-10,expires_at_ms:now+60000,measurement_id:'LOCAL clock double'};const qualification='LOCAL port doubles, not deployed acceptance';
 const metadata={schema_version:1 as const,candidate_commit:'a'.repeat(40),serving_revision:'serving',fixture_sha256:'f'.repeat(64),classification_basis:'application-serving-readiness' as const,qualification_sha256:createHash('sha256').update(qualification).digest('hex'),runtime_config_sha256:digest(runtime),clock_calibration_sha256:digest(calibration),approved_notebook_ids:ids};
 const source='c'.repeat(64),config='d'.repeat(64);
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:ids,revision:'serving',sink:()=>{},sourceTreeSha256:source,operationalConfigSha256:config,executionEvidence:{file:join(dir,'code.json'),metadata,runtime,calibration,qualification}});
 await recorder.qualifyDependencies({sql:async()=>true,migrations:async()=>true,recovery:async()=>true});
 writeFileSync(join(dir,'trusted-public-key.pem'),publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
 let calls=0;const probe=async()=>{calls++;};const ports={retrieval:probe,model:probe,cache:probe,runtime_observation:probe};const stop=recorder.startOperationalCoordinator(dir,ports);
 const plan=()=>({provider_budget:OPERATIONAL_PROVIDER_BUDGET,...metadata, schema_version:undefined,approved_notebook_ids:undefined,serving_revision:undefined,id:randomUUID(),instance_boot_id:recorder.readiness().instance_boot_id,revision:'serving',issued_at:Date.now()-1,expires_at:Date.now()+5000,timeout_ms:100,source_tree_sha256:source,operational_config_sha256:config,operations:['retrieval','model','cache','runtime_observation'],actors:ids.map(notebook_id=>({owner_id:randomUUID(),notebook_id,sources:[{source_id:randomUUID(),revision:1}]}))});
 const publish=(body:unknown,key=privateKey)=>{const payload=JSON.stringify(body);writeFileSync(join(dir,'authorization.json'),payload,{mode:0o600});writeFileSync(join(dir,'authorization.sig'),sign(null,Buffer.from(payload),key).toString('base64'),{mode:0o600});};
 try{
  const challenge=JSON.parse(readFileSync(join(dir,'challenge.json'),'utf8'));expect(challenge).toMatchObject({source_tree_sha256:source,operational_config_sha256:config});
  publish(plan(),rogue.privateKey);await new Promise(resolve=>setTimeout(resolve,1100));expect(calls).toBe(0);
  publish({...plan(),candidate_commit:'b'.repeat(40)});await new Promise(resolve=>setTimeout(resolve,1100));expect(calls).toBe(0);
  const accepted=plan();publish(accepted);await new Promise(resolve=>setTimeout(resolve,1100));expect(calls).toBe(8);
  const status=JSON.parse(readFileSync(join(dir,'status.json'),'utf8'));expect(status).toMatchObject({result:'OBSERVED_READY',release_eligible:false});
  await new Promise(resolve=>setTimeout(resolve,1100));expect(calls).toBe(8);
  const actor=accepted.actors[0]!;expect(recorder.beginExecution({notebook_id:actor.notebook_id,owner_id:actor.owner_id,request_id:randomUUID(),source_snapshot:actor.sources})).toBeDefined();
  expect(recorder.beginExecution({notebook_id:actor.notebook_id,owner_id:randomUUID(),request_id:randomUUID(),source_snapshot:actor.sources})).toBeUndefined();
  const clock=vi.spyOn(Date,'now').mockReturnValue(accepted.expires_at+1);try{expect(recorder.readiness().ready_at_ms).toBeNull();}finally{clock.mockRestore();}
 }finally{stop();rmSync(dir,{recursive:true,force:true});}
 expect(recorder.readiness().ready_at_ms).toBeNull();
},10000);

it('NFR-PERF-01 API-owned cache adapter counts actual scoped bytes and enforces a finite provider TTL without worker imports (SDK double)',async()=>{
 const {createOperationalCacheFromEnv}=await import('../src/observability/benchmark.ts');const {randomUUID}=await import('node:crypto');
 cacheSdk.countTokens.mockResolvedValue({totalTokens:100});cacheSdk.create.mockResolvedValue({name:'LOCAL-private-cache',expireTime:new Date(Date.now()+60000).toISOString()});
 const cache=createOperationalCacheFromEnv({VERTEX_PROJECT:'local-fixture',VERTEX_LOCATION:'europe-west4'});
 const pages=[[{chunk_id:randomUUID(),source_id:randomUUID(),revision:1,text:'Original scoped fact.',token_count:4,locator:{page_number:1,start_offset:0,end_offset:21}}]];
 const result=await cache.create({pages,signal:new AbortController().signal});expect(result.handle).toBe('LOCAL-private-cache');expect(cacheSdk.create.mock.calls[0]?.[0].config.ttl).toBe('60s');expect(JSON.stringify(cacheSdk.countTokens.mock.calls[0])).toContain('Original scoped fact.');
 cacheSdk.countTokens.mockResolvedValue({totalTokens:1048576});await expect(cache.create({pages,signal:new AbortController().signal})).rejects.toThrow(/envelope/);
 expect(cacheSdk.create).toHaveBeenCalledTimes(1);await cache.delete(result.handle);expect(cacheSdk.delete).toHaveBeenCalledWith({name:result.handle});
});

it('NFR-PERF-01 signed retrieval setup limits actual embedding RPC attempts and carries abort, preserving ordinary retry defaults (SDK double)',async()=>{
 const {VertexEmbedder,createVertexClient}=await import('@everlast/cloud');
 const embedder:any=new VertexEmbedder({client:createVertexClient({project:'local',location:'europe-west4'})});cacheSdk.embed.mockReset();cacheSdk.embed.mockRejectedValue(Object.assign(new Error('provider429'),{status:429}));
 const signal=new AbortController().signal;vi.useFakeTimers();
 try{const pending=expect(embedder.embed(['setup'],'RETRIEVAL_QUERY',{signal,maxAttempts:1})).rejects.toThrow('provider429');await vi.runAllTimersAsync();await pending;expect(cacheSdk.embed).toHaveBeenCalledTimes(1);expect(cacheSdk.embed.mock.calls[0]?.[0].config.abortSignal).toBe(signal);}finally{vi.useRealTimers();}
});

it('NFR-PERF-01 provider-native cache 10MB cap rejects originals before any token/count/create RPC without truncation (SDK double)',async()=>{
 const {createOperationalCacheFromEnv}=await import('../src/observability/benchmark.ts');const {randomUUID}=await import('node:crypto');
 const cache=createOperationalCacheFromEnv({VERTEX_PROJECT:'local-fixture',VERTEX_LOCATION:'europe-west4'});
 const pages=[[{chunk_id:randomUUID(),source_id:randomUUID(),revision:1,text:'x'.repeat(10000001),token_count:1000000,locator:{page_number:1,start_offset:0,end_offset:10000001}}]];
 const beforeCount=cacheSdk.countTokens.mock.calls.length,beforeCreate=cacheSdk.create.mock.calls.length;
 await expect(cache.create({pages,signal:new AbortController().signal})).rejects.toThrow(/native.*byte/);
 expect(cacheSdk.countTokens.mock.calls.length).toBe(beforeCount);expect(cacheSdk.create.mock.calls.length).toBe(beforeCreate);expect(pages[0]![0]!.text.length).toBe(10000001);
});

it('NFR-PERF-01 million-token declared cache fixture fits native byte cap with actual tokenizer proof and single-attempt SDK budget (LOCAL SDK)',async()=>{
 const {createOperationalCacheFromEnv}=await import('../src/observability/benchmark.ts');const {randomUUID}=await import('node:crypto');
 cacheSdk.countTokens.mockResolvedValue({totalTokens:1000000});cacheSdk.create.mockResolvedValue({name:'LOCAL-million-cache',expireTime:new Date(Date.now()+60000).toISOString()});
 const cache=createOperationalCacheFromEnv({VERTEX_PROJECT:'local-fixture',VERTEX_LOCATION:'europe-west4'});const pages=[[{chunk_id:randomUUID(),source_id:randomUUID(),revision:1,text:'word '.repeat(800000),token_count:1000000,locator:{page_number:1,start_offset:0,end_offset:4000000}}]];
 const result=await cache.create({pages,signal:new AbortController().signal});expect(result.handle).toBe('LOCAL-million-cache');expect(cacheSdk.options.mock.lastCall?.[0].httpOptions.retryOptions.attempts).toBe(1);expect(JSON.stringify(cacheSdk.create.mock.lastCall?.[0].config.contents).length).toBeGreaterThan(4000000);await cache.delete(result.handle);
});
it('NFR-SEC-02 remote bootstrap stays default-disabled and missing/invalid independent trust config fails before effects',async()=>{
 const {preparePrivateBridgeEnvironment}=await import('../src/observability/benchmark.ts');const original={BENCHMARK_BRIDGE_PUBLIC_KEY:'untrusted-invalid'};expect(preparePrivateBridgeEnvironment(original).env).toBe(original);
 expect(()=>preparePrivateBridgeEnvironment({...original,BENCHMARK_BRIDGE_ENABLED:'true'})).toThrow(/incomplete/);
 const {randomUUID}=await import('node:crypto');expect(()=>preparePrivateBridgeEnvironment({BENCHMARK_BRIDGE_ENABLED:'true',BENCHMARK_BRIDGE_EXPIRES_AT_MS:String(Date.now()+60000),BENCHMARK_BRIDGE_CAMPAIGN_ID:randomUUID(),BENCHMARK_BRIDGE_PUBLIC_KEY:'invalid',BENCHMARK_BRIDGE_EXECUTION_CONFIG:'{}',BENCHMARK_APPROVED_NOTEBOOKS:randomUUID()})).toThrow(/trust/);
});

it('NFR-SEC-02 actual server rejects incomplete private bridge bootstrap before any object/provider operation',async()=>{
 const {startApiServer}=await import('../src/server.ts');const effect=vi.fn(async()=>{throw new Error('MUST NOT CALL');});
 await expect(startApiServer({BENCHMARK_BRIDGE_ENABLED:'true'},{},{bridgeObjects:{stat:effect,read:effect,put:effect,list:effect}})).rejects.toThrow(/incomplete/);expect(effect).not.toHaveBeenCalled();
});

it.each([-30000,30000])('NFR-PERF-01 server maps client-epoch calibration %ims and conservatively rejects mapped expiry',async offset=>{
 const {randomUUID,createHash}=await import('node:crypto');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'012-offset-'));
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),runtime={reasoning_engine:'projects/local/locations/europe-west4/reasoningEngines/123',region:'europe-west4' as const,vcpu:2 as const,memory_gb:1.5 as const,network:'none' as const,file_io_mb:100 as const,deadline_ms:15000 as const},ids=[randomUUID(),randomUUID()],qualification='LOCAL clock-domain test';
 const base={offset_ms:offset,uncertainty_ms:5,measured_at_ms:Date.now()-offset-100,expires_at_ms:Date.now()-offset+10000,measurement_id:'LOCAL retained client epoch'};
 const create=(calibration:typeof base)=>new PrivateBenchmarkRecorder({approved_notebook_ids:ids,revision:'local',sink:()=>{},executionEvidence:{file:join(dir,'code.json'),runtime,calibration,qualification,metadata:{schema_version:1,candidate_commit:'a'.repeat(40),serving_revision:'local',fixture_sha256:'f'.repeat(64),classification_basis:'application-serving-readiness',qualification_sha256:createHash('sha256').update(qualification).digest('hex'),runtime_config_sha256:hash(runtime),clock_calibration_sha256:hash(calibration),approved_notebook_ids:ids}}});
 try{expect(()=>create(base)).not.toThrow();expect(()=>create({...base,expires_at_ms:Date.now()-offset-100})).toThrow(/calibration/);}finally{rmSync(dir,{recursive:true,force:true});}
});
