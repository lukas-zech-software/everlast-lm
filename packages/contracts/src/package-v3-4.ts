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
 sources:CanonicalScopeSchema,token_counting_model:z.string().min(1),token_counting_version:z.string().min(1),token_counting_qualification:z.enum(['enterprise-eu','local-double','unqualified']).optional(),source_token_total:count,
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
 active_token_total:count.nullable(),cited_chunk_ids:z.array(z.string().uuid()),needle_correct:z.boolean(),prompt_leakage_count:count.nullable(),answer_leakage_count:count.nullable(),
 diagnostic_pair_id:z.string().uuid().optional(),client_completion_monotonic_ms:z.number().finite().nonnegative().optional(),
 client_submission_epoch_ms:z.number().finite().optional(),clock_uncertainty_ms:z.number().finite().nonnegative().nullable().optional(),
 notebook_id:z.string().uuid().optional(),principal_subject:z.string().min(1).optional(),scope_manifest_hash:hash.optional(),revision:z.string().min(1).optional(),evidence_error:z.string().optional(),
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

/** NFR-PERF-01 private identifier/count-only record, correlated outside the ordinary public API. */
export const BenchmarkPrivateEvidenceSchema=z.object({
 request_id:z.string().uuid(),notebook_id:z.string().uuid(),instance_boot_id:z.string().uuid(),revision:z.string().min(1),terminal_status:z.string(),
 readiness:z.object({instance_boot_id:z.string().uuid(),revision:z.string().min(1),ready_at_ms:z.number().finite().nullable(),dependencies:z.object({sql:z.boolean(),model:z.boolean(),retrieval:z.boolean(),cache:z.boolean(),migrations:z.boolean(),recovery:z.boolean()}).strict()}).strict(),
 stages:z.record(z.string(),z.number().finite().nonnegative()),fixture_hash:hash.nullable(),
 scope:z.object({principal_subject:z.string().min(1),notebook_id:z.string().uuid(),sources:CanonicalScopeSchema,source_token_total:count,manifest_hash:hash,token_counting_model:z.string().min(1),token_counting_version:z.string().min(1),token_counting_qualification:z.enum(['enterprise-eu','local-double','unqualified'])}).strict().nullable(),
 prompt_leakage_count:count.nullable(),
}).strict();
export type BenchmarkPrivateEvidence=z.infer<typeof BenchmarkPrivateEvidenceSchema>;

export type ReadinessEvidence=BenchmarkPrivateEvidence['readiness'];
/** NFR-PERF-01 / D17: uncertainty overlaps are unqualified, never guessed warm. */
export function classifyReadiness(evidence:ReadinessEvidence,request:{instance_boot_id:string;revision:string;client_submission_epoch_ms:number;clock_uncertainty_ms:number}):'warm'|'wake'|'invalid_environment'{
 const {clock_uncertainty_ms:u,client_submission_epoch_ms:t}=request;
 if(evidence.instance_boot_id!==request.instance_boot_id || evidence.revision!==request.revision || !Number.isFinite(u) || u<0 || !Number.isFinite(t) || evidence.ready_at_ms===null || !Number.isFinite(evidence.ready_at_ms) || !Object.values(evidence.dependencies).every(v=>v===true)) return 'invalid_environment';
 if(evidence.ready_at_ms<t-u) return 'warm';
 if(evidence.ready_at_ms>t+u) return 'wake';
 return 'invalid_environment';
}

