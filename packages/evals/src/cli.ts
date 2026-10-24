import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import { createTestDatabase } from "@everlast/db/testing";
import { createOcrEngine, createVertexClient, HashingTestEmbedder, NoOcrEngine, vertexConfigFromEnv, VertexEmbedder } from "@everlast/cloud";
import { AdkGroundedModel } from "@everlast/api/chat/model";
import { assertDatasetMinimums, buildGoldenDataset, corpusHash, datasetCounts, datasetHash, DATASET_VERSION, releaseSample, RELEASE_SAMPLE_SIZE } from "./dataset.ts";
import { AdversarialCitingModel, LexicalCitingModel } from "./deterministic-models.ts";
import { VertexJudge } from "./judge.ts";
import { createResponseLengthRunner, runEvaluation, type EvalRunResult } from "./runner.ts";
import { runResponseLengthEval, type ResponseLengthMetric } from "./response-length.ts";
import { runSecurityPreflight } from "./security-preflight.ts";
import { buildGateReport, renderMarkdown, writeGateReport, type UiGateEvidence } from "./report.ts";
import { renderStudioGate, runStudioReportsGate, runStudioReportsReleaseGate } from "./studio-gate.ts";
import { renderSourceGuideGate, runSourceGuideReleaseGate } from "./source-guide-gate.ts";

/**
 * `pnpm eval:deterministic` — every PR: Precision_ID and leakage with test doubles (no cloud), incl. an
 * adversarial pass that tries to cite chunks outside the prompt.
 * `pnpm eval:judged` — release / retrieval-prompt-chat PRs: the full golden dataset against the real Vertex AI
 * model, embeddings and judge. Exits 2 (UNAVAILABLE) without credentials; never reports a pass it did not run.
 */

const mode = process.argv[2] === "release" ? "release" : process.argv[2] === "deterministic" ? "deterministic" : null;
if (!mode) {
  console.error("usage: cli.ts deterministic|release [--out reports] [--concurrency N] [--limit N]");
  process.exit(64);
}
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outDir = arg("out") ?? "reports";
const concurrency = Number(arg("concurrency") ?? (mode === "release" ? 4 : 2));
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const full = process.argv.includes("--full");
const onlyCases = arg("cases")?.split(",").map((x) => x.trim()).filter(Boolean);

function unavailable(reason: string): never {
  console.error(`[UNAVAILABLE] eval:${mode === "release" ? "judged" : "deterministic"}: ${reason}`);
  process.exit(2);
}

function commit(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return process.env.GITHUB_SHA ?? "unknown";
  }
}

async function readUiEvidence(): Promise<UiGateEvidence> {
  try {
    return JSON.parse(await readFile(`${outDir}/gate-v1-ui.json`, "utf8")) as UiGateEvidence;
  } catch {
    return {};
  }
}

const log = (line: string) => console.log(`[eval] ${line}`);

const cases = buildGoldenDataset();
assertDatasetMinimums(cases);
// Release runs use the fixed stratified 50-case sample (Constitution v2.0.0); --full runs every case.
const selected = onlyCases
  ? cases.filter((c) => onlyCases.includes(c.id))
  : mode === "release" && !full
    ? releaseSample(cases, RELEASE_SAMPLE_SIZE)
    : limit
      ? cases.filter((_, i) => i % Math.ceil(cases.length / limit) === 0)
      : cases;
if (!process.env.TEST_DATABASE_URL) unavailable("TEST_DATABASE_URL is not set (start PostgreSQL with pnpm db:test:up)");
if (mode === "release") {
  try {
    vertexConfigFromEnv();
  } catch (err) {
    unavailable((err as Error).message);
  }
  try {
    await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getAccessToken();
  } catch (err) {
    unavailable(`no Application Default Credentials (${(err as Error).message.split("\n")[0]}); run gcloud auth application-default login`);
  }
}

