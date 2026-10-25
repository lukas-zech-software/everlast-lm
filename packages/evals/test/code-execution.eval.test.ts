import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createNotebook, deleteSource } from "@everlast/db";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "@everlast/db/testing";
import {
  AMBIGUOUS_STDDEV_QUESTION,
  CAGR_2021_2025,
  DECOY_MARKER,
  DECOY_PAGE,
  LATENCY_TABLE_PAGE,
  NUMERIC_TOLERANCE,
  POPULATION_STDDEV,
  POPULATION_STDDEV_QUESTION,
  RND_2021_PAGE,
  RND_2025_PAGE,
  SAMPLE_STDDEV,
  SAMPLE_STDDEV_QUESTION,
  TINY_PNG_BASE64,
  UNKNOWN_CHUNK_ID,
} from "@everlast/testkit/code-execution-fixtures";
import { ChatService, type TurnObservation } from "@everlast/api/chat/service";
import type { GroundedDraft } from "@everlast/api/chat/draft";
import type { CodeCorrectionInput, GroundedModel, GroundedModelInput } from "@everlast/api/chat/model";
import type { RawExecution, SandboxFile, SandboxHandle, SandboxRuntime } from "@everlast/api/chat/execution/runtime";
import {
  assertDatasetMinimums,
  buildGoldenDataset,
  corpusHash,
  datasetCounts,
  datasetHash,
  DATASET_VERSION,
  releaseSample,
  RELEASE_SAMPLE_SIZE,
} from "../src/dataset.ts";
import { containsForbidden, judgeMetric, ratio } from "../src/metrics.ts";

/**
 * [010-code-execution-sandbox] T042 — deterministic/semantic evidence tests for Package 3.2 (FR-GC-08, FR-GC-02,
 * NFR-EVAL-01..04; spec FR-005, FR-008, FR-012, FR-014, SC-001, SC-005, SC-006, SC-007).
 *
 * Covers:
 * - Exact arithmetic (`POPULATION_STDDEV`, `SAMPLE_STDDEV`, two-source unit-normalized `CAGR_2021_2025`) and chart
 *   source claims through the real ChatService + PostgreSQL + LocalObjectStorage + C-02 + D13 verifier pipeline.
 * - Scope decoys (`DECOY_MARKER` absent from retrieval, prompt, sandbox manifest, generated code and published text;
 *   `scoping_leakage_count === 0`).
 * - Invalid citation refusal (`UNKNOWN_CHUNK_ID` in preamble or dataset/sandbox output is refused; `citation_precision === 1.0`).
 * - Statistical intent clarification (`AMBIGUOUS_STDDEV_QUESTION` triggers `clarification` with 0 sandbox calls) and
 *   two-attempt bounded retry fixture (retains both attempts in order, publishes only final attempt).
 * - Current golden dataset lineage (`DATASET_VERSION`, `datasetHash`, `corpusHash`, `RELEASE_SAMPLE_SIZE === 50`).
 */

type Script = (input: GroundedModelInput, callIndex: number) => Promise<GroundedDraft> | GroundedDraft;

interface SandboxCall {
  handle: string;
  code: string;
  files: SandboxFile[];
}

const resultFile = (result: unknown): SandboxFile => ({
  name: "everlast_result.json",
  content: Buffer.from(JSON.stringify(result)),
  mimeType: "application/json",
});
const pngFile = (name = "chart_1.png"): SandboxFile => ({
  name,
  content: Buffer.from(TINY_PNG_BASE64, "base64"),
  mimeType: "image/png",
});

