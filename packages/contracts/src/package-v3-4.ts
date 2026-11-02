import { z } from 'zod';
import { ChunkLocatorSchema } from './document-chunk.ts';
import { SourceRevisionPairSchema } from './scoped-context.ts';

/** NFR-PERF-01, C-02/C-03: internal scale evidence; never part of public chat DTOs. */
const count = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const CanonicalScopeSchema = z.array(SourceRevisionPairSchema).min(1).superRefine((pairs, ctx) => {
  for (let i = 1; i < pairs.length; i++) if (pairs[i - 1]!.source_id >= pairs[i]!.source_id)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Scope must contain unique sorted source IDs'});
});
export const ContextModeSchema = z.enum(['retrieval','CachedFullContext','ChunkMapReduce']);
export const QueryClassSchema = z.enum(['detailed','broad']);
export const CacheStatusSchema = z.enum(['Creating','Ready','Invalidated','Expired','Failed']);
export const EvidenceSegmentSchema = z.object({parent_chunk_id:z.string().uuid(),start_offset:count,end_offset:count,token_count:count}).strict()
  .refine(s=>s.end_offset>s.start_offset,'Segment must have a positive interval');
export const QualityRatioSchema = z.object({numerator:count,denominator:count.positive()}).strict()
  .refine(r=>r.numerator<=r.denominator,'Numerator exceeds denominator');
