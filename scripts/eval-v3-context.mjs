#!/usr/bin/env node
/** NFR-PERF-01 C-01/C-02/C-03: local ordinary-API stress or dev-only Vertex context cache smoke check. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const arg=name=>{const i=process.argv.indexOf(`--${name}`);return i<0?undefined:process.argv[i+1];};
const out=arg('out')??'reports',profile=process.argv.includes('--smoke')?'dev-smoke':(arg('profile')??'enterprise');mkdirSync(out,{recursive:true});
let report,exitCode=2;
if(profile==='dev-smoke'){const {runScaleCli}=await import('./eval-v3-scale.mjs');process.exitCode=await runScaleCli(['--smoke','--out',out]);}
else{
 if(!['local-api','enterprise'].includes(profile))report={result:'UNAVAILABLE',error:'Unknown context profile',profile};
 else if(profile==='enterprise')report={schema:'everlast.studio-context-v3-report/2',profile,result:'UNAVAILABLE',missing_prerequisites:['Use `pnpm test:cloud:dev` or `--smoke` on dev for live Vertex context-cache smoke checks']};
 else if(!process.env.TEST_DATABASE_URL)report={result:'UNAVAILABLE',profile,missing_prerequisites:['PostgreSQL16/pgvector TEST_DATABASE_URL']};
 else{
  try{const {runLocalContextStress,runLocalScalePairs}=await import('../apps/api/test/v3-context-local.ts');const {runScaleBenchmark}=await import('../packages/evals/src/v3-scale.ts');report=await runLocalContextStress();report.paired_scale=await runLocalScalePairs(runScaleBenchmark);exitCode=report.result==='PASS'?0:1;}
  catch(error){report=error.report??{schema:'everlast.studio-context-v3-report/2',profile,result:'FAIL',error:error.message};exitCode=1;}
 }
 writeFileSync(join(out,'v3-context-benchmark.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(exitCode!==0)console.error(JSON.stringify(report));process.exitCode=exitCode;
}
