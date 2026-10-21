import type { Pool } from "@everlast/db";
import { claimDueJobs, completeJob, deferJob, failJob, type JobKind, type JobRecord } from "@everlast/db";

/**
 * Outbox drain (FR-WM-01, FR-SI-01): claims due jobs with SKIP LOCKED and runs their handler. A crash
 * mid-job leaves it Running; it becomes due again after the stale timeout, so dispatch always recovers.
 */

export type JobResult =
  | { kind: "done" }
  | { kind: "defer"; seconds: number }
  | { kind: "retry"; errorCode: string }
  | { kind: "dead"; errorCode: string };

export type JobHandler = (job: JobRecord) => Promise<JobResult>;

export async function drainJobs(
  pool: Pool,
  handlers: Partial<Record<JobKind, JobHandler>>,
  options: { batchSize?: number; maxBatches?: number } = {}
): Promise<{ processed: number }> {
  const kinds = Object.keys(handlers) as JobKind[];
  let processed = 0;
  for (let batch = 0; batch < (options.maxBatches ?? 50); batch++) {
    const jobs = await claimDueJobs(pool, kinds, options.batchSize ?? 5);
    if (jobs.length === 0) break;
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const result = await handlers[job.kind]!(job);
          if (result.kind === "done") await completeJob(pool, job.id);
          else if (result.kind === "defer") await deferJob(pool, job.id, result.seconds);
          else await failJob(pool, job.id, result.errorCode, result.kind === "retry");
        } catch (err) {
          console.error(JSON.stringify({ severity: "ERROR", job_id: job.id, kind: job.kind, message: (err as Error).message }));
          await failJob(pool, job.id, "UnhandledError");
        }
        processed++;
      })
    );
  }
  return { processed };
}
