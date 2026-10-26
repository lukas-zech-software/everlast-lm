import { createHash } from 'node:crypto';
import { ScopedCorpusManifestSchema, type ScopedCorpusManifest } from '@everlast/contracts';
import type { Queryable } from './transaction.ts';
import { verifyScopeSnapshot, type ScopeSnapshot } from './scope-guard.ts';
import { streamSnapshotChunks } from './scoped-context.ts';

/** C-02, NFR-PERF-01: caller supplies a qualified tokenizer, never an inferred token count. */
export interface CorpusTokenizer { model:string; version:string; count(text:string):Promise<number>; }
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export async function buildScopedCorpusLedger(db:Queryable,captured:ScopeSnapshot,tokenizer:CorpusTokenizer):Promise<ScopedCorpusManifest> {
 const snapshot={...captured,sources:captured.sources.map(s=>({...s})).sort((a,b)=>a.source_id.localeCompare(b.source_id))};
 await verifyScopeSnapshot(db,snapshot);
 const pages:ScopedCorpusManifest['pages']=[];
 // One canonical page at a time: no original source text retained by the ledger.
 for(const source of snapshot.sources){
  let cursor=0;
  for(;;){
   await verifyScopeSnapshot(db,snapshot);
   const result=await db.query<{page_number:number;text:string}>(
    'SELECT page_number,text FROM source_pages WHERE notebook_id=$1 AND source_id=$2 AND revision=$3 AND page_number>$4 ORDER BY page_number LIMIT 1',
    [snapshot.notebook_id,source.source_id,source.revision,cursor]);
   const row=result.rows[0];
   if(!row) break;
   const tokens=await tokenizer.count(row.text);
   if(!Number.isSafeInteger(tokens)||tokens<0) throw new Error('Invalid qualified token count');
   pages.push({...source,page_number:row.page_number,digest:digest(row.text),token_count:tokens});
   cursor=row.page_number;
  }
  if(!pages.some(p=>p.source_id===source.source_id)) throw new Error('Canonical source text is unavailable');
 }
 const chunks:ScopedCorpusManifest['chunks']=[];
 for await(const page of streamSnapshotChunks(db,snapshot)) for(const c of page)
  chunks.push({chunk_id:c.chunk_id,source_id:c.source_id,revision:c.revision,digest:digest(c.text),token_count:c.token_count,locator:c.locator});
 await verifyScopeSnapshot(db,snapshot);
 const record={notebook_id:snapshot.notebook_id,principal_subject:snapshot.owner_id,
  effective_authorization_fingerprint:digest(JSON.stringify({owner:snapshot.owner_id,notebook:snapshot.notebook_id,sources:snapshot.sources})),
  sources:snapshot.sources,token_counting_model:tokenizer.model,token_counting_version:tokenizer.version,
  source_token_total:pages.reduce((n,p)=>n+p.token_count,0),pages,chunks};
 return ScopedCorpusManifestSchema.parse({...record,manifest_hash:digest(JSON.stringify(record))});
}
