import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook, admitOnDemandGuide, finishOnDemandGuide, recoverOnDemandGuides } from "../src/index.ts";
/** [008-studio-text-reports] T072 — FR-SI-02/FR-ST-11/NFR-SEC-02, real PostgreSQL admission. */
let db: TestDatabase;
beforeAll(async()=>{db=await createTestDatabase();});
afterAll(async()=>{await db?.drop();});
async function fixture(){
 const owner=await createTestUser(db.pool);const {notebook}=await createNotebook(db.pool,owner,{});
 const source=await seedReadySource(db.pool,owner,notebook.id,{title:"facts",mediaType:"text/plain",pages:["A fact in 2020."],embed:async texts=>texts.map(()=>Array(768).fill(0))});
 return {notebook_id:notebook.id,user_id:owner,source_id:source.sourceId,revision:1};
}
it("serializes concurrent admissions, charges duplicates once and releases failed slots",async()=>{
 const f=await fixture();const inputs=Array.from({length:12},(_,i)=>({...f,output_language:`test-${i}`}));
 const results=await Promise.all(inputs.map(input=>admitOnDemandGuide(db.pool,input)));
 expect(results.filter(r=>r.state==="started")).toHaveLength(2);
 expect(results.filter(r=>r.state==="concurrency")).toHaveLength(10);
 const idx=results.findIndex(r=>r.state==="started"),input=inputs[idx]!;
 expect((await admitOnDemandGuide(db.pool,input)).state).toBe("deduplicated");
 const started=results[idx]!;if(started.state!=="started")throw new Error("not admitted");
 await finishOnDemandGuide(db.pool,started.id);
 expect((await admitOnDemandGuide(db.pool,{...f,output_language:"new"})).state).toBe("started");
});
it("counts failed starts in a rolling hour, including across restart and boundary",async()=>{
 const f=await fixture();const now=new Date("2026-11-07T12:59:59Z");
 for(let i=0;i<20;i++){
  const r=await admitOnDemandGuide(db.pool,{...f,output_language:`variant-${i}`},{now});
  expect(r.state).toBe("started");if(r.state==="started")await finishOnDemandGuide(db.pool,r.id);
 }
 expect((await admitOnDemandGuide(db.pool,{...f,output_language:"blocked"},{now:new Date(now.getTime()+2000)})).state).toBe("rate");
 await recoverOnDemandGuides(db.pool);
 expect((await admitOnDemandGuide(db.pool,{...f,output_language:"still-blocked"},{now:new Date(now.getTime()+3000)})).state).toBe("rate");
 expect((await admitOnDemandGuide(db.pool,{...f,output_language:"hour-later"},{now:new Date(now.getTime()+3600000)})).state).toBe("started");
 await recoverOnDemandGuides(db.pool);
 expect((await db.pool.query("SELECT count(*)::int AS n FROM guide_admissions WHERE notebook_id=$1 AND finished_at IS NULL",[f.notebook_id])).rows[0].n).toBe(0);
 expect((await db.pool.query("SELECT count(*)::int AS n FROM guide_admissions WHERE notebook_id=$1",[f.notebook_id])).rows[0].n).toBe(1);
});
it("honors configuration and rejects foreign ownership or stale scope without charging",async()=>{
 const f=await fixture();const foreign=await createTestUser(db.pool);
 await expect(admitOnDemandGuide(db.pool,{...f,user_id:foreign,output_language:"fr-FR"})).rejects.toThrow();
 await expect(admitOnDemandGuide(db.pool,{...f,revision:2,output_language:"fr-FR"})).rejects.toThrow();
 const options={maxConcurrent:1,maxStartsPerHour:1};
 const r=await admitOnDemandGuide(db.pool,{...f,output_language:"fr-FR"},options);
 expect(r.state).toBe("started");
 if(r.state==="started")await finishOnDemandGuide(db.pool,r.id);
 expect((await admitOnDemandGuide(db.pool,{...f,output_language:"de-DE"},options)).state).toBe("rate");
});
