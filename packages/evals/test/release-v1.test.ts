import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGateReport, writeGateReport, type GateReport } from "../src/report.ts";
import { judgeMetric } from "../src/metrics.ts";
import { runSecurityPreflight } from "../src/security-preflight.ts";
import type { EvalRunResult } from "../src/runner.ts";

/** T012/T027/T029 — gate lifecycle (fail closed) and hermetic NFR-SEC-01 preflight. */

function run(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    upload: { documents: [{ key: "a", title: "A.pdf", media_type: "application/pdf", status: "Ready", chunks: 3, valid_chunks: 3 }], passed: true },
    cases: [],
    judged: true,
    errored: [],
    metrics: [
      judgeMetric("citation_precision", 1, { failing_cases: [] }),
      judgeMetric("scoping_leakage_count", 0, { failing_cases: [] }),
      judgeMetric("hallucination_rate", 0.01, { failing_cases: [] }),
      judgeMetric("semantic_support_rate", 1, { failing_cases: [] }),
      judgeMetric("negative_rejection_rate", 1, { failing_cases: [] }),
    ],
    ...overrides,
  };
}

const passingPreflight = { passed: true, checks: [], endpoints: [], verified_at: new Date().toISOString() };
const dataset = { version: "v1.0.0", hash: "h", corpus_hash: "c", counts: {} };
const ui = {
  gate1_upload_schema: { status: "pass" as const, detail: "ok", at: "t" },
  gate3_citation_navigation: { status: "pass" as const, detail: "ok", at: "t" },
};

