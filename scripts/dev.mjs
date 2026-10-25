#!/usr/bin/env node
/**
 * `pnpm dev` — local runnable v1 (Constitution V): PostgreSQL 16 + pgvector (Docker), migrations, API on :8080
 * serving the built SPA, ingestion/cleanup worker on :8081, local signed-capability storage in .local/storage,
 * local identity issuer (refused in production).
 *
 * AI endpoints: set VERTEX_PROJECT (or GOOGLE_CLOUD_PROJECT) with ADC (`gcloud auth application-default login`)
 * to use Vertex AI in europe-west4. Without it, `--offline` uses the TEST-ONLY lexical embedder for ingestion
 * and retrieval, and chat answers 503 "not configured" — it never fakes model answers.
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const offline = process.argv.includes("--offline");
const port = process.env.EVERLAST_PG_PORT ?? "54329";
const adminUrl = `postgres://everlast:everlast@127.0.0.1:${port}/everlast`;
const devUrl = `postgres://everlast:everlast@127.0.0.1:${port}/everlast_dev`;
const project = process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!project && !offline) {
  console.error("Set VERTEX_PROJECT (with ADC) for Vertex AI, or run `pnpm dev -- --offline` (no model answers).");
  process.exit(1);
}

execFileSync("node", ["scripts/db-test.mjs", "up"], { stdio: "inherit" });
execFileSync("node", ["packages/db/src/cli/ensure-database.ts", adminUrl, "everlast_dev"], { stdio: "inherit" });
execFileSync("node", ["packages/db/src/cli/migrate.ts"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: devUrl } });
execFileSync("node", ["scripts/build-web.mjs"], { stdio: "inherit" });

const shared = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: devUrl,
  LOCAL_STORAGE_DIR: ".local/storage",
  LOCAL_STORAGE_SIGNING_KEY: randomBytes(32).toString("hex"),
  PUBLIC_BASE_URL: "http://localhost:8080",
  ...(project ? { VERTEX_PROJECT: project, VERTEX_LOCATION: process.env.VERTEX_LOCATION ?? "europe-west4" } : {}),
  // Offline dev: lexical embeddings; web/synced content is screened by an explicit local pass-through (never on Cloud Run).
  ...(offline ? { EVERLAST_DEV_TEST_EMBEDDER: "1", EVERLAST_DEV_SCREENING: "pass-through" } : {}),
};
// Developer API keys must never reach the services (NFR-SEC-01).
for (const name of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"]) delete shared[name];

const children = [
  spawn("node", ["apps/worker/src/server.ts"], { stdio: "inherit", env: { ...shared, PORT: "8081" } }),
  spawn("node", ["apps/api/src/server.ts"], {
    stdio: "inherit",
    env: { ...shared, PORT: "8080", AUTH_MODE: "local", WEB_DIST_DIR: "apps/web/dist", WORKER_URL: "http://localhost:8081" },
  }),
];
console.log(`Everlast LM dev: http://localhost:8080 ${offline ? "(OFFLINE: test embedder, chat not configured)" : `(Vertex AI project ${project})`}`);
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => code && stop());
