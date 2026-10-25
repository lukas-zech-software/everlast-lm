import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.ts";

/**
 * [010-code-execution-sandbox] T004 — package 3.2 execution trace, result, artifact and manifest DTOs
 * (FR-GC-08, FR-GC-06, C-01/C-02; spec FR-003, FR-005, FR-007, FR-009, FR-012, FR-014, SC-004, SC-007).
 * Accessed through the barrel so a missing export fails the assertion (requirement Red), not the import.
 */

const v3 = contracts as unknown as Record<string, any>;

const NB = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a10";
const MSG = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a11";
const EXEC = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a12";
const A1 = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a13";
const A2 = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a14";
const ART = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a15";
const ART_FAILED = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a16";
const SRC = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a17";
const CHUNK = "0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a01";
const T0 = "2026-10-23T10:00:00.000Z";
const T1 = "2026-10-23T10:00:01.000Z";

const chartUrl = (artifact: string) => `/api/notebooks/${NB}/chat/messages/${MSG}/charts/${artifact}`;

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    attempt_id: A1,
    ordinal: 1,
    code: "emit('sd', 1.0)",
    stdout: "",
    stderr: "",
    exit_code: 0,
    started_at: T0,
    ended_at: T1,
    terminal_reason: "Succeeded",
    artifacts: [chartUrl(ART)],
    ...overrides,
  };
}

function trace(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    execution_id: EXEC,
    state: "Succeeded",
    attempts: [attempt()],
    final_attempt_id: A1,
    published_artifact_ids: [ART],
    failure_code: null,
    computed_results: [{ label: "Population standard deviation", value: "3.452052529534663", unit: "ms", citations: [CHUNK] }],
    ...overrides,
  };
}

const parse = (value: unknown) => v3.CodeExecutionTraceSchema?.safeParse(value) ?? { success: false, missing: true };

describe("T004 execution states and failure codes (FR-GC-08 FR-007)", () => {
  it("V32-C01: exports the five execution states exactly", () => {
    expect(v3.CodeExecutionStateSchema?.options).toEqual(["CodeGenerating", "SandboxRunning", "Succeeded", "TimedOut", "Failed"]);
  });

  it("V32-C02: failure codes are a closed safe enum (contracts/interfaces.md)", () => {
    expect(v3.CodeExecutionFailureCodeSchema?.options).toEqual([
      "PythonException",
      "ExecutionTimeout",
      "MemoryLimitExceeded",
      "TemporaryStorageLimit",
      "SecurityViolation",
      "ProviderUnavailable",
      "ExecutionOutcomeUnknown",
      "ScopeChanged",
      "AccessRevoked",
      "GenerationCancelled",
      "CitationInvalid",
      "InvalidOutput",
    ]);
    expect(v3.CodeExecutionFailureCodeSchema?.safeParse("Traceback: secret").success).toBe(false);
  });
});