export const BenchmarkPolicySchema = z.object({sample_count:z.literal(20),percentile_method:z.literal('nearest_rank'),max_attempts:z.literal(40)}).strict();
export const ScopedCorpusManifestSchema = z.object({
 notebook_id:z.string().uuid(),principal_subject:z.string().min(1),effective_authorization_fingerprint:hash,
 sources:CanonicalScopeSchema,token_counting_model:z.string().min(1),token_counting_version:z.string().min(1),source_token_total:count,
 pages:z.array(z.object({source_id:z.string().uuid(),revision:count.positive(),page_number:count.positive(),digest:hash,token_count:count}).strict()),
 chunks:z.array(z.object({chunk_id:z.string().uuid(),source_id:z.string().uuid(),revision:count.positive(),digest:hash,token_count:count,locator:ChunkLocatorSchema}).strict()),
 manifest_hash:hash,
}).strict().superRefine((m,ctx)=>{
 const scope=new Map(m.sources.map(p=>[p.source_id,p.revision]));
 if([...m.pages,...m.chunks].some(p=>scope.get(p.source_id)!==p.revision)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Evidence outside exact scope'});
 if(new Set(m.chunks.map(c=>c.chunk_id)).size!==m.chunks.length) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate chunk'});
 const keys=m.pages.map(p=>`${p.source_id}:${p.page_number}`);
 if(new Set(keys).size!==keys.length || m.pages.reduce((n,p)=>n+p.token_count,0)!==m.source_token_total) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid canonical token ledger'});
});
export const ContextCacheEntrySchema = z.object({
 provider_handle:z.string().min(1),cache_key:hash,notebook_id:z.string().uuid(),scope_manifest_hash:hash,
 effective_authorization_fingerprint:hash,output_language:z.string().min(1),generation_parameters_hash:hash,
 model:z.string().min(1),model_version:z.string().min(1),content_digest:hash,
 created_at:z.number().finite(),expires_at:z.number().finite(),ttl_seconds:z.number().finite().positive(),status:CacheStatusSchema,
}).strict().refine(e=>e.expires_at>e.created_at,'Provider-confirmed finite expiry required');
export const BenchmarkObservationSchema = z.object({
 run_id:z.string().uuid(),request_id:z.string().uuid(),manifest_hash:hash,
 cohort:z.enum(['warm','wake','invalid_environment']),instance_boot_id:z.string().uuid().nullable(),replayed:z.boolean(),
 client_submission_monotonic_ms:z.number().finite().nonnegative(),client_first_validated_answer_ms:z.number().finite().nonnegative().nullable(),
 latency_ms:z.number().finite().nonnegative().nullable(),terminal_status:z.enum(['answer','refusal','error','cancelled','missing','replayed']),
 active_token_total:count,cited_chunk_ids:z.array(z.string().uuid()),needle_correct:z.boolean(),prompt_leakage_count:count,answer_leakage_count:count,
}).strict().superRefine((o,ctx)=>{
 const factual=o.terminal_status==='answer' && !o.replayed;
 if(factual ? o.latency_ms===null || o.client_first_validated_answer_ms===null : o.latency_ms!==null || o.client_first_validated_answer_ms!==null)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Only a fresh factual answer has a timing'});
 if(o.latency_ms!==null && o.client_first_validated_answer_ms!==null && Math.abs(o.latency_ms-(o.client_first_validated_answer_ms-o.client_submission_monotonic_ms))>0.001)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Timing must preserve the submission clock'});
 if(o.cohort==='warm' && o.instance_boot_id===null) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Warm request requires serving identity'});
});
export type BenchmarkObservation=z.infer<typeof BenchmarkObservationSchema>;
export type ScopedCorpusManifest=z.infer<typeof ScopedCorpusManifestSchema>;
export type ContextCacheEntry=z.infer<typeof ContextCacheEntrySchema>;
export type EvidenceSegment=z.infer<typeof EvidenceSegmentSchema>;

export const ContextPlanSchema=z.object({
 request_id:z.string().uuid(),scope_manifest_hash:hash,purpose:z.enum(['inspection','generation']),query_class:QueryClassSchema,mode:ContextModeSchema,
 model:z.string().min(1),model_version:z.string().min(1),input_limit:count.positive(),output_reserve:count,
 instruction_tokens:count,history_tokens:count,guide_tokens:count,chunk_marker_tokens:count,evidence_tokens:count,
 detail_chunk_ids:z.array(z.string().uuid()),required_guide_ids:z.array(z.string().uuid()),
}).strict().refine(p=>p.output_reserve+p.instruction_tokens+p.history_tokens+p.guide_tokens+p.chunk_marker_tokens+p.evidence_tokens<=p.input_limit,'Complete model envelope exceeds capacity');

/** NFR-PERF-01, C-01/C-03: a completed manifest certifies every original interval, including no-finding batches. */
export const OriginalCoverageSchema=z.object({
 attempt_id:z.string().uuid(),originals:z.array(z.object({chunk_id:z.string().uuid(),digest:hash,length:count.positive()}).strict()).min(1),
 segments:z.array(EvidenceSegmentSchema).min(1),completed_segments:z.array(count),expected_batch_ids:z.array(z.string().uuid()).min(1),completed_batch_ids:z.array(z.string().uuid()),
}).strict().superRefine((c,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
 const originals=new Map(c.originals.map(o=>[o.chunk_id,o]));
 if(originals.size!==c.originals.length) fail('Duplicate original');
 if(c.segments.some(s=>!originals.has(s.parent_chunk_id))) fail('Unknown original');
 for(const original of c.originals){
  const segments=c.segments.filter(s=>s.parent_chunk_id===original.chunk_id).sort((a,b)=>a.start_offset-b.start_offset);
  let end=0;
  for(const s of segments){if(s.start_offset!==end || s.end_offset>original.length) fail('Gap, overlap or out-of-bounds segment');end=s.end_offset;}
  if(end!==original.length) fail('Incomplete original coverage');
 }
 const complete=new Set(c.completed_segments);
 if(complete.size!==c.completed_segments.length || complete.size!==c.segments.length || [...complete].some(i=>i>=c.segments.length)) fail('Incomplete or duplicate segment completion');
 const batches=new Set(c.expected_batch_ids),done=new Set(c.completed_batch_ids);
 if(batches.size!==c.expected_batch_ids.length || done.size!==c.completed_batch_ids.length || done.size!==batches.size || [...done].some(id=>!batches.has(id))) fail('Incomplete or duplicate batch completion');
});
