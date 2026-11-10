import { createHash, randomUUID } from 'node:crypto';
import { OriginalCoverageSchema, type EvidenceSegment } from '@everlast/contracts';
import type { SourceRevisionPair, StudioCoverageManifest, UnifiedDocumentChunk } from '@everlast/contracts';
import { DEFAULT_BATCH_LIMITS } from './reports/batching.ts';
/** NFR-PERF-01 / C-02/C-03 / D12: one bounded original page plus <=4 model batches, no corpus array. */
export interface EvidenceBatchLimits {maxTokensPerBatch?:number;maxChunksPerBatch?:number;maxTokens?:number;maxChunks?:number;}
export interface ProcessOriginalEvidenceInput<T>{
 chunks:readonly UnifiedDocumentChunk[];original_chunks?:AsyncIterable<UnifiedDocumentChunk[]>|undefined;
 snapshot:readonly SourceRevisionPair[];limits?:EvidenceBatchLimits|undefined;concurrency?:number|undefined;signal:AbortSignal;
 onBatchComplete?(completedBatches:number,totalBatches:number):void;
 extractBatch(batch:UnifiedDocumentChunk[],batchIndex:number):Promise<T[]>;
 consumeItems?:(items:T[])=>Promise<void>;
}
export interface ProcessOriginalEvidenceResult<T>{items:T[];coverage:StudioCoverageManifest;original_coverage?:ReturnType<typeof OriginalCoverageSchema.parse>|undefined;}
export const DEFAULT_EVIDENCE_CONCURRENCY=4;
export async function processAllOriginalEvidenceBatches<T>(input:ProcessOriginalEvidenceInput<T>):Promise<ProcessOriginalEvidenceResult<T>>{
 input.signal.throwIfAborted();
 const maxTokens=input.limits?.maxTokensPerBatch??input.limits?.maxTokens??DEFAULT_BATCH_LIMITS.maxTokens;
 const maxChunks=input.limits?.maxChunksPerBatch??input.limits?.maxChunks??DEFAULT_BATCH_LIMITS.maxChunks;
 if(!Number.isSafeInteger(maxTokens)||maxTokens<1||!Number.isSafeInteger(maxChunks)||maxChunks<1)throw new Error('Invalid evidence batch bounds');
 const revisions=new Map(input.snapshot.map(p=>[p.source_id,p.revision])),seen=new Set<string>();
 let originals=0,batchCount=0,completed=0,itemBytes=0;
 const items:T[]=[];
 const originalsLedger:{chunk_id:string;digest:string;length:number}[]=[],segments:EvidenceSegment[]=[],batchIds:string[]=[];
 const pages=input.original_chunks??(async function*(){yield [...input.chunks];})();
 async function* batches(){
  let batch:UnifiedDocumentChunk[]=[],tokens=0,bytes=0;
  for await(const page of pages) for(const original of page){
   input.signal.throwIfAborted();
   if(revisions.get(original.source_id)!==original.revision || seen.has(original.chunk_id))throw new Error('Original evidence scope/revision/duplicate mismatch');
   seen.add(original.chunk_id);originals++;
   // Split oversized units by Unicode code point, retaining the real original chunk ID and continuous original intervals.
   // Byte bounds conservatively bound serialized model input even when a provider tokenizer is not qualified.
   const record={chunk_id:original.chunk_id,digest:createHash('sha256').update(original.text).digest('hex'),length:0};originalsLedger.push(record);
   const tokenParts=Math.max(1,Math.ceil(original.token_count/maxTokens)),width=Math.max(1,Math.min(8000,Math.floor(original.text.length/tokenParts)||1));
   let offset=0,text='',length=0,codeUnits=0;
   const unit=(part:string,points:number)=>{
    const count=Math.max(1,Math.ceil(original.token_count*part.length/Math.max(1,original.text.length)));
    if(count>maxTokens)throw new Error('Individual evidence point exceeds token capacity');
    segments.push({parent_chunk_id:original.chunk_id,start_offset:offset,end_offset:offset+points,token_count:count});offset+=points;
    return {...original,text:part,token_count:count};
   };
   async function* units(){
    // Iterate code points without materializing a character array of a potentially large original chunk.
    for(const point of original.text){if(codeUnits+point.length>width&&length){yield unit(text,length);text='';length=0;codeUnits=0;}text+=point;length++;codeUnits+=point.length;}
    if(length)yield unit(text,length);record.length=offset;
   }
   for await(const chunk of units()){
    const size=Buffer.byteLength(JSON.stringify(chunk));
    if(size>64_000)throw new Error('Individual evidence segment exceeds serialized model envelope');
    if(batch.length&&(batch.length>=maxChunks||tokens+chunk.token_count>maxTokens||bytes+size>64_000)){yield batch;batch=[];tokens=0;bytes=0;}
    batch.push(chunk);tokens+=chunk.token_count;bytes+=size;
   }
  }
  if(batch.length)yield batch;
 }
 // At most the configured concurrency batches are retained; complete a window before reading more originals.
 const pending:Promise<{ok:true;rows:T[]}|{ok:false;error:unknown}>[]=[];
 const flush=async()=>{
  const results=await Promise.all(pending.splice(0));
  const failure=results.find(r=>!r.ok);if(failure&&!failure.ok)throw failure.error;
  for(const result of results){
   if(!result.ok)throw result.error;const rows=result.rows;completed++;
   if(input.consumeItems)await input.consumeItems(rows);
   else{itemBytes+=Buffer.byteLength(JSON.stringify(rows));if(itemBytes>16_000_000)throw new Error('Extracted findings exceed bounded reduction capacity');items.push(...rows);}
   input.onBatchComplete?.(completed,batchCount);
  }
 };
 const concurrency=Math.max(1,Math.min(input.concurrency??DEFAULT_EVIDENCE_CONCURRENCY,4));
 for await(const batch of batches()){
  const index=batchCount++;batchIds.push(randomUUID());
  pending.push(input.extractBatch(batch,index).then(rows=>{
   const ids=new Set(batch.map(c=>c.chunk_id));
   for(const item of rows){const ref=(item as {chunk_id?:unknown}|null)?.chunk_id;if(typeof ref==='string'&&!ids.has(ref))throw new Error('Extraction cited outside original batch');}
   return {ok:true as const,rows};
  }).catch(error=>({ok:false as const,error})));
  if(pending.length>=concurrency)await flush();
 }
 await flush();input.signal.throwIfAborted();
 const original_coverage=originals?OriginalCoverageSchema.parse({attempt_id:randomUUID(),originals:originalsLedger,segments,completed_segments:segments.map((_,i)=>i),expected_batch_ids:batchIds,completed_batch_ids:batchIds.slice(0,completed)}):undefined;
 return {items,original_coverage,coverage:{total_sources:input.snapshot.length,total_chunks:originals,batch_count:batchCount,processed_batch_count:completed,all_original_chunks_visited:true}};
}
export function verifyEvidenceCoverage(coverage:StudioCoverageManifest|undefined,chunks:readonly UnifiedDocumentChunk[],snapshot:readonly SourceRevisionPair[]):string|null{
 if(!coverage)return 'Coverage manifest is missing.';
 if(!coverage.all_original_chunks_visited)return 'Not all original chunks were visited.';
 if(coverage.processed_batch_count!==coverage.batch_count)return `Incomplete batch coverage: processed ${coverage.processed_batch_count} of ${coverage.batch_count} batches.`;
 if(coverage.total_chunks!==chunks.length)return `Chunk count mismatch in coverage manifest (${coverage.total_chunks} vs ${chunks.length}).`;
 const revisions=new Map(snapshot.map(s=>[s.source_id,s.revision]));
 for(const chunk of chunks)if(revisions.get(chunk.source_id)!==chunk.revision)return `Chunk ${chunk.chunk_id} has out-of-snapshot source or stale revision.`;
 return null;
}
