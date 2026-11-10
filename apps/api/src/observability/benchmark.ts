import { CodeExecutionPrivateEvidenceFileSchema, CodeExecutionPrivateMeasurementSchema, CodeExecutionRuntimeConfigSchema, type CodeExecutionPrivateEvidenceFile, type CodeExecutionRuntimeConfig, type CodeExecutionTrace, type SourceRevisionPair } from '@everlast/contracts';
import { randomUUID, createHash } from 'node:crypto';
import { constants, closeSync, mkdirSync, openSync, fstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, fsyncSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { BenchmarkPrivateEvidenceSchema, type BenchmarkPrivateEvidence, type ReadinessEvidence, type ScopedCorpusManifest } from '@everlast/contracts';
import { buildScopedCorpusLedger, verifyScopeSnapshot, type CorpusTokenizer, type Pool, type ScopeSnapshot } from '@everlast/db';
export { classifyReadiness } from '@everlast/contracts';
export type { ReadinessEvidence } from '@everlast/contracts';
export type BenchmarkStage='admission'|'retrieval'|'generation'|'verification'|'publication';
export type PrivateStageRecord=BenchmarkPrivateEvidence;
export interface BenchmarkRecorderOptions {
 executionEvidence?: ExecutionEvidenceConfig|undefined;
 approved_notebook_ids:string[];revision:string;sink:(record:PrivateStageRecord)=>void;clock?:()=>number;
 /** Qualified tokenizer is injected in-process; absent means ledger evidence unavailable. */
 tokenizer?:CorpusTokenizer;
 fixtures?:Record<string,{fixture_hash:string;forbidden_facts:string[]}>;
}
/** NFR-SEC-01/02 private local sink: identifier/count-only, never a public route or generic log. */
/** Same-directory replacement; reject links, non-regular files and existing broad permissions. */
function readPrivateFile(file:string):string{
 try{const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.uid!==process.getuid?.())throw new Error('Private evidence requires an owner-private regular file');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>8_000_000||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw new Error('Private evidence file bounds/permissions invalid');return readFileSync(fd,'utf8');}finally{closeSync(fd);}}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}
}
function writePrivateAtomic(file:string,text:string):void{
 if(!isAbsolute(file)||Buffer.byteLength(text)>8_000_000)throw new Error('Private evidence path/size invalid');
 readPrivateFile(file);mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+randomUUID()+'.tmp';let fd:number|undefined;
 try{fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);writeFileSync(fd,text);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,file);}
 finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch{/* renamed or absent */}}
}
export function createPrivateBenchmarkSink(file:string):(record:PrivateStageRecord)=>void{
 if(!isAbsolute(file))throw new Error('Private benchmark evidence file must be absolute');readPrivateFile(file);
 return record=>{const checked=BenchmarkPrivateEvidenceSchema.parse(record);const prior=readPrivateFile(file);writePrivateAtomic(file,prior+JSON.stringify(checked)+'\n');};
}

