import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { CodeExecutionPrivateMeasurementSchema, CodeExecutionTraceSchema } from "@everlast/contracts";
import { collectCodeExecutionCohorts, type CollectionManifest, type CollectionPorts, type CollectionSubmission } from "../src/code-execution-collector.ts";
import { COHORT_NAMES, type CodeExecutionBenchmarkPlan } from "../src/code-execution-performance.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const start = Date.parse("2026-11-10T12:00:00.000Z");
const plan: CodeExecutionBenchmarkPlan = {fixture:{id:"fixture",version:1,sha256:"a".repeat(64),question:"Calculate the population deviation."},provider:{service:"aiplatform.googleapis.com/AgentEngineSandbox",region:"europe-west4",cpu:"2 vCPU",memory:"1.5 GB"},environment:"test-double",declaredAt:new Date(start-100).toISOString(),cohorts:Object.fromEntries(COHORT_NAMES.map(c=>[c,{repetitions:20,warm:c.startsWith("warm"),concurrency:c.endsWith("2u")?2:1}])) as CodeExecutionBenchmarkPlan["cohorts"]};
const manifest: CollectionManifest = {actors:[1,2].map(n=>({owner_id:id(n),notebook_id:id(n+10),source_snapshot:[{source_id:id(n+20),revision:1}],expected_citation_chunk_ids:[id(n+30)]})) as CollectionManifest["actors"],api_base_url:"http://127.0.0.1",candidate_commit:"d".repeat(40),serving_revision:"candidate-v1",classification_basis:"application-serving-readiness",qualification_sha256:"c".repeat(64),runtime_config_sha256:"e".repeat(64),clock_calibration:{offset_ms:0,uncertainty_ms:0,measured_at_ms:start-200,expires_at_ms:start+10000,measurement_id:"synthetic-clock"},clock_calibration_sha256:hash({offset_ms:0,uncertainty_ms:0,measured_at_ms:start-200,expires_at_ms:start+10000,measurement_id:"synthetic-clock"}),expected_result:"1.5",max_total_requests:80};
function fixture(options:{missing?:boolean;wrongOwner?:boolean;throwTransport?:boolean;posthoc?:boolean;errorEvent?:boolean;publicationFailure?:boolean;unknownRetry?:boolean;reuseIdentity?:"execution"|"attempt";manifest?:CollectionManifest;mutate?:(e:any)=>void}={}) {
  const frozen=options.manifest??manifest,serverStart=start+frozen.clock_calibration.offset_ms;
  let count=0, active=0,maxActive=0;
  const evidence=new Map<string,unknown>();
  const ports: CollectionPorts = {now:()=>start,requestId:randomUUID,
    async submit(s:CollectionSubmission) {
      const ordinal=count++;active++;maxActive=Math.max(maxActive,active);
      await new Promise(resolve=>setTimeout(resolve,0));active--;
      if(options.throwTransport && ordinal===0)throw new Error("PRIVATE_TOKEN");
      const warm=Math.floor(ordinal/20)%2===1;
      const attemptId=options.reuseIdentity==="attempt"?id(888):randomUUID();
      const trace=CodeExecutionTraceSchema.parse({schema_version:1,execution_id:options.reuseIdentity==="execution"?id(999):randomUUID(),state:options.errorEvent?"TimedOut":"Succeeded",attempts:[{attempt_id:attemptId,ordinal:1,code:"pass",stdout:"",stderr:"",exit_code:options.errorEvent?null:0,started_at:new Date(serverStart+3).toISOString(),ended_at:new Date(serverStart+15).toISOString(),terminal_reason:options.errorEvent?"ExecutionTimeout":"Succeeded",artifacts:[]}],final_attempt_id:attemptId,published_artifact_ids:[],failure_code:options.errorEvent?"ExecutionTimeout":null,computed_results:options.errorEvent?[]:[{label:"Deviation",value:"1.5",unit:null,citations:s.actor.expected_citation_chunk_ids}]});
      if(options.publicationFailure){trace.state="Failed";trace.failure_code="ScopeChanged";trace.computed_results=[];}
      if(options.unknownRetry){
        trace.state="Failed";trace.failure_code="ExecutionOutcomeUnknown";trace.computed_results=[];
        trace.attempts[0]!.terminal_reason="PythonException";trace.attempts[0]!.exit_code=1;
        const second={...trace.attempts[0]!,attempt_id:randomUUID(),ordinal:2 as const,started_at:new Date(serverStart+16).toISOString(),ended_at:null,exit_code:null,terminal_reason:null};
        trace.attempts.push(second);trace.final_attempt_id=second.attempt_id;
      }
      CodeExecutionTraceSchema.parse(trace);
      evidence.set(s.request_id,{schema_version:1,request_id:s.request_id,notebook_id:s.actor.notebook_id,owner_id:options.wrongOwner?id(1):s.actor.owner_id,execution_id:trace.execution_id,fixture_sha256:plan.fixture.sha256,source_snapshot:s.actor.source_snapshot,instance_boot_id:id(99),candidate_commit:frozen.candidate_commit,serving_revision:frozen.serving_revision,classification_basis:frozen.classification_basis,qualification_sha256:"c".repeat(64),runtime_config_sha256:"e".repeat(64),clock_calibration_sha256:frozen.clock_calibration_sha256,execution_state:trace.state,failure_code:trace.failure_code,attempts:trace.attempts.map(a=>({attempt_id:a.attempt_id,ordinal:a.ordinal,started_at:a.started_at,ended_at:a.ended_at,terminal_reason:a.terminal_reason})),qualified:true,ready_at_ms:warm?serverStart-10:serverStart+2,qualified_at_ms:options.posthoc?serverStart+10:warm?serverStart-9:serverStart+2,sandbox_created_at:new Date(serverStart+3).toISOString(),running_code_at:new Date(serverStart+6).toISOString(),execution_completed_at:options.unknownRetry?null:new Date(serverStart+15).toISOString(),answer_published_at:options.unknownRetry?null:new Date(serverStart+18).toISOString(),trace_sha256:hash(trace)});
      options.mutate?.(evidence.get(s.request_id));
      return {terminal:options.errorEvent||options.publicationFailure||options.unknownRetry?"error" as const:"final" as const,client_running_ms:10,client_final_ms:20,running_execution_id:trace.execution_id,trace:options.errorEvent||options.publicationFailure||options.unknownRetry?null:trace,cited_chunk_ids:s.actor.expected_citation_chunk_ids};
    }, async measurement(request) {return options.missing?null:evidence.get(request);}};
  return {ports,counts:()=>({count,maxActive})};
}
it("collects all four declared cohorts through the port and actually overlaps paired owners",async()=>{
  const f=fixture();const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.attempts).toHaveLength(80);expect(r.observations).toHaveLength(80);expect(r.status).toBe("PASS");
  expect(f.counts()).toEqual({count:80,maxActive:2});
});
it("retains all requests when private evidence is missing instead of inferring warmth",async()=>{
  const f=fixture({missing:true});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.attempts).toHaveLength(1);expect(r.status).toBe("UNAVAILABLE");
});
it("rejects a paired credential that resolves to the same actual owner",async()=>{
  const f=fixture({wrongOwner:true});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.status).toBe("UNAVAILABLE");expect(r.attempts.some(a=>a.diagnostic==="evidence_mismatch")).toBe(true);
});
it("retains transport errors without leaking provider text or selecting replacement successes",async()=>{
  const f=fixture({throwTransport:true});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.attempts).toHaveLength(1);expect(r.status).not.toBe("PASS");expect(JSON.stringify(r)).not.toContain("PRIVATE_TOKEN");
});
it("does not qualify warm samples from post-hoc readiness",async()=>{
  const f=fixture({posthoc:true});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.status).toBe("UNAVAILABLE");
});
it("keeps the private producer schema strict and content-free",()=>{
  expect(CodeExecutionPrivateMeasurementSchema.safeParse({schema_version:1,token:"PRIVATE_TOKEN"}).success).toBe(false);
});

