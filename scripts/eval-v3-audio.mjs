#!/usr/bin/env node
/**
 * Package 3.1 audio transcription benchmark (FR-SI-01, SC-002; specs/009 T032).
 *
 * Usage: node scripts/eval-v3-audio.mjs --plan plan.json --fixture depot-meeting-30min.flac [--out reports]
 *
 * Runs the predeclared N ≥ 20 attempts against the configured Speech-to-Text V2 (Chirp 2, europe-west4) with keyless
 * ADC and the workspace bucket, measuring acceptance → complete timestamped transcript (queue included, upload and
 * indexing excluded), then writes every observation and the nearest-rank P95 (failures = +∞) as JSON.
 * Without SPEECH_LOCATION / GCP_PROJECT_ID / GCS_WORKSPACE_BUCKET it exits 2 with UNAVAILABLE — never a pass.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const unavailable = (reason) => {
  console.error(`[UNAVAILABLE] eval:v3-audio: ${reason}`);
  process.exit(2);
};

const env = process.env;
if (!env.SPEECH_LOCATION || !(env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT) || !(env.GCS_WORKSPACE_BUCKET ?? env.STORAGE_BUCKET)) {
  unavailable("Speech-to-Text V2 is not configured (SPEECH_LOCATION, GCP_PROJECT_ID, GCS_WORKSPACE_BUCKET)");
}
const planPath = arg("plan");
const fixturePath = arg("fixture");
if (!planPath || !fixturePath) unavailable("--plan and --fixture are required (declare the plan before measuring)");

const { evaluateBenchmark, validatePlan } = await import("../packages/evals/src/audio-transcription-benchmark.ts");
const { SpeechV2Transcriber, speechConfigFromEnv } = await import("../apps/worker/src/ingestion/media.ts");
const { createObjectStorage } = await import("../packages/cloud/src/index.ts");

const plan = JSON.parse(readFileSync(planPath, "utf8"));
validatePlan(plan);
const bytes = readFileSync(fixturePath);
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== plan.fixture.sha256 || bytes.length !== plan.fixture.bytes) unavailable("fixture does not match the declared plan (hash/size)");

const storage = createObjectStorage(env);
const transcriber = new SpeechV2Transcriber(speechConfigFromEnv(env, storage));
const observations = [];
for (let attempt = 1; attempt <= plan.repetitions; attempt++) {
  const uploadStarted = Date.now();
  const object = await storage.write(`benchmarks/v3-audio/${Date.now()}-${basename(fixturePath)}`, bytes, "audio/flac");
  const uploadCompletedAt = new Date().toISOString();
  const acceptedAt = new Date().toISOString();
  let transcriptAvailableAt = null;
  let outcome = "failed";
  try {
    const result = await transcriber.transcribe({ object: { name: object.name, generation: object.generation }, mediaType: "audio/flac", durationMs: plan.fixture.durationMs });
    if (result.words.length > 0) {
      transcriptAvailableAt = new Date().toISOString();
      outcome = "completed";
    }
  } catch (err) {
    console.error(JSON.stringify({ attempt, error: err?.name ?? "Error" }));
  } finally {
    await storage.deleteVersion(object.name, object.generation).catch(() => undefined);
  }
  observations.push({ attempt, uploadCompletedAt, acceptedAt, transcriptAvailableAt, indexedAt: null, outcome, warm: attempt > 1, upload_ms: Date.parse(uploadCompletedAt) - uploadStarted });
}
const result = evaluateBenchmark(plan, observations);
const out = arg("out") ?? "reports";
mkdirSync(out, { recursive: true });
const file = join(out, `v3-audio-benchmark-${Date.now()}.json`);
writeFileSync(file, JSON.stringify({ ...result, samplesMs: result.samplesMs.map((v) => (Number.isFinite(v) ? v : "Infinity")) }, null, 2));
console.log(JSON.stringify({ p95_ms: Number.isFinite(result.p95Ms) ? result.p95Ms : "Infinity", target_ms: result.targetMs, pass: result.pass, report: file }));
process.exit(result.pass ? 0 : 1);
