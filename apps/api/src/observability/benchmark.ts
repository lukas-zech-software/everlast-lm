import { randomUUID } from 'node:crypto';
/** NFR-PERF-01, D17: private evidence never infers warmth from latency or SQL-only health. */
export interface ReadinessEvidence {
 instance_boot_id:string;revision:string;ready_at_ms:number|null;
 dependencies:{sql:boolean;model:boolean;retrieval:boolean;cache:boolean;migrations:boolean;recovery:boolean};
}
export function classifyReadiness(evidence:ReadinessEvidence,request:{instance_boot_id:string;revision:string;client_submission_epoch_ms:number;clock_uncertainty_ms:number}):'warm'|'wake'|'invalid_environment'{
 const {clock_uncertainty_ms:u,client_submission_epoch_ms:t}=request;
 if(evidence.instance_boot_id!==request.instance_boot_id || evidence.revision!==request.revision || !Number.isFinite(u) || u<0 || !Number.isFinite(t)
  || evidence.ready_at_ms===null || !Number.isFinite(evidence.ready_at_ms) || !Object.values(evidence.dependencies).every(v=>v===true)) return 'invalid_environment';
 if(evidence.ready_at_ms<t-u) return 'warm';
 if(evidence.ready_at_ms>t+u) return 'wake';
 return 'invalid_environment';
}
export type BenchmarkStage='admission'|'retrieval'|'generation'|'verification'|'publication';
export interface PrivateStageRecord {
 request_id:string;instance_boot_id:string;revision:string;terminal_status:string;
 readiness:ReadinessEvidence;stages:Partial<Record<BenchmarkStage,number>>;
}
export interface BenchmarkRecorderOptions {approved_notebook_ids:string[];revision:string;sink:(record:PrivateStageRecord)=>void;clock?:()=>number}
export class PrivateBenchmarkRecorder {
 private readonly options:BenchmarkRecorderOptions;
 private readonly approved:Set<string>;
 private readonly boot=randomUUID();
 private readonly clock:()=>number;
 private evidence:ReadinessEvidence;
 constructor(options:BenchmarkRecorderOptions){
  this.options=options;
  this.approved=new Set(options.approved_notebook_ids);this.clock=options.clock??(()=>performance.now());
  this.evidence={instance_boot_id:this.boot,revision:options.revision,ready_at_ms:null,dependencies:{sql:false,model:false,retrieval:false,cache:false,migrations:false,recovery:false}};
 }
 readiness():ReadinessEvidence{return structuredClone(this.evidence);}
 /** Only a trusted in-process dependency qualifier may supply this; never a public request field. */
 qualify(input:Omit<ReadinessEvidence,'instance_boot_id'|'revision'>):void{
  if(input.ready_at_ms!==null && !Number.isFinite(input.ready_at_ms)) throw new Error('Invalid readiness timestamp');
  this.evidence={...structuredClone(input),instance_boot_id:this.boot,revision:this.options.revision};
 }
 begin(notebook:string,request:string){
  if(!this.approved.has(notebook)) return undefined;
  const readiness=this.readiness();let start=this.clock(),stage:BenchmarkStage='admission',finished=false;
  const stages:Partial<Record<BenchmarkStage,number>>={};
  const close=()=>{const now=this.clock();stages[stage]=(stages[stage]??0)+Math.max(0,now-start);start=now;};
  return {
   stage:(next:BenchmarkStage)=>{if(!finished){close();stage=next;}},
   finish:(terminal_status:string)=>{
    if(finished)return;close();finished=true;
    // Sink failures must not change user publication or leak source content through logs.
    try{this.options.sink({request_id:request,instance_boot_id:this.boot,revision:this.options.revision,terminal_status,readiness,stages});}catch{/* Evidence unavailable; never manufacture a record. */}
   },
  };
 }
}