describe("Gate v1.0 lifecycle", () => {
  it("FR-GC-08 / NFR-EVAL-02: a compute intent is reportable without inventing a computed answer", () => {
    const result = run({ cases: [{
      id: "COMPUTE-001", category: "synthesis", question: "Calculate", kind: "answer", response: "1 (Computed)",
      citations: [], sentences: [], invalid_citations: 0,
      leakage: { retrieved: 0, prompt: 0, response: 0, details: [] },
      turns: [{ requestId: "request", snapshot: [], retrieved: [], modelInput: null, draft: null,
        result: { kind: "compute", preamble: [], computation: { intent: "sum", code: "emit('sum', 1)", dataset: [] } } }],
    }] });
    const report = buildGateReport({ mode: "deterministic", commit: "abc", run: result, preflight: null, ui, dataset, models: {} });
    expect(report.cases[0]!.turns).toEqual([{ kind: "compute", content: "", history_turns: 0, retrieved: 0 }]);
    expect(report.cases[0]!.response).toBe("1 (Computed)");
  });

  it("EVR-01: release run with all four metrics, upload/schema and citation navigation passing → GatePassed", () => {
    const report = buildGateReport({ mode: "release", commit: "abc", run: run(), preflight: passingPreflight, ui, dataset, models: {} });
    expect(report.state).toBe("GatePassed");
    expect(report.failures).toEqual([]);
  });

  it("T038 (NFR-EVAL-01..04): diagnostic workloads cannot promote the release gate", () => {
    const report = buildGateReport({
      mode: "release", commit: "abc", run: run(), preflight: passingPreflight, ui, dataset, models: {},
      diagnostic: true,
    });
    expect(report.state).toBe("GatePending");
    expect(report.diagnostic).toBe(true);
  });

  it("T038 (NFR-EVAL-01..04): a later run retains the original failed report and each judge attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "everlast-release-report-"));
    try {
      const input = { mode: "release" as const, commit: "abc", preflight: passingPreflight, ui, dataset, models: {} };
      const judgeAttempts = [
        { call_id: 1, purpose: "rejection", attempt: 1, outcome: "error", status: 429, elapsed_ms: 3 },
        { call_id: 1, purpose: "rejection", attempt: 2, outcome: "error", status: 503, elapsed_ms: 1004 },
      ] as const;
      await writeGateReport(buildGateReport({ ...input, run: run({ errored: ["NEG-007"], judge_attempts: judgeAttempts }) }), dir);
      await writeGateReport(buildGateReport({ ...input, run: run() }), dir);
      const audit = (await readFile(join(dir, "gate-audit.jsonl"), "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as { evidence_path: string });
      expect(audit).toHaveLength(2);
      expect(audit[0]!.evidence_path).not.toBe(audit[1]!.evidence_path);
      const first = JSON.parse(await readFile(join(dir, audit[0]!.evidence_path), "utf8")) as GateReport;
      expect(first.state).toBe("GateFailed");
      expect(first.judge_attempts).toEqual(judgeAttempts);
      expect(first.criteria.gate2_evaluation.errored_cases).toEqual(["NEG-007"]);
      expect(first.dataset.hash).toBe(dataset.hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("EVR-02: evaluation success alone leaves the gate pending without UI upload/navigation evidence", () => {
    expect(buildGateReport({ mode: "release", commit: "abc", run: run(), preflight: passingPreflight, ui: {}, dataset, models: {} }).state).toBe("GatePending");
    expect(buildGateReport({ mode: "release", commit: "abc", run: run(), preflight: passingPreflight, ui: { gate1_upload_schema: ui.gate1_upload_schema }, dataset, models: {} }).state).toBe("GatePending");
  });

  it("EVR-03: any failing metric fails the gate and lists the failing case IDs against the commit", () => {
    const failing = run({ metrics: [...run().metrics.slice(0, 4), judgeMetric("negative_rejection_rate", 0.85, { failing_cases: ["NEG-007", "NEG-042"] })] });
    const report = buildGateReport({ mode: "release", commit: "deadbeef", run: failing, preflight: passingPreflight, ui, dataset, models: {} });
    expect(report.state).toBe("GateFailed");
    expect(report.commit).toBe("deadbeef");
    expect(report.failures.join()).toContain("NEG-007");
  });

  it("EVR-04: deterministic mode can never pass the gate (judged suites unavailable)", () => {
    const det = run({ judged: false, metrics: [...run().metrics.slice(0, 2), judgeMetric("hallucination_rate", null, { failing_cases: [], unavailable: "UNAVAILABLE" })] });
    expect(buildGateReport({ mode: "deterministic", commit: "a", run: det, preflight: null, ui, dataset, models: {} }).state).toBe("GatePending");
  });

  it("EVR-05: errored cases, invalid upload evidence or failed preflight fail closed", () => {
    expect(buildGateReport({ mode: "release", commit: "a", run: run({ errored: ["SYN-001"] }), preflight: passingPreflight, ui, dataset, models: {} }).state).toBe("GateFailed");
    expect(buildGateReport({ mode: "release", commit: "a", run: run({ upload: { documents: [], passed: false } }), preflight: passingPreflight, ui, dataset, models: {} }).state).toBe("GateFailed");
    const badPreflight = { ...passingPreflight, passed: false, checks: [{ id: "SEC-01", description: "x", status: "fail" as const, detail: "GEMINI_API_KEY" }] };
    expect(buildGateReport({ mode: "release", commit: "a", run: run(), preflight: badPreflight, ui, dataset, models: {} }).state).toBe("GateFailed");
  });
});

describe("NFR-SEC-01 preflight (hermetic: explicit env, no ambient variables)", () => {
  const vertex = { name: "chat", purpose: "chat", vertexai: true, location: "europe-west4", project: "p", route: "regional" as const, endpoint: "https://europe-west4-aiplatform.googleapis.com/" };

  it("EVS-01: enterprise Vertex clients in europe-west4 with ADC and no developer keys pass", async () => {
    const report = await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "documentai:europe-west4:proc" }, live: false });
    expect(report.passed).toBe(true);
    expect(report.endpoints[0]!.no_training.status).toBe("contractual");
    expect(report.endpoints[0]!.retention).toMatch(/Zero data retention is NOT claimed/);
  });

  it("EVS-02: a developer API key in the runtime environment fails", async () => {
    const report = await runSecurityPreflight({ env: { GEMINI_API_KEY: "x" }, clients: [vertex], ocr: { name: "documentai:europe-west4:p" }, live: false });
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.id === "SEC-01")!.detail).toContain("GEMINI_API_KEY");
  });

  it("EVS-03: a non-Vertex client, an API-key client or a non-EU region fails", async () => {
    for (const client of [{ ...vertex, vertexai: false }, { ...vertex, apiKey: "k" }, { ...vertex, location: "us-central1" }]) {
      expect((await runSecurityPreflight({ env: {}, clients: [client], ocr: { name: "documentai:europe-west4:p" }, live: false })).passed).toBe(false);
    }
  });

  it("EVS-05: D23 Gemini and regional embeddings must use their own endpoints", async () => {
    const gemini = { ...vertex, route: "gemini" as const, location: "eu", endpoint: "https://aiplatform.eu.rep.googleapis.com" };
    const embedding = { ...vertex, name: "embedding" };
    const input = { env: {}, ocr: { name: "documentai:eu:p" }, live: false };
    const approved = await runSecurityPreflight({ ...input, clients: [gemini, embedding] });
    expect(approved.passed).toBe(true);
    expect(approved.endpoints.map(({ endpoint }) => endpoint)).toEqual(["aiplatform.eu.rep.googleapis.com", "europe-west4-aiplatform.googleapis.com", "eu-documentai.googleapis.com"]);
    for (const clients of [
      [{ ...gemini, location: embedding.location, endpoint: embedding.endpoint }, embedding],
      [gemini, { ...embedding, location: gemini.location, endpoint: gemini.endpoint }],
      [{ ...gemini, endpoint: "https://aiplatform.eu.rep.googleapis.com.invalid" }, embedding],
    ]) {
      expect((await runSecurityPreflight({ ...input, clients })).passed).toBe(false);
    }
  });

  it("EVS-04: OCR in europe-west4 or the EU multi-region passes (D3 region map); other regions need a recorded exception; missing OCR is unavailable", async () => {
    expect((await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "documentai:eu:p" }, live: false })).passed).toBe(true);
    expect((await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "documentai:us:p" }, live: false })).passed).toBe(false);
    expect((await runSecurityPreflight({ env: { REGION_EXCEPTION_DOCUMENT_AI: "D99" }, clients: [vertex], ocr: { name: "documentai:us:p" }, live: false })).passed).toBe(true);
    const none = await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "none" }, live: false });
    expect(none.checks.find((c) => c.id === "SEC-OCR")!.status).toBe("unavailable");
    expect(none.passed).toBe(false);
  });
});
