import { PrivateBenchmarkBridge,PrivateClockBridge,OwnerPrivateDirectory,type PrivateBridgeObjects } from '@everlast/cloud/private-benchmark';
import { PrivateBridgeIdentitySchema,PrivateBridgePolicySchema,PrivateBridgeApprovalEnvelopeSchema,type PrivateBridgeBindingSchema } from '@everlast/contracts';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { resolveEnterpriseGeminiConfig } from '@everlast/cloud';
import { CodeExecutionPrivateEvidenceFileSchema, CodeExecutionPrivateMeasurementSchema, CodeExecutionRuntimeConfigSchema, type CodeExecutionPrivateEvidenceFile, type CodeExecutionRuntimeConfig, type CodeExecutionTrace, type SourceRevisionPair } from '@everlast/contracts';
import { randomUUID, createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { OperationalQualificationPlanSchema as OperationalPlanSchema, OPERATIONAL_PROVIDER_BUDGET } from '@everlast/contracts';
export { OPERATIONAL_PROVIDER_BUDGET } from '@everlast/contracts';
import { constants, closeSync, mkdirSync, openSync, fstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, fsyncSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { CanonicalScopeSchema, BenchmarkPrivateEvidenceSchema, type BenchmarkPrivateEvidence, type ReadinessEvidence, type ScopedCorpusManifest } from '@everlast/contracts';
import { buildScopedCorpusLedger, verifyScopeSnapshot, type CorpusTokenizer, type Pool, type ScopeSnapshot } from '@everlast/db';
export { classifyReadiness } from '@everlast/contracts';
export type { ReadinessEvidence } from '@everlast/contracts';
export type BenchmarkStage='admission'|'retrieval'|'generation'|'verification'|'publication';
export type PrivateStageRecord=BenchmarkPrivateEvidence;
export interface BenchmarkRecorderOptions {
 executionEvidence?: ExecutionEvidenceConfig|undefined;
 requiresClockBootstrap?: boolean;
 bridgeScaleFile?:string|undefined;
 sourceTreeSha256?:string|undefined;
 operationalConfigSha256?:string|undefined;
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
const ClockTemplateSchema = z.object({
 metadata: CodeExecutionPrivateEvidenceFileSchema.omit({measurements:true,clock_calibration_sha256:true}),
 runtime: CodeExecutionRuntimeConfigSchema,
 qualification: z.string().min(1).max(128000),
}).strict();
type ClockTemplate = z.infer<typeof ClockTemplateSchema>;
interface ClockBootstrapConfig { template: ClockTemplate; receiptPrivateKey: string; }
interface RemoteBenchmarkConfig {
 campaign_id: string;
 expiresAtMs: number;
 objects: PrivateBridgeObjects;
 policy?: z.infer<typeof PrivateBridgePolicySchema>;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checkExecutionConfig(config:ExecutionEvidenceConfig,revision:string){
 const meta=CodeExecutionPrivateEvidenceFileSchema.parse({...config.metadata,measurements:[]});
 const runtime=CodeExecutionRuntimeConfigSchema.parse(config.runtime),clock=config.calibration;
 if(meta.serving_revision!==revision||digest(runtime)!==meta.runtime_config_sha256||digest(clock)!==meta.clock_calibration_sha256||createHash('sha256').update(config.qualification).digest('hex')!==meta.qualification_sha256)throw new Error('Private execution provenance mismatch');
 if(!Number.isFinite(clock.offset_ms)||!Number.isFinite(clock.uncertainty_ms)||clock.uncertainty_ms<0||clock.uncertainty_ms>1000||!Number.isFinite(clock.measured_at_ms)||clock.measured_at_ms<0||clock.measured_at_ms+clock.offset_ms+clock.uncertainty_ms>Date.now()||!Number.isFinite(clock.expires_at_ms)||clock.expires_at_ms+clock.offset_ms-clock.uncertainty_ms<=Date.now()||typeof clock.measurement_id!=='string'||!clock.measurement_id||clock.measurement_id.length>200)throw new Error('Private execution calibration unavailable');
 readPrivateFile(config.file);return meta;
}
export interface OperationalCachePort {
 identity:string;
 create(input:{pages:import('@everlast/contracts').UnifiedDocumentChunk[][];signal:AbortSignal}):Promise<{handle:string;expiresAt:number}>;
 delete(handle:string):Promise<void>;
}
/** API-owned enterprise adapter; does not consume worker implementation through a legacy application import. */
export function createOperationalCacheFromEnv(env:NodeJS.ProcessEnv):OperationalCachePort{
 const {clientOptions,model}=resolveEnterpriseGeminiConfig('flash',env);
 const client=new GoogleGenAI({...clientOptions,httpOptions:{...clientOptions.httpOptions,timeout:30000,retryOptions:{attempts:1}}});
 return {identity:JSON.stringify({project:clientOptions.project,location:clientOptions.location,model}),
  create:async({pages,signal})=>{
   signal.throwIfAborted();const contents=[{role:'user',parts:pages.flatMap(page=>page.map(chunk=>({text:JSON.stringify({chunk_id:chunk.chunk_id,source_id:chunk.source_id,revision:chunk.revision,text:chunk.text})})))}];
   if(Buffer.byteLength(JSON.stringify(contents))>10000000)throw new Error('Operational cache native serialized byte cap exceeded');
   const counted=await client.models.countTokens({model,contents});signal.throwIfAborted();
   if(!Number.isSafeInteger(counted.totalTokens)||counted.totalTokens!<0||counted.totalTokens!+18000>1048576)throw new Error('Operational cache actual tokenizer envelope unavailable');
   const response=await client.caches.create({model,config:{contents,ttl:'60s'}});
   // Return any handle even after abort so the enclosing owner always attempts deletion; finite TTL bounds unknown outcomes.
   if(!response.name)throw new Error('Operational provider cache handle unavailable');
   return {handle:response.name,expiresAt:Date.parse(response.expireTime??'')};
  },
  delete:async handle=>{await client.caches.delete({name:handle});},
 };
}

export interface OperationalProbePorts {
 retrieval:(actor:{owner_id:string;notebook_id:string;sources:{source_id:string;revision:number}[];cache_sources?:{source_id:string;revision:number}[]|undefined},signal:AbortSignal)=>Promise<void>;
 model:OperationalProbePorts['retrieval'];cache:OperationalProbePorts['retrieval'];
 /** Read actual same-boot canonical managed lifecycle evidence; MUST NOT create another sandbox. */
 runtime_observation:OperationalProbePorts['retrieval'];
}
function requireEd25519Key(pem:string){try{return createPublicKey(pem).asymmetricKeyType==='ed25519';}catch{return false;}}
export class PrivateBenchmarkRecorder {
 readonly bootedAt=Date.now();
 private readonly options:BenchmarkRecorderOptions;private readonly approved:Set<string>;private readonly boot=randomUUID();private readonly clock:()=>number;private evidence:ReadinessEvidence;
 private readonly consumedOperationalIds=new Set<string>();
 private operationalExpiry:number|undefined;
 private bridgeBinding:z.infer<typeof PrivateBridgeBindingSchema>|undefined;
 private operationalGeneration=0;
 private operationalRunning=false;
 private operationalAbort:AbortController|undefined;
 private operationalActors:z.infer<typeof OperationalPlanSchema>['actors']|undefined;
 private invalidateOperational():void{
  this.evidence={...this.evidence,ready_at_ms:null,dependencies:{...this.evidence.dependencies,model:false,retrieval:false,cache:false}};
  this.operationalActors=undefined;
 }
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
 private clockGuard: (()=>void)|undefined;
 private hasCurrentClock(): boolean {
  if(!this.options.requiresClockBootstrap) return true;
  if(!this.clockGuard) return false;
  try {
   this.clockGuard();
   return true;
  } catch {
   this.clockGuard=undefined;
   this.failOperationalTransport();
   return false;
  }
 }

 /** Opens only the private clock exchange until an authenticated same-boot install commits. */
 startClockCoordinator(options: {
  directory: string;
  bootstrap: ClockBootstrapConfig;
  remote: RemoteBenchmarkConfig;
  candidate: string | undefined;
  runtime: CodeExecutionRuntimeConfig | undefined;
  ports: OperationalProbePorts;
 }): ()=>void {
  const {directory, bootstrap, remote, candidate, runtime, ports}=options;
  const {metadata, runtime: frozenRuntime, qualification}=bootstrap.template;
  if(!this.options.requiresClockBootstrap||this.options.executionEvidence||
     candidate!==metadata.candidate_commit||metadata.serving_revision!==this.options.revision||
     !runtime||digest(CodeExecutionRuntimeConfigSchema.parse(runtime))!==metadata.runtime_config_sha256||
     digest(frozenRuntime)!==metadata.runtime_config_sha256||
     createHash('sha256').update(qualification).digest('hex')!==metadata.qualification_sha256||
     digest([...this.approved].sort())!==digest([...metadata.approved_notebook_ids].sort())||
     !this.options.sourceTreeSha256||!this.options.operationalConfigSha256) {
   throw new Error('Private clock deployment template mismatch');
  }
  const identity=PrivateBridgeIdentitySchema.parse({
   campaign_id:remote.campaign_id,candidate_commit:candidate,
   serving_revision:this.options.revision,instance_boot_id:this.boot,
  });
  const files=new OwnerPrivateDirectory(directory);
  const publicKey=readPrivateFile(join(directory,'trusted-public-key.pem'));
  let stopOperational: (()=>void)|undefined;
  let closed=false;
  const bridge=new PrivateClockBridge({
   identity, objects:remote.objects, ownerPublicKey:publicKey,
   receiptPrivateKey:bootstrap.receiptPrivateKey, expiresAtMs:remote.expiresAtMs,
   configSha256:digest({template:bootstrap.template, source_tree_sha256:this.options.sourceTreeSha256,
    operational_config_sha256:this.options.operationalConfigSha256}),
   install:(proof,assertClockCurrent)=>{
    if(closed) throw new Error('Private clock coordinator closed');
    const config: ExecutionEvidenceConfig={
     file:join(directory,'code.json'),metadata:{...metadata,clock_calibration_sha256:digest(proof.calibration)},
     runtime:frozenRuntime, qualification, calibration:proof.calibration,
    };
    checkExecutionConfig(config,this.options.revision);
    assertClockCurrent();
    files.write('clock-proof.json',JSON.stringify(proof));
    assertClockCurrent();
    this.options.executionEvidence=config;
    this.clockGuard=assertClockCurrent;
    return ()=>{
     if(closed)throw new Error('Private clock coordinator closed');
     try {
      stopOperational=this.startOperationalCoordinator(directory,ports,remote);
     } catch(error) {
      this.failOperationalTransport();
      throw error;
     }
    };
   },
  });
  const tick=async()=>{
   try { await bridge.tick(); } catch { /* Keep the unqualified state. The exchange bounds retries. */ }
   if(bridge.stopped) clearInterval(timer);
  };
  const timer=setInterval(()=>void tick(),500);
  timer.unref();
  void tick();
  return ()=>{
   closed=true;
   clearInterval(timer);
   bridge.close();
   stopOperational?.();
   this.clockGuard=undefined;
   this.failOperationalTransport();
  };
 }

 /** Only current in-process probe evidence can open collection; object construction never qualifies it. */
 beginExecution(input:{notebook_id:string;owner_id:string;request_id:string;source_snapshot:SourceRevisionPair[]}){
  const config=this.options.executionEvidence,readiness=this.readiness();
  if(!config||!this.approved.has(input.notebook_id)||!config.metadata.approved_notebook_ids.includes(input.notebook_id))return undefined;
  // This recorder observes application qualification. A distinct provider timestamp is required for managed-runtime readiness.
  if(config.metadata.classification_basis!=='application-serving-readiness')return undefined;
  try{checkExecutionConfig(config,this.options.revision);}catch{return undefined;}
  if(readiness.ready_at_ms===null||!Object.values(readiness.dependencies).every(Boolean))return undefined;
  const actor=this.operationalActors?.find(actor=>actor.notebook_id===input.notebook_id);
  if(this.operationalActors&&(!actor||actor.owner_id!==input.owner_id||JSON.stringify(actor.sources)!==JSON.stringify(input.source_snapshot)))return undefined;
  const qualifiedAt=readiness.ready_at_ms,operationalGeneration=this.operationalGeneration,times:{sandbox_created_at:string|null;running_code_at:string|null;execution_completed_at:string|null}={sandbox_created_at:null,running_code_at:null,execution_completed_at:null};
  let finished=false;
  return {
   timing:(event:{phase:keyof typeof times;at:string})=>{if(finished)return;if(event.phase==='execution_completed_at')times.execution_completed_at=event.at;else times[event.phase]??=event.at;},
   finish:(trace:CodeExecutionTrace,publishedAt:string|null)=>{
    if(finished)return;finished=true;
    try{
     const current=this.readiness();
     if(current.ready_at_ms!==qualifiedAt||!Object.values(current.dependencies).every(Boolean)||this.operationalGeneration!==operationalGeneration)return;
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
 /** Identity binding for the canonical controller's existing durable lifecycle, not provider proof. */
 executionIdentity(notebookId?:string){if(!this.hasCurrentClock())return undefined;const config=this.options.executionEvidence;if(notebookId&&(!this.approved.has(notebookId)||!config?.metadata.approved_notebook_ids.includes(notebookId)))return undefined;return config?{instance_boot_id:this.boot,candidate_commit:config.metadata.candidate_commit,runtime_config_sha256:config.metadata.runtime_config_sha256}:undefined;}
 /** Fixed private channel. The trust root is loaded independently from the owner-controlled directory, never the signed payload. */
 startOperationalCoordinator(directory:string,ports:OperationalProbePorts,remote?:RemoteBenchmarkConfig):()=>void{
  if(!isAbsolute(directory))throw new Error('Private operational directory must be absolute');
  const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw new Error('Private operational directory permissions invalid');
  const file=(name:string)=>directory+'/'+name;
  const publicKey=readPrivateFile(file('trusted-public-key.pem'));
  const key=(requireEd25519Key(publicKey));if(!key)throw new Error('Operational trust root must be Ed25519');
  const identity=this.executionIdentity();
  if(!identity||!this.options.sourceTreeSha256||!this.options.operationalConfigSha256)throw new Error('Measured source/candidate/runtime identity unavailable');
  writePrivateAtomic(file('challenge.json'),JSON.stringify({...identity,fixture_sha256:this.options.executionEvidence!.metadata.fixture_sha256,clock_calibration_sha256:this.options.executionEvidence!.metadata.clock_calibration_sha256,qualification_sha256:this.options.executionEvidence!.metadata.qualification_sha256,classification_basis:this.options.executionEvidence!.metadata.classification_basis,revision:this.options.revision,provider_budget:OPERATIONAL_PROVIDER_BUDGET,source_tree_sha256:this.options.sourceTreeSha256,operational_config_sha256:this.options.operationalConfigSha256,approved_notebook_ids:[...this.approved]})+'\n');
  const privateFiles=new OwnerPrivateDirectory(directory);
  let bridge:PrivateBenchmarkBridge|undefined;
  if(remote){
   const remoteIdentity=PrivateBridgeIdentitySchema.parse({campaign_id:remote.campaign_id,candidate_commit:identity.candidate_commit,serving_revision:this.options.revision,instance_boot_id:identity.instance_boot_id});
   bridge=new PrivateBenchmarkBridge({identity:remoteIdentity,expiresAtMs:remote.expiresAtMs,objects:remote.objects,publicKey,...(remote.policy?{policy:remote.policy}:{}),onFailure:()=>this.failOperationalTransport(),files:{
    read:async kind=>{const name=kind==='outcomes'?'observations.json':kind==='scale'?undefined:kind+'.json';const raw=kind==='code'?readPrivateFile(this.options.executionEvidence!.file):kind==='scale'?(this.options.bridgeScaleFile?readPrivateFile(this.options.bridgeScaleFile):''):privateFiles.read(name!)?.toString();if(!raw)return null;return kind==='scale'?raw.trim().split('\n').filter(Boolean).map(row=>JSON.parse(row)):JSON.parse(raw);},
    accept:async(payload,signature,binding)=>{this.bridgeBinding=binding;privateFiles.write('delivered.json',JSON.stringify({schema:'everlast.private-approval/1',payload,signature}));},
    record:async event=>{const prior=privateFiles.read('transport.json');const rows:unknown[]=prior?JSON.parse(prior.toString()):[];if(!Array.isArray(rows)||rows.length>=100)throw new Error('Private transport retention exhausted');privateFiles.write('transport.json',JSON.stringify([...rows,event]));},
   }});
  }
  let previous='',busy=false,closed=false,bridgeBusy=false;
  const bridgePoll=async()=>{if(!bridge||closed||bridgeBusy)return;bridgeBusy=true;try{await bridge.tick();}catch{this.failOperationalTransport();}finally{bridgeBusy=false;}};

  const poll=async()=>{
   this.readiness();if(closed||busy)return;busy=true;
   try{
    const delivered=remote?privateFiles.read('delivered.json'):null;const envelope=delivered?PrivateBridgeApprovalEnvelopeSchema.parse(JSON.parse(delivered.toString())):null;
    const payload=remote?envelope?.payload??'':readPrivateFile(file('authorization.json')),signature=remote?envelope?.signature??'':readPrivateFile(file('authorization.sig')).trim();
    if(!payload||!signature)return;
    const hash=digest({payload,signature});if(hash===previous)return;previous=hash;
    const prior=readPrivateFile(file('observations.json'));const observations:unknown[]=prior?JSON.parse(prior):[];if(!Array.isArray(observations)||observations.length>=100)throw new Error('Operational observation retention capacity exceeded');
    const success=await this.refreshOperational({payload,signature,publicKey,ports});
    const observation={authorization_sha256:hash,result:success?'OBSERVED_READY':'UNAVAILABLE',observed_at:Date.now(),readiness:this.readiness(),release_eligible:false};
    if(!closed){writePrivateAtomic(file('observations.json'),JSON.stringify([...observations,observation])+'\n');writePrivateAtomic(file('status.json'),JSON.stringify(observation)+'\n');}
   }catch{this.invalidateOperational();}finally{busy=false;}
  };
  const timer=setInterval(()=>{void poll();void bridgePoll();},1000);timer.unref();void poll();void bridgePoll();
  return ()=>{closed=true;bridge?.close();clearInterval(timer);this.operationalGeneration++;this.operationalAbort?.abort();this.invalidateOperational();};
 }
 /** Private in-process workflow: a signature authorizes effects, never substitutes for their actual observation. */
 failOperationalTransport(){this.operationalGeneration++;this.operationalAbort?.abort();this.invalidateOperational();}
 async refreshOperational(input:{payload:string;signature:string;publicKey:string;ports:OperationalProbePorts}):Promise<boolean>{
  const generation=++this.operationalGeneration;
  this.invalidateOperational();
  if(this.operationalRunning||!this.hasCurrentClock())return false;
  let plan:z.infer<typeof OperationalPlanSchema>;
  try{
   if(Buffer.byteLength(input.payload)>128000||input.signature.length>1024||input.publicKey.length>8192)return false;
   const key=(await import('node:crypto')).createPublicKey(input.publicKey);
   if(key.asymmetricKeyType!=='ed25519'||!verifySignature(null,Buffer.from(input.payload),key,Buffer.from(input.signature,'base64')))return false;
   plan=OperationalPlanSchema.parse(JSON.parse(input.payload));
   if(this.bridgeBinding&&JSON.stringify(plan.bridge)!==JSON.stringify(this.bridgeBinding))return false;
   const now=Date.now();
   if(plan.instance_boot_id!==this.boot||plan.revision!==this.options.revision||plan.issued_at>now||plan.expires_at<=now||plan.expires_at-plan.issued_at>900000||plan.issued_at<now-900000)return false;
   if(this.consumedOperationalIds.has(plan.id)||this.consumedOperationalIds.size>=100)return false;
   if(new Set(plan.actors.map(a=>a.owner_id)).size!==2||new Set(plan.actors.map(a=>a.notebook_id)).size!==2||plan.actors.some(a=>!this.approved.has(a.notebook_id)))return false;
   const sourceIds=plan.actors.flatMap(a=>a.sources.map(s=>s.source_id));if(new Set(sourceIds).size!==sourceIds.length)return false;
   if(this.options.operationalConfigSha256&&!plan.provider_budget)return false;
   if(this.options.operationalConfigSha256&&plan.operational_config_sha256!==this.options.operationalConfigSha256)return false;
   if(this.options.sourceTreeSha256&&plan.source_tree_sha256!==this.options.sourceTreeSha256)return false;
   const config=this.options.executionEvidence;
   if(config){
    const meta=checkExecutionConfig(config,this.options.revision);
    for(const name of ['classification_basis','candidate_commit','fixture_sha256','runtime_config_sha256','clock_calibration_sha256','qualification_sha256'] as const)if(plan[name]!==meta[name])return false;
    if(plan.actors.some(a=>!meta.approved_notebook_ids.includes(a.notebook_id)))return false;
   }
   if(!this.evidence.dependencies.sql||!this.evidence.dependencies.migrations||!this.evidence.dependencies.recovery)return false;
   if(plan.operations.some(name=>typeof input.ports[name]!=='function'))return false;
  }catch{return false;}
  // Consume before the first effect, including failed/timed-out effects. No favorable replacement attempts.
  this.consumedOperationalIds.add(plan.id);this.operationalRunning=true;
  const controller=new AbortController();this.operationalAbort=controller;let timer:ReturnType<typeof setTimeout>|undefined;
  const clock=this.options.requiresClockBootstrap?this.options.executionEvidence?.calibration:undefined;
  const clockDeadline=clock?clock.expires_at_ms+clock.offset_ms-clock.uncertainty_ms:Infinity;
  const timeout=Math.min(plan.timeout_ms,plan.expires_at-Date.now(),clockDeadline-Date.now());
  if(timeout<=0){this.operationalRunning=false;return false;}
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Operational probe timeout'));},timeout);});
  const run=async()=>{for(const actor of plan.actors){controller.signal.throwIfAborted();if(!this.hasCurrentClock())throw new Error('Private clock expired');await input.ports.runtime_observation(structuredClone(actor),controller.signal);}for(const actor of plan.actors)for(const operation of ['retrieval','model','cache'] as const){controller.signal.throwIfAborted();if(!this.hasCurrentClock())throw new Error('Private clock expired');await input.ports[operation](structuredClone(actor),controller.signal);}};
  try{
   const actual=run();
   void actual.then(()=>{this.operationalRunning=false;},()=>{this.operationalRunning=false;});
   await Promise.race([actual,deadline]);
   if(controller.signal.aborted||generation!==this.operationalGeneration||Date.now()>=plan.expires_at||!this.hasCurrentClock())return false;
   this.operationalExpiry=plan.expires_at;this.operationalActors=structuredClone(plan.actors);
   this.qualify({dependencies:{...this.evidence.dependencies,model:true,retrieval:true,cache:true},ready_at_ms:Date.now()});
   return true;
  }catch{return false;}
  finally{controller.abort();clearTimeout(timer);}
 }
 readiness():ReadinessEvidence{
  if(!this.hasCurrentClock()||(this.operationalExpiry!==undefined&&Date.now()>=this.operationalExpiry))this.invalidateOperational();
  return structuredClone(this.evidence);
 }
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
    try{this.options.sink({request_id:request,notebook_id:notebook,instance_boot_id:this.boot,revision:this.options.revision,terminal_status,readiness:this.hasCurrentClock()?readiness:this.readiness(),stages,scope,fixture_hash:fixture?.fixture_hash??null,prompt_leakage_count:promptLeaks});}catch{/* Missing evidence invalidates acceptance; never change user publication. */}
   },
  };
 }
}

/** Cloud Run bootstrap adapter: trusted deployment inputs become an owned ephemeral private channel.
 * Public keys/config are pinned separately from bucket-delivered owner authorizations. */
export function preparePrivateBridgeEnvironment(original:NodeJS.ProcessEnv):{env:NodeJS.ProcessEnv;cleanup:()=>void;clock?:ClockBootstrapConfig}{
 const clockMode=original.BENCHMARK_BRIDGE_CLOCK_BOOTSTRAP;
 if(clockMode!==undefined&&clockMode!=='true'&&clockMode!=='false')throw new Error('Invalid private clock mode');
 if(original.BENCHMARK_BRIDGE_ENABLED!=='true'){
  if(clockMode==='true')throw new Error('Private clock requires the explicitly enabled bridge');
  return {env:original,cleanup:()=>{}};
 }
 if(original.BENCHMARK_OPERATIONAL_DIRECTORY||!original.BENCHMARK_BRIDGE_CAMPAIGN_ID||!original.BENCHMARK_BRIDGE_EXPIRES_AT_MS||!original.BENCHMARK_BRIDGE_PUBLIC_KEY||!original.BENCHMARK_BRIDGE_EXECUTION_CONFIG||!original.BENCHMARK_APPROVED_NOTEBOOKS)throw new Error('Private bridge trusted bootstrap incomplete');
 const expires=Number(original.BENCHMARK_BRIDGE_EXPIRES_AT_MS);if(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+3600000)throw new Error('Private deployment window invalid/expired');
 if(!requireEd25519Key(original.BENCHMARK_BRIDGE_PUBLIC_KEY))throw new Error('Invalid private bridge trust root');
 if(Buffer.byteLength(original.BENCHMARK_BRIDGE_EXECUTION_CONFIG)>128000)throw new Error('Private bridge config too large');
 const config=JSON.parse(original.BENCHMARK_BRIDGE_EXECUTION_CONFIG) as unknown;
 const receiptPrivateKey=original.BENCHMARK_BRIDGE_CLOCK_RECEIPT_PRIVATE_KEY;
 if(clockMode==='true'&&!receiptPrivateKey)throw new Error('Private clock receipt signing capability unavailable');
 const clock=clockMode==='true'?{template:ClockTemplateSchema.parse(config),receiptPrivateKey:receiptPrivateKey!}:undefined;
 const root=mkdtempSync(join(tmpdir(),'everlast-private-')),files=new OwnerPrivateDirectory(root);
 try {
  files.write('trusted-public-key.pem',original.BENCHMARK_BRIDGE_PUBLIC_KEY);
  const env:NodeJS.ProcessEnv={...original,BENCHMARK_OPERATIONAL_DIRECTORY:root,BENCHMARK_EVIDENCE_FILE:join(root,'scale.jsonl')};
  delete env.BENCHMARK_BRIDGE_CLOCK_RECEIPT_PRIVATE_KEY;
  if(clock) {
   delete env.BENCHMARK_EXECUTION_CONFIG_FILE;
  } else {
   files.write('execution-config.json',JSON.stringify({...config as object,file:join(root,'code.json')}));
   env.BENCHMARK_EXECUTION_CONFIG_FILE=join(root,'execution-config.json');
  }
  if(original.BENCHMARK_BRIDGE_FIXTURES){
   files.write('fixtures.json',original.BENCHMARK_BRIDGE_FIXTURES);
   env.BENCHMARK_FIXTURES_FILE=join(root,'fixtures.json');
  }
  return {env,cleanup:()=>rmSync(root,{recursive:true,force:true}),...(clock?{clock}:{})};
 } catch(error) {
  rmSync(root,{recursive:true,force:true});
  throw error;
 }
}
