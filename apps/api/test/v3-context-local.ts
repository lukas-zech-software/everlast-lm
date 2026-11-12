import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { seedReadySource } from '@everlast/db/testing';
import { buildScopedCorpusLedger, captureScopeSnapshot, runWithV2Persistence, saveSourceGuide } from '@everlast/db';
import type { V2RuntimeOptions } from '../src/v2/runtime.ts';
type StudioContextRuntime=NonNullable<V2RuntimeOptions['studioContext']>;
type ReportModelClient=NonNullable<V2RuntimeOptions['reportModel']>;
type ExtractRequest=Parameters<ReportModelClient['extract']>[0];
type ComposeRequest=Parameters<ReportModelClient['compose']>[0];
type Finding=Awaited<ReturnType<ReportModelClient['extract']>>[number];
import { startNotesApi, type NotesApi } from './notes-pg-support.ts';

/** NFR-PERF-01: explicitly LOCAL doubles, genuine source text/DB/C-02/ordinary APIs, never enterprise proof. */
class LocalReportModel implements ReportModelClient{
 seen=new Set<string>();maxTokens=0;maxChunks=0;calls=0;cachedCalls=0;
 onExtract:(()=>Promise<void>)|undefined;
 reset(){this.seen.clear();this.maxTokens=0;this.maxChunks=0;this.calls=0;this.cachedCalls=0;}
 async extract(req:ExtractRequest):Promise<Finding[]>{
  this.calls++;if(req.cached_context)this.cachedCalls++;
  this.maxTokens=Math.max(this.maxTokens,req.chunks.reduce((n,c)=>n+c.token_count,0));this.maxChunks=Math.max(this.maxChunks,req.chunks.length);
  for(const c of req.chunks)this.seen.add(c.chunk_id);
  await this.onExtract?.();
  return req.chunks.filter(c=>c.text.includes('142.8 bar')).map(c=>({kind:'qa',text:'The reactor coolant pressure must be 142.8 bar.',question:'What must the reactor coolant pressure be?',chunk_id:c.chunk_id,source_id:c.source_id,quote:'142.8 bar'}));
 }
 async compose(req:ComposeRequest){return [{id:'faq',items:req.findings.filter(f=>f.kind==='qa').map(f=>({text:f.text,chunk_id:f.chunk_id,...(f.quote!==undefined?{quote:f.quote}:{}),...(f.question!==undefined?{question:f.question}:{})}))}];}
}
const OWNER='scale-local-owner';
const count=(text:string)=>text.trim().split(/\s+/).filter(Boolean).length;
const tokenizer={qualification:'local-double' as const,model:'LOCAL-DOUBLE-whitespace',version:'whitespace-v1',count:async(text:string)=>count(text)};
async function terminal(n:NotesApi,nb:string,id:string){
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){const r=await n.call(OWNER,'GET',`/api/notebooks/${nb}/studio/artifacts/${id}`);if(['Completed','Failed','Cancelled'].includes(r.json.artifact.status))return r.json.artifact;await new Promise(resolve=>setTimeout(resolve,10));}
 throw new Error('Bounded ordinary Studio poll timed out');
}
async function generate(n:NotesApi,nb:string,ids:string[],plugin='report'){
 const r=await n.call(OWNER,'POST',`/api/notebooks/${nb}/studio/artifacts`,{plugin_type:plugin,subtype:plugin==='report'?'faq':'default',active_source_ids:ids});assert.equal(r.status,202,JSON.stringify(r.json));return terminal(n,nb,r.json.artifact.id);
}
export async function runLocalContextStress(){
 const model=new LocalReportModel();let providerCreates=0,providerDeletes=0,providerReads=0,failCreate=false,now=Date.now();
 const contextObservations:Parameters<NonNullable<StudioContextRuntime['onObservation']>>[0][]=[];
 const mapSeen=new Set<string>(),tableSeen=new Set<string>();
 const mindmapModel:NonNullable<V2RuntimeOptions['mindmapModel']>={extract:async req=>{for(const c of req.chunks)mapSeen.add(c.chunk_id);return req.chunks.filter(c=>c.text.includes('142.8 bar')).map(c=>({topic:'Reactor',subtopic:'Pressure',detail:'142.8 bar',chunk_id:c.chunk_id,source_id:c.source_id,revision:c.revision,snippet:'142.8 bar'}));},compose:async req=>{const f=req.findings[0]!;const ref={badge_number:1,source_id:f.source_id,chunk_id:f.chunk_id,revision:f.revision,snippet:f.snippet};const leaf={id:'pressure',label:'Pressure',summary:'142.8 bar',label_citations:[ref],summary_citations:[ref],children:[]};return {root_node:{...leaf,id:'root',children:[leaf]},node_count:2,max_depth:2,initial_expanded_depth:2,insufficient_evidence_note:'Local diagnostic fixture contains one grounded fact.',citations:[ref]};}};
 const dataTableModel:NonNullable<V2RuntimeOptions['dataTableModel']>={extract:async req=>{for(const c of req.chunks)tableSeen.add(c.chunk_id);return req.chunks.filter(c=>c.text.includes('142.8 bar')).map(c=>({item_label:'Reactor',attribute_id:'pressure',attribute_label:'Pressure',value_text:'142.8 bar',chunk_id:c.chunk_id,source_id:c.source_id,revision:c.revision,snippet:'142.8 bar'}));},compose:async req=>{const f=req.observations[0]!;const ref={badge_number:1,source_id:f.source_id,chunk_id:f.chunk_id,revision:f.revision,snippet:f.snippet};const cell={state:'supported' as const,display_text:'142.8 bar',disagreement:false as const,values:[{value:'142.8 bar',citations:[ref]}]};return {payload:{schema_id:'auto',focus_prompt:null,columns:[{id:'entity',label:'Reactor',citations:[ref]},{id:'pressure',label:'Pressure',citations:[ref]}],rows:[{item_id:'reactor',item_label:'Reactor',item_citations:[ref],cells:{entity:cell,pressure:cell}}],citations:[ref]},rawRowCount:1,rawColumnCount:2};}};
 const context:StudioContextRuntime={model:'LOCAL-DOUBLE-report',modelVersion:'1',inputLimit:110_000,outputReserve:4096,instructionTokens:1000,ttlSeconds:60,tokenizer,clock:()=>now,
  provider:{create:async({chunks,ttlSeconds})=>{providerCreates++;if(failCreate){failCreate=false;throw new Error('LOCAL provider create failure');}for await(const page of chunks){providerReads+=page.length;}return {handle:`LOCAL-PRIVATE-${providerCreates}`,expiresAt:now+ttlSeconds*1000};},delete:async()=>{providerDeletes++;}},
  onObservation:o=>contextObservations.push(o),
 };
 let n=await startNotesApi({sourceLimit:300,v2:{reportModel:model,mindmapModel,dataTableModel,studioContext:context}});
 const allApis=[n];const startMemory=process.memoryUsage().rss;let peakRss=startMemory;
 const memoryTimer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},10);memoryTimer.unref();
 const boundaries:{source_tokens:number;original_chunks:number;extracted_chunks:number;max_batch_tokens:number;max_batch_chunks:number;completed:boolean;mode:string;cache_hit:boolean;model_calls:number}[]=[];
 try{
  let first:{nb:string;ids:string[];needle:string;needleSource:string}|undefined;
  for(const total of [99999,100000,100001]){
   const nb=await n.notebook(OWNER),owner=await n.userId(OWNER),ids:string[]=[],chunkIds:string[]=[];
   let needle='',needleSource='';
   for(let i=0;i<40;i++){
    const tokens=Math.floor(total/40)+(i<total%40?1:0),fact='The reactor coolant pressure must be 142.8 bar.';
    const text=i===32?'context '.repeat(tokens-count(fact))+fact:'context '.repeat(tokens).trim();
    assert.equal(count(text),tokens);
    const source=await seedReadySource(n.api.db.pool,owner,nb,{title:`Scale ${i+1}.txt`,mediaType:'text/plain',pages:[text],embed:t=>n.embedder.embed(t,'RETRIEVAL_DOCUMENT')});
    ids.push(source.sourceId);chunkIds.push(...source.chunkIds);if(i===32){needle=source.chunkIds[0]!;needleSource=source.sourceId;}
   }
   const scope=await captureScopeSnapshot(n.api.db.pool,owner,nb,ids),ledger=await buildScopedCorpusLedger(n.api.db.pool,scope,tokenizer);
   assert.equal(ledger.source_token_total,total);assert.equal(ledger.chunks.length,40);
   model.reset();const artifact=await generate(n,nb,ids);assert.equal(artifact.status,'Completed',JSON.stringify(artifact.failure));
   assert.deepEqual([...model.seen].sort(),chunkIds.sort());assert(model.maxTokens<=4000);assert(model.maxChunks<=8);assert(artifact.payload_json.citations.some((c:{chunk_id:string})=>c.chunk_id===needle));
   const observed=contextObservations.at(-1)!;
   assert.equal(observed.mode,total>100000?'ChunkMapReduce':'CachedFullContext');
   boundaries.push({source_tokens:ledger.source_token_total,original_chunks:chunkIds.length,extracted_chunks:model.seen.size,max_batch_tokens:model.maxTokens,max_batch_chunks:model.maxChunks,completed:true,mode:observed.mode,cache_hit:observed.cache_hit,model_calls:model.calls});
   if(!first)first={nb,ids,needle,needleSource};
  }
  const f=first!,owner=await n.userId(OWNER);
  // All forty guides are observed by the ordinary grounded model, followed by original-detail retrieval.
  await runWithV2Persistence(n.api.db.pool,async()=>{for(const id of f.ids)await saveSourceGuide({notebook_id:f.nb,source_id:id,revision:1,output_language:'en-US',status:'GuideReady',source_word_count:25000,summary_md:`Guide for ${id}`,key_topics:['context'],supporting_chunk_ids:[(await n.api.db.pool.query('SELECT chunk_id FROM chunks WHERE source_id=$1',[id])).rows[0].chunk_id]});});
  n.model.script=({chunks})=>{const c=chunks.find(c=>c.chunk_id===f.needle);return c?{status:'answered',sentences:[{kind:'claim',text:'The reactor coolant pressure must be 142.8 bar.',citations:[c.chunk_id]}]}:{status:'not_in_sources',sentences:[]};};
  const broad=await n.turn(OWNER,f.nb,'Summarize themes across all 40 sources',f.ids);assert.equal(broad.status,200);
  const broadInput=n.model.calls.at(-1)!;assert.equal(broadInput.guides?.length,40);assert.deepEqual(broadInput.guides?.map(g=>g.source_id).sort(),[...f.ids].sort());
  const detail=await n.turn(OWNER,f.nb,'What must the reactor coolant pressure be?',f.ids);assert.equal(detail.status,200);
  const needleCited=detail.messages.some(m=>m.role==='assistant'&&m.citations?.some((c:{chunk_id:string})=>c.chunk_id===f.needle));assert(needleCited);
  const map=await generate(n,f.nb,f.ids,'mindmap'),table=await generate(n,f.nb,f.ids,'data_table');
  assert.equal(map.status,'Completed',JSON.stringify(map.failure));assert.equal(table.status,'Completed',JSON.stringify(table.failure));
  assert.equal(mapSeen.size,40);assert.equal(tableSeen.size,40);assert.equal(map.payload_json.coverage.total_chunks,40);assert.equal(table.payload_json.coverage.total_chunks,40);
  // Ordinary repeated jobs use the same private cache key; expiry/restart force original-byte creation again.
  let before=providerCreates;model.reset();assert.equal((await generate(n,f.nb,f.ids)).status,'Completed');assert.equal(providerCreates,before);assert(model.cachedCalls>0);const hit=true;
  now+=61000;assert.equal((await generate(n,f.nb,f.ids)).status,'Completed');assert.equal(providerCreates,before+1);const expiry=true;
  n.v2.close();n=await startNotesApi({db:n.api.db,sourceLimit:300,v2:{reportModel:model,mindmapModel,dataTableModel,studioContext:context}});allApis.push(n);
  before=providerCreates;assert.equal((await generate(n,f.nb,f.ids)).status,'Completed');assert.equal(providerCreates,before+1);const restart=true;
  now+=61000;failCreate=true;assert.equal((await generate(n,f.nb,f.ids)).status,'Completed');assert.equal(contextObservations.at(-1)?.mode,'ChunkMapReduce');
  // Revocation during extraction makes cache ineligible and publishes no partial artifact.
  let mutated=false;model.onExtract=async()=>{if(!mutated){mutated=true;await n.api.db.pool.query('UPDATE sources SET active_revision=2 WHERE id=$1',[f.needleSource]);}};
  const revoked=await generate(n,f.nb,f.ids);assert.equal(revoked.status,'Failed');assert.equal(revoked.payload_json,null);assert(providerDeletes>0);model.onExtract=undefined;
  // Full 300-source admission and over-limit rejection via normal copied-text API; no declared quota-only field.
  const quotaNotebook=await n.notebook(OWNER);let admitted=0;const quotaIds:string[]=[];
  for(let i=0;i<300;i++){
   const r=await n.call(OWNER,'POST',`/api/notebooks/${quotaNotebook}/sources/text`,{attempt_id:randomUUID(),text:i===299?'The reactor coolant pressure must be 142.8 bar.':`Quota evidence ${i}.`});assert.equal(r.status,201,JSON.stringify(r.json));admitted++;quotaIds.push(r.json.source.id);
  }
  const excess=await n.call(OWNER,'POST',`/api/notebooks/${quotaNotebook}/sources/text`,{attempt_id:randomUUID(),text:'Quota evidence 301.'});assert.equal(excess.status,409);assert.match(JSON.stringify(excess.json),/limit|quota/i);
  const readyDeadline=Date.now()+30000;let readyCount=0;
  while(Date.now()<readyDeadline){await n.drain();const listing=await n.call(OWNER,'GET',`/api/notebooks/${quotaNotebook}/sources`);readyCount=listing.json.sources.filter((source:{status:string})=>source.status==='Ready').length;if(readyCount===300)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(readyCount,300);model.reset();const quotaArtifact=await generate(n,quotaNotebook,quotaIds);assert.equal(quotaArtifact.status,'Completed',JSON.stringify(quotaArtifact.failure));assert.equal(model.seen.size,300);
  const rss=process.memoryUsage().rss;peakRss=Math.max(peakRss,rss);assert(peakRss-startMemory<=256_000_000,'Local predeclared 256MB RSS growth ceiling exceeded');
  return {schema:'everlast.studio-context-v3-report/2',timestamp:new Date().toISOString(),profile:'local-api',result:'PASS',release_result:'UNAVAILABLE',qualification:'LOCAL whitespace tokenizer, scripted model, hashing embeddings and cache-provider doubles; real PostgreSQL/C-02/admission/Studio lifecycle',boundaries,quota:{admitted,rejected_301:true,ready_sources:readyCount,originals_processed:model.seen.size,completed:quotaArtifact.status==='Completed'},guide_routing:{guide_count:40,needle_cited:needleCited},studio_consumers:{report:true,mindmap:map.status==='Completed',data_table:table.status==='Completed',mindmap_originals:mapSeen.size,table_originals:tableSeen.size},cache:{miss:true,hit,expiry,restart,revocation:revoked.status==='Failed',create_failure_recovery:true,provider_creates:providerCreates,provider_deletes:providerDeletes,original_chunks_transferred:providerReads},memory:{node:process.version,exec_argv:process.execArgv,rss_before_bytes:startMemory,rss_after_bytes:rss,rss_delta_bytes:rss-startMemory,peak_rss_bytes:peakRss,peak_growth_limit_bytes:256_000_000,c02_page_limit:16,model_concurrency_limit:4},missing_release_prerequisites:['qualified enterprise EU model/tokenizer/provider cache','approved deployed candidate and prospective readiness/clock evidence','complete cloud Gate v3 and judged release sample']};
 }catch(error){throw Object.assign(error as Error,{report:{schema:'everlast.studio-context-v3-report/2',profile:'local-api',result:'FAIL',release_result:'UNAVAILABLE',boundaries,context_observations:contextObservations,provider_creates:providerCreates,provider_deletes:providerDeletes,error:(error as Error).message}});}
 finally{clearInterval(memoryTimer);model.onExtract=undefined;for(const api of [...allApis].reverse())await api.close();}
}