describe("T004 trace envelope (FR-GC-08 FR-007, FR-GC-06)", () => {
  it("V32-C03: a successful single-attempt trace is valid; schema_version is Literal 1", () => {
    expect(parse(trace()).success).toBe(true);
    expect(parse(trace({ schema_version: 2 })).success).toBe(false);
  });

  it("V32-C04: IDs must be UUIDs and unknown fields are rejected (strict)", () => {
    expect(parse(trace({ execution_id: "exec-1" })).success).toBe(false);
    expect(parse(trace({ attempts: [attempt({ attempt_id: "a1" })] })).success).toBe(false);
    expect(parse(trace({ provider_handle: "projects/x/sandboxEnvironments/1" })).success).toBe(false);
  });

  it("V32-C05: after a correction retry both attempts are kept in order; the final attempt is the last one", () => {
    const failed = attempt({ exit_code: 1, stderr: "ZeroDivisionError", terminal_reason: "PythonException", artifacts: [] });
    const ok = attempt({ attempt_id: A2, ordinal: 2 });
    expect(parse(trace({ attempts: [failed, ok], final_attempt_id: A2 })).success).toBe(true);
    expect(parse(trace({ attempts: [ok, failed], final_attempt_id: A1 })).success).toBe(false); // out of order
    expect(parse(trace({ attempts: [failed, ok], final_attempt_id: A1 })).success).toBe(false); // final must be last
    expect(parse(trace({ attempts: [failed, ok, attempt({ attempt_id: ART, ordinal: 3 })] })).success).toBe(false); // max 2
  });

  it("V32-C06: published artifacts only come from the successful final attempt", () => {
    const failed = attempt({ exit_code: 1, terminal_reason: "PythonException", artifacts: [chartUrl(ART_FAILED)] });
    const ok = attempt({ attempt_id: A2, ordinal: 2 });
    expect(parse(trace({ attempts: [failed, ok], final_attempt_id: A2, published_artifact_ids: [ART_FAILED] })).success).toBe(false);
    expect(parse(trace({ state: "Failed", failure_code: "PythonException", published_artifact_ids: [ART], computed_results: [] })).success).toBe(false);
  });

  it("V32-C07: allocated-before-code failure has zero attempts, null final attempt and nothing published", () => {
    expect(parse(trace({ state: "Failed", failure_code: "ProviderUnavailable", attempts: [], final_attempt_id: null, published_artifact_ids: [], computed_results: [] })).success).toBe(true);
    expect(parse(trace({ state: "Failed", failure_code: "ProviderUnavailable", attempts: [], final_attempt_id: A1, published_artifact_ids: [], computed_results: [] })).success).toBe(false);
  });

  it("V32-C08: exit_code is a nullable integer — killed/unknown attempts are never given a fabricated 0", () => {
    const timedOut = attempt({ exit_code: null, terminal_reason: "ExecutionTimeout", artifacts: [] });
    expect(parse(trace({ state: "TimedOut", failure_code: "ExecutionTimeout", attempts: [timedOut], published_artifact_ids: [], computed_results: [] })).success).toBe(true);
    const fabricated = attempt({ exit_code: 0, terminal_reason: "ExecutionTimeout", artifacts: [] });
    expect(parse(trace({ state: "TimedOut", failure_code: "ExecutionTimeout", attempts: [fabricated], published_artifact_ids: [], computed_results: [] })).success).toBe(false);
    expect(parse(trace({ attempts: [attempt({ exit_code: 1.5 })] })).success).toBe(false);
  });

  it("V32-C09: non-terminal traces have no final attempt; terminal failures need a failure code; success has none", () => {
    expect(parse(trace({ state: "SandboxRunning", final_attempt_id: null, published_artifact_ids: [], computed_results: [], attempts: [attempt({ ended_at: null, exit_code: null, terminal_reason: null, artifacts: [] })] })).success).toBe(true);
    expect(parse(trace({ state: "SandboxRunning", final_attempt_id: A1, published_artifact_ids: [], computed_results: [] })).success).toBe(false);
    expect(parse(trace({ state: "Failed", failure_code: null, published_artifact_ids: [], computed_results: [] })).success).toBe(false);
    expect(parse(trace({ failure_code: "PythonException" })).success).toBe(false);
  });

  it("V32-C10: chart artifacts are authenticated application routes, never storage bearer URLs", () => {
    expect(parse(trace({ attempts: [attempt({ artifacts: ["https://storage.googleapis.com/bucket/x.png?X-Goog-Signature=abc"] })] })).success).toBe(false);
    expect(parse(trace({ attempts: [attempt({ artifacts: ["/api/notebooks/x/../charts/y"] })] })).success).toBe(false);
    expect(v3.chartUrl?.(NB, MSG, ART)).toBe(chartUrl(ART));
  });
});

