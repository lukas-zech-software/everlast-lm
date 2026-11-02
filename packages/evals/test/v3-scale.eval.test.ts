import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadScaleFixture, checkScaleAnswer, scaleQualityMetadata, checkScaleResponses } from '../src/v3-scale-fixture.ts';
const raw=JSON.parse(readFileSync(new URL('../fixtures/v3/scale-manifest.json',import.meta.url),'utf8'));
describe('NFR-PERF-01 NFR-EVAL-02/04 scaled fixture',()=>{
 it('pins schema-valid needle and exact 40-source selection excluding decoy',()=>{
  const f=loadScaleFixture(raw);
  expect(f.active_source_ids).toHaveLength(40);
  expect(f.active_source_ids).not.toContain(f.decoy_source_id);
  expect(f.boundaries).toEqual([999999,1000000,1000001]);
  expect(()=>loadScaleFixture({...raw,active_source_ids:[raw.decoy_source_id]})).toThrow();
  expect(()=>loadScaleFixture({...raw,fixture_hash:'0'.repeat(64)})).toThrow();
 });
 it('requires exact original needle citation and audits every supplied context channel',()=>{
  const f=loadScaleFixture(raw);
  const result={answer:'142.8 bar',cited_chunk_ids:[f.needle_chunk_id],contexts:['safe guide','safe history','safe cache']};
  expect(checkScaleAnswer(f,result)).toBe(true);
  expect(checkScaleAnswer(f,{...result,cited_chunk_ids:[]})).toBe(false);
  expect(checkScaleAnswer(f,{...result,contexts:['155.0 bar']})).toBe(false);
  expect(checkScaleAnswer(f,{...result,answer:'155.0 bar'})).toBe(false);
 });
});

describe('NFR-EVAL-01..04 sample and strict scale assertions',()=>{
 it('keeps the deterministic stratified 50-case judged metadata separate from timing',()=>{
  const m=scaleQualityMetadata();
  expect(m.case_ids).toHaveLength(50);
  expect(m.dataset_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(m.categories).toEqual({unanswerable:25,deselected_source:7,history_carryover:4,synthesis:14});
 });
 it('rejects one bad needle in twenty, missing evidence channels and zero denominators',()=>{
  const f=loadScaleFixture(raw);
  const observations=Array.from({length:20},()=>({answer:'142.8 bar',cited_chunk_ids:[f.needle_chunk_id],contexts:['safe']}));
  expect(checkScaleResponses(f,observations)).toBe(true);
  expect(checkScaleResponses(f,[...observations.slice(1),{...observations[0]!,answer:'unsupported'}])).toBe(false);
  expect(()=>checkScaleResponses(f,[])).toThrow();
  expect(checkScaleAnswer(f,{...observations[0]!,contexts:[]})).toBe(false);
 });
});

// These exercise the existing publication verifier; no model outputs are synthesized as measured evidence.
import { verifyDraft } from '@everlast/api/chat/verifier';
import { ratio, judgeMetric } from '../src/metrics.ts';
describe('FR-GC-02 NFR-EVAL-01..04 scaled publication boundaries',()=>{
 it('refuses unsupported and foreign-citation drafts without publishing stripped content',()=>{
  expect(verifyDraft({status:'not_in_sources',sentences:[]},[]).kind).toBe('refusal');
  const refused=verifyDraft({status:'answered',sentences:[{kind:'claim',text:'142.8 bar',citations:[raw.needle_chunk_id]}]},[]);
  expect(refused.kind).toBe('refusal');
  expect('content' in refused && refused.content).not.toContain('142.8 bar');
 });
 it('preserves exact numeric thresholds and rejects empty metric populations',()=>{
  expect(()=>ratio(0,0,'scale')).toThrow();
  for(const [metric,value] of [['hallucination_rate',0.05],['citation_precision',0.99],['negative_rejection_rate',0.98],['scoping_leakage_count',1],['semantic_support_rate',0.99]] as const)
   expect(judgeMetric(metric,value,{failing_cases:[]}).passed).toBe(false);
 });
});
