/** NFR-PERF-01, D13: ordinary SSE final receipt, never progress/model-token timing. */
export interface FinalReceipt {
 terminal_status:'answer'|'refusal'|'replayed'|'error'|'missing';
 client_first_validated_answer_ms:number|null;
 latency_ms:number|null;
 answer:string;
 cited_chunk_ids:string[];
}
export async function collectFreshFinal(response:Response,submitted:number,clock:()=>number=()=>performance.now()):Promise<FinalReceipt>{
 const empty=(terminal_status:FinalReceipt['terminal_status']):FinalReceipt=>({terminal_status,client_first_validated_answer_ms:null,latency_ms:null,answer:'',cited_chunk_ids:[]});
 if(!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) return empty('error');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let buffer='',bytes=0;
 try {
  for(;;){
   const {value,done}=await reader.read();
   if(done) break;
   bytes+=value.byteLength;
   if(bytes>2000000) throw new Error('Benchmark SSE exceeds transport limit');
   buffer+=decoder.decode(value,{stream:true});
   buffer=buffer.replace(/\r\n/g,'\n');
   let boundary:number;
   while((boundary=buffer.indexOf('\n\n'))>=0){
    const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
    const lines=block.split('\n'),event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();
    if(event==='error') return empty('error');
    if(event!=='final') continue;
    const received=clock();
    const payload:unknown=JSON.parse(lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n'));
    if(!payload || typeof payload!=='object') throw new Error('Malformed final');
    const final=payload as {replayed?:unknown;messages?:unknown};
    if(final.replayed===true) return empty('replayed');
    if(final.replayed!==false || !Array.isArray(final.messages)) throw new Error('Malformed final');
    const assistant=final.messages.filter(m=>m && m.role==='assistant');
    if(assistant.length!==1) return empty('missing');
    const m=assistant[0];
    if(m.kind!=='answer') return empty('refusal');
    if(m.code_execution_trace || typeof m.content!=='string' || !m.content.trim() || m.unavailable_reason || !Array.isArray(m.citations) || !m.citations.length) return empty('missing');
    const ids=m.citations.map((c:{chunk_id?:unknown})=>c.chunk_id);
    if(ids.some((id:unknown)=>typeof id!=='string') || !Number.isFinite(submitted) || !Number.isFinite(received) || received<submitted) throw new Error('Invalid final receipt');
    return {terminal_status:'answer',client_first_validated_answer_ms:received,latency_ms:received-submitted,answer:m.content,cited_chunk_ids:ids as string[]};
   }
  }
  decoder.decode();
  return empty('missing');
 } finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