function interpretFixture(call: SandboxCall): RawExecution {
  const op = /# FIXTURE:(\w+)/.exec(call.code)?.[1] ?? "none";
  const data = call.files.find((f) => f.name === "data.json");
  const v = data
    ? (JSON.parse(data.content.toString()) as { values: { value: number; unit: string | null; chunk_id: string; label: string }[] }).values
    : [];
  const nums = v.map((x) => x.value);
  const sources = [...new Set(v.map((x) => x.chunk_id))];
  const mean = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);
  const ss = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
  switch (op) {
    case "pstdev":
      return {
        stdout: "computed population sd\n",
        stderr: "",
        files: [
          resultFile({ status: "ok", results: [{ label: "Population standard deviation", value: String(Math.sqrt(ss / nums.length)), unit: "ms", sources }] }),
          pngFile(),
        ],
      };
    case "stdev":
      return {
        stdout: "computed sample sd\n",
        stderr: "",
        files: [
          resultFile({ status: "ok", results: [{ label: "Sample standard deviation", value: String(Math.sqrt(ss / (nums.length - 1))), unit: "ms", sources }] }),
          pngFile(),
        ],
      };
    case "cagr": {
      const millions = v.map((x) => (x.unit === "USD billion" ? x.value * 1000 : x.value));
      const cagr = Math.pow(millions[1]! / millions[0]!, 1 / 4) - 1;
      return {
        stdout: "",
        stderr: "",
        files: [resultFile({ status: "ok", results: [{ label: "R&D spend CAGR 2021–2025", value: String(cagr), unit: null, sources }] })],
      };
    }
    case "raise":
      return {
        stdout: "",
        stderr: "Traceback (most recent call last):\nZeroDivisionError: division by zero\n",
        files: [resultFile({ status: "exception", exception_type: "ZeroDivisionError", results: [] })],
      };
    case "forge":
      return {
        stdout: "",
        stderr: "",
        files: [resultFile({ status: "ok", results: [{ label: "x", value: "1", unit: null, sources: [UNKNOWN_CHUNK_ID] }] })],
      };
    default:
      return { stdout: "", stderr: "", files: [resultFile({ status: "ok", results: [] })] };
  }
}

class ScriptedSandbox implements SandboxRuntime {
  readonly id = "eval-scripted-sandbox-double";
  calls: SandboxCall[] = [];
  async create(): Promise<SandboxHandle> {
    return { name: `projects/test/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/${randomUUID()}` };
  }
  async execute(handle: SandboxHandle, input: { code: string; files: SandboxFile[] }): Promise<RawExecution> {
    const call = { handle: handle.name, code: input.code, files: input.files.map((f) => ({ ...f, content: Buffer.from(f.content) })) };
    this.calls.push(call);
    return interpretFixture(call);
  }
  async destroy(): Promise<void> {}
  reset(): void {
    this.calls = [];
  }
}

function latencyComputeDraft(chunks: UnifiedDocumentChunk[], op: "pstdev" | "stdev" | "raise" | "forge" = "pstdev", preamble = true): GroundedDraft {
  const rows: { label: string; value: string; chunk_id: string }[] = [];
  for (const c of chunks) {
    for (const m of c.text.matchAll(/(\w{3}) 2025: (\d+) ms/g)) rows.push({ label: `${m[1]} 2025`, value: m[2]!, chunk_id: c.chunk_id });
  }
  const first = chunks.find((c) => /2025: \d+ ms/.test(c.text));
  return {
    status: "compute",
    sentences: preamble && first ? [{ text: "The latency table lists monthly server latency in ms for 2025.", citations: [first.chunk_id], kind: "claim" }] : [],
    computation: {
      intent: op === "stdev" ? "sample standard deviation" : "population standard deviation",
      dataset: rows.map((r) => ({ ...r, unit: "ms" })),
      code: `# FIXTURE:${op}\nimport json, statistics\nimport matplotlib.pyplot as plt\nrows = json.load(open('data.json'))['values']\nvals = [r['value'] for r in rows]\nemit('Population standard deviation', statistics.pstdev(vals), unit='ms', sources=[r['chunk_id'] for r in rows])\nplt.plot(vals); plt.savefig('chart_1.png')\n`,
    },
  } as GroundedDraft;
}

class EvalScriptedModel implements GroundedModel {
  readonly id = "eval-code-execution-model";
  calls: GroundedModelInput[] = [];
  corrections: CodeCorrectionInput[] = [];
  script: Script = () => ({ status: "not_in_sources", sentences: [] });
  correction: (input: CodeCorrectionInput) => Promise<string> = async () => "# FIXTURE:pstdev\nemit('sd', 1)";
  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    this.calls.push(input);
    return this.script(input, this.calls.length);
  }
  async correctCode(input: CodeCorrectionInput): Promise<string> {
    this.corrections.push(input);
    return this.correction(input);
  }
}