/** NFR-PERF-01: actual local ordinary HTTP pair diagnostics; tiny fixtures and absent enterprise proof stay UNAVAILABLE. */
export async function runLocalScalePairs(collect:(fixture:unknown,options:unknown)=>Promise<{result:string;core:{attempt_count:number};concurrency?:{count:number;observations:unknown[]};release_eligible:boolean}>){
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const n=await startNotesApi();let active=0,peak=0;
 try{
  const scopes=[];
  for(const actor of ['local-scale-owner-a','local-scale-owner-b']){
   const notebookId=await n.notebook(actor),owner=await n.userId(actor),ids:string[]=[];let needle='';
   for(let i=0;i<40;i++){const seeded=await seedReadySource(n.api.db.pool,owner,notebookId,{title:`Pair ${i}`,pages:[i===32?'Reactor coolant pressure must be 142.8 bar.':`Pair evidence ${i}.`],embed:t=>n.embedder.embed(t,'RETRIEVAL_DOCUMENT')});ids.push(seeded.sourceId);if(i===32)needle=seeded.chunkIds[0]!;}
   const raw=JSON.parse(await readFile('packages/evals/fixtures/v3/scale-manifest.json','utf8'));delete raw.fixture_hash;
   const recipe={...raw,active_source_ids:ids,needle_source_id:ids[32],needle_chunk_id:needle,decoy_source_id:randomUUID()};
   scopes.push({notebookId,owner,token:n.api.token(actor),fixture:{...recipe,fixture_hash:createHash('sha256').update(JSON.stringify(recipe)).digest('hex')},needle});
  }
  n.model.script=async({chunks})=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,40));const c=chunks.find(c=>c.text.includes('142.8 bar'));return c?{status:'answered',sentences:[{kind:'claim',text:'Reactor coolant pressure must be 142.8 bar.',citations:[c.chunk_id]}]}:{status:'not_in_sources',sentences:[]};}finally{active--;}};
  const [a,b]=scopes;assert(a&&b);assert.notEqual(a.owner,b.owner);
  const report=await collect(a.fixture,{baseUrl:n.api.baseUrl,token:a.token,notebookId:a.notebookId,profile:'concurrency',concurrencyNotebookId:b.notebookId,concurrencyToken:b.token,concurrencyFixture:b.fixture,timeoutMs:5000});
  assert.equal(report.result,'UNAVAILABLE');assert.equal(report.release_eligible,false);assert.equal(report.core.attempt_count,40);assert.equal(report.concurrency?.count,20);assert.equal(peak,2);
  return {result:'PASS',release_result:'UNAVAILABLE',qualification:'LOCAL tiny fixtures/model double; real HTTP/authentication/PostgreSQL/C-02, no private enterprise proof',attempted_requests:60,core_attempts:40,diagnostic_requests:20,peak_model_concurrency:peak,distinct_owners:true,collector_report:report};
 }finally{await n.close();}
}