const db = await createTestDatabase();
let exitCode = 1;
try {
  const dataset = {
    version: DATASET_VERSION,
    hash: datasetHash(cases),
    corpus_hash: corpusHash(),
    counts: datasetCounts(selected),
    sample: mode === "release" && !full ? { size: RELEASE_SAMPLE_SIZE, method: "stratified-largest-remainder-v1", case_ids: selected.map((c) => c.id) } : null,
  };
  let run: EvalRunResult;
  let models: Record<string, string>;
  let preflight = null;
  // FR-GC-07: measured only in the judged release run on the fixed sample; UNAVAILABLE otherwise.
  let responseLength: ResponseLengthMetric = await runResponseLengthEval(null, selected);

  if (mode === "deterministic") {
    const embedder = new HashingTestEmbedder();
    run = await runEvaluation({ pool: db.pool, embedder, model: new LexicalCitingModel(), ocr: new NoOcrEngine(), judge: null, concurrency, log }, selected);
    // Adversarial pass: a model that cites chunks outside its prompt must never get a badge published.
    const foreign = (await db.pool.query<{ chunk_id: string }>("SELECT chunk_id FROM chunks")).rows.map((r) => r.chunk_id);
    const adversarial = new AdversarialCitingModel(() => foreign);
    const attack = await runEvaluation(
      { pool: db.pool, embedder, model: adversarial, ocr: new NoOcrEngine(), judge: null, concurrency, log },
      selected.filter((c) => c.category !== "unanswerable").slice(0, 60)
    );
    const published = attack.cases.filter((c) => c.kind === "answer");
    log(`adversarial pass: ${adversarial.attempts} drafts with out-of-prompt citations, ${published.length} published (must be 0)`);
    run.metrics = run.metrics.map((m) => {
      const other = attack.metrics.find((x) => x.name === m.name);
      if (m.name === "scoping_leakage_count" && other && other.value !== null && m.value !== null) {
        const value = m.value + other.value;
        return { ...m, value, passed: value === 0, status: value === 0 ? "pass" : "fail", failing_cases: [...m.failing_cases, ...other.failing_cases.map((id) => `ADV:${id}`)] };
      }
      return m;
    });
    if (published.length > 0) run.errored.push(...published.map((c) => `ADV:${c.id} published an answer with an out-of-prompt citation`));
    models = { chat: "deterministic-lexical-citing-model (+ adversarial)", embedding: embedder.model, judge: "none (judged suite not run)" };
  } else {
    for (const name of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"]) {
      if (process.env[name]) log(`WARNING: ${name} is set in this process; NFR-SEC-01 preflight will fail`);
    }
    const vertex = vertexConfigFromEnv();
    const client = createVertexClient(vertex);
    const embedder = new VertexEmbedder({ client, model: process.env.EMBEDDING_MODEL });
    const chat = new AdkGroundedModel({ project: vertex.project, location: vertex.location, model: process.env.CHAT_MODEL ?? "gemini-2.5-flash" });
    const judge = new VertexJudge({ client, model: process.env.JUDGE_MODEL });
    const ocr = createOcrEngine();
    const chatClient = chat.llm.apiClient as unknown as { vertexai: boolean; apiKey?: string; location?: string; project?: string };
    const genaiClient = client as unknown as { vertexai: boolean; apiKey?: string; location?: string; project?: string };
    preflight = await runSecurityPreflight({
      env: process.env,
      clients: [
        { name: "chat", purpose: `Grounded chat (${chat.id})`, ...pick(chatClient) },
        { name: "embedding", purpose: `Embeddings (${embedder.model})`, ...pick(genaiClient) },
        { name: "judge", purpose: `Eval judge (${judge.model})`, ...pick(genaiClient) },
      ],
      ocr,
      live: true,
    });
    if (!preflight.passed) log(`NFR-SEC-01 preflight failed: ${preflight.checks.filter((c) => c.status !== "pass").map((c) => c.id).join(", ")}`);
    run = await runEvaluation({ pool: db.pool, embedder, model: chat, ocr, judge, concurrency, log }, selected);
    if (!full && !onlyCases) {
      const lengthRunner = await createResponseLengthRunner({ pool: db.pool, embedder, model: chat, ocr, judge, concurrency, log });
      try {
        responseLength = await runResponseLengthEval(lengthRunner, selected);
        log(`FR-GC-07 response length: ${responseLength.status} (shorter ${responseLength.shorter_ratio}, longer ${responseLength.longer_ratio})`);
      } finally {
        await lengthRunner.close();
      }
    }
    models = { chat: chat.id, embedding: `vertex:${vertex.location}:${embedder.model}`, judge: `vertex:${vertex.location}:${judge.model}`, ocr: ocr.name };
  }

  const report = buildGateReport({ mode, commit: commit(), run, preflight, ui: await readUiEvidence(), dataset, models, responseLength });
  if (onlyCases) {
    // Diagnostic subset: never gate evidence and never overwrites the release report.
    report.state = report.state === "GateFailed" ? "GateFailed" : "GatePending";
    report.failures.push(`diagnostic run limited to ${onlyCases.join(", ")}`);
  }
  await writeGateReport(report, onlyCases ? `${outDir}/diagnostic` : outDir);
  console.log(renderMarkdown(report));
  const evalOk = report.criteria.gate2_evaluation.status === "pass" || (mode === "deterministic" && report.criteria.gate2_evaluation.metrics.filter((m) => m.status !== "unavailable").every((m) => m.passed) && report.criteria.gate2_evaluation.errored_cases.length === 0);
  exitCode = report.state === "GateFailed" ? 1 : evalOk ? 0 : 1;
  if (limit && mode === "deterministic") log(`--limit ${limit}: subset run, not valid deterministic evidence`);

  // Gate v2.0 #3 (FR-ST-10): all four report templates through the Studio runtime path. Deterministic on every
  // PR; the release run uses Vertex AI Flash and reports UNAVAILABLE without Vertex configuration.
  const studio = mode === "deterministic" ? { status: "ran" as const, result: await runStudioReportsGate() } : await runStudioReportsReleaseGate(process.env);
  if (studio.status === "ran") {
    for (const line of renderStudioGate(studio.result)) log(line);
    if (!studio.result.passed) exitCode = 1;
  } else {
    log(`[UNAVAILABLE] Gate v2.0 #3 Studio reports (Vertex Flash): ${studio.reason}`);
  }

  // Gate v2.0 #1 (FR-SI-02): Source Guide < 10 s P95 from Ready, release-only on Vertex AI Flash-Lite.
  if (mode === "release") {
    const guides = await runSourceGuideReleaseGate(process.env);
    if (guides.status === "ran") {
      for (const line of renderSourceGuideGate(guides.result)) log(line);
      if (!guides.result.passed) exitCode = 1;
    } else {
      log(`[UNAVAILABLE] Gate v2.0 #1 Source Guide (Vertex Flash-Lite): ${guides.reason}`);
    }
  }
} finally {
  await db.drop();
}
process.exit(exitCode);

function pick(c: { vertexai: boolean; apiKey?: string; location?: string; project?: string }) {
  return { vertexai: c.vertexai, apiKey: c.apiKey, location: c.location, project: c.project };
}
