#!/usr/bin/env node
// C-01..C-03 / CC-09. See specs/004 ARCH-01..03 and D21.
import ts from 'typescript-compiler';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const json = p => JSON.parse(readFileSync(p, 'utf8'));
const slash = p => p.split(sep).join('/');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const isTest = p => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => {
    if (['node_modules','dist','build','coverage','.git','.tsbuild'].includes(e.name)) return [];
    const p = join(dir, e.name);
    // Source symlinks are rejected rather than silently excluded from analysis.
    if (e.isSymbolicLink()) throw new Error(`Source symlink is not supported: ${p}`);
    return e.isDirectory() ? walk(p) : [p];
  });
}
function leaves(value) {
  return typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [];
}
function exportMap(pkg) {
  const value = pkg.exports;
  if (typeof value === 'string' || Array.isArray(value)) return {'.':value};
  if (!value || typeof value !== 'object') return {};
  return Object.keys(value).some(k=>k.startsWith('.')) ? value : {'.':value};
}
function sourceFile(path) {
  const candidates = [path, path.replace(/\.mjs$/,'.mts').replace(/\.cjs$/,'.cts').replace(/\.jsx?$/,'.ts'),
    path.replace(/\.jsx?$/,'.tsx'), ...['.ts','.tsx','.mts','.cts','.js','.mjs','.cjs','.json','/index.ts','/index.js'].map(ext=>path+ext)];
  return candidates.find(p=>ts.sys.fileExists(p));
}
function moduleTokens(node, sf) {
  // Ignore trivia, retain imported names and syntax so widening an import changes its exception.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, node.getText(sf));
  const result=[];
  for(let token=scanner.scan();token!==ts.SyntaxKind.EndOfFileToken;token=scanner.scan()) result.push([token,scanner.getTokenText()]);
  return result;
}
export function inspectArchitecture(root) {
  root=realpathSync(root);
  const files=['apps','packages'].flatMap(d=>walk(join(root,d)));
  const packages=files.filter(p=>/\/(apps|packages)\/[^/]+\/package.json$/.test(slash(p))).map(path=>({path,dir:dirname(path),data:json(path)}));
  const byName=new Map(packages.map(p=>[p.data.name,p]));
  if(byName.size!==packages.length) throw new Error('Duplicate workspace package names');
  const owner=p=>packages.find(pkg=>p===pkg.dir||p.startsWith(pkg.dir+sep));
  const rel=p=>slash(relative(root,p));
  const violations=[];
  const edges=[];
  const add=(rule,from,to,statement,line=1)=>violations.push({rule,from,to,fingerprint:fingerprint(statement),line});
  function direction(from,to,statement,line,test=false) {
    const a=owner(resolve(root,from)),b=owner(resolve(root,to));
    if(!a||!b||a===b) return;
    const ap=rel(a.dir),bp=rel(b.dir);
    if(ap.startsWith('apps/')&&bp.startsWith('apps/')) add('no-cross-app',from,to,statement,line);
    if(ap.startsWith('packages/')&&bp.startsWith('apps/')) add('no-shared-to-app',from,to,statement,line);
    if(a.data.name==='@everlast/contracts') add('contracts-only',from,to,statement,line);
    if(!test&&a.data.name==='@everlast/web'&&b.data.name!=='@everlast/contracts') add('browser-safe',from,to,statement,line);
    if(!test&&!['@everlast/testkit','@everlast/evals'].includes(a.data.name)&&['@everlast/testkit','@everlast/evals'].includes(b.data.name)) add('no-production-testkit',from,to,statement,line);
    if(!test) edges.push({a:a.data.name,b:b.data.name,from,to,statement,line});
  }
  for(const pkg of packages) {
    for(const [key,value] of Object.entries(exportMap(pkg.data))) {
      if(key.includes('*')||leaves(value).some(v=>v.includes('*'))) add('wildcard-export',rel(pkg.path),key,[key,value,files.filter(f=>leaves(value).some(pattern=>new RegExp('^'+resolve(pkg.dir,pattern).split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(f))).map(rel)]);
      for(const target of leaves(value)) if(!target.startsWith('./')||!resolve(pkg.dir,target).startsWith(pkg.dir+sep))
        add('invalid-export',rel(pkg.path),target,[key,value]);
    }
    for(const section of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) {
      for(const [name,version] of Object.entries(pkg.data[section]||{})) {
        const target=byName.get(name);
        if(target) direction(rel(pkg.path),rel(target.path),[section,name,version],1,section==='devDependencies');
        else if(name.startsWith('@everlast/')) add('unresolved-internal',rel(pkg.path),name,[section,name,version]);
      }
    }
  }
  const optionCache=new Map();
  function optionsFor(file) {
    const config=ts.findConfigFile(dirname(file),ts.sys.fileExists) || (existsSync(join(root,'tsconfig.base.json'))?join(root,'tsconfig.base.json'):undefined);
    if(!config) return {module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,allowJs:true};
    if(!optionCache.has(config)) {
      const read=ts.readConfigFile(config,ts.sys.readFile);
      if(read.error) throw new Error(`Cannot read ${config}`);
      const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,dirname(config));
      const errors=parsed.errors.filter(e=>![18002,18003].includes(e.code));
      if(errors.length) throw new Error(`Invalid ${config}: ${errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; ')}`);
      optionCache.set(config,parsed.options);
    }
    return optionCache.get(config);
  }
  for(const file of files.filter(p=>sourcePattern.test(p))) {
    const from=rel(file),pkg=owner(file);
    if(!pkg) throw new Error(`Source has no workspace owner: ${from}`);
    const content=readFileSync(file,'utf8');
    const sf=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true);
    for(const error of sf.parseDiagnostics) add('parse-error',from,'',ts.flattenDiagnosticMessageText(error.messageText,' '));
    const options=optionsFor(file);
    function check(node,argument) {
      const line=sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1;
      const statement=moduleTokens(node,sf);
      if(!argument||!(ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument))) {
        add('computed-module',from,'<computed>',[statement,content],line);return;
      }
      const specifier=argument.text;
      const targetPkg=[...byName.values()].find(p=>specifier===p.data.name||specifier.startsWith(p.data.name+'/'));
      let target;
      let publicEntry=false;
      if(targetPkg) {
        const key=specifier===targetPkg.data.name?'.':'.'+specifier.slice(targetPkg.data.name.length);
        const exports=exportMap(targetPkg.data);
        if(Object.hasOwn(exports,key)&&!key.includes('*')) {
          publicEntry=true;
          target=leaves(exports[key]).map(p=>sourceFile(resolve(targetPkg.dir,p))).find(Boolean);
        } else {
          for(const [pattern,values] of Object.entries(exports)) {
            if(!pattern.includes('*')) continue;
            const [start,end]=pattern.split('*');
            if(!key.startsWith(start)||!key.endsWith(end)) continue;
            const middle=key.slice(start.length,end.length?-end.length:undefined);
            target=leaves(values).map(p=>sourceFile(resolve(targetPkg.dir,p.replaceAll('*',middle)))).find(Boolean);
          }
          target ||= sourceFile(resolve(targetPkg.dir,specifier.slice(targetPkg.data.name.length+1)));
        }
      }
      const resolvedModule = ts.resolveModuleName(specifier,file,options,ts.sys).resolvedModule?.resolvedFileName;
      // TS paths take precedence even when an alias looks like a canonical workspace name.
      const mapped = Object.keys(options.paths||{}).some(pattern => {
        const [start,end] = pattern.split('*');
        return end === undefined ? specifier === start : specifier.startsWith(start) && specifier.endsWith(end);
      });
      if(mapped) target = resolvedModule;
      else target ||= resolvedModule;
      if(!target&&specifier.startsWith('.')) target=sourceFile(resolve(dirname(file),specifier));
      if(target) target=realpathSync(target);
      const targetOwner=target&&owner(target);
      if(targetOwner&&sourcePattern.test(target)&&!files.includes(target)) add('unscanned-module',from,rel(target),statement,line);
      if(target&&!targetOwner&&(specifier.startsWith('.')||specifier.startsWith('/')||(target.startsWith(root+sep)&&!target.includes(sep+'node_modules'+sep)))) add('outside-workspace',from,rel(target),statement,line);
      if(targetOwner&&targetOwner!==pkg) {
        direction(from,rel(target),statement,line,isTest(from));
        if(!publicEntry||targetPkg!==targetOwner) add('public-entrypoint',from,rel(target),statement,line);
      } else if(targetPkg&&targetPkg!==pkg) {
        direction(from,rel(targetPkg.path),statement,line,isTest(from));
        if(!publicEntry) add('public-entrypoint',from,specifier,statement,line);
      }
      if(!target&&(specifier.startsWith('.')||specifier.startsWith('/')||specifier.startsWith('@everlast/')||specifier.startsWith('#')||Object.keys(options.paths||{}).some(p=>specifier.startsWith(p.split('*')[0]))))
        add('unresolved-internal',from,specifier,statement,line);
      // Contracts may use their schema library, not third-party runtime adapters.
      if(!isTest(from)&&pkg.data.name==='@everlast/contracts'&&!targetOwner&&!specifier.startsWith('.')&&specifier!=='zod'&&!specifier.startsWith('zod/'))
        add('contracts-only',from,specifier,statement,line);
      if(pkg.data.name==='@everlast/web'&&/^(node:|pg$|@google\/|@google-cloud\/)/.test(specifier)&&!isTest(from))
        add('browser-safe',from,specifier,statement,line);
    }
    const factories = new Set(), loaders = new Set(['require']);
    for(const node of sf.statements) {
      if(ts.isImportDeclaration(node)&&['node:module','module'].includes(node.moduleSpecifier.text)) {
        const bindings=node.importClause?.namedBindings;
        if(bindings&&ts.isNamedImports(bindings)) for(const binding of bindings.elements)
          if((binding.propertyName||binding.name).text==='createRequire') factories.add(binding.name.text);
      }
    }
    let changed=true;
    while(changed) {
      changed=false;
      const collect=node=>{
        if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer) {
          const init=node.initializer;
          if((ts.isCallExpression(init)&&ts.isIdentifier(init.expression)&&factories.has(init.expression.text))||
            (ts.isIdentifier(init)&&loaders.has(init.text))) {
            if(!loaders.has(node.name.text)) {loaders.add(node.name.text);changed=true;}
          }
        }
        ts.forEachChild(node,collect);
      };
      collect(sf);
    }
    function visit(node) {
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier) check(node,node.moduleSpecifier);
      else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)) check(node,node.moduleReference.expression);
      else if(ts.isImportTypeNode(node)) check(node,ts.isLiteralTypeNode(node.argument)?node.argument.literal:node.argument);
      else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&loaders.has(node.expression.text)))) check(node,node.arguments[0]);
      ts.forEachChild(node,visit);
    }
    visit(sf);
  }
  const adjacency=new Map();
  for(const e of edges) { if(!adjacency.has(e.a)) adjacency.set(e.a,new Set());adjacency.get(e.a).add(e.b); }
  const reaches=(a,b,seen=new Set())=>a===b||(!seen.has(a)&&(seen.add(a),[...(adjacency.get(a)||[])].some(next=>reaches(next,b,seen))));
  for(const e of edges) if(reaches(e.b,e.a)) add('package-cycle',e.from,e.to,e.statement,e.line);
  // Count identical statements so copying an existing violation is not grandfathered.
  const grouped=new Map();
  for(const v of violations) {const key=violationKey(v);if(grouped.has(key)) grouped.get(key).count++;else grouped.set(key,{...v,count:1});}
  return [...grouped.values()].sort((a,b)=>violationKey(a).localeCompare(violationKey(b)));
}
export const violationKey=v=>JSON.stringify([v.rule,v.from,v.to,v.fingerprint]);
export function checkArchitecture(root,{policy={version:1,exceptions:[]},now=new Date().toISOString().slice(0,10),basePolicy}={}) {
  const violations=inspectArchitecture(root),findings=[];
  if(policy.version!==1||!Array.isArray(policy.exceptions)) throw new Error('Invalid architecture policy schema');
  const remaining=new Map(violations.map(v=>[violationKey(v),v]));
  const seen=new Set();
  for(const e of policy.exceptions) {
    const key=violationKey(e),v=remaining.get(key);
    const error=rule=>findings.push({...e,rule});
    if(seen.has(key)) error('duplicate-exception');
    seen.add(key);
    if(!['owner','decision','baseline','removalTask','reason'].every(k=>typeof e[k]==='string'&&e[k].trim())||
      !/^D\d+$/.test(e.decision)||!/^\d{4}-\d{2}-\d{2}$/.test(e.expires)||
      Number.isNaN(Date.parse(e.expires))||new Date(e.expires).toISOString().slice(0,10)!==e.expires||!Number.isInteger(e.count)||e.count<1)
      error('invalid-exception');
    if(e.expires<=now) error('expired-exception');
    const removal = typeof e.removalTask === 'string' && e.removalTask.match(/^(specs\/[a-zA-Z0-9_-]+) (T\d+)$/);
    if(!removal || !existsSync(join(root,removal[1],'tasks.md'))) error('invalid-removal-task');
    else if(!new RegExp('^- \\[ \\] '+removal[2]+'\\b','m').test(readFileSync(join(root,removal[1],'tasks.md'),'utf8')))
      error('completed-or-missing-removal-task');
    if(!v) error('stale-exception');
    else if(v.count!==e.count) error('exception-count');
    if(basePolicy&&!basePolicy.exceptions.some(old=>JSON.stringify({...old,line:0})===JSON.stringify({...e,line:0}))) error('exception-expansion');
    remaining.delete(key);
  }
  findings.push(...remaining.values());
  return {violations,findings,exceptions:policy.exceptions};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    let baseRef,asJson=false;
    for(let i=0;i<args.length;i++) {
      if(args[i]==='--json') asJson=true;
      else if(args[i]==='--base-ref'&&args[i+1]) baseRef=args[++i];
      else throw new Error(`Unknown argument: ${args[i]}`);
    }
    const root=process.cwd(),policy=json(join(root,'scripts/architecture-policy.json'));
    let basePolicy;
    if(baseRef) {
      if(!/^[a-zA-Z0-9_./-]+$/.test(baseRef)||baseRef.startsWith('-')) throw new Error('Invalid base ref');
      const files=execFileSync('git',['ls-tree','--name-only',baseRef,'scripts/architecture-policy.json'],{encoding:'utf8'});
      if(files.trim()) basePolicy=JSON.parse(execFileSync('git',['show',`${baseRef}:scripts/architecture-policy.json`],{encoding:'utf8'}));
      else console.error('Architecture policy bootstrap: no base policy; owner review required for initial inventory.');
    }
    const result=checkArchitecture(root,{policy,basePolicy});
    if(asJson) console.log(JSON.stringify(result,null,2));
    else {
      for(const v of result.findings) console.error(`${v.from}:${v.line||1} → ${v.to}: ${v.rule}`);
      console.log(`Architecture: ${result.findings.length} finding(s); ${result.exceptions.length} exact legacy exception(s).`);
    }
    process.exitCode=result.findings.length?1:0;
  } catch(error) {console.error(`Architecture check failed: ${error.message}`);process.exitCode=1;}
}
