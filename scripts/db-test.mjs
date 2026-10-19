#!/usr/bin/env node
/**
 * Starts (or reuses) the local PostgreSQL 16 + pgvector container used by integration tests and `pnpm dev`.
 * Matches the Cloud SQL major version (D4). Prints the TEST_DATABASE_URL to export.
 */
import { execFileSync } from "node:child_process";

const NAME = "everlast-pg-test";
const PORT = process.env.EVERLAST_PG_PORT ?? "54329";
const IMAGE = "pgvector/pgvector:pg16";
const action = process.argv[2] ?? "up";

function docker(args, opts = {}) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function running() {
  try {
    return docker(["inspect", "-f", "{{.State.Running}}", NAME]) === "true";
  } catch {
    return null;
  }
}

if (action === "down") {
  try {
    docker(["rm", "-f", NAME]);
  } catch {}
  console.log(`Removed ${NAME}`);
  process.exit(0);
}

const state = running();
if (state === null) {
  docker(["run", "-d", "--name", NAME, "-e", "POSTGRES_USER=everlast", "-e", "POSTGRES_PASSWORD=everlast",
    "-e", "POSTGRES_DB=everlast", "-p", `127.0.0.1:${PORT}:5432`, IMAGE]);
} else if (state === false) {
  docker(["start", NAME]);
}
for (let i = 0; i < 60; i++) {
  try {
    docker(["exec", NAME, "pg_isready", "-U", "everlast"]);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.log(`export TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:${PORT}/everlast`);
