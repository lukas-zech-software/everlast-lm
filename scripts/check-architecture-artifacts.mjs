#!/usr/bin/env node
// C-01..C-03, CC-09: changed/new features need architectural evidence (ARCH-04).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export function validateArtifacts(root,changedPaths) {
  const features=new Set(changedPaths.map(p=>p.match(/^specs\/([^/]+)\//)?.[1]).filter(Boolean));
  const findings=[];
  if(changedPaths.some(p=>/^(apps|packages)\/.*\.(?:[cm]?[jt]sx?|json)$/.test(p))&&!changedPaths.some(p=>/^specs\/[^/]+\/plan\.md$/.test(p)))
    findings.push('Application/package changes require an updated feature plan with CC-09 evidence.');
  for(const feature of features) {
    // Fully deleted features need no replacement evidence.
    if(!existsSync(join(root,'specs',feature))) continue;
    for(const name of ['spec','plan','tasks']) {
      const path=`specs/${feature}/${name}.md`;
      if(!existsSync(join(root,path))) {findings.push(`${path}: missing artifact`);continue;}
      const text=readFileSync(join(root,path),'utf8');
      if(!text.includes('CC-09')) findings.push(`${path}: missing CC-09`);
      if(name==='plan') {
        const evidence=text.match(/^## Architecture Boundary Evidence[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
        if(!evidence||!evidence.includes('|')||/\[(?:SRS-ID|exact paths|wiring file|test path)/i.test(evidence))
          findings.push(`${path}: missing or unfilled Architecture Boundary Evidence inventory`);
      }
    }
  }
  return findings;
}
export function changedPaths(root,baseRef) {
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  if(baseRef&&(!/^[a-zA-Z0-9_./-]+$/.test(baseRef)||baseRef.startsWith('-'))) throw new Error('Invalid base ref');
  return [...new Set([
    ...(baseRef?git(['diff','--name-only','-z',baseRef,'--']):[]),
    ...git(['diff','--name-only','-z','HEAD','--']),
    ...git(['ls-files','--others','--exclude-standard','-z']),
  ])];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length&&!(args.length===2&&args[0]==='--base-ref')) throw new Error('Usage: check-architecture-artifacts.mjs [--base-ref REF]');
    const findings=validateArtifacts(process.cwd(),changedPaths(process.cwd(),args[1]));
    findings.forEach(f=>console.error(f));
    console.log(`Architecture artifacts: ${findings.length} finding(s).`);
    process.exitCode=findings.length?1:0;
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
