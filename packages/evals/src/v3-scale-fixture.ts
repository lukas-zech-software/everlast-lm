import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildGoldenDataset, releaseSample, datasetHash } from './dataset.ts';
import { containsForbidden, ratio } from './metrics.ts';
/** NFR-PERF-01, NFR-EVAL-02/04: deterministic recipe validation is not runtime evidence. */
const schema=z.object({version:z.literal(1),active_source_ids:z.array(z.string().uuid()).length(40),needle_source_id:z.string().uuid(),needle_chunk_id:z.string().uuid(),decoy_source_id:z.string().uuid(),minimum_active_tokens:z.literal(1050000),expected_fact:z.literal('142.8 bar'),forbidden_fact:z.literal('155.0 bar'),boundaries:z.tuple([z.literal(999999),z.literal(1000000),z.literal(1000001)]),quota_source_count:z.literal(300),sample_count:z.literal(20),percentile_method:z.literal('nearest_rank'),max_attempts:z.literal(40),tokenizer_qualification:z.string(),runtime_qualification:z.string(),fixture_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ScaleFixture=z.infer<typeof schema>;
export function loadScaleFixture(raw:unknown):ScaleFixture {
 const parsed=schema.parse(raw);
 if(new Set(parsed.active_source_ids).size!==40 || parsed.active_source_ids.includes(parsed.decoy_source_id) || parsed.active_source_ids[32]!==parsed.needle_source_id) throw new Error('Invalid active fixture scope');
 const {fixture_hash,...recipe}=parsed;
 if(createHash('sha256').update(JSON.stringify(recipe)).digest('hex')!==fixture_hash) throw new Error('Fixture hash mismatch');
 return parsed;
}
export function checkScaleAnswer(fixture:ScaleFixture,result:{answer:string;cited_chunk_ids:string[];contexts:string[]}):boolean {
 return result.contexts.length > 0 && containsForbidden(result.answer,fixture.expected_fact) && result.cited_chunk_ids.includes(fixture.needle_chunk_id)
  && ![result.answer,...result.contexts].some(text=>containsForbidden(text,fixture.forbidden_fact));
}

/** Fixed existing golden sample, not a new or favorable sample selected from benchmark results. */
export function scaleQualityMetadata(){
 const cases=buildGoldenDataset(),sample=releaseSample(cases);
 const categories:Record<string,number>={};
 for(const c of sample) categories[c.category]=(categories[c.category]??0)+1;
 return {dataset_hash:datasetHash(cases),case_ids:sample.map(c=>c.id),categories};
}
export function checkScaleResponses(fixture:ScaleFixture,results:Parameters<typeof checkScaleAnswer>[1][]):boolean {
 ratio(results.filter(r=>checkScaleAnswer(fixture,r)).length,results.length,'scale correct answers');
 return results.length===20 && results.every(r=>checkScaleAnswer(fixture,r));
}
