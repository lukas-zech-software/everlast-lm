import { describe, expect, it } from "vitest";
import { buildGateReport } from "../src/report.ts";
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

  it("EVR-02: evaluation success alone leaves the gate pending without UI upload/navigation evidence", () => {
    expect(buildGateReport({ mode: "release", commit: "abc", run: run(), preflight: passingPreflight, ui: {}, dataset, models: {} }).state).toBe("GatePending");
    expect(buildGateReport({ mode: "release", commit: "abc", run: run(), preflight: passingPreflight, ui: { gate1_upload_schema: ui.gate1_upload_schema }, dataset, models: {} }).state).toBe("GatePending");
  });

  it("EVR-03: any failing metric fails the gate and lists the failing case IDs against the commit", () => {
    const failing = run({ metrics: [...run().metrics.slice(0, 4), judgeMetric("negative_rejection_rate", 0.98, { failing_cases: ["NEG-007", "NEG-042"] })] });
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
  const vertex = { name: "chat", purpose: "chat", vertexai: true, location: "europe-west4", project: "p" };

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

  it("EVS-04: OCR in europe-west4 or the EU multi-region passes (D3 region map); other regions need a recorded exception; missing OCR is unavailable", async () => {
    expect((await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "documentai:eu:p" }, live: false })).passed).toBe(true);
    expect((await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "documentai:us:p" }, live: false })).passed).toBe(false);
    expect((await runSecurityPreflight({ env: { REGION_EXCEPTION_DOCUMENT_AI: "D99" }, clients: [vertex], ocr: { name: "documentai:us:p" }, live: false })).passed).toBe(true);
    const none = await runSecurityPreflight({ env: {}, clients: [vertex], ocr: { name: "none" }, live: false });
    expect(none.checks.find((c) => c.id === "SEC-OCR")!.status).toBe("unavailable");
    expect(none.passed).toBe(false);
  });
});
