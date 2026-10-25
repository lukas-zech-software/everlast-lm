import { runWithV2Persistence, type JobRecord, type Pool } from "@everlast/db";
import type { JobHandler, JobResult } from "../jobs.ts";
import type { StudioJobRunner } from "./runner.ts";

/**
 * [011-studio-mindmaps-data-tables] T010 — Durable identifier-only Studio outbox handler and dispatcher
 * (FR-ST-08/18, C-02/C-03, NFR-SEC-01/02; FR-010, FR-012, FR-014, FR-017).
 *
 * Outbox payloads carry only `{ artifact_id, notebook_id }` (no secrets, no source content).
 * Terminal outcomes (`Completed`, `Failed`, `Cancelled`) mark the outbox job `done` so terminal citation
 * or evidence refusals are never silently retried on redelivery.
 */

export function createStudioOutboxHandler(
  runner: Pick<StudioJobRunner, "run">,
  pool?: Pool
): JobHandler {
  return async (job: JobRecord): Promise<JobResult> => {
    const artifactId = job.payload.artifact_id;
    if (!artifactId) {
      return { kind: "dead", errorCode: "MissingArtifactId" };
    }
    const exec = async () => runner.run(artifactId);
    const record = pool ? await runWithV2Persistence(pool, exec) : await exec();
    if (record.status === "Completed" || record.status === "Failed" || record.status === "Cancelled") {
      return { kind: "done" };
    }
    // Still Running under another active worker lease: defer so lease expiration can recover if needed
    return { kind: "defer", seconds: 5 };
  };
}

export interface DurableStudioDispatcherOptions {
  /** When true (default), triggers an immediate non-blocking drain/run in addition to the durable outbox row. */
  notifyImmediate?: boolean | undefined;
  onNotify?: (() => void) | undefined;
}

export class DurableStudioDispatcher {
  private readonly pending = new Set<Promise<void>>();
  private readonly pool: Pool;
  private readonly runner: { run(id: string): Promise<unknown> };
  private readonly options: DurableStudioDispatcherOptions;

  constructor(
    pool: Pool,
    runner: { run(id: string): Promise<unknown> },
    options: DurableStudioDispatcherOptions = {}
  ) {
    this.pool = pool;
    this.runner = runner;
    this.options = options;
  }

  async enqueue(artifactId: string, _ownerId: string): Promise<void> {
    this.options.onNotify?.();
    if (this.options.notifyImmediate === false) {
      return;
    }
    const task = Promise.resolve()
      .then(() => runWithV2Persistence(this.pool, () => this.runner.run(artifactId)))
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}