it("retains proven timed-out execution from an SSE error as failure, not unavailable",async()=>{
 const f=fixture({errorEvent:true});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
 expect(r.status).toBe("FAIL");expect(r.observations).toHaveLength(80);expect(r.observations.every(o=>o.outcome==="timed_out")).toBe(true);
});
it("binds expected qualification and retained calibration evidence",async()=>{
 for(const field of ["qualification_sha256","runtime_config_sha256","clock_calibration_sha256"]){
  const f=fixture({mutate:e=>{e[field]="d".repeat(64);}});
  const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);expect(r.status).toBe("UNAVAILABLE");expect(r.attempts[0]!.diagnostic).toBe("evidence_mismatch");
 }
 await expect(collectCodeExecutionCohorts(plan,{...manifest,clock_calibration_sha256:"0".repeat(64)},fixture().ports)).rejects.toThrow(/calibration/);
 const good=await collectCodeExecutionCohorts(plan,manifest,fixture().ports);expect(good.provenance.clock_calibration).toEqual(manifest.clock_calibration);
});
it("enforces a hard deadline for unresponsive transport or evidence ports",async()=>{
 const never=()=>new Promise<never>(()=>{});
 for(const which of ["submit","measurement"] as const){
  const f=fixture();const r=await collectCodeExecutionCohorts(plan,manifest,{...f.ports,[which]:never,deadlineMs:10});
  expect(r.status).toBe("UNAVAILABLE");expect(r.attempts).toHaveLength(1);expect(r.attempts[0]!.diagnostic).toBe("deadline");
 }
});
it("rejects reused execution and attempt identities and private timing beyond the bound trace",async()=>{
 for(const mutate of [(e:any)=>{e.execution_id=id(999);},(e:any)=>{e.attempts[0].attempt_id=id(888);},(e:any)=>{e.execution_completed_at=new Date(start+100).toISOString();}]){
  const f=fixture({mutate});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.status).toBe("UNAVAILABLE");expect(r.attempts.some(a=>a.diagnostic!==null)).toBe(true);
 }
});
it("retains slow client status receipt even when server execution is fast",async()=>{
 const f=fixture();const submit=f.ports.submit;
 f.ports.submit=async(...args)=>({...await submit(...args),client_running_ms:3000,client_final_ms:3001});
 const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);expect(r.status).toBe("FAIL");expect(r.report.cohorts.cold_1u.runningCodeMaxMs).toBe(3000);
});

