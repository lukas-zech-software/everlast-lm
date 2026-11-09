import { describe, expect, it } from 'vitest';
import { CanonicalScopeSchema, ContextModeSchema, QueryClassSchema, CacheStatusSchema, EvidenceSegmentSchema, BenchmarkObservationSchema, BenchmarkPolicySchema, QualityRatioSchema, ContextPlanSchema, OriginalCoverageSchema, ContextCacheEntrySchema } from '../src/package-v3-4.ts';
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
describe('NFR-PERF-01 C-02/C-03 scale records', () => {
 it('requires a unique canonical exact nonempty revision set', () => {
  expect(CanonicalScopeSchema.parse([{source_id:a,revision:1}])).toHaveLength(1);
  for (const pairs of [[],[{source_id:a,revision:0}],[{source_id:b,revision:1},{source_id:a,revision:1}],[{source_id:a,revision:1},{source_id:a,revision:2}]]) expect(CanonicalScopeSchema.safeParse(pairs).success).toBe(false);
 });
 it('preserves private context modes and lifecycle enums', () => {
  for(const mode of ['retrieval','CachedFullContext','ChunkMapReduce']) expect(ContextModeSchema.parse(mode)).toBe(mode);
  for(const mode of ['detailed','broad']) expect(QueryClassSchema.parse(mode)).toBe(mode);
  for(const mode of ['Creating','Ready','Invalidated','Expired','Failed']) expect(CacheStatusSchema.parse(mode)).toBe(mode);
  expect(ContextModeSchema.safeParse('Completed').success).toBe(false);
 });
 it('rejects invalid parent-linked intervals and zero metric denominators', () => {
  expect(EvidenceSegmentSchema.safeParse({parent_chunk_id:a,start_offset:2,end_offset:1,token_count:1}).success).toBe(false);
  expect(QualityRatioSchema.safeParse({numerator:0,denominator:0}).success).toBe(false);
  expect(QualityRatioSchema.safeParse({numerator:2,denominator:1}).success).toBe(false);
 });
 it('freezes the 20 sample nearest-rank policy', () => {
  expect(BenchmarkPolicySchema.parse({sample_count:20,percentile_method:'nearest_rank',max_attempts:40})).toBeTruthy();
  expect(BenchmarkPolicySchema.safeParse({sample_count:19,percentile_method:'nearest_rank',max_attempts:40}).success).toBe(false);
 });
 it('round trips terminal failure without manufacturing a timing', () => {
  const row={run_id:a,request_id:b,manifest_hash:'a'.repeat(64),cohort:'warm',instance_boot_id:a,replayed:false,client_submission_monotonic_ms:1,client_first_validated_answer_ms:null,latency_ms:null,terminal_status:'refusal',active_token_total:1050000,cited_chunk_ids:[],needle_correct:false,prompt_leakage_count:0,answer_leakage_count:0};
  expect(BenchmarkObservationSchema.parse(JSON.parse(JSON.stringify(row)))).toEqual(row);
  expect(BenchmarkObservationSchema.safeParse({...row,latency_ms:Infinity}).success).toBe(false);
  expect(BenchmarkObservationSchema.safeParse({...row,terminal_status:'answer'}).success).toBe(false);
  expect(BenchmarkObservationSchema.safeParse({...row,cohort:'slow'}).success).toBe(false);
 });
});

describe('NFR-PERF-01 C-03 complete envelope and original coverage records',()=>{
 it('rejects unqualified or overfull model envelopes',()=>{
  const plan={request_id:a,scope_manifest_hash:'a'.repeat(64),purpose:'generation',query_class:'detailed',mode:'retrieval',model:'test',model_version:'v1',input_limit:100,output_reserve:10,instruction_tokens:10,history_tokens:10,guide_tokens:10,chunk_marker_tokens:10,evidence_tokens:50,detail_chunk_ids:[a],required_guide_ids:[]};
  expect(ContextPlanSchema.safeParse(plan).success).toBe(true);
  expect(ContextPlanSchema.safeParse({...plan,evidence_tokens:51}).success).toBe(false);
  expect(ContextPlanSchema.safeParse({...plan,model_version:''}).success).toBe(false);
 });
 it('requires contiguous, complete parent coverage with original digests',()=>{
  const coverage={attempt_id:a,originals:[{chunk_id:a,digest:'a'.repeat(64),length:10}],segments:[{parent_chunk_id:a,start_offset:0,end_offset:5,token_count:2},{parent_chunk_id:a,start_offset:5,end_offset:10,token_count:2}],completed_segments:[0,1],expected_batch_ids:[b],completed_batch_ids:[b]};
  expect(OriginalCoverageSchema.safeParse(coverage).success).toBe(true);
  expect(OriginalCoverageSchema.safeParse({...coverage,completed_segments:[0]}).success).toBe(false);
  expect(OriginalCoverageSchema.safeParse({...coverage,segments:[coverage.segments[0],{...coverage.segments[1],start_offset:6}]}).success).toBe(false);
  expect(OriginalCoverageSchema.safeParse({...coverage,completed_batch_ids:[]}).success).toBe(false);
 });
 it('requires private scope/model/content identity and finite provider expiry',()=>{
  const entry={provider_handle:'private/handle',cache_key:'a'.repeat(64),notebook_id:a,scope_manifest_hash:'a'.repeat(64),effective_authorization_fingerprint:'a'.repeat(64),output_language:'en',generation_parameters_hash:'a'.repeat(64),model:'model',model_version:'v1',content_digest:'a'.repeat(64),created_at:1,expires_at:2,ttl_seconds:1,status:'Ready'};
  expect(ContextCacheEntrySchema.safeParse(entry).success).toBe(true);
  for(const ttl of [0,-1,Infinity]) expect(ContextCacheEntrySchema.safeParse({...entry,ttl_seconds:ttl}).success).toBe(false);
  expect(ContextCacheEntrySchema.safeParse({...entry,expires_at:1}).success).toBe(false);
 });
});
