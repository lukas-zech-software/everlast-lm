import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HashingTestEmbedder } from '@everlast/cloud';
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from '../src/testing.ts';
import { createNotebook } from '../src/notebooks.ts';
import { captureScopeSnapshot } from '../src/scope-guard.ts';
import { streamSnapshotChunks } from '../src/scoped-context.ts';
import { buildScopedCorpusLedger } from '../src/scoped-corpus.ts';
let db: TestDatabase;
const embedder=new HashingTestEmbedder({NODE_ENV:'test'});
beforeAll(async()=>{db=await createTestDatabase();});
afterAll(async()=>{await db?.drop();});
describe('NFR-PERF-01 C-02 original corpus streaming',()=>{
 async function fixture(){
  const owner=await createTestUser(db.pool);
  const {notebook}=await createNotebook(db.pool,owner,{});
  const s=await seedReadySource(db.pool,owner,notebook.id,{pages:['alpha beta\n\ngamma delta','epsilon zeta'],embed:t=>embedder.embed(t)});
  await seedReadySource(db.pool,owner,notebook.id,{pages:['155.0 bar decoy'],embed:t=>embedder.embed(t)});
  const scope=await captureScopeSnapshot(db.pool,owner,notebook.id,[s.sourceId]);
  return {s,scope};
 }
 it('pages only captured originals with backpressure and fails after revision replacement',async()=>{
  const {s,scope}=await fixture();
  const stream=streamSnapshotChunks(db.pool,scope,1);
  expect((await stream.next()).value?.map(c=>c.chunk_id)).toEqual([s.chunkIds[0]]);
  await db.pool.query('UPDATE sources SET active_revision=2 WHERE id=$1',[s.sourceId]);
  await expect(stream.next()).rejects.toMatchObject({code:'SourceSnapshotInvalid'});
 });
 it('counts normalized source pages once, excludes decoy and ignores overlapping chunk counts',async()=>{
  const {s,scope}=await fixture();
  await db.pool.query('UPDATE chunks SET token_count=10000 WHERE source_id=$1',[s.sourceId]);
  const tokenizer={model:'test-only',version:'words-v1',count:async(t:string)=>t.split(/\s+/).filter(Boolean).length};
  const result=await buildScopedCorpusLedger(db.pool,scope,tokenizer);
  expect(result.source_token_total).toBe(6);
  expect(result.pages).toHaveLength(2);
  expect(result.chunks.every(c=>c.locator && c.digest.length===64)).toBe(true);
  expect(result.chunks.map(c=>c.chunk_id)).toEqual(s.chunkIds);
  expect(result.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(await buildScopedCorpusLedger(db.pool,scope,tokenizer)).toEqual(result);
 });
 it('does not prefetch, never follows caller mutation, and excludes foreign owners/notebooks',async()=>{
  const {s,scope}=await fixture();
  const queries:string[]=[];
  const observed={query:async <R extends import('pg').QueryResultRow>(sql:string,args?:unknown[])=>{queries.push(sql);return db.pool.query<R>(sql,args);}};
  const stream=streamSnapshotChunks(observed,scope,1);
  const first=await stream.next();
  expect(first.done).toBe(false);
  const before=queries.length;
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(queries.length).toBe(before);
  scope.sources[0]!.revision=99;
  const second=await stream.next();
  expect(second.value?.[0]?.chunk_id).toBe(s.chunkIds[1]);
  await stream.return();
  const intruder=await createTestUser(db.pool);
  await expect(captureScopeSnapshot(db.pool,intruder,scope.notebook_id,[s.sourceId])).rejects.toMatchObject({status:403});
  const {notebook:foreign}=await createNotebook(db.pool,scope.owner_id,{});
  await expect(captureScopeSnapshot(db.pool,scope.owner_id,foreign.id,[s.sourceId])).rejects.toMatchObject({code:'InvalidScope'});
 });
 it('rejects empty scope, unknown revisions and invalid page sizes',async()=>{
  const {scope}=await fixture();
  await expect(streamSnapshotChunks(db.pool,{...scope,sources:[]}).next()).rejects.toMatchObject({code:'EmptyScope'});
  await expect(streamSnapshotChunks(db.pool,{...scope,sources:scope.sources.map(s=>({...s,revision:99}))}).next()).rejects.toMatchObject({code:'SourceSnapshotInvalid'});
  await expect(streamSnapshotChunks(db.pool,scope,Infinity).next()).rejects.toThrow();
 });
});