it("does not reuse a previously observed execution or actual attempt across requests",async()=>{
 for(const reuseIdentity of ["execution","attempt"] as const){
  const f=fixture({reuseIdentity});const r=await collectCodeExecutionCohorts(plan,manifest,f.ports);
  expect(r.status).toBe("UNAVAILABLE");expect(r.attempts).toHaveLength(2);expect(r.attempts[1]!.diagnostic).toBe("identity_reused");
 }
});
it("refuses invalid scope and approved call budget before any transport",async()=>{
 const f=fixture();
 await expect(collectCodeExecutionCohorts(plan,{...manifest,actors:[manifest.actors[0],manifest.actors[0]]},f.ports)).rejects.toThrow(/distinct/);
 await expect(collectCodeExecutionCohorts({...plan,cohorts:{...plan.cohorts,cold_1u:{...plan.cohorts.cold_1u,repetitions:21}}},manifest,f.ports)).rejects.toThrow(/bound/);
 expect(f.counts().count).toBe(0);
});

it("normalizes measured server clock offsets without moving the client submission clock",async()=>{
 for(const offset_ms of [-1000,1000]){
  const clock_calibration={...manifest.clock_calibration,offset_ms};
  const frozen={...manifest,clock_calibration,clock_calibration_sha256:hash(clock_calibration)};
  const r=await collectCodeExecutionCohorts(plan,frozen,fixture({manifest:frozen}).ports);
  expect(r.status).toBe("PASS");expect(r.observations[0]!.submittedAt).toBe(new Date(start).toISOString());
  expect(r.observations[0]!.sandboxCreatedAt).toBe(new Date(start+3).toISOString());
  expect(r.provenance.clock_calibration.offset_ms).toBe(offset_ms);
 }
});

it("retains publication-fence failures and unknown retry completion without fabricating timings",async()=>{
 for(const options of [{publicationFailure:true},{unknownRetry:true}]){
  const r=await collectCodeExecutionCohorts(plan,manifest,fixture(options).ports);
  expect(r.status).toBe("FAIL");expect(r.observations).toHaveLength(80);
  expect(r.observations.every(o=>o.outcome==="failed")).toBe(true);
  if(options.unknownRetry){expect(r.observations[0]!.attempts).toBe(2);expect(r.observations[0]!.retryEndToEndMs).toBeNull();}
 }
});

