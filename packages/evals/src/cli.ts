import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import { GoogleGenAI } from "@google/genai";
import { createTestDatabase } from "@everlast/db/testing";
import { createOcrEngine, createVertexClient, HashingTestEmbedder, NoOcrEngine, resolveEnterpriseGeminiConfig, vertexConfigFromEnv, VertexEmbedder } from "@everlast/cloud";
import { AdkGroundedModel } from "@everlast/api/chat/model";
import { assertDatasetMinimums, buildGoldenDataset, corpusHash, datasetCounts, datasetHash, DATASET_VERSION, releaseSample, RELEASE_SAMPLE_SIZE } from "./dataset.ts";
import { ensureDevEnvironmentForTests, type DevEnvironmentLease } from "@everlast/testkit/live-fixtures";
import { AdversarialCitingModel, LexicalCitingModel } from "./deterministic-models.ts";
import { VertexJudge } from "./judge.ts";
import { createResponseLengthRunner, runEvaluation, type EvalRunResult } from "./runner.ts";
import { computeResponseLengthMetric, runResponseLengthEval, type ResponseLengthMetric } from "./response-length.ts";
import { runSecurityPreflight } from "./security-preflight.ts";
import { buildGateReport, renderMarkdown, writeGateReport, type UiGateEvidence } from "./report.ts";
import { renderStudioGate, runStudioReportsGate, runStudioReportsReleaseGate } from "./studio-gate.ts";
import { renderSourceGuideGate, runSourceGuideReleaseGate } from "./source-guide-gate.ts";
import { runStudioStructureDeterministicEval } from "./studio-structure-eval.ts";
import { runStudioActiveLearningDeterministicEval } from "./studio-active-learning-eval.ts";
import { runStudioVisualsDeterministicEval } from "./studio-v4-eval.ts";

