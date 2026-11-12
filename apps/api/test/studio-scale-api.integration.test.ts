import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
/** NFR-PERF-01 C-01/C-02/C-03 FR-WM-07: standalone declared memory budget, real ordinary API/database. */
describe('NFR-PERF-01 ordinary Studio API stress',()=>{
 it('processes actual million-token boundaries, forty Guides and full quota with bounded original traversal',async()=>{
  const out=await mkdtemp(join(tmpdir(),'everlast-012-stress-'));
  try{
   // A reused Vitest worker contains unrelated fixtures/heap. Own process freezes the collector's memory population.
   await promisify(execFile)(process.execPath,['--max-old-space-size=256','scripts/eval-v3-context.mjs','--profile','local-api','--out',out],{timeout:180000,maxBuffer:1000000});
   const report=JSON.parse(await readFile(join(out,'v3-context-benchmark.json'),'utf8'));
   expect(report.result).toBe('PASS');expect(report.release_result).toBe('UNAVAILABLE');
   expect(report.boundaries.map((b:{source_tokens:number})=>b.source_tokens)).toEqual([99999,100000,100001]);
   expect(report.boundaries.every((b:{completed:boolean;extracted_chunks:number;original_chunks:number;max_batch_tokens:number;max_batch_chunks:number})=>b.completed&&b.extracted_chunks===b.original_chunks&&b.max_batch_tokens<=4000&&b.max_batch_chunks<=8)).toBe(true);
   expect(report.quota).toMatchObject({admitted:300,rejected_301:true,ready_sources:300,originals_processed:300,completed:true});expect(report.guide_routing).toMatchObject({guide_count:40,needle_cited:true});
   expect(report.paired_scale).toMatchObject({result:'PASS',release_result:'UNAVAILABLE',attempted_requests:60,diagnostic_requests:20,peak_model_concurrency:2,distinct_owners:true});
   expect(report.cache).toMatchObject({miss:true,hit:true,expiry:true,restart:true,revocation:true});
   expect(report.memory.peak_rss_bytes-report.memory.rss_before_bytes).toBeLessThanOrEqual(report.memory.peak_growth_limit_bytes);
  }finally{await rm(out,{recursive:true,force:true});}
 },190_000);
});
