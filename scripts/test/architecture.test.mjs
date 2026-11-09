// C-01..C-03, CC-09; specs/004 ARCH-01..03.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectArchitecture, checkArchitecture } from '../check-architecture.mjs';

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'architecture-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, content) => { mkdirSync(dirname(join(root,p)), {recursive:true}); writeFileSync(join(root,p), typeof content === 'string' ? content : JSON.stringify(content)); };
  put('specs/004-ui-skeleton-quality-gates/tasks.md', '- [ ] T035 C-01 migration');
  put('tsconfig.json', { compilerOptions: { baseUrl: '.', paths: { '@alias/*': ['apps/worker/src/*'] } } });
  for (const name of ['apps/api','apps/worker','apps/web','packages/contracts','packages/db','packages/testkit']) {
    put(`${name}/package.json`, { name: '@everlast/'+name.split('/')[1], type:'module', exports:{'.':'./src/index.ts'}, dependencies: { '@everlast/contracts':'workspace:*', zod:'*' } });
    put(`${name}/src/index.ts`, 'export const value = 1;');
    put(`${name}/src/private.ts`, 'export const secret = 1;');
  }
  for (const [p,c] of Object.entries(files)) put(p,c);
  return {root, put};
}
function rules(root) { return inspectArchitecture(root).map(v=>v.rule); }
for (const [label, content] of [
  ['value', "import {value} from '@everlast/worker';"],
  ['type', "import type {value} from '@everlast/worker';"],
  ['re-export', "export {value} from '@everlast/worker';"],
  ['relative', "import {value} from '../../worker/src/index.js';"],
  ['alias', "import {value} from '@alias/index';"],
  ['dynamic', "await import('@everlast/worker');"],
  ['require', "const worker = require('@everlast/worker');"],
  ['import-type', "type Worker = import('@everlast/worker').value;"],
  ['import-equals', "import worker = require('@everlast/worker');"],
]) test(`C-01..03 rejects cross-app ${label}`, t => {
  const {root} = fixture(t, {'apps/api/src/new.ts':content});
  assert.ok(rules(root).includes('no-cross-app'));
});
for (const [label, file, content, rule] of [
 ['shared app','packages/db/src/new.ts',"export * from '@everlast/api';",'no-shared-to-app'],
 ['contract runtime','packages/contracts/src/new.ts',"import '@everlast/db';",'contracts-only'],
 ['browser server','apps/web/src/new.ts',"import '@everlast/db';",'browser-safe'],
 ['production testkit','apps/api/src/new.ts',"import '@everlast/testkit';",'no-production-testkit'],
 ['deep import','apps/api/src/new.ts',"import '@everlast/db/src/private';",'public-entrypoint'],
 ['relative bypass','apps/api/src/new.ts',"import '../../../packages/db/src/private.ts';",'public-entrypoint'],
 ['missing local','apps/api/src/new.ts',"import './missing.js';",'unresolved-internal'],
 ['missing workspace','apps/api/src/new.ts',"import '@everlast/missing';",'unresolved-internal'],
 ['computed','apps/api/src/new.ts',"await import(moduleName);",'computed-module'],
]) test(`C-01..03 rejects ${label}`, t=>{
 const {root}=fixture(t,{[file]:content}); assert.ok(rules(root).includes(rule));
});
test('C-01..03 allows public adapters in composition roots, local modules, and public contracts', t=>{
 const {root}=fixture(t, {'apps/api/src/server.ts':"import '@everlast/db'; import '@everlast/contracts'; import './private.js';",'apps/web/src/main.ts':"import '@everlast/contracts';"});
 assert.deepEqual(inspectArchitecture(root),[]);
});
test('C-01..03 rejects wildcard export and package manifest cross-app dependency', t=>{
 const {root}=fixture(t, {'apps/api/package.json':{name:'@everlast/api', exports:{'./*':'./src/*.ts'},dependencies:{'@everlast/worker':'workspace:*'}}});
 assert.ok(rules(root).includes('wildcard-export')); assert.ok(rules(root).includes('no-cross-app'));
});
test('C-01..03 rejects package cycles', t=>{
 const {root}=fixture(t, {'packages/db/src/new.ts':"import '@everlast/contracts';",'packages/contracts/src/new.ts':"import '@everlast/db';"});
 assert.ok(rules(root).includes('package-cycle'));
});
const metadata = {owner:'@lukas-zech-software',decision:'D21',baseline:'13e76bd',removalTask:'specs/004-ui-skeleton-quality-gates T035',expires:'2027-02-05',reason:'R1 shared workflow extraction'};
function exception(v) { return {...v,...metadata}; }
test('C-01..03 exact exception passes; expansion, duplication, expiry and stale debt fail', t=>{
 const {root,put}=fixture(t, {'apps/api/src/new.ts':"import {value} from '@everlast/worker';"});
 const violations=inspectArchitecture(root);
 assert.ok(violations.length>0);
 const policy={version:1,exceptions:violations.map(exception)};
 assert.deepEqual(checkArchitecture(root,{policy,now:'2026-11-07'}).findings,[]);
 assert.ok(checkArchitecture(root,{policy,now:'2027-02-05'}).findings.some(x=>x.rule==='expired-exception'));
 put('apps/api/src/new.ts',"import {value, another} from '@everlast/worker';");
 assert.ok(checkArchitecture(root,{policy,now:'2026-11-07'}).findings.length>0);
 put('apps/api/src/new.ts',"import {value} from '@everlast/worker';\nimport {value} from '@everlast/worker';");
 assert.ok(checkArchitecture(root,{policy,now:'2026-11-07'}).findings.length>0);
 put('apps/api/src/new.ts','export {};');
 assert.ok(checkArchitecture(root,{policy,now:'2026-11-07'}).findings.some(x=>x.rule==='stale-exception'));
});
test('C-01..03 malformed and duplicate exceptions fail closed',t=>{
 const {root}=fixture(t,{'apps/api/src/new.ts':"import '@everlast/worker';"});
 const [v]=inspectArchitecture(root); assert.ok(v);
 for(const exceptions of [[{...exception(v),owner:''}], [exception(v),exception(v)]])
   assert.ok(checkArchitecture(root,{policy:{version:1,exceptions},now:'2026-11-07'}).findings.length>0);
});
test('C-01..03 rejects widening wildcard exports by adding new source modules',t=>{
 const {root,put}=fixture(t,{'packages/db/package.json':{name:'@everlast/db',exports:{'./*':'./src/*.ts'}}});
 const policy={version:1,exceptions:inspectArchitecture(root).map(exception)};
 put('packages/db/src/added.ts','export const added = 1;');
 assert.ok(checkArchitecture(root,{policy,now:'2026-11-07'}).findings.length);
});
test('C-01..03 PR policy cannot add or extend exceptions',t=>{
 const {root}=fixture(t,{'apps/api/src/new.ts':"import '@everlast/worker';"});
 const policy={version:1,exceptions:inspectArchitecture(root).map(exception)};
 assert.ok(checkArchitecture(root,{policy,basePolicy:{version:1,exceptions:[]},now:'2026-11-07'}).findings.some(f=>f.rule==='exception-expansion'));
 const basePolicy=structuredClone(policy);policy.exceptions[0].expires='2027-03-01';
 assert.ok(checkArchitecture(root,{policy,basePolicy,now:'2026-11-07'}).findings.some(f=>f.rule==='exception-expansion'));
});
test('C-01..03 allows external test runners in contract tests and testkit for eval tooling',t=>{
 const {root}=fixture(t,{'packages/contracts/test/check.test.ts':"import {test} from 'vitest';"});
 assert.deepEqual(inspectArchitecture(root),[]);
});

