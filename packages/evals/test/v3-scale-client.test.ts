import { describe,expect,it } from 'vitest';
import { collectFreshFinal } from '../src/v3-scale-client.ts';
const response=(events:string[])=>new Response(new ReadableStream({start(c){for(const e of events)c.enqueue(new TextEncoder().encode(e));c.close();}}),{headers:{'content-type':'text/event-stream'}});
const final=(kind='answer',replayed=false)=>`event: final\ndata: ${JSON.stringify({messages:[{role:'assistant',kind,content:'142.8 bar',citations:[{chunk_id:'needle'}],code_execution_trace:null}],replayed})}\n\n`;
describe('NFR-PERF-01 D13 monotonic validated final receipt',()=>{
 it('ignores status/raw events and preserves original submission clock across split UTF-8/SSE framing',async()=>{
  let clock=100;
  const result=await collectFreshFinal(response(['event: status\ndata: {"phase":"generating"}\n\n',final().slice(0,15),final().slice(15)]),100,()=>clock+=250);
  expect(result).toMatchObject({terminal_status:'answer',latency_ms:250});
 });
 it('cannot measure refusal, replay, error, missing or Computed results as standard factual TTFT',async()=>{
  for(const event of [final('refusal'),final('answer',true),'event: error\ndata: {}\n\n','event: status\ndata: {}\n\n']){
   const result=await collectFreshFinal(response([event]),100,()=>200);
   expect(result.latency_ms).toBeNull();
   expect(result.terminal_status).not.toBe('answer');
  }
 });
 it('rejects malformed or oversized transport without retaining unlimited response data',async()=>{
  await expect(collectFreshFinal(response(['event: final\ndata: {bad}\n\n']),0,()=>1)).rejects.toThrow();
  await expect(collectFreshFinal(response(['x'.repeat(2000001)]),0,()=>1)).rejects.toThrow();
 });
 it('correctly parses CRLF line endings and verifies monotonic timing',async()=>{
  const crlfEvent = `event: final\r\ndata: ${JSON.stringify({messages:[{role:'assistant',kind:'answer',content:'142.8 bar',citations:[{chunk_id:'needle'}],code_execution_trace:null}],replayed:false})}\r\n\r\n`;
  const result = await collectFreshFinal(response([crlfEvent]), 100, () => 350);
  expect(result).toMatchObject({
   terminal_status: 'answer',
   client_first_validated_answer_ms: 350,
   latency_ms: 250,
   answer: '142.8 bar',
   cited_chunk_ids: ['needle']
  });
 });
});
