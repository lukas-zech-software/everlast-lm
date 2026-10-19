import http from "node:http";
import { fileURLToPath } from "node:url";
import type { Pool } from "@everlast/db";
import { createPool } from "@everlast/db";
import {
  createObjectStorage,
  createOcrEngine,
  createVertexClient,
  HashingTestEmbedder,
  vertexConfigFromEnv,
  VertexEmbedder,
  type Embedder,
  type ObjectStorage,
  type OcrEngine,
} from "@everlast/cloud";
import { processIngestJob } from "./ingestion/pipeline.ts";
import { drainJobs, type JobHandler } from "./jobs.ts";
import { processNotebookCleanup } from "./notebook-cleanup.ts";
import type { JobKind } from "@everlast/db";

/**
 * Worker service (FR-WM-01, FR-SI-01). Internal ingress only; on Cloud Run the `roles/run.invoker` IAM
 * binding authenticates callers. Locally a dev header is required so the endpoint is never open by accident.
 */

export interface WorkerDeps {
  pool: Pool;
  storage: ObjectStorage;
  embedder?: Embedder;
  ocr?: OcrEngine;
  handlers?: Partial<Record<JobKind, JobHandler>>;
}

export function ingestHandler(deps: WorkerDeps): JobHandler {
  return async (job) => {
    if (!deps.embedder || !deps.ocr) return { kind: "retry", errorCode: "IngestionNotConfigured" };
    const outcome = await processIngestJob(
      { pool: deps.pool, storage: deps.storage, embedder: deps.embedder, ocr: deps.ocr },
      { source_id: job.payload.source_id!, attempt_id: job.payload.attempt_id! },
      job.attempts
    );
    return outcome.status === "retry" ? { kind: "retry", errorCode: outcome.errorCode } : { kind: "done" };
  };
}

export function cleanupHandler(deps: WorkerDeps): JobHandler {
  return async (job) => {
    const outcome = await processNotebookCleanup(deps, job.payload.deletion_id!);
    switch (outcome.status) {
      case "purged":
      case "missing":
        return { kind: "done" };
      case "deferred":
        return { kind: "defer", seconds: outcome.retryAfterSeconds };
      case "retry":
        return { kind: "retry", errorCode: outcome.errorCode };
    }
  };
}

export function createWorkerHandler(deps: WorkerDeps, env: NodeJS.ProcessEnv = process.env) {
  const handlers: Partial<Record<JobKind, JobHandler>> = {
    cleanup: cleanupHandler(deps),
    ingest: ingestHandler(deps),
    ...deps.handlers,
  };
  let draining: Promise<unknown> | null = null;
  const drain = () => {
    draining ??= drainJobs(deps.pool, handlers).finally(() => (draining = null));
    return draining;
  };
  return {
    drain,
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
        return;
      }
      if (url.pathname === "/tasks/drain" && req.method === "POST") {
        if (!env.K_SERVICE && req.headers["x-everlast-dev-worker"] !== "1") {
          res.writeHead(403).end();
          return;
        }
        drain()
          .then((result) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result)))
          .catch((err) => {
            console.error(JSON.stringify({ severity: "ERROR", message: `drain failed: ${(err as Error).message}` }));
            res.writeHead(500).end();
          });
        return;
      }
      res.writeHead(404).end();
    },
  };
}

export async function startWorker(env: NodeJS.ProcessEnv = process.env, extra: Partial<WorkerDeps> = {}) {
  const deps: WorkerDeps = {
    pool: createPool(),
    storage: createObjectStorage(env),
    embedder:
      extra.embedder ??
      (env.EVERLAST_DEV_TEST_EMBEDDER === "1"
        ? new HashingTestEmbedder(env)
        : new VertexEmbedder({ client: createVertexClient(vertexConfigFromEnv(env)), model: env.EMBEDDING_MODEL })),
    ocr: extra.ocr ?? createOcrEngine(env),
    ...extra,
  };
  const worker = createWorkerHandler(deps, env);
  const server = http.createServer(worker.handler);
  const port = Number(env.PORT ?? 8081);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  // Recover anything left in the outbox (crash between commit and notify), then poll while alive.
  void worker.drain();
  const interval = setInterval(() => void worker.drain(), Number(env.WORKER_POLL_MS ?? 5000));
  server.on("close", () => clearInterval(interval));
  console.log(JSON.stringify({ severity: "INFO", message: `Worker listening on :${port}` }));
  return { server, deps, worker };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startWorker().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
