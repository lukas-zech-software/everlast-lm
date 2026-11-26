#!/usr/bin/env node
/**
 * Practical Live-Cloud Smoke Runner (`dev` environment only).
 * - Enforces `EVERLAST_ENV=dev` (never staging/prod).
 * - Inspects `everlast-dev-pg` (and `everlast-dev-api` with `--warmup-api`); asks permission once before
 *   starting `dev` if currently scaled down to zero, and scales it back down in `finally` unless it was
 *   already manually running beforehand.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  assertDevOnlyEnvironment,
  ensureDevEnvironmentForTests,
} from "../packages/testkit/src/live-fixtures.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  assertDevOnlyEnvironment(process.env);
} catch (err) {
  console.error(
    `[UNAVAILABLE] test:cloud:dev: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(2);
}

const env = { ...process.env, EVERLAST_ENV: process.env.EVERLAST_ENV ?? "dev" };
delete env.GEMINI_API_KEY;
delete env.GOOGLE_API_KEY;
delete env.GOOGLE_GENAI_API_KEY;

const warmupApi = process.argv.includes("--warmup-api");
const audioFixture = arg("audio-fixture") ?? env.AUDIO_SMOKE_FIXTURE;

let lease;
try {
  lease = await ensureDevEnvironmentForTests({ env, warmupApi });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[UNAVAILABLE] test:cloud:dev: ${msg}`);
  process.exit(2);
}
const results = [];

function runStep(name, cmd, args, extraEnv = {}) {
  console.log(`\n=== [dev-cloud] ${name} ===`);
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...env, EVERLAST_START_DEV_APPROVED: "1", ...extraEnv },
  });
  let status = "FAIL";
  if (res.status === 0) {
    status = "PASS";
  } else if (res.status === 2) {
    status = "UNAVAILABLE";
  }
  results.push({ name, status, code: res.status ?? 1 });
}

try {
  runStep("1. Vertex Chat/Embeddings/Reports/SourceGuide (eval:judged --smoke)", "pnpm", [
    "eval:judged",
    "--",
    "--smoke",
  ]);
  runStep("2. Vertex Context Cache (eval:v3-scale --smoke)", "node", [
    "scripts/eval-v3-scale.mjs",
    "--smoke",
  ]);
  runStep("3. Studio Mindmap & Data Table Live (eval:v3-studio --smoke)", "node", [
    "scripts/eval-v3-studio.mjs",
    "--smoke",
  ]);

  if (env.CODE_EXECUTION_REASONING_ENGINE) {
    runStep("4. Agent Engine Code Execution Live (v3.2)", "node", [
      "scripts/eval-v3-code-execution.mjs",
      "--smoke",
    ]);
  } else {
    results.push({
      name: "4. Agent Engine Code Execution Live (v3.2)",
      status: "UNAVAILABLE",
      code: 2,
    });
  }

  if (audioFixture && existsSync(audioFixture)) {
    runStep("5. Speech V2 Audio Transcription Live (v3.1)", "node", [
      "scripts/eval-v3-audio.mjs",
      "--smoke",
      "--fixture",
      audioFixture,
    ]);
  } else {
    results.push({
      name: "5. Speech V2 Audio Transcription Live (v3.1)",
      status: "UNAVAILABLE",
      code: 2,
    });
  }

  if (
    env.WORKSPACE_STORAGE_IT === "1" ||
    ((env.WORKSPACE_IT_BUCKET ?? env.GCS_WORKSPACE_BUCKET ?? env.STORAGE_BUCKET) &&
      env.TEST_DATABASE_URL)
  ) {
    runStep(
      "6. GCS Signed PUT & Versioned Cleanup (notebook-cleanup.integration)",
      "pnpm",
      ["vitest", "run", "apps/worker/test/notebook-cleanup.integration.test.ts"],
      { WORKSPACE_STORAGE_IT: "1" },
    );
  } else {
    results.push({ name: "6. GCS Signed PUT & Versioned Cleanup", status: "UNAVAILABLE", code: 2 });
  }

  if (env.WORKSPACE_IDENTITY_IT === "1" && env.WORKSPACE_IT_API_KEY && env.WORKSPACE_IT_EMAIL) {
    runStep(
      "7. Identity Platform Sign-In & Revocation (identity.integration)",
      "pnpm",
      ["vitest", "run", "apps/api/test/identity.integration.test.ts"],
      { WORKSPACE_IDENTITY_IT: "1" },
    );
  } else {
    results.push({
      name: "7. Identity Platform Sign-In & Revocation",
      status: "UNAVAILABLE",
      code: 2,
    });
  }
} finally {
  await lease.restore();
}

console.log("\n=== Dev Live-Cloud Smoke Summary ===");
for (const r of results) {
  console.log(`  [${r.status}] ${r.name}`);
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
else if (!results.some((r) => r.status === "PASS")) process.exitCode = 2;