test('C-01..03 completed removal tasks invalidate their exceptions',t=>{
 const {root,put}=fixture(t,{'apps/api/src/new.ts':"import '@everlast/worker';"});
 const policy={version:1,exceptions:inspectArchitecture(root).map(exception)};
 put('specs/004-ui-skeleton-quality-gates/tasks.md','- [x] T035 C-01 migration');
 assert.ok(checkArchitecture(root,{policy,now:'2026-11-07'}).findings.some(f=>f.rule==='completed-or-missing-removal-task'));
});
test('C-01..03 rejects imports into skipped generated directories',t=>{
 const {root}=fixture(t,{'apps/api/src/new.ts':"import './dist/bypass.js';",'apps/api/src/dist/bypass.js':"import '@everlast/worker';"});
 assert.ok(rules(root).includes('unscanned-module'));
});
test('C-01..03 does not confuse installed external types with repository code',t=>{
 const {root}=fixture(t,{'node_modules/external/package.json':{name:'external',types:'index.d.ts'},'node_modules/external/index.d.ts':'export const value: number;','apps/api/src/new.ts':"import {value} from 'external';"});
 assert.deepEqual(inspectArchitecture(root),[]);
});
test('C-01..03 wildcard exceptions do not block unrelated new tests',t=>{
 const {root,put}=fixture(t,{'packages/db/package.json':{name:'@everlast/db',exports:{'./*':'./src/*.ts'}}});
 const policy={version:1,exceptions:inspectArchitecture(root).map(exception)};
 put('packages/db/test/added.test.ts','export {};');
 assert.deepEqual(checkArchitecture(root,{policy,now:'2026-11-07'}).findings,[]);
});
test('C-01..03 a tsconfig alias cannot disguise worker code as contracts',t=>{
 const {root,put}=fixture(t,{'apps/api/src/new.ts':"import '@everlast/contracts';"});
 put('tsconfig.json',{compilerOptions:{baseUrl:'.',paths:{'@everlast/contracts':['apps/worker/src/index.ts']}}});
 assert.ok(rules(root).includes('no-cross-app'));
});
test('C-01..03 renamed createRequire loaders cannot bypass application boundaries',t=>{
 const {root}=fixture(t,{'apps/api/src/new.ts':"import { createRequire as makeLoader } from 'node:module'; const load = makeLoader(import.meta.url); load('@everlast/worker');"});
 assert.ok(rules(root).includes('no-cross-app'));
});

test('C-01..03 CLI fails with importer, target and rule diagnostics',t=>{
 const {root,put}=fixture(t,{'apps/api/src/new.ts':"import '@everlast/worker';"});
 put('scripts/architecture-policy.json',{version:1,exceptions:[]});
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('../check-architecture.mjs',import.meta.url))],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,1);
 assert.match(run.stderr,/apps\/api\/src\/new.ts/);
 assert.match(run.stderr,/apps\/worker/);
 assert.match(run.stderr,/no-cross-app/);
});
test('C-01..03 CLI accepts allowed imports and rejects invalid arguments',t=>{
 const {root,put}=fixture(t,{'apps/api/src/new.ts':"import '@everlast/contracts';"});
 put('scripts/architecture-policy.json',{version:1,exceptions:[]});
 const cli=fileURLToPath(new URL('../check-architecture.mjs',import.meta.url));
 assert.equal(spawnSync(process.execPath,[cli],{cwd:root}).status,0);
 assert.equal(spawnSync(process.execPath,[cli,'--silently-ignore-violations'],{cwd:root}).status,1);
});
