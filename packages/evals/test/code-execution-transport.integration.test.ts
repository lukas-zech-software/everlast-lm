import { createServer, type Server, type RequestListener } from "node:http";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createCodeExecutionHttpTransport, createCodeExecutionPrivateFileReader } from "../src/code-execution-transport.ts";
import type { CollectionManifest, CollectionSubmission } from "../src/code-execution-collector.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor = {owner_id:id(1),notebook_id:id(2),source_snapshot:[{source_id:id(3),revision:1}],expected_citation_chunk_ids:[id(4)]};
const submission:CollectionSubmission = {request_id:id(5),actor,question:"Compute",submitted_at_ms:0};
const trace = {schema_version:1,execution_id:id(6),state:"Succeeded",attempts:[{attempt_id:id(7),ordinal:1,code:"pass",stdout:"",stderr:"",exit_code:0,started_at:"2026-11-10T12:00:00.000Z",ended_at:"2026-11-10T12:00:00.010Z",terminal_reason:"Succeeded",artifacts:[]}],final_attempt_id:id(7),published_artifact_ids:[],failure_code:null,computed_results:[{label:"Result",value:"1.5",unit:null,citations:[id(4)]}]};
// Actual public VisibleMessage projection: intentionally no request_id or private qualification fields.
const message = {id:id(8),turn_id:id(9),role:"assistant",kind:"answer",content:"1.5 (Computed)",unavailable_reason:null,citations:[{source_id:id(3),chunk_id:id(4),status:"available"}],code_execution_trace:trace,created_at:"2026-11-10T12:00:00.011Z"};
const servers:Server[]=[],dirs:string[]=[];
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()));}for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function host(handler:RequestListener) {
  const server=createServer(handler);servers.push(server);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address || typeof address==="string")throw new Error("No local test address");
  return `http://127.0.0.1:${address.port}`;
}
it("submits authenticated ordinary JSON and consumes fragmented actual public SSE projection",async()=>{
  let received:unknown;
  const baseUrl=await host((req,res)=>{
    const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
      received={path:req.url,authorization:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())};
      res.writeHead(200,{"content-type":"text/event-stream"});
      res.write('event: status\r\ndata: {"phase":"retrieving"}\r\n\r\n');
      res.write('event: status\ndata: '+JSON.stringify({phase:"running_code",execution_id:id(6),attempt:1})+'\n\n');
      const final='event: final\ndata: '+JSON.stringify({replayed:false,messages:[message]})+'\n\n';
      res.write(final.slice(0,23));res.end(final.slice(23));
    });
  });
  const submit=createCodeExecutionHttpTransport({baseUrl,credentials:new Map([[actor.notebook_id,"synthetic-token"]])});
  const receipt=await submit(submission,new AbortController().signal);
  expect(receipt.terminal).toBe("final");expect(receipt.trace?.execution_id).toBe(id(6));expect(receipt.cited_chunk_ids).toEqual([id(4)]);
  expect(receipt.client_running_ms).toBeGreaterThanOrEqual(0);
  expect(received).toEqual({path:`/api/notebooks/${id(2)}/chat/turns`,authorization:"Bearer synthetic-token",body:{message:"Compute",active_source_ids:[id(3)],request_id:id(5)}});
});
it("does not certify replayed or foreign-source finals",async()=>{
  for(const mode of ["replay","foreign"]){
    const baseUrl=await host((_req,res)=>{res.writeHead(200,{"content-type":"text/event-stream"});res.end('event: final\ndata: '+JSON.stringify({replayed:mode==="replay",messages:[{...message,citations:[{source_id:mode==="foreign"?id(20):id(3),chunk_id:id(4),status:"available"}]}]})+'\n\n');});
    const submit=createCodeExecutionHttpTransport({baseUrl,credentials:new Map([[actor.notebook_id,"test"]])});
    expect((await submit(submission,new AbortController().signal)).terminal).toBe(mode==="replay"?"replayed":"missing");
  }
});
it("bounds a stalled stream and oversized response, without following redirects",async()=>{
  for(const mode of ["stalled","oversized","redirect"]){
    let requests=0;
    const baseUrl=await host((_req,res)=>{
      requests++;
      if(mode==="redirect"){res.writeHead(302,{location:"/credential-sink"});res.end();return;}
      res.writeHead(200,{"content-type":"text/event-stream"});res.flushHeaders();
      if(mode==="oversized")res.end("x".repeat(200));
    });
    const submit=createCodeExecutionHttpTransport({baseUrl,credentials:new Map([[actor.notebook_id,"test"]]),timeoutMs:mode==="stalled"?20:1000,maxBytes:100});
    if(mode==="oversized")await expect(submit(submission,new AbortController().signal)).rejects.toThrow(/byte bound/);
    else await expect(submit(submission,new AbortController().signal)).rejects.toThrow();
    expect(requests).toBe(1);
  }
});
it("preflights bounded private provenance and refuses missing records or shared file permissions",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"everlast-010-evidence-"));dirs.push(dir);const path=join(dir,"private.json");
  const manifest={actors:[actor,{...actor,owner_id:id(10),notebook_id:id(11)}],api_base_url:"http://127.0.0.1",candidate_commit:"a".repeat(40),serving_revision:"candidate",classification_basis:"application-serving-readiness",qualification_sha256:"b".repeat(64),runtime_config_sha256:"e".repeat(64),clock_calibration_sha256:"c".repeat(64)} as CollectionManifest;
  const header={schema_version:1,candidate_commit:manifest.candidate_commit,serving_revision:manifest.serving_revision,fixture_sha256:"d".repeat(64),classification_basis:manifest.classification_basis,qualification_sha256:manifest.qualification_sha256,runtime_config_sha256:manifest.runtime_config_sha256,clock_calibration_sha256:manifest.clock_calibration_sha256,approved_notebook_ids:[id(2),id(11)],measurements:[]};
  await writeFile(path,JSON.stringify(header),{mode:0o600});
  const reader=createCodeExecutionPrivateFileReader(path,manifest,"d".repeat(64),{timeoutMs:10,maxBytes:10_000});
  await expect(reader.preflight()).resolves.toMatchObject({measurements:[]});
  await expect(reader.measurement(id(5),new AbortController().signal)).rejects.toThrow(/unavailable/);
  await chmod(path,0o644);await expect(reader.preflight()).rejects.toThrow(/private/);
  await chmod(path,0o600);await writeFile(path,JSON.stringify({...header,qualification_sha256:"e".repeat(64)}));
  await expect(reader.preflight()).rejects.toThrow(/provenance/);
});
