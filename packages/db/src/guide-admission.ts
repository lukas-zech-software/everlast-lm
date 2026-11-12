import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "@everlast/contracts";
import { requireOwnedNotebook } from "./notebooks.ts";
import { withTransaction } from "./transaction.ts";
/** [008-studio-text-reports] T073 — FR-SI-02, FR-ST-11, NFR-SEC-02. */
export interface GuideAdmissionLimits { maxConcurrent: number; maxStartsPerHour: number }
export type GuideAdmission = { state: "started"; id: string } | { state: "deduplicated" | "concurrency" | "rate" };
export async function admitOnDemandGuide(pool: Pool, input: { notebook_id: string; user_id: string; source_id: string; revision: number; output_language: string }, options: Partial<GuideAdmissionLimits> & { now?: Date } = {}): Promise<GuideAdmission> {
  const { maxConcurrent = 2, maxStartsPerHour = 20 } = options;
  for (const n of [maxConcurrent, maxStartsPerHour]) if (!Number.isSafeInteger(n) || n < 1) throw new Error("Guide admission limits must be positive integers");
  return withTransaction(pool, async tx => {
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [input.user_id]);
    await requireOwnedNotebook(tx, input.user_id, input.notebook_id, "update");
    const source = await tx.query("SELECT id FROM sources WHERE notebook_id=$1 AND id=$2 AND status='Ready' AND active_revision=$3 FOR SHARE", [input.notebook_id, input.source_id, input.revision]);
    if (!source.rowCount) throw new AppError("SourceSnapshotInvalid",409,"Requested source revision is not Ready");
    const identity = [input.notebook_id,input.source_id,input.revision,input.output_language];
    const existing = await tx.query(`SELECT 1 FROM guide_admissions WHERE notebook_id=$1 AND source_id=$2 AND revision=$3 AND output_language=$4 AND finished_at IS NULL
      UNION ALL SELECT 1 FROM source_guides WHERE notebook_id=$1 AND source_id=$2 AND revision=$3 AND output_language=$4 LIMIT 1`,identity);
    if (existing.rowCount) return {state:"deduplicated"};
    // Use server/database time unless a private test clock was explicitly supplied.
    const now = options.now ?? (await tx.query<{now:Date}>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    const counts = (await tx.query<{active:number;starts:number}>(`SELECT count(*) FILTER(WHERE finished_at IS NULL)::int AS active,
      count(*) FILTER(WHERE started_at > $2::timestamptz - interval '1 hour')::int AS starts FROM guide_admissions WHERE notebook_id=$1`,[input.notebook_id,now])).rows[0]!;
    if(counts.active>=maxConcurrent)return {state:"concurrency"};
    if(counts.starts>=maxStartsPerHour)return {state:"rate"};
    // Retain active or in-window rows; historical closed metadata need not grow without bound.
    await tx.query("DELETE FROM guide_admissions WHERE notebook_id=$1 AND finished_at IS NOT NULL AND started_at <= $2::timestamptz - interval '1 hour'",[input.notebook_id,now]);
    const id=randomUUID();
    await tx.query("INSERT INTO guide_admissions(id,notebook_id,source_id,revision,output_language,started_at) VALUES($1,$2,$3,$4,$5,$6)",[id,...identity,now]);
    return {state:"started",id};
  });
}
export async function finishOnDemandGuide(pool:Pool,id:string):Promise<void>{
  await pool.query("UPDATE guide_admissions SET finished_at=clock_timestamp() WHERE id=$1 AND finished_at IS NULL",[id]);
}
/** D16 one API instance: called before admitting any work, paired with the orphan Guide sweep. */
export async function recoverOnDemandGuides(pool:Pool):Promise<void>{
  await pool.query("UPDATE guide_admissions SET finished_at=clock_timestamp() WHERE finished_at IS NULL");
}

/** Freeze primary identity before any language run; recover legacy identity from an existing Guide. */
export async function claimPrimaryGuideLanguage(pool: Pool, input: {
  notebook_id: string; user_id: string; source_id: string; revision: number; output_language: string;
}): Promise<string> {
  return withTransaction(pool, async tx => {
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [input.user_id]);
    await requireOwnedNotebook(tx, input.user_id, input.notebook_id, "update");
    const source = await tx.query("SELECT id FROM sources WHERE notebook_id=$1 AND id=$2 AND status='Ready' AND active_revision=$3 FOR SHARE", [input.notebook_id,input.source_id,input.revision]);
    if (!source.rowCount) throw new AppError("SourceSnapshotInvalid",409,"Requested source revision is not Ready");
    const existing = await tx.query<{output_language:string}>("SELECT output_language FROM guide_primary_languages WHERE source_id=$1 AND revision=$2",[input.source_id,input.revision]);
    if (existing.rows[0]) return existing.rows[0].output_language;
    // Before this migration, ordinary Guides may already exist. Prefer a Ready-origin record when available.
    const legacy = await tx.query<{output_language:string}>(`SELECT output_language FROM source_guides WHERE source_id=$1 AND revision=$2
      ORDER BY (record ? 'ready_at') DESC, updated_at, output_language LIMIT 1`,[input.source_id,input.revision]);
    const language = legacy.rows[0]?.output_language ?? input.output_language;
    await tx.query("INSERT INTO guide_primary_languages(source_id,revision,notebook_id,output_language) VALUES($1,$2,$3,$4)",[input.source_id,input.revision,input.notebook_id,language]);
    return language;
  });
}