/** [010-code-execution-sandbox] T065 — FR-GC-08, NFR-PERF-01. */
it("retains malformed receipts as unavailable evidence instead of rejecting the entire campaign", async () => {
  const f = fixture();
  const submit = f.ports.submit;
  f.ports.submit = async (...args) => {
    await submit(...args);
    return null as unknown as Awaited<ReturnType<CollectionPorts["submit"]>>;
  };
  const result = await collectCodeExecutionCohorts(plan, manifest, f.ports);
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0]?.diagnostic).toBe("receipt_invalid");
  expect(result.report.cohorts.cold_1u.declaredRepetitions).toBe(20);
});

it("retains private observations beyond conservative clock expiry without qualifying them (NFR-PERF-01)", async () => {
  const clock = { ...manifest.clock_calibration, uncertainty_ms: 1, expires_at_ms: start + 19 };
  const frozen = { ...manifest, clock_calibration: clock, clock_calibration_sha256: hash(clock) };
  const f = fixture({ manifest: frozen });
  const result = await collectCodeExecutionCohorts(plan, frozen, f.ports);
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.observations).toHaveLength(0);
  expect(result.attempts[0]).toMatchObject({
    diagnostic: "clock_invalid",
    measurement: { answer_published_at: new Date(start + 18).toISOString() },
  });
  expect(f.counts().count).toBe(1);
});

it("stops after private evidence receipt crosses expiry and retains an already proven failure (FR-GC-08, NFR-PERF-01)", async () => {
  const f = fixture({ errorEvent: true });
  const measurement = f.ports.measurement;
  let now = start;
  let count = 0;
  f.ports.now = () => now;
  f.ports.measurement = async (...args) => {
    if (++count === 2) now = manifest.clock_calibration.expires_at_ms;
    return measurement(...args);
  };
  const result = await collectCodeExecutionCohorts(plan, manifest, f.ports);
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[1]).toMatchObject({ diagnostic: "clock_invalid", measurement: { execution_state: "TimedOut" } });
  expect(result.report.cohorts.cold_1u).toMatchObject({
    declaredRepetitions: 20,
    observedSamples: 1,
    failedSamples: [{ sampleIndex: 1, outcome: "timed_out" }],
    status: "UNAVAILABLE",
  });
});

it("checks the integrated continuity guard before submission and after private evidence (NFR-PERF-01)", async () => {
  const f = fixture();
  const checks: [Readonly<CollectionManifest["clock_calibration"]>, string | undefined][] = [];
  const ports = {
    ...f.ports,
    assertClockCurrent(calibration: Readonly<CollectionManifest["clock_calibration"]>, instanceBootId?: string) {
      checks.push([calibration, instanceBootId]);
      if (checks.length === 2) throw new Error("private proof invalidated");
    },
  };
  const result = await collectCodeExecutionCohorts(plan, manifest, ports);
  expect(checks).toEqual([[manifest.clock_calibration, undefined], [manifest.clock_calibration, id(99)]]);
  expect(result.status).toBe("UNAVAILABLE");
  expect(f.counts().count).toBe(1);
  expect(result.attempts[0]).toMatchObject({ diagnostic: "clock_invalid", measurement: { execution_state: "Succeeded" } });
  expect(JSON.stringify(result)).not.toContain("private proof invalidated");
});

it("retains the concurrent Owner's observation when its peer is missing (FR-GC-08, NFR-PERF-01)", async () => {
  const f = fixture();
  const measurement = f.ports.measurement;
  let calls = 0;
  f.ports.measurement = async (...args) => ++calls === 41 ? null : measurement(...args);
  const result = await collectCodeExecutionCohorts(plan, manifest, f.ports);
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.attempts).toHaveLength(42);
  const pair = result.attempts.slice(-2);
  expect(pair.map(sample => sample.owner_id)).toEqual(manifest.actors.map(actor => actor.owner_id));
  expect(pair.map(sample => sample.diagnostic)).toEqual(["evidence_unavailable", null]);
  expect(result.observations.at(-1)).toMatchObject({ cohort: "cold_2u", sampleIndex: 2 });
  expect(result.report.cohorts.cold_2u).toMatchObject({ declaredRepetitions: 20, observedSamples: 1 });
});
