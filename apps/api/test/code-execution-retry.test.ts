import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { CodeExecutionTraceSchema } from "@everlast/contracts";
import { seedReadySource } from "@everlast/db/testing";
import { LATENCY_TABLE_PAGE, NUMERIC_TOLERANCE, POPULATION_STDDEV, POPULATION_STDDEV_QUESTION } from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import { SandboxError } from "../src/chat/execution/runtime.ts";
import type { CodeCorrectionInput, GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { interpretFixture, latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] T024 — retry/state machine (FR-GC-08; spec FR-003, FR-006, FR-007, SC-004, SC-007).
 * Exactly one correction after a first-attempt Python exception, in a fresh sandbox with the same immutable inputs;
 * zero retries for timeout/OOM/storage/security/transport uncertainty/invalid output/citation errors.
 * Real API + PostgreSQL; model and sandbox are labelled TEST DOUBLES.
 */

class Model implements GroundedModel {
  readonly id = "scripted";
  draftOp: Parameters<typeof latencyComputeDraft>[1] = "raise";
  corrections: CodeCorrectionInput[] = [];
  correction: (input: CodeCorrectionInput) => Promise<string> = async () => "# FIXTURE:pstdev\nemit('sd', 1)";
  async generate({ chunks }: GroundedModelInput): Promise<GroundedDraft> {
    return latencyComputeDraft(chunks, this.draftOp);
  }
  async correctCode(input: CodeCorrectionInput): Promise<string> {
    this.corrections.push(input);
    return this.correction(input);
  }
}

let api: TestApi;
const model = new Model();
const sandbox = new ScriptedSandbox();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);

beforeAll(async () => {
  const storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-retry-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => ({ embedder, storage, chat: new ChatService({ pool: db.pool, embedder, model, codeExecution: { runtime: sandbox, storage, deadlineMs: 300 } }) }));
});
afterAll(async () => api?.close());
beforeEach(() => {
  sandbox.reset();
  model.corrections = [];
  model.draftOp = "raise";
  model.correction = async () => "# FIXTURE:pstdev\nemit('sd', 1)";
});

