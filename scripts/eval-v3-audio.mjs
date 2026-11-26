#!/usr/bin/env node
/**
 * Package 3.1 audio transcription evaluation & dev smoke check (FR-SI-01, SC-002; specs/009).
 * Usage:
 *   node scripts/eval-v3-audio.mjs --smoke --fixture sample.flac [--out reports]
 *   node scripts/eval-v3-audio.mjs --plan plan.json --fixture depot-meeting-30min.flac [--validate-only | --out reports]
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  assertDevOnlyEnvironment,
  withDevTestEnvironment,
} from "../packages/testkit/src/live-fixtures.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const unavailable = (reason) => {
  console.error(`[UNAVAILABLE] eval:v3-audio: ${reason}`);
  process.exit(2);
};
function verifyFlacDuration(bytes, durationMs) {
  const hasStreamInfo =
    bytes.length > 42 &&
    bytes.subarray(0, 4).equals(Buffer.from("fLaC")) &&
    (bytes[4] & 0x7f) === 0 &&
    bytes.readUIntBE(5, 3) === 34;
  if (!hasStreamInfo) throw new Error("Fixture must start with native FLAC STREAMINFO");
  const sampleInfo = bytes.readBigUInt64BE(18);
  const sampleRate = sampleInfo >> 44n;
  const sampleCount = sampleInfo & ((1n << 36n) - 1n);
  if (sampleRate === 0n || sampleCount * 1_000n !== sampleRate * BigInt(durationMs)) {
    throw new Error("FLAC fixture duration must be exactly 30 minutes");
  }
}

const env = process.env;
const isSmoke = process.argv.includes("--smoke");
const out = arg("out") ?? "reports";

if (isSmoke) {
  try {
    assertDevOnlyEnvironment(env);
  } catch (err) {
    unavailable(err instanceof Error ? err.message : String(err));
  }
  const fixturePath = arg("fixture");
  if (
    !env.SPEECH_LOCATION ||
    !(env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT) ||
    !(env.GCS_WORKSPACE_BUCKET ?? env.STORAGE_BUCKET)
  ) {
    unavailable(
      "Speech-to-Text V2 is not configured on dev (SPEECH_LOCATION, GCP_PROJECT_ID, GCS_WORKSPACE_BUCKET)",
    );
  }
  if (!fixturePath) {
    unavailable(
      "Pass --fixture <short-speech.flac> for live dev Speech-to-Text V2 smoke verification",
    );
  }
  const bytes = readFileSync(fixturePath);
  const { SpeechV2Transcriber, speechConfigFromEnv, validateWords } =
    await import("../apps/worker/src/ingestion/media.ts");
  const { createObjectStorage } = await import("../packages/cloud/src/index.ts");
  await withDevTestEnvironment({ env }, async () => {
    const storage = createObjectStorage(env);
    const config = speechConfigFromEnv(
      { ...env, SPEECH_LANGUAGE_CODES: env.SPEECH_LANGUAGE_CODES ?? "en-US" },
      storage,
    );
    const transcriber = new SpeechV2Transcriber(config);
    const runId = randomUUID();
    const objectName = `benchmarks/v3-audio-smoke/${runId}-${basename(fixturePath)}`;
    const uploaded = await storage.write(objectName, bytes, "audio/flac");
    try {
      const started = Date.now();
      const result = await transcriber.transcribe({
        object: { name: uploaded.name, generation: uploaded.generation },
        mediaType: "audio/flac",
        durationMs: null,
      });
      if (!result.words.length) throw new Error("No timestamped transcript returned");
      validateWords(result.words, null);
      mkdirSync(out, { recursive: true });
      const file = join(out, `v3-audio-smoke-${runId}.json`);
      writeFileSync(
        file,
        JSON.stringify(
          {
            status: "PASS",
            mode: "dev-smoke",
            words: result.words.length,
            elapsed_ms: Date.now() - started,
          },
          null,
          2,
        ),
      );
      console.log(JSON.stringify({ status: "PASS", words: result.words.length, report: file }));
    } finally {
      await storage.deleteVersion(uploaded.name, uploaded.generation).catch(() => {});
    }
  });
  process.exit(0);
}

const planPath = arg("plan");
const fixturePath = arg("fixture");
if (!planPath || !fixturePath)
  unavailable("--plan and --fixture (or --smoke --fixture) are required");

const { collectAudioBenchmark, evaluateBenchmark, validateExecutionPlan, validatePlan } =
  await import("../packages/evals/src/audio-transcription-benchmark.ts");
const model = "chirp_2";
let plan;
let bytes;
let planHash;
try {
  const planText = readFileSync(planPath, "utf8");
  plan = JSON.parse(planText);
  planHash = createHash("sha256").update(planText).digest("hex");
  validatePlan(plan);
  if (Date.parse(plan.declaredAt) > Date.now())
    throw new Error("The plan must be declared before execution");
  validateExecutionPlan(plan, {
    region: plan.provider.region,
    model,
    languageCodes: [plan.fixture.languageCode],
  });
  if (!/^(?:europe-[a-z]+[0-9]+|eu)$/.test(plan.provider.region))
    throw new Error("Declared region must be an EU Speech location");
  bytes = readFileSync(fixturePath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== plan.fixture.sha256 || bytes.length !== plan.fixture.bytes)
    throw new Error("Fixture does not match declared hash/size");
  verifyFlacDuration(bytes, plan.fixture.durationMs);
} catch (error) {
  unavailable(error instanceof Error ? error.message : "Invalid benchmark fixture or declaration");
}

if (process.argv.includes("--validate-only")) {
  console.log(
    JSON.stringify({
      status: "VALIDATED",
      plan_sha256: planHash,
      fixture_sha256: plan.fixture.sha256,
      duration_ms: plan.fixture.durationMs,
      repetitions: plan.repetitions,
    }),
  );
  process.exit(0);
}

if (
  !env.SPEECH_LOCATION ||
  !(env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT) ||
  !(env.GCS_WORKSPACE_BUCKET ?? env.STORAGE_BUCKET)
) {
  unavailable(
    "Speech-to-Text V2 is not configured (SPEECH_LOCATION, GCP_PROJECT_ID, GCS_WORKSPACE_BUCKET)",
  );
}

const { SpeechV2Transcriber, speechConfigFromEnv, validateWords } =
  await import("../apps/worker/src/ingestion/media.ts");
const { createObjectStorage } = await import("../packages/cloud/src/index.ts");

let exitCode = 1;
await withDevTestEnvironment({ env }, async () => {
  let config;
  let storage;
  try {
    storage = createObjectStorage(env);
    config = speechConfigFromEnv(
      { ...env, SPEECH_LANGUAGE_CODES: env.SPEECH_LANGUAGE_CODES ?? plan.fixture.languageCode },
      storage,
    );
    validateExecutionPlan(plan, {
      region: config.location,
      model: config.model ?? model,
      languageCodes: config.languageCodes,
    });
  } catch (error) {
    unavailable(error instanceof Error ? error.message : "Invalid benchmark configuration");
  }
  const transcriber = new SpeechV2Transcriber(config);
  mkdirSync(out, { recursive: true });
  const runId = randomUUID();
  const file = join(out, `v3-audio-benchmark-${runId}.json`);
  let commit = "UNAVAILABLE";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Keep default "UNAVAILABLE" when git revision cannot be resolved
  }
  const provenance = {
    run_id: runId,
    started_at: new Date().toISOString(),
    source_commit: commit,
    node_version: process.version,
    plan_sha256: planHash,
    fixture_sha256: plan.fixture.sha256,
    provider: plan.provider,
    language_codes: config.languageCodes,
    concurrency: 1,
  };
  let latest = [];
  const checkpoint = (observations) => {
    latest = observations;
    writeFileSync(
      file,
      JSON.stringify({ status: "RUNNING", plan, provenance, observations }, null, 2),
    );
  };
  checkpoint([]);
  let observations;
  try {
    observations = await collectAudioBenchmark(plan, {
      upload: (attempt) =>
        storage.write(
          `benchmarks/v3-audio/${runId}/${attempt}-${basename(fixturePath)}`,
          bytes,
          "audio/flac",
        ),
      transcribe: async (object) => {
        const result = await transcriber.transcribe({
          object: { name: object.name, generation: object.generation },
          mediaType: "audio/flac",
          durationMs: plan.fixture.durationMs,
        });
        if (!result.words.length) throw new Error("No timestamped transcript");
        validateWords(result.words, plan.fixture.durationMs);
      },
      cleanup: (object) => storage.deleteVersion(object.name, object.generation),
      checkpoint,
    });
  } catch (error) {
    writeFileSync(
      file,
      JSON.stringify(
        {
          status: "UNAVAILABLE",
          plan,
          provenance,
          observations: latest,
          error: error instanceof Error ? error.name : "Error",
        },
        null,
        2,
      ),
    );
    unavailable(`Collection incomplete; accepted attempts retained in ${file}`);
  }
  const result = evaluateBenchmark(plan, observations);
  const serializable = {
    ...result,
    p95Ms: Number.isFinite(result.p95Ms) ? result.p95Ms : "Infinity",
    samplesMs: result.samplesMs.map((value) => (Number.isFinite(value) ? value : "Infinity")),
  };
  writeFileSync(
    file,
    JSON.stringify({ status: result.pass ? "PASS" : "FAIL", provenance, ...serializable }, null, 2),
  );
  console.log(
    JSON.stringify({
      p95_ms: serializable.p95Ms,
      target_ms: result.targetMs,
      pass: result.pass,
      report: file,
    }),
  );
  exitCode = result.pass ? 0 : 1;
});
process.exit(exitCode);
