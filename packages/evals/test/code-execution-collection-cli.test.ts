import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { codeExecutionRuntimeConfigDigest } from "../src/code-execution-collector.ts";
/** [010-code-execution-sandbox] T063 — FR-GC-08/NFR-SEC-02: missing scope never dispatches paid work. */
it("rejects unapproved scope, a different runtime, and missing/malformed producer evidence before HTTP",async()=>{
  let requests=0;
  const server=createServer((_req,res)=>{requests++;res.writeHead(500);res.end();});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address || typeof address==="string")throw new Error("No local address");
  const dir=await mkdtemp(join(tmpdir(),"everlast-010-cli-"));
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const engine="projects/local-test/locations/europe-west4/reasoningEngines/1";
  const plan={fixture:{id:"f",version:1,sha256:"a".repeat(64),question:"Calculate a synthetic fixture."},provider:{service:"aiplatform.googleapis.com/AgentEngineSandbox",region:"europe-west4",cpu:"2 vCPU",memory:"1.5 GB"},environment:"local-test-double",declaredAt:"2026-11-10T00:00:00.000Z",cohorts:{cold_1u:{repetitions:20,warm:false,concurrency:1},warm_1u:{repetitions:20,warm:true,concurrency:1},cold_2u:{repetitions:20,warm:false,concurrency:2},warm_2u:{repetitions:20,warm:true,concurrency:2}}};
  const calibration={offset_ms:0,uncertainty_ms:0,measured_at_ms:0,expires_at_ms:9999999999999,measurement_id:"synthetic-calibration"};
  const manifest={actors:[1,2].map(n=>({owner_id:id(n),notebook_id:id(n+10),source_snapshot:[{source_id:id(n+20),revision:1}],expected_citation_chunk_ids:[id(n+30)],credential_env:`CE_TEST_TOKEN_${n}`})),api_base_url:`http://127.0.0.1:${address.port}`,candidate_commit:"d".repeat(40),serving_revision:"synthetic",classification_basis:"application-serving-readiness",qualification_sha256:"b".repeat(64),runtime_config_sha256:codeExecutionRuntimeConfigDigest(engine),clock_calibration:calibration,clock_calibration_sha256:hash(JSON.stringify(calibration)),expected_result:"1.5",max_total_requests:80};
  const planText=JSON.stringify(plan),planPath=join(dir,"plan.json"),manifestPath=join(dir,"manifest.json"),evidence=join(dir,"private.json"),out=join(dir,"out");
  await writeFile(planPath,planText);
  try {
    for(const mode of ["approval","runtime","producer","malformed"]){
      const m=mode==="runtime"?{...manifest,runtime_config_sha256:codeExecutionRuntimeConfigDigest(engine.replace(/1$/,"2"))}:manifest;
      const manifestText=JSON.stringify(m);await writeFile(manifestPath,manifestText);
      if(mode==="malformed")await writeFile(evidence,'{"private":"PRIVATE_ACTOR_SECRET"',{mode:0o600});
      const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
        const child=spawn(process.execPath,["scripts/eval-v3-code-execution.mjs","--collect","--plan",planPath,"--collection-manifest",manifestPath,"--private-evidence",evidence,"--out",out],{cwd:fileURLToPath(new URL("../../../",import.meta.url)),env:{...process.env,CODE_EXECUTION_IT:"1",CODE_EXECUTION_REASONING_ENGINE:engine,CODE_EXECUTION_BENCHMARK_APPROVED_PLAN_SHA256:mode==="approval"?"wrong":hash(planText),CODE_EXECUTION_BENCHMARK_APPROVED_MANIFEST_SHA256:hash(manifestText),CE_TEST_TOKEN_1:"PRIVATE_ACTOR_SECRET",CE_TEST_TOKEN_2:"PRIVATE_ACTOR_SECRET_TWO"},stdio:["ignore","pipe","pipe"]});
        const timer=setTimeout(()=>{child.kill();reject(new Error("Local CLI exceeded bound"));},15000);let output="";
        child.stdout.on("data",chunk=>{output+=String(chunk);});child.stderr.on("data",chunk=>{output+=String(chunk);});child.once("error",reject);child.once("close",code=>{clearTimeout(timer);resolve({code,output});});
      });
      expect(result.code).toBe(2);expect(result.output).toContain("UNAVAILABLE");
      expect(result.output).toContain(mode==="approval"?"frozen plan and manifest hashes":mode==="runtime"?"approved runtime configuration":"qualified private producer evidence");expect(result.output).not.toContain("PRIVATE_ACTOR_SECRET");
      expect(await readFile(join(out,"v3-code-execution-benchmark.json"),"utf8")).not.toContain("PRIVATE_ACTOR_SECRET");
      expect(requests).toBe(0);
    }
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
