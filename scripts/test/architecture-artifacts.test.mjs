// C-01..C-03, CC-09 / ARCH-04: changed/new vs historical artifact coverage.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateArtifacts} from '../check-architecture-artifacts.mjs';
function fixture(t,plan='Historical plan') {
 const root=mkdtempSync(join(tmpdir(),'architecture-artifacts-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'specs','001-fixture'),{recursive:true});
 for(const [name,text] of Object.entries({spec:'C-01 CC-09',tasks:'C-01 CC-09',plan})) writeFileSync(join(root,'specs','001-fixture',name+'.md'),text);
 return root;
}
test('C-01 historical unchanged features are not retroactively certified',t=>assert.deepEqual(validateArtifacts(fixture(t),['README.md']),[]));
test('C-01 resumed feature missing gate fails',t=>assert.ok(validateArtifacts(fixture(t),['specs/001-fixture/tasks.md']).some(f=>f.includes('CC-09'))));
test('C-01 a gate name alone is insufficient',t=>assert.ok(validateArtifacts(fixture(t,'CC-09'),['specs/001-fixture/plan.md']).some(f=>f.includes('inventory'))));
test('C-01 populated inventory passes',t=>assert.deepEqual(validateArtifacts(fixture(t,'CC-09\n## Architecture Boundary Evidence\n| C-01 | scripts/check.mjs | owner |'),['specs/001-fixture/plan.md']),[]));
test('C-01 source-only implementation cannot omit the feature plan',t=>assert.ok(validateArtifacts(fixture(t),['apps/api/src/new.ts']).length));