/** NFR-PERF-01 / FR-GC-08: canonical private approval/channel transport schemas. */
export const PrivateClockCalibrationSchema=z.object({offset_ms:z.number().finite(),uncertainty_ms:z.number().finite().min(0).max(1000),measured_at_ms:z.number().finite().nonnegative(),expires_at_ms:z.number().finite().nonnegative(),measurement_id:z.string().min(1).max(200)}).strict();
export const PrivateBridgeBindingSchema=z.object({campaign_id:z.string().uuid(),challenge_generation:z.string().regex(/^[1-9][0-9]{0,39}$/),challenge_sha256:hash,channel_policy_sha256:hash}).strict();
export const OPERATIONAL_PROVIDER_BUDGET={embedding_requests:2,model_requests:2,model_output_tokens_each:512,model_request_bytes:100000,cache_token_counts:2,cache_creates:2,cache_deletes:2,cache_ttl_seconds:60,cache_original_bytes:32000000,cache_serialized_bytes:10000000,managed_creates:0} as const;
export const OperationalProviderBudgetSchema=z.object({embedding_requests:z.literal(2),model_requests:z.literal(2),model_output_tokens_each:z.literal(512),model_request_bytes:z.literal(100000),cache_token_counts:z.literal(2),cache_creates:z.literal(2),cache_deletes:z.literal(2),cache_ttl_seconds:z.literal(60),cache_original_bytes:z.literal(32000000),cache_serialized_bytes:z.literal(10000000),managed_creates:z.literal(0)}).strict();
export const OperationalQualificationPlanSchema=z.object({
 provider_budget:OperationalProviderBudgetSchema.optional(),
 bridge:PrivateBridgeBindingSchema.optional(),
 id:z.string().uuid(),instance_boot_id:z.string().uuid(),revision:z.string().min(1),
 issued_at:z.number().finite().nonnegative(),expires_at:z.number().finite().nonnegative(),timeout_ms:z.number().int().min(1).max(240000),
 operations:z.tuple([z.literal('retrieval'),z.literal('model'),z.literal('cache'),z.literal('runtime_observation')]),
 actors:z.array(z.object({owner_id:z.string().uuid(),notebook_id:z.string().uuid(),sources:CanonicalScopeSchema.max(300),cache_sources:CanonicalScopeSchema.max(300).optional()}).strict()).length(2),
 operational_config_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 source_tree_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 classification_basis:z.enum(['application-serving-readiness','managed-runtime-readiness']).optional(),
 candidate_commit:z.string().regex(/^[a-f0-9]{40}$/).optional(),fixture_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 runtime_config_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),clock_calibration_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),qualification_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const PrivateBridgeIdentitySchema=z.object({campaign_id:z.string().uuid(),candidate_commit:z.string().regex(/^[a-f0-9]{40}$/),serving_revision:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),instance_boot_id:z.string().uuid()}).strict();