describe("T004 computed values (FR-GC-08 FR-005, FR-012)", () => {
  it("V32-C11: computed values are exact canonical finite number strings with citations", () => {
    const ok = v3.CanonicalNumberSchema;
    for (const value of ["3.452052529534663", "-0.5", "12", "1e-07", "8.97e+21", "0"]) expect(ok?.safeParse(value).success, value).toBe(true);
    for (const value of ["NaN", "inf", "-inf", "Infinity", "1,000", " 1", "1.", ".5", "0x10", "", "3.45 ms"]) expect(ok?.safeParse(value).success ?? true, value).toBe(false);
    expect(v3.ComputedResultSchema?.safeParse({ label: "x", value: "1", unit: null, citations: [] }).success).toBe(false);
    expect(v3.ComputedResultSchema?.safeParse({ label: "x", value: "1", unit: null, citations: [CHUNK] }).success).toBe(true);
  });
});

describe("T004 chart artifact record (FR-GC-08, NFR-SEC-02)", () => {
  const record = {
    artifact_id: ART,
    execution_id: EXEC,
    attempt_id: A1,
    message_id: null,
    notebook_id: NB,
    object_key: `notebooks/${NB}/chat-charts/${ART}.png`,
    object_generation: "1",
    mime_type: "image/png",
    digest: "a".repeat(64),
    byte_size: 120,
    source_snapshot: [{ source_id: SRC, revision: 1 }],
    citation_chunk_ids: [CHUNK],
    state: "candidate",
  };
  it("V32-C12: PNG/SVG only, sha256 digest, private states candidate/published/invalidated", () => {
    const schema = v3.ChartArtifactRecordSchema;
    expect(schema?.safeParse(record).success).toBe(true);
    expect(schema?.safeParse({ ...record, mime_type: "text/html" }).success).toBe(false);
    expect(schema?.safeParse({ ...record, state: "public" }).success).toBe(false);
    expect(schema?.safeParse({ ...record, digest: "xyz" }).success).toBe(false);
    expect(schema?.safeParse({ ...record, source_snapshot: [{ source_id: SRC, revision: 0 }] }).success).toBe(false);
  });
});

describe("T004 input manifest (FR-GC-08, C-01/C-02 FR-009)", () => {
  const entry = {
    filename: "data.json",
    digest: "b".repeat(64),
    byte_count: 10,
    values: [{ label: "Jan 2025", value: "1", unit: "ms", chunk_id: CHUNK }],
    supporting_chunk_ids: [CHUNK],
  };
  it("V32-C13: internal filenames only — no URLs, credentials or path traversal", () => {
    const schema = v3.ManifestEntrySchema;
    expect(schema?.safeParse(entry).success).toBe(true);
    for (const filename of ["../data.json", "/etc/passwd", "gs://bucket/x", "https://x/y.json", "a/b.json", ".env", "DATA.JSON;rm"]) {
      expect(schema?.safeParse({ ...entry, filename }).success ?? true, filename).toBe(false);
    }
    expect(schema?.safeParse({ ...entry, values: [{ ...entry.values[0], value: "NaN" }] }).success ?? true).toBe(false);
  });
});

describe("T004 ChatMessage compatibility (FR-GC-06, FR-014)", () => {
  const base = {
    id: MSG,
    thread_id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a20",
    notebook_id: NB,
    user_id: "user-1",
    role: "assistant",
    content: "Answer",
    active_source_revisions_snapshot: [{ source_id: SRC, revision: 1 }],
    citations: [],
    created_at: T0,
  };
  it("V32-C14: legacy and clarification messages without a trace stay valid; a valid trace is accepted", () => {
    expect(contracts.ChatMessageSchema.safeParse(base).success).toBe(true);
    expect(contracts.ChatMessageSchema.safeParse({ ...base, code_execution_trace: null }).success).toBe(true);
    expect(contracts.ChatMessageSchema.safeParse({ ...base, code_execution_trace: trace() }).success).toBe(true);
    expect(contracts.ChatMessageSchema.safeParse({ ...base, code_execution_trace: trace({ schema_version: 9 }) }).success).toBe(false);
  });
});