let db: TestDatabase;
let dir: string;
let storage: LocalObjectStorage;
let owner: string;
let foreignOwner: string;
let nb: string;
let foreignNb: string;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);
const model = new EvalScriptedModel();
const sandbox = new ScriptedSandbox();
const observations: TurnObservation[] = [];
let chat: ChatService;

const sources: {
  latency: string;
  rnd2021: string;
  rnd2025: string;
  decoyUnselected: string;
  decoyRemoved: string;
  foreignDecoy: string;
} = {
  latency: "",
  rnd2021: "",
  rnd2025: "",
  decoyUnselected: "",
  decoyRemoved: "",
  foreignDecoy: "",
};

beforeAll(async () => {
  db = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), "everlast-ce-eval-"));
  storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://localhost" });
  owner = await createTestUser(db.pool);
  foreignOwner = await createTestUser(db.pool);
  nb = (await createNotebook(db.pool, owner, { title: "Package 3.2 Eval Notebook" })).notebook.id;
  foreignNb = (await createNotebook(db.pool, foreignOwner, { title: "Foreign Eval Notebook" })).notebook.id;

  sources.latency = (await seedReadySource(db.pool, owner, nb, { title: "Latency_2025.pdf", pages: [LATENCY_TABLE_PAGE], embed })).sourceId;
  sources.rnd2021 = (await seedReadySource(db.pool, owner, nb, { title: "Report_2021.pdf", pages: [RND_2021_PAGE], embed })).sourceId;
  sources.rnd2025 = (await seedReadySource(db.pool, owner, nb, { title: "Report_2025.pdf", pages: [RND_2025_PAGE], embed })).sourceId;
  sources.decoyUnselected = (await seedReadySource(db.pool, owner, nb, { title: "Unselected_Decoy.pdf", pages: [DECOY_PAGE], embed })).sourceId;
  sources.decoyRemoved = (await seedReadySource(db.pool, owner, nb, { title: "Removed_Decoy.pdf", pages: [DECOY_PAGE], embed })).sourceId;
  await deleteSource(db.pool, owner, nb, sources.decoyRemoved);
  sources.foreignDecoy = (await seedReadySource(db.pool, foreignOwner, foreignNb, { title: "Foreign_Decoy.pdf", pages: [DECOY_PAGE], embed })).sourceId;

  chat = new ChatService({
    pool: db.pool,
    embedder,
    model,
    observer: (obs) => observations.push(obs),
    codeExecution: { runtime: sandbox, storage },
  });
});

afterAll(async () => {
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  sandbox.reset();
  model.calls = [];
  model.corrections = [];
  observations.length = 0;
});

async function runTurn(question: string, activeSourceIds: string[]) {
  const events: any[] = [];
  for await (const event of chat.runTurn({ ownerId: owner, notebookId: nb, message: question, activeSourceIds, requestId: randomUUID() })) {
    events.push(event);
  }
  const final = events.find((e) => e.type === "final");
  const assistant = final?.messages.find((m: any) => m.role === "assistant");
  return { events, final, assistant, observation: observations.at(-1)! };
}