export interface ExecutionEvidenceConfig{
 file:string;metadata:Omit<CodeExecutionPrivateEvidenceFile,'measurements'>;
 runtime:CodeExecutionRuntimeConfig;
 calibration:{offset_ms:number;uncertainty_ms:number;measured_at_ms:number;expires_at_ms:number;measurement_id:string};
 qualification:string;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checkExecutionConfig(config:ExecutionEvidenceConfig,revision:string){
 const meta=CodeExecutionPrivateEvidenceFileSchema.parse({...config.metadata,measurements:[]});
 const runtime=CodeExecutionRuntimeConfigSchema.parse(config.runtime),clock=config.calibration;
 if(meta.serving_revision!==revision||digest(runtime)!==meta.runtime_config_sha256||digest(clock)!==meta.clock_calibration_sha256||createHash('sha256').update(config.qualification).digest('hex')!==meta.qualification_sha256)throw new Error('Private execution provenance mismatch');
 if(!Number.isFinite(clock.offset_ms)||!Number.isFinite(clock.uncertainty_ms)||clock.uncertainty_ms<0||clock.uncertainty_ms>1000||!Number.isFinite(clock.measured_at_ms)||clock.measured_at_ms<0||clock.measured_at_ms>Date.now()||!Number.isFinite(clock.expires_at_ms)||clock.expires_at_ms<=Date.now()||typeof clock.measurement_id!=='string'||!clock.measurement_id||clock.measurement_id.length>200)throw new Error('Private execution calibration unavailable');
 readPrivateFile(config.file);return meta;
}
export interface OperationalProbePorts {
 retrieval:(actor:{owner_id:string;notebook_id:string;sources:{source_id:string;revision:number}[]},signal:AbortSignal)=>Promise<void>;
 model:OperationalProbePorts['retrieval'];cache:OperationalProbePorts['retrieval'];
 /** Read actual same-boot canonical managed lifecycle evidence; MUST NOT create another sandbox. */
 runtime_observation:OperationalProbePorts['retrieval'];
}
export class PrivateBenchmarkRecorder {
 private readonly options:BenchmarkRecorderOptions;private readonly approved:Set<string>;private readonly boot=randomUUID();private readonly clock:()=>number;private evidence:ReadinessEvidence;
 private readonly ledgers=new Map<string,ScopedCorpusManifest>();
 readonly tokenizer:CorpusTokenizer|undefined;
 constructor(options:BenchmarkRecorderOptions){
  if(options.executionEvidence)checkExecutionConfig(options.executionEvidence,options.revision);
  this.options=options;this.tokenizer=options.tokenizer;this.approved=new Set(options.approved_notebook_ids);this.clock=options.clock??(()=>performance.now());
  this.evidence={instance_boot_id:this.boot,revision:options.revision,ready_at_ms:null,dependencies:{sql:false,model:false,retrieval:false,cache:false,migrations:false,recovery:false}};
 }
 /** Mounts are private operator evidence, never public request inputs. Matching identity is necessary, not qualification. */
 static executionConfigFromEnv(env:NodeJS.ProcessEnv,runtime:CodeExecutionRuntimeConfig|undefined):ExecutionEvidenceConfig|undefined{
  if(!env.BENCHMARK_EXECUTION_CONFIG_FILE)return undefined;
  if(!runtime||!env.COMMIT_SHA||!env.K_REVISION)throw new Error('Actual candidate/runtime identity unavailable');
  const config=JSON.parse(readPrivateFile(env.BENCHMARK_EXECUTION_CONFIG_FILE)) as ExecutionEvidenceConfig;
  const meta=checkExecutionConfig(config,env.K_REVISION);
  if(meta.candidate_commit!==env.COMMIT_SHA||digest(CodeExecutionRuntimeConfigSchema.parse(runtime))!==meta.runtime_config_sha256)throw new Error('Actual serving/runtime identity mismatch');
  return config;
 }
 /** Only current in-process probe evidence can open collection; object construction never qualifies it. */
 beginExecution(input:{notebook_id:string;owner_id:string;request_id:string;source_snapshot:SourceRevisionPair[]}){
  const config=this.options.executionEvidence,readiness=this.readiness();
  if(!config||!this.approved.has(input.notebook_id)||!config.metadata.approved_notebook_ids.includes(input.notebook_id))return undefined;
  try{checkExecutionConfig(config,this.options.revision);}catch{return undefined;}
  if(readiness.ready_at_ms===null||!Object.values(readiness.dependencies).every(Boolean))return undefined;
  const qualifiedAt=Date.now(),times:{sandbox_created_at:string|null;running_code_at:string|null;execution_completed_at:string|null}={sandbox_created_at:null,running_code_at:null,execution_completed_at:null};
  let finished=false;
  return {
   timing:(event:{phase:keyof typeof times;at:string})=>{if(finished)return;if(event.phase==='execution_completed_at')times.execution_completed_at=event.at;else times[event.phase]??=event.at;},
   finish:(trace:CodeExecutionTrace,publishedAt:string|null)=>{
    if(finished)return;finished=true;
    try{
     checkExecutionConfig(config,this.options.revision);
     const {measurements,...metadata}=CodeExecutionPrivateEvidenceFileSchema.parse({...config.metadata,measurements:[]});
     const terminal=trace.state==='Succeeded'||trace.state==='Failed'||trace.state==='TimedOut';if(!terminal)return;
     const record=CodeExecutionPrivateMeasurementSchema.parse({schema_version:1,...input,execution_id:trace.execution_id,fixture_sha256:metadata.fixture_sha256,instance_boot_id:readiness.instance_boot_id,candidate_commit:metadata.candidate_commit,serving_revision:metadata.serving_revision,classification_basis:metadata.classification_basis,qualification_sha256:metadata.qualification_sha256,runtime_config_sha256:metadata.runtime_config_sha256,clock_calibration_sha256:metadata.clock_calibration_sha256,execution_state:trace.state,failure_code:trace.failure_code,attempts:trace.attempts.map(a=>({attempt_id:a.attempt_id,ordinal:a.ordinal,started_at:a.started_at,ended_at:a.ended_at,terminal_reason:a.terminal_reason})),qualified:true,ready_at_ms:readiness.ready_at_ms,qualified_at_ms:qualifiedAt,...times,answer_published_at:publishedAt,trace_sha256:digest(trace)});
     const prior=readPrivateFile(config.file);const file=prior?CodeExecutionPrivateEvidenceFileSchema.parse(JSON.parse(prior)):{...metadata,measurements};
     if(digest({...file,measurements:[]})!==digest({...metadata,measurements:[]})||file.measurements.some(row=>row.request_id===input.request_id)||file.measurements.length>=2000)throw new Error('Private execution evidence identity/count mismatch');
     writePrivateAtomic(config.file,JSON.stringify({...file,measurements:[...file.measurements,record]})+'\n');
    }catch{/* Missing proof stays UNAVAILABLE; user publication never depends on instrumentation. */}
   },
  };
 }
 async refreshOperational(_input:{payload:string;signature:string;publicKey:string;ports:OperationalProbePorts}):Promise<boolean>{return false;}
 readiness():ReadinessEvidence{return structuredClone(this.evidence);}
 /** Qualified original-only metadata may be prepared privately before submission; every use rechecks current C-02 scope. */
 async corpusLedger(pool:Pool,snapshot:ScopeSnapshot):Promise<ScopedCorpusManifest>{
  if(!this.tokenizer||!this.approved.has(snapshot.notebook_id))throw new Error('Qualified approved corpus tokenizer unavailable');
  const key=JSON.stringify({owner:snapshot.owner_id,notebook:snapshot.notebook_id,sources:snapshot.sources,model:this.tokenizer.model,version:this.tokenizer.version});
  try{
   await verifyScopeSnapshot(pool,snapshot);
   let ledger=this.ledgers.get(key);
   if(!ledger){ledger=await buildScopedCorpusLedger(pool,snapshot,this.tokenizer);this.ledgers.set(key,ledger);}
   await verifyScopeSnapshot(pool,snapshot);return structuredClone(ledger);
  }catch(error){this.ledgers.delete(key);throw error;}
 }
 /** Run real, bounded in-process probes. Omitted/failed dependencies remain unqualified. */
 async qualifyDependencies(probes:Partial<Record<keyof ReadinessEvidence['dependencies'],()=>Promise<boolean>>>):Promise<ReadinessEvidence>{
  const dependencies={sql:false,model:false,retrieval:false,cache:false,migrations:false,recovery:false};
  await Promise.all((Object.keys(dependencies) as (keyof typeof dependencies)[]).map(async key=>{
   const probe=probes[key];if(!probe)return;
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{dependencies[key]=await Promise.race([probe(),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),5000);})])===true;}catch{dependencies[key]=false;}finally{clearTimeout(timer);}
  }));
  this.qualify({dependencies,ready_at_ms:Object.values(dependencies).every(Boolean)?Date.now():null});return this.readiness();
 }
 /** Explicit trusted dependency qualification only; no public request may invoke this. */
 qualify(input:Omit<ReadinessEvidence,'instance_boot_id'|'revision'>):void{
  if(input.ready_at_ms!==null&&!Number.isFinite(input.ready_at_ms))throw new Error('Invalid readiness timestamp');
  this.evidence={...structuredClone(input),instance_boot_id:this.boot,revision:this.options.revision};
 }
 begin(notebook:string,request:string){
  if(!this.approved.has(notebook))return undefined;
  const readiness=this.readiness(),fixture=this.options.fixtures?.[notebook];let start=this.clock(),stage:BenchmarkStage='admission',finished=false;
  let scope:BenchmarkPrivateEvidence['scope']=null,promptLeaks:number|null=null;
  const stages:Partial<Record<BenchmarkStage,number>>={};
  const close=()=>{const now=this.clock();stages[stage]=(stages[stage]??0)+Math.max(0,now-start);start=now;};
  return {
   recordScope:(ledger:ScopedCorpusManifest)=>{if(ledger.notebook_id!==notebook)throw new Error('Benchmark ledger notebook mismatch');scope={principal_subject:ledger.principal_subject,notebook_id:ledger.notebook_id,sources:ledger.sources,source_token_total:ledger.source_token_total,manifest_hash:ledger.manifest_hash,token_counting_model:ledger.token_counting_model,token_counting_version:ledger.token_counting_version,token_counting_qualification:ledger.token_counting_qualification??'unqualified'};},
   observePrompt:(input:unknown)=>{if(!fixture?.forbidden_facts.length)return;const text=JSON.stringify(input);promptLeaks=(promptLeaks??0)+fixture.forbidden_facts.filter(f=>text.includes(f)).length;},
   stage:(next:BenchmarkStage)=>{if(!finished){close();stage=next;}},
   finish:(terminal_status:string)=>{
    if(finished)return;close();finished=true;
    try{this.options.sink({request_id:request,notebook_id:notebook,instance_boot_id:this.boot,revision:this.options.revision,terminal_status,readiness,stages,scope,fixture_hash:fixture?.fixture_hash??null,prompt_leakage_count:promptLeaks});}catch{/* Missing evidence invalidates acceptance; never change user publication. */}
   },
  };
 }
}