async function run(as: string) {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const notebookId = ((await res.json()) as any).notebook.id as string;
  const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  const src = await seedReadySource(api.db.pool, owner, notebookId, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
  const turn = await api.fetch(`/api/notebooks/${notebookId}/chat/turns`, { method: "POST", as, json: { message: POPULATION_STDDEV_QUESTION, active_source_ids: [src.sourceId], request_id: randomUUID() } });
  const text = await turn.text();
  const final = /event: final\ndata: (.+)/.exec(text)?.[1];
  const answer = final ? JSON.parse(final).messages[1] : null;
  const charts = (await api.db.pool.query("SELECT state FROM chart_artifacts WHERE notebook_id = $1 ORDER BY created_at", [notebookId])).rows.map((r) => r.state);
  return { answer, trace: answer?.code_execution_trace ? CodeExecutionTraceSchema.parse(answer.code_execution_trace) : null, text, charts, notebookId };
}

describe("T024 one correction after a first Python exception (FR-006, FR-007, SC-007)", () => {
  it("RTY-01: both attempts are kept in order; only the final attempt's outputs are published", async () => {
    const { answer, trace, charts } = await run("rty01");
    expect(trace!.state).toBe("Succeeded");
    expect(trace!.attempts.map((a) => [a.ordinal, a.terminal_reason, a.exit_code])).toEqual([
      [1, "PythonException", 1],
      [2, "Succeeded", 0],
    ]);
    expect(trace!.attempts[0]!.stderr).toContain("ZeroDivisionError");
    expect(trace!.attempts[0]!.artifacts).toEqual([]);
    expect(trace!.final_attempt_id).toBe(trace!.attempts[1]!.attempt_id);
    expect(trace!.published_artifact_ids).toHaveLength(1);
    expect(trace!.attempts[1]!.artifacts[0]).toContain(trace!.published_artifact_ids[0]!);
    const value = /: (\S+) ms \(Computed\)/.exec(answer.content)![1]!;
    expect(Math.abs(Number(value) - POPULATION_STDDEV)).toBeLessThan(NUMERIC_TOLERANCE);
    expect(charts).toEqual(["published"]);
    // Fresh sandbox per attempt, each deleted; the correction saw the same immutable inputs and the failure.
    expect(sandbox.created).toHaveLength(2);
    expect(new Set(sandbox.created).size).toBe(2);
    expect(sandbox.destroyed).toEqual(sandbox.created);
    expect(sandbox.calls[0]!.files[0]!.content.equals(sandbox.calls[1]!.files[0]!.content)).toBe(true);
    expect(model.corrections).toHaveLength(1);
    expect(model.corrections[0]!.values).toHaveLength(12);
    expect(model.corrections[0]!.stderr).toContain("ZeroDivisionError");
    expect(model.corrections[0]!.failedCode).toContain("# FIXTURE:raise");
  });

  it("RTY-02: a second exception is terminal — transparent error, no number, both attempts, nothing published", async () => {
    model.correction = async () => "# FIXTURE:raise\n1/0";
    const { answer, trace, charts } = await run("rty02");
    expect(answer.kind).toBe("refusal");
    expect(answer.content).toMatch(/could not be completed/);
    expect(answer.content).not.toMatch(/\d\.\d/);
    expect(trace!.state).toBe("Failed");
    expect(trace!.failure_code).toBe("PythonException");
    expect(trace!.attempts).toHaveLength(2);
    expect(trace!.final_attempt_id).toBe(trace!.attempts[1]!.attempt_id);
    expect(trace!.published_artifact_ids).toEqual([]);
    expect(trace!.computed_results).toEqual([]);
    expect(charts).toEqual([]);
    expect(model.corrections).toHaveLength(1); // never a third attempt
  });

  it("RTY-03: the per-attempt deadline is TimedOut with zero retries, a null exit code and a deleted sandbox", async () => {
    model.draftOp = "pstdev";
    sandbox.gate = new Promise(() => undefined);
    const { answer, trace } = await run("rty03");
    expect(trace!.state).toBe("TimedOut");
    expect(trace!.failure_code).toBe("ExecutionTimeout");
    expect(trace!.attempts).toHaveLength(1);
    expect(trace!.attempts[0]!.exit_code).toBeNull();
    expect(answer.content).toMatch(/15 seconds/);
    expect(model.corrections).toHaveLength(0);
    expect(sandbox.destroyed).toEqual(sandbox.created);
  });

  it("RTY-04: a sandbox memory error has zero retries", async () => {
    model.draftOp = "memory";
    const { trace } = await run("rty04");
    expect(trace).toMatchObject({ state: "Failed", failure_code: "MemoryLimitExceeded" });
    expect(trace!.attempts).toHaveLength(1);
    expect(model.corrections).toHaveLength(0);
  });

  it("RTY-05: file-limit, security-profile and transport-uncertainty failures have zero retries", async () => {
    for (const [as, error, code] of [
      ["rty05a", new SandboxError("TemporaryStorageLimit", "x"), "TemporaryStorageLimit"],
      ["rty05b", new SandboxError("ExecutionOutcomeUnknown", "x"), "ExecutionOutcomeUnknown"],
    ] as const) {
      sandbox.reset();
      model.draftOp = "pstdev";
      sandbox.script = () => {
        throw error;
      };
      const { trace } = await run(as);
      expect(trace).toMatchObject({ state: "Failed", failure_code: code });
      expect(sandbox.calls).toHaveLength(1);
      expect(trace!.attempts[0]!.exit_code).toBeNull();
    }
    expect(model.corrections).toHaveLength(0);
  });

  it("RTY-06: invalid output (NaN) and a forged out-of-scope citation are terminal without retry", async () => {
    model.draftOp = "nan";
    expect((await run("rty06a")).trace).toMatchObject({ state: "Failed", failure_code: "InvalidOutput" });
    model.draftOp = "forge";
    expect((await run("rty06b")).trace).toMatchObject({ state: "Failed", failure_code: "CitationInvalid" });
    expect(model.corrections).toHaveLength(0);
  });

  it("RTY-07: a blocked network call fails the code; no result derived from a network response is published (SC-002)", async () => {
    model.draftOp = "network";
    model.correction = async () => "# FIXTURE:network\nimport urllib.request";
    const { answer, trace } = await run("rty07");
    expect(trace!.state).toBe("Failed");
    expect(trace!.attempts.every((a) => a.stderr.includes("URLError"))).toBe(true);
    expect(trace!.computed_results).toEqual([]);
    expect(answer.content).not.toContain("(Computed)");
  });

  it("RTY-08: a provider that cannot create a sandbox leaves an allocated Failed trace with zero attempts", async () => {
    model.draftOp = "pstdev";
    sandbox.failCreate = true;
    const { answer, trace } = await run("rty08");
    expect(trace).toMatchObject({ state: "Failed", failure_code: "ProviderUnavailable", attempts: [], final_attempt_id: null, published_artifact_ids: [] });
    expect(answer.kind).toBe("refusal");
  });

  it("RTY-09: the correction cannot expand inputs — the second sandbox receives byte-identical data.json", async () => {
    model.correction = async () => "# FIXTURE:pstdev\n# tries to read other data\nopen('/etc/passwd')";
    sandbox.script = (call, attempt) => interpretFixture(call);
    await run("rty09");
    expect(sandbox.calls).toHaveLength(2);
    expect(sandbox.calls.map((c) => c.files.map((f) => f.name))).toEqual([["data.json"], ["data.json"]]);
    expect(sandbox.calls[1]!.files[0]!.content.equals(sandbox.calls[0]!.files[0]!.content)).toBe(true);
  });
});
