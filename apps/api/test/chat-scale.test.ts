import { describe,expect,it } from 'vitest';
import { PrivateBenchmarkRecorder } from '../src/observability/benchmark.ts';
describe('NFR-PERF-01 D13 private stage records',()=>{
 it('records monotonic stage intervals without counting progress as a factual result',()=>{
  let now=0;const records:unknown[]=[];
  const r=new PrivateBenchmarkRecorder({approved_notebook_ids:['synthetic'],revision:'rev',sink:v=>records.push(v),clock:()=>now});
  const span=r.begin('synthetic','request')!;
  now=10;span.stage('retrieval');now=30;span.stage('generation');now=40;span.stage('verification');now=50;span.stage('publication');
  expect(records).toHaveLength(0);
  span.finish('refusal');
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({terminal_status:'refusal',stages:{admission:10,retrieval:20,generation:10,verification:10,publication:0}});
  span.finish('answer');expect(records).toHaveLength(1);
 });
});

import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { seedReadySource } from '@everlast/db/testing';
import { ChatService } from '../src/chat/service.ts';
import { startTestApi, type TestApi } from './support.ts';
import type { PrivateStageRecord } from '../src/observability/benchmark.ts';
let api:TestApi;
const records:PrivateStageRecord[]=[];
const approved:string[]=[];
let calls=0;
const embedder=new HashingTestEmbedder({NODE_ENV:'test'});
let recorder:PrivateBenchmarkRecorder;
beforeAll(async()=>{
 api=await startTestApi({},db=>{
  recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:approved,revision:'test',sink:r=>records.push(r)});
  return {embedder,chat:new ChatService({pool:db.pool,embedder,benchmark:recorder,model:{id:'test',generate:async({chunks})=>{calls++;return {status:'answered',sentences:[{kind:'claim',text:'142.8 bar',citations:[chunks[0]!.chunk_id]}]};}}})};
 });
});
afterAll(async()=>{await api?.close();});
describe('NFR-PERF-01 C-02 D13 ordinary chat private instrumentation',()=>{
 it('leaves ordinary public framing intact and produces no records for unapproved content',async()=>{
  const nb=await (await api.fetch('/api/notebooks',{method:'POST',as:'scale',json:{}})).json() as {notebook:{id:string}};
  const owner=(await api.db.pool.query("SELECT id FROM users WHERE subject='local:scale'")).rows[0].id;
  const source=await seedReadySource(api.db.pool,owner,nb.notebook.id,{pages:['Reactor coolant pressure must be 142.8 bar'],embed:t=>embedder.embed(t)});
  const request=randomUUID();
  const send=()=>api.fetch(`/api/notebooks/${nb.notebook.id}/chat/turns`,{method:'POST',as:'scale',json:{message:'What is the reactor coolant pressure?',active_source_ids:[source.sourceId],request_id:request}});
  const first=await (await send()).text();
  expect(first).toContain('event: final');expect(first).toContain('142.8 bar');expect(first).not.toContain('instance_boot_id');
  expect(records).toHaveLength(0);
  const again=await (await send()).text();expect(again).toContain('"replayed":true');expect(calls).toBe(1);
 });
});

it('NFR-PERF-01 records approved stages only after fenced publication, preserving replay semantics',async()=>{
 const nb=await (await api.fetch('/api/notebooks',{method:'POST',as:'approved-scale',json:{}})).json() as {notebook:{id:string}};
 const owner=(await api.db.pool.query("SELECT id FROM users WHERE subject='local:approved-scale'")).rows[0].id;
 const source=await seedReadySource(api.db.pool,owner,nb.notebook.id,{pages:['Reactor coolant pressure must be 142.8 bar'],embed:t=>embedder.embed(t)});
 const captured:PrivateStageRecord[]=[];
 const rec=new PrivateBenchmarkRecorder({approved_notebook_ids:[nb.notebook.id],revision:'test',sink:r=>captured.push(r)});
 const service=new ChatService({pool:api.db.pool,embedder,benchmark:rec,model:{id:'test',generate:async({chunks})=>({status:'answered',sentences:[{kind:'claim',text:'142.8 bar',citations:[chunks[0]!.chunk_id]}]})}});
 const request={ownerId:owner,notebookId:nb.notebook.id,message:'coolant pressure',activeSourceIds:[source.sourceId],requestId:randomUUID()};
 for await(const event of service.runTurn(request)){if(event.type==='status')expect(captured).toHaveLength(0);}
 expect(captured).toHaveLength(1);expect(captured[0]).toMatchObject({terminal_status:'answer',request_id:request.requestId});
 expect(captured[0]!.stages).toHaveProperty('publication');
 expect(JSON.stringify(captured)).not.toContain('142.8 bar');
 for await(const _event of service.runTurn(request)){};
 expect(captured[1]).toMatchObject({terminal_status:'replayed'});

 const abortController = new AbortController();
 const abortReq = { ...request, requestId: randomUUID() };
 abortController.abort();
 await expect(async () => {
  for await (const _ of service.runTurn(abortReq, abortController.signal)) {}
 }).rejects.toThrow();
 expect(captured[2]).toMatchObject({ terminal_status: 'cancelled', request_id: abortReq.requestId });
});