export type PrivateBridgeIdentity=z.infer<typeof PrivateBridgeIdentitySchema>;
export const PrivateBridgePolicySchema=z.object({max_duration_ms:count.positive().max(3600000),max_ticks:count.positive().max(3600),max_operations:count.positive().max(20000),max_writes:count.positive().max(1024),max_write_bytes:count.positive().max(128000000),max_read_bytes:count.positive().max(256000000),operation_timeout_ms:count.positive().max(5000)}).strict();
export type PrivateBridgePolicy=z.infer<typeof PrivateBridgePolicySchema>;
export const OperationalChallengeSchema=z.object({instance_boot_id:z.string().uuid(),candidate_commit:z.string().regex(/^[a-f0-9]{40}$/),revision:PrivateBridgeIdentitySchema.shape.serving_revision,runtime_config_sha256:hash,fixture_sha256:hash,clock_calibration_sha256:hash,qualification_sha256:hash,classification_basis:z.enum(['application-serving-readiness','managed-runtime-readiness']),provider_budget:OperationalProviderBudgetSchema,source_tree_sha256:hash,operational_config_sha256:hash,approved_notebook_ids:z.array(z.string().uuid()).min(2).max(100)}).strict();
export const PrivateBridgeChallengeSchema=z.object({schema:z.literal('everlast.private-challenge/1'),identity:PrivateBridgeIdentitySchema,created_at_ms:z.number().finite().nonnegative(),expires_at_ms:z.number().finite().nonnegative(),policy:PrivateBridgePolicySchema,challenge:OperationalChallengeSchema}).strict().refine(v=>v.expires_at_ms>v.created_at_ms&&v.expires_at_ms-v.created_at_ms<=v.policy.max_duration_ms,'Invalid challenge lifetime');
export type PrivateBridgeChallenge=z.infer<typeof PrivateBridgeChallengeSchema>;
export const PrivateBridgeObjectRefSchema=z.object({name:z.string().min(1).max(1000),generation:z.string().regex(/^[1-9][0-9]{0,39}$/),sha256:hash,size:count.max(8000000)}).strict();
export type PrivateBridgeObjectRef=z.infer<typeof PrivateBridgeObjectRefSchema>;
export const PrivateBridgeExportKindSchema=z.enum(['challenge','outcomes','transport','code','scale']);
export type PrivateBridgeExportKind=z.infer<typeof PrivateBridgeExportKindSchema>;
export const PrivateBridgeIndexSchema=z.object({schema:z.literal('everlast.private-exports/1'),identity:PrivateBridgeIdentitySchema,updated_at_ms:z.number().finite().nonnegative(),expires_at_ms:z.number().finite().nonnegative(),objects:z.object({challenge:PrivateBridgeObjectRefSchema,outcomes:PrivateBridgeObjectRefSchema.optional(),transport:PrivateBridgeObjectRefSchema.optional(),code:PrivateBridgeObjectRefSchema.optional(),scale:PrivateBridgeObjectRefSchema.optional()}).strict()}).strict();
export const PrivateBridgeInboxSchema=z.object({schema:z.literal('everlast.private-inbox/1'),identity:PrivateBridgeIdentitySchema,authorization_id:z.string().uuid(),envelope:PrivateBridgeObjectRefSchema,challenge_generation:PrivateBridgeObjectRefSchema.shape.generation,challenge_sha256:hash}).strict();
export const PrivateBridgeApprovalEnvelopeSchema=z.object({schema:z.literal('everlast.private-approval/1'),payload:z.string().min(1).max(128000),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict();
export const PrivateOperationalOutcomeSchema=z.object({authorization_sha256:hash,result:z.enum(['OBSERVED_READY','UNAVAILABLE']),observed_at:z.number().finite().nonnegative(),readiness:BenchmarkPrivateEvidenceSchema.shape.readiness,release_eligible:z.literal(false)}).strict();
export const PrivateTransportOutcomeSchema=z.object({event_id:z.string().uuid(),observed_at_ms:z.number().finite().nonnegative(),inbox_generation:PrivateBridgeObjectRefSchema.shape.generation.nullable(),authorization_id:z.string().uuid().nullable(),result:z.enum(['ACCEPTED','REJECTED','UNAVAILABLE','CONFLICT','BUDGET_EXCEEDED']),release_eligible:z.literal(false)}).strict();
/** Exact bounded export shape; general arbitrary strings/stage keys cannot smuggle source/provider contents. */
export const ExportedScaleEvidenceSchema=BenchmarkPrivateEvidenceSchema.extend({
 terminal_status:z.enum(['answer','computed','refusal','error','cancelled','missing','replayed']),
 stages:z.object({admission:z.number().finite().nonnegative().optional(),retrieval:z.number().finite().nonnegative().optional(),generation:z.number().finite().nonnegative().optional(),verification:z.number().finite().nonnegative().optional(),publication:z.number().finite().nonnegative().optional()}).strict(),
 scope:BenchmarkPrivateEvidenceSchema.shape.scope.unwrap().extend({principal_subject:z.string().uuid(),token_counting_model:z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,199}$/),token_counting_version:z.string().regex(/^[A-Za-z0-9._:-]{1,240}$/)}).strict().nullable(),
}).strict();

/** NFR-PERF-01: unqualified clock-only measurement inputs; authentication belongs to the trusted exchange workflow. */
export const PrivateClockReceiptSchema=z.object({schema:z.literal('everlast.private-clock-receipt/1'),identity:PrivateBridgeIdentitySchema,nonce:z.string().uuid(),request:PrivateBridgeObjectRefSchema,t2_ms:z.number().finite().nonnegative(),t3_ms:z.number().finite().nonnegative(),server_elapsed_ms:z.number().finite().nonnegative().max(5000)}).strict();
export const PrivateClockExchangeSchema=z.object({identity:PrivateBridgeIdentitySchema,nonce:z.string().uuid(),request:PrivateBridgeObjectRefSchema,t1_ms:z.number().finite().nonnegative(),t4_ms:z.number().finite().nonnegative(),client_elapsed_ms:z.number().finite().nonnegative().max(5000),ttl_ms:z.number().int().positive().max(60000)}).strict();
