import { afterAll, beforeAll, expect, it } from "vitest";
import { seedReadySource } from "@everlast/db/testing";
import { DeterministicReportModel } from "@everlast/worker/studio/reports/deterministic-model";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";
/** [008-studio-text-reports] T072 — FR-SI-02, FR-ST-11, NFR-SEC-02. Model is a held test double. */
let n: NotesApi;
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
let calls = 0;
beforeAll(async () => {
  n = await startNotesApi({ v2: { suggestionModel: new DeterministicReportModel(), generation: {
    async generateSourceGuide(): Promise<never> { calls++; await gate; throw new Error("scripted failure"); },
    async generateOverview(): Promise<never> { throw new Error("unused"); },
    async generateFollowUps(): Promise<never> { throw new Error("unused"); },
  } } });
});
afterAll(async () => { release(); await n?.close(); });
it("atomically limits concurrent on-demand variants, deduplicates and keeps standard reports usable", async () => {
  const owner = "guide-limit-owner";
  const nb = await n.notebook(owner), uid = await n.userId(owner);
  const sources = [];
  for (let i=0; i<5; i++) sources.push(await seedReadySource(n.api.db.pool, uid, nb, { title: `Vendor${i}`, mediaType: "text/plain", pages: [`Vendor ${i} recorded a proposal in 2020.`], embed:t=>n.embedder.embed(t,"RETRIEVAL_DOCUMENT") }));
  const path = (id:string) => `/api/notebooks/${nb}/sources/${id}/guide?revision=1&language=fr-FR`;
  const requests = await Promise.all(sources.map(s=>n.call(owner,"GET",path(s.sourceId))));
  for(let i=0;i<100 && calls<2;i++) await new Promise(r=>setTimeout(r,10));
  expect(calls).toBe(2);
  expect(requests.filter(r=>r.status===202)).toHaveLength(2);
  expect(requests.filter(r=>r.status===429)).toHaveLength(3);
  const admitted = sources[requests.findIndex(r=>r.status===202)]!;
  await Promise.all(Array.from({length:10},()=>n.call(owner,"GET",path(admitted.sourceId))));
  expect(calls).toBe(2);
  const limited = sources[requests.findIndex(r=>r.status===429)]!;
  const suggestions = await n.call(owner,"POST",`/api/notebooks/${nb}/studio/report-suggestions`,{active_source_ids:[limited.sourceId],output_language:"fr-FR"});
  expect(suggestions.json.state).toBe("SuggestionsUnavailable");
  const report = await n.call(owner,"POST",`/api/notebooks/${nb}/studio/artifacts`,{plugin_type:"report",subtype:"faq",active_source_ids:[limited.sourceId]});
  expect(report.status).toBe(202);
  // Ordinary Ready-triggered Guides bypass extra-language admission, even while both slots are occupied.
  const ordinary = n.v2.pollReadySources();
  for(let i=0;i<100 && calls<7;i++) await new Promise(r=>setTimeout(r,10));
  expect(calls).toBe(7);
  expect((await n.api.db.pool.query("SELECT count(*)::int AS n FROM guide_admissions WHERE notebook_id=$1",[nb])).rows[0].n).toBe(2);
  release();
  await ordinary;
  for(let i=0;i<100;i++) {
    const active=(await n.api.db.pool.query("SELECT count(*)::int AS n FROM guide_admissions WHERE notebook_id=$1 AND finished_at IS NULL",[nb])).rows[0].n;
    if(active===0)break;
    await new Promise(r=>setTimeout(r,10));
  }
  const retry=await n.call(owner,"GET",path(limited.sourceId));
  expect(retry.status).toBe(202);
});

it("does not charge or duplicate a primary-language polling race with ordinary Ready dispatch", async()=>{
 let ready:Promise<number>|undefined;
 let unblock!:()=>void;const held=new Promise<void>(r=>{unblock=r;});let primaryCalls=0;
 const app=await startNotesApi({v2:{generation:{
  async generateSourceGuide():Promise<never>{primaryCalls++;await held;throw new Error("scripted ordinary failure");},
  async generateOverview():Promise<never>{throw new Error("unused");},async generateFollowUps():Promise<never>{throw new Error("unused");},
 }}});
 try{
  const owner="primary-guide-owner",nb=await app.notebook(owner),uid=await app.userId(owner);
  const src=await seedReadySource(app.api.db.pool,uid,nb,{title:"Ordinary",mediaType:"text/plain",pages:["Primary evidence."],embed:t=>app.embedder.embed(t,"RETRIEVAL_DOCUMENT")});
  const path=`/api/notebooks/${nb}/sources/${src.sourceId}/guide?revision=1&language=en-US`;
  await Promise.all(Array.from({length:6},()=>app.call(owner,"GET",path)));
  ready=app.v2.pollReadySources();
  for(let i=0;i<100 && primaryCalls<1;i++)await new Promise(r=>setTimeout(r,10));
  expect(primaryCalls).toBe(1);
  expect((await app.api.db.pool.query("SELECT count(*)::int AS n FROM guide_admissions WHERE notebook_id=$1",[nb])).rows[0].n).toBe(0);
  unblock();await ready;
  expect((await app.call(owner,"PATCH",`/api/notebooks/${nb}/preferences`,{notebook_output_language:"fr-FR"})).status).toBe(200);
  await app.call(owner,"GET",path.replace("en-US","fr-FR"));
  for(let i=0;i<100 && primaryCalls<2;i++)await new Promise(r=>setTimeout(r,10));
  expect(primaryCalls).toBe(2);
  expect((await app.api.db.pool.query("SELECT count(*)::int AS n FROM guide_admissions WHERE notebook_id=$1",[nb])).rows[0].n).toBe(1);
 }finally{unblock();await ready;await app.close();}
});