describe("code-execution deterministic & semantic evals (FR-GC-08, NFR-EVAL-01..04; T042)", () => {
  it("CE-EVAL-01: exact arithmetic (population SD, sample SD, unit-normalized CAGR) and chart source claims preserve citation_precision = 1.0 and leakage = 0", async () => {
    let publishedBadges = 0;
    let validBadges = 0;
    let leakageCount = 0;

    // 1. Population standard deviation + chart
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
    const pop = await runTurn(POPULATION_STDDEV_QUESTION, [sources.latency]);
    expect(pop.assistant.kind).toBe("answer");
    const popVal = Number(/Population standard deviation: (\S+) ms \(Computed\)/.exec(pop.assistant.content)?.[1]);
    expect(Math.abs(popVal - POPULATION_STDDEV)).toBeLessThan(NUMERIC_TOLERANCE);
    expect(pop.assistant.code_execution_trace.published_artifact_ids).toHaveLength(1);

    // 2. Sample standard deviation + chart
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "stdev");
    const samp = await runTurn(SAMPLE_STDDEV_QUESTION, [sources.latency]);
    expect(samp.assistant.kind).toBe("answer");
    const sampVal = Number(/Sample standard deviation: (\S+) ms \(Computed\)/.exec(samp.assistant.content)?.[1]);
    expect(Math.abs(sampVal - SAMPLE_STDDEV)).toBeLessThan(NUMERIC_TOLERANCE);

    // 3. Two-source unit-normalized CAGR ($850M in 2021 vs $1.2B in 2025)
    model.script = ({ chunks }) => {
      const c21 = chunks.find((c) => c.text.includes("2021"))!;
      const c25 = chunks.find((c) => c.text.includes("2025"))!;
      return {
        status: "compute",
        sentences: [],
        computation: {
          intent: "CAGR 2021-2025",
          dataset: [
            { label: "R&D spend 2021", value: "850", unit: "USD million", chunk_id: c21.chunk_id },
            { label: "R&D spend 2025", value: "1.2", unit: "USD billion", chunk_id: c25.chunk_id },
          ],
          code: "# FIXTURE:cagr\n# Normalize USD billion to USD million (x1000)\n",
        },
      };
    };
    const cagr = await runTurn("Compute the exact R&D spend CAGR from 2021 to 2025.", [sources.rnd2021, sources.rnd2025]);
    expect(cagr.assistant.kind).toBe("answer");
    const cagrVal = Number(/CAGR 2021–2025: (\S+) \(Computed\)/.exec(cagr.assistant.content)?.[1]);
    expect(Math.abs(cagrVal - CAGR_2021_2025)).toBeLessThan(NUMERIC_TOLERANCE);
    expect(new Set(cagr.assistant.citations.map((c: any) => c.source_id))).toEqual(new Set([sources.rnd2021, sources.rnd2025]));

    for (const [turnResult, activeIds] of [
      [pop, [sources.latency]],
      [samp, [sources.latency]],
      [cagr, [sources.rnd2021, sources.rnd2025]],
    ] as const) {
      const activeSet = new Set(activeIds);
      const retrievedIds = new Set(turnResult.observation.retrieved.map((c) => c.chunk_id));
      for (const cit of turnResult.assistant.citations) {
        publishedBadges++;
        if (retrievedIds.has(cit.chunk_id) && activeSet.has(cit.source_id)) validBadges++;
      }
      for (const chunk of turnResult.observation.retrieved) {
        if (!activeSet.has(chunk.source_id) || containsForbidden(chunk.text, DECOY_MARKER)) leakageCount++;
      }
      if (containsForbidden(JSON.stringify(turnResult.observation.modelInput), DECOY_MARKER)) leakageCount++;
      if (containsForbidden(turnResult.assistant.content, DECOY_MARKER)) leakageCount++;
    }

    for (const call of sandbox.calls) {
      const dataJson = call.files.find((f) => f.name === "data.json")!.content.toString("utf8");
      if (containsForbidden(dataJson, DECOY_MARKER) || containsForbidden(call.code, DECOY_MARKER)) leakageCount++;
    }

    const precisionMetric = judgeMetric("citation_precision", ratio(validBadges, publishedBadges, "citation_precision"), {
      numerator: validBadges,
      denominator: publishedBadges,
      failing_cases: [],
    });
    const leakageMetric = judgeMetric("scoping_leakage_count", leakageCount, { failing_cases: [] });
    expect(publishedBadges).toBeGreaterThanOrEqual(4);
    expect(precisionMetric).toMatchObject({ status: "pass", value: 1 });
    expect(leakageMetric).toMatchObject({ status: "pass", value: 0 });
  });

  it("CE-EVAL-02: invalid citation IDs in preamble, dataset, or sandbox output are refused without publishing a badge (citation_precision = 1.0)", async () => {
    // 1. Forged chunk ID in preamble
    model.script = ({ chunks }) => {
      const draft = latencyComputeDraft(chunks, "pstdev");
      draft.sentences = [{ text: "Monthly server latency is recorded in ms.", citations: [UNKNOWN_CHUNK_ID], kind: "claim" }];
      return draft;
    };
    const badPreamble = await runTurn(POPULATION_STDDEV_QUESTION, [sources.latency]);
    expect(badPreamble.assistant.kind).toBe("refusal");
    expect(badPreamble.assistant.citations).toEqual([]);
    expect(sandbox.calls).toHaveLength(0);

    // 2. Forged chunk ID in dataset
    model.script = ({ chunks }) => {
      const draft = latencyComputeDraft(chunks, "pstdev") as any;
      draft.computation.dataset[0].chunk_id = UNKNOWN_CHUNK_ID;
      return draft;
    };
    const badDataset = await runTurn(POPULATION_STDDEV_QUESTION, [sources.latency]);
    expect(badDataset.assistant.kind).toBe("refusal");
    expect(badDataset.assistant.citations).toEqual([]);
    expect(sandbox.calls).toHaveLength(0);

    // 3. Sandbox output forging an unretrieved chunk ID
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "forge", false);
    const badOutput = await runTurn(POPULATION_STDDEV_QUESTION, [sources.latency]);
    expect(badOutput.assistant.kind).toBe("refusal");
    expect(badOutput.assistant.citations).toEqual([]);
    expect(badOutput.assistant.code_execution_trace).toMatchObject({
      state: "Failed",
      failure_code: "CitationInvalid",
      computed_results: [],
      published_artifact_ids: [],
    });
    expect(model.corrections).toHaveLength(0);
  });

  it("CE-EVAL-03: ambiguous statistical intent clarifies with 0 sandbox calls; two-attempt retry retains both ordered attempts and publishes only final output", async () => {
    // Ambiguous request -> clarification
    model.script = () => ({
      status: "clarify",
      sentences: [],
      clarification_question: "Should the standard deviation treat the 12 months as the whole population or as a sample?",
    });
    const clarifyTurn = await runTurn(AMBIGUOUS_STDDEV_QUESTION, [sources.latency]);
    expect(clarifyTurn.assistant).toMatchObject({
      kind: "clarification",
      citations: [],
      code_execution_trace: null,
    });
    expect(sandbox.calls).toHaveLength(0);

    // Follow-up resolution with 1 runtime failure followed by 1 repair attempt
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "raise");
    model.correction = async () => "# FIXTURE:pstdev\nemit('sd', 1)";
    const retryTurn = await runTurn("Treat the 12 months as the whole population.", [sources.latency]);
    expect(retryTurn.assistant.kind).toBe("answer");
    const trace = retryTurn.assistant.code_execution_trace;
    expect(trace.state).toBe("Succeeded");
    expect(trace.attempts).toHaveLength(2);
    expect(trace.attempts.map((a: any) => [a.ordinal, a.terminal_reason, a.exit_code])).toEqual([
      [1, "PythonException", 1],
      [2, "Succeeded", 0],
    ]);
    expect(trace.final_attempt_id).toBe(trace.attempts[1].attempt_id);
    expect(retryTurn.assistant.content).not.toContain("ZeroDivisionError");
  });

  it("CE-EVAL-04: preserves golden dataset v1.0.0 lineage and fixed 50-case stratified release sample (SC-006)", () => {
    const cases = buildGoldenDataset();
    assertDatasetMinimums(cases);
    expect(DATASET_VERSION).toBe("v1.0.0");
    expect(RELEASE_SAMPLE_SIZE).toBe(50);
    expect(datasetHash(cases)).toMatch(/^[0-9a-f]{64}$/);
    expect(corpusHash()).toMatch(/^[0-9a-f]{64}$/);
    const sample = releaseSample(cases, RELEASE_SAMPLE_SIZE);
    expect(sample).toHaveLength(50);
    const counts = datasetCounts(sample);
    expect(counts.total).toBe(50);
    expect(counts.unanswerable).toBeGreaterThan(0);
    expect(counts.deselection).toBeGreaterThan(0);
    expect(counts.history).toBeGreaterThan(0);
    expect(counts.synthesis).toBeGreaterThan(0);
    // Deterministic repeatable selection
    expect(releaseSample(cases, RELEASE_SAMPLE_SIZE).map((c) => c.id)).toEqual(sample.map((c) => c.id));
  });
});