/**
 * `pnpm eval:deterministic` — every PR: Precision_ID and leakage with test doubles (no cloud), incl. an
 * adversarial pass that tries to cite chunks outside the prompt.
 * `pnpm eval:judged` — the fixed stratified release sample against the real Vertex AI
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
const limit = process.argv.includes("--limit") ? Number(arg("limit")) : undefined;
const full = process.argv.includes("--full");
const smoke = process.argv.includes("--smoke");
const onlyCases = arg("cases")?.split(",").map((x) => x.trim()).filter(Boolean);
if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
  console.error("--limit requires a positive integer");
  process.exit(64);
}
if (process.argv.includes("--cases") && !onlyCases?.length) {
  console.error("--cases requires a comma-separated list of case IDs");
  process.exit(64);
}
const diagnostic = full || limit !== undefined || onlyCases !== undefined || smoke;

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
// Release evidence uses the fixed stratified 50-case sample (Constitution v2.0.0).
const selected = onlyCases
  ? cases.filter((c) => onlyCases.includes(c.id))
  : mode === "release" && smoke
    ? releaseSample(cases, 5)
    : mode === "release" && !diagnostic
      ? releaseSample(cases, RELEASE_SAMPLE_SIZE)
      : limit
        ? cases.filter((_, i) => i % Math.ceil(cases.length / limit) === 0)
        : cases;
if (onlyCases && onlyCases.some((id) => !selected.some((c) => c.id === id))) {
  console.error("--cases contains an unknown case ID");
  process.exit(64);
}
if (mode === "release") {
  try {
    vertexConfigFromEnv();
    resolveEnterpriseGeminiConfig("flash");
    resolveEnterpriseGeminiConfig("flash-lite");
  } catch (err) {
    unavailable((err as Error).message);
  }
  try {
    await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getAccessToken();
  } catch (err) {
    unavailable(`no Application Default Credentials (${(err as Error).message.split("\n")[0]}); run gcloud auth application-default login`);
  }
}

let devLease: DevEnvironmentLease | undefined;
if (mode === "release") {
  try {
    devLease = await ensureDevEnvironmentForTests({ env: process.env });
  } catch (err) {
    unavailable(err instanceof Error ? err.message : String(err));
  }
}
if (!process.env.TEST_DATABASE_URL) {
  await devLease?.restore();
  unavailable("TEST_DATABASE_URL is not set (start PostgreSQL with pnpm db:test:up or point to dev Cloud SQL)");
}

const candidate = commit();
const db = await createTestDatabase();
let exitCode = 1;
try {
  const dataset = {
    version: DATASET_VERSION,
    hash: datasetHash(cases),
    corpus_hash: corpusHash(),
    counts: datasetCounts(selected),
    sample: mode === "release" && !diagnostic ? { size: RELEASE_SAMPLE_SIZE, method: "stratified-largest-remainder-v1", case_ids: selected.map((c) => c.id) } : null,
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
    const chatRoute = resolveEnterpriseGeminiConfig("flash");
    const judgeRoute = resolveEnterpriseGeminiConfig("flash-lite");
    const chat = new AdkGroundedModel({ ...chatRoute.clientOptions, model: chatRoute.model, thinkingConfig: chatRoute.thinkingConfig });
    const judgeClient = new GoogleGenAI(judgeRoute.clientOptions);
    const judge = new VertexJudge({ client: judgeClient, model: judgeRoute.model, thinkingConfig: judgeRoute.thinkingConfig });
    const ocr = createOcrEngine();
    const chatClient = chat.llm.apiClient as unknown as { vertexai: boolean; apiKey?: string; location?: string; project?: string };
    const regionalClient = client as unknown as Parameters<typeof pick>[0] & { apiClient: { getBaseUrl(): string } };
    const judgeIdentity = judgeClient as unknown as Parameters<typeof pick>[0];
    preflight = await runSecurityPreflight({
      env: process.env,
      clients: [
        { name: "chat", purpose: `Grounded chat (${chat.id})`, ...pick(chatClient), route: "gemini", endpoint: chatRoute.clientOptions.httpOptions.baseUrl },
        { name: "embedding", purpose: `Embeddings (${embedder.model})`, ...pick(regionalClient), route: "regional", endpoint: regionalClient.apiClient.getBaseUrl() },
        { name: "judge", purpose: `Eval judge (${judge.model})`, ...pick(judgeIdentity), route: "gemini", endpoint: judgeRoute.clientOptions.httpOptions.baseUrl },
      ],
      ocr,
      live: true,
    });
    if (!preflight.passed) {
      const failedChecks = preflight.checks.filter((check) => check.status !== "pass");
      throw new Error(`NFR-SEC-01 preflight failed before inference: ${failedChecks.map((check) => check.id).join(", ")}`);
    }
    run = await runEvaluation({ pool: db.pool, embedder, model: chat, ocr, judge, concurrency, log }, selected);
    if (!diagnostic) {
      try {
        const lengthRunner = await createResponseLengthRunner({ pool: db.pool, embedder, model: chat, ocr, judge, concurrency, log });
        try {
          responseLength = await runResponseLengthEval(lengthRunner, selected);
        } finally {
          await lengthRunner.close();
        }
      } catch {
        // Keep the completed Gate v1.0 run even when this separate v2 metric cannot finish.
        responseLength = computeResponseLengthMetric(null, "UNAVAILABLE: response-length runner failed");
      }
      log(`FR-GC-07 response length: ${responseLength.status} (shorter ${responseLength.shorter_ratio}, longer ${responseLength.longer_ratio})`);
    }
    models = { chat: chat.id, embedding: `vertex:${vertex.location}:${embedder.model}`, judge: `vertex:${judgeRoute.clientOptions.location}:${judge.model}`, ocr: ocr.name };
  }

  const ui = await readUiEvidence();
  const report = buildGateReport({ mode, commit: candidate, run, preflight, ui, dataset, models, responseLength, diagnostic });
  await writeGateReport(report, diagnostic ? `${outDir}/diagnostic` : outDir);
  console.log(renderMarkdown(report));
  const evalOk = report.criteria.gate2_evaluation.status === "pass" || (mode === "deterministic" && report.criteria.gate2_evaluation.metrics.filter((m) => m.status !== "unavailable").every((m) => m.passed) && report.criteria.gate2_evaluation.errored_cases.length === 0);
  exitCode = mode === "release" && !diagnostic
    ? (report.state === "GatePassed" ? 0 : 1)
    : (report.state !== "GateFailed" && evalOk ? 0 : 1);

  // Gate v2.0 #3 (FR-ST-10): all four report templates through the Studio runtime path. Deterministic on every
  // PR; the release/smoke run uses Vertex AI Flash and reports UNAVAILABLE without Vertex configuration.
  const studio = mode === "deterministic"
    ? { status: "ran" as const, result: await runStudioReportsGate() }
    : (!diagnostic || smoke) ? await runStudioReportsReleaseGate(process.env) : null;
  if (studio?.status === "ran") {
    for (const line of renderStudioGate(studio.result)) log(line);
    if (!studio.result.passed) exitCode = 1;
  } else if (studio) {
    log(`[UNAVAILABLE] Gate v2.0 #3 Studio reports (Vertex Flash): ${studio.reason}`);
  }

  // Gate v3.0 #3 (FR-ST-08/09/18, NFR-EVAL-02/04): Studio Mindmap & Data Table deterministic grounding & scoping gate.
  if (mode === "deterministic") {
    const studioV3 = await runStudioStructureDeterministicEval();
    log(
      `Gate v3.0 #3 Studio structure (Mindmap & Data Table): ${studioV3.passed ? "PASS" : "FAIL"} (models=${studioV3.models.mindmap}/${studioV3.models.data_table}, precision=${studioV3.citation_precision.toFixed(3)}, leakage=${studioV3.leakage_count}, late_fact=${studioV3.late_fact_retained})`
    );
    if (!studioV3.passed) exitCode = 1;

    // Gate v4.0 #1 (FR-ST-12..15, NFR-EVAL-02/04, NFR-SEC-01): Studio Active Learning deterministic grounding, semantic grading & scoping gate.
    const studioV4 = await runStudioActiveLearningDeterministicEval();
    log(
      `Gate v4.0 #1 Studio active learning (Flashcards, Quiz & Learning Overview): ${studioV4.passed ? "PASS" : "FAIL"} (precision=${studioV4.citation_precision.toFixed(3)}, leakage=${studioV4.leakage_count}, equiv=${studioV4.semantic_unit_equivalence_passed}, injection_blocked=${studioV4.injection_rejected}, explain_guard=${studioV4.explain_missing_scope_blocked})`
    );
    if (!studioV4.passed) exitCode = 1;

    // Gate v4.0 #3 (FR-ST-16/17, NFR-EVAL-02/04, NFR-SEC-02): Slide Deck PPTX/PDF & Infographic D9 SVG gate.
    const studioV4Visuals = await runStudioVisualsDeterministicEval();
    log(
      `Gate v4.0 #3 Studio visuals (Slide Deck PPTX/PDF & Infographic D9 SVG): ${studioV4Visuals.passed ? "PASS" : "FAIL"} (precision=${studioV4Visuals.citation_precision.toFixed(3)}, leakage=${studioV4Visuals.leakage_count}, slides=${studioV4Visuals.slide_count})`
    );
    if (!studioV4Visuals.passed) exitCode = 1;
  }

  // Gate v2.0 #1 (FR-SI-02): Source Guide < 30 s P95 from Ready on Vertex AI Flash-Lite (2 sources in smoke mode).
  if (mode === "release" && (!diagnostic || smoke)) {
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
  await devLease?.restore();
}
process.exit(exitCode);

function pick(c: { vertexai: boolean; apiKey?: string; location?: string; project?: string }) {
  return { vertexai: c.vertexai, apiKey: c.apiKey, location: c.location, project: c.project };
}
