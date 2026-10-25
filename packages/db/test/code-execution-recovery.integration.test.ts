import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodeExecutionTrace } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook } from "../src/notebooks.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import { getOrCreateThread } from "../src/chat-history.ts";
import * as ce from "../src/code-execution.ts";

/**
 * [010-code-execution-sandbox] T026 (DB part) — crash/unknown-outcome reconciliation without replay, lease fencing,
 * duplicate/out-of-order writes and cleanup selection (FR-GC-08, FR-GC-06, NFR-EVAL-04; spec FR-006, FR-007,
 * FR-010, FR-011, SC-004, SC-005). Real PostgreSQL.
 */

let db: TestDatabase;
let owner: string;
const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
});
afterAll(async () => db?.drop());

async function admitted() {
  const notebookId = (await createNotebook(db.pool, owner, {})).notebook.id;
  const source = await seedReadySource(db.pool, owner, notebookId, { title: "L.pdf", pages: ["Jan 2025: 1 ms"], embed });
  const snapshot = await captureScopeSnapshot(db.pool, owner, notebookId, [source.sourceId]);
  const thread = await getOrCreateThread(db.pool, owner, notebookId);
  const exec = await ce.admitCodeExecution(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources, leaseMs: 1 });
  return { notebookId, thread, snapshot, exec };
}

const runningTrace = (executionId: string, attemptId: string): CodeExecutionTrace => ({
  schema_version: 1,
  execution_id: executionId,
  state: "SandboxRunning",
  attempts: [{ attempt_id: attemptId, ordinal: 1, code: "x", stdout: "", stderr: "", exit_code: null, started_at: new Date().toISOString(), ended_at: null, terminal_reason: null, artifacts: [] }],
  final_attempt_id: null,
  published_artifact_ids: [],
  failure_code: null,
  computed_results: [],
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("T026 reconciliation without Python replay (FR-006, FR-007)", () => {
  it("REC-DB-01: an expired lease after code submission becomes ExecutionOutcomeUnknown with a null exit code", async () => {
    const { exec } = await admitted();
    const attemptId = randomUUID();
    await ce.recordCodeExecutionProgress(db.pool, exec.executionId, exec.leaseToken, { state: "SandboxRunning", attemptOrdinal: 1, trace: runningTrace(exec.executionId, attemptId), leaseMs: 1 });
    await sleep(20);
    expect(await ce.reconcileExpiredExecutions(db.pool)).toContain(exec.executionId);
    const row = await ce.getCodeExecution(db.pool, exec.executionId);
    expect(row).toMatchObject({ state: "Failed", failure_code: "ExecutionOutcomeUnknown" });
    expect(row!.trace.attempts).toHaveLength(1);
    expect(row!.trace.attempts[0]).toMatchObject({ exit_code: null, terminal_reason: "ExecutionOutcomeUnknown" });
    expect(row!.trace.final_attempt_id).toBe(attemptId);
    // The crashed controller's lease is dead: it can neither progress nor finish.
    await expect(ce.recordCodeExecutionProgress(db.pool, exec.executionId, exec.leaseToken, { state: "SandboxRunning" })).rejects.toMatchObject({ code: "GenerationCancelled" });
  });

  it("REC-DB-02: an expired lease before any code ran is Failed with zero attempts and a null final attempt", async () => {
    const { exec } = await admitted();
    await sleep(20);
    await ce.reconcileExpiredExecutions(db.pool);
    const row = await ce.getCodeExecution(db.pool, exec.executionId);
    expect(row).toMatchObject({ state: "Failed", failure_code: "GenerationCancelled" });
    expect(row!.trace).toMatchObject({ attempts: [], final_attempt_id: null, published_artifact_ids: [] });
  });

  it("REC-DB-03: a live lease is never reconciled", async () => {
    const { exec } = await admitted();
    await ce.recordCodeExecutionProgress(db.pool, exec.executionId, exec.leaseToken, { state: "SandboxRunning", leaseMs: 60_000 });
    expect(await ce.reconcileExpiredExecutions(db.pool)).not.toContain(exec.executionId);
    expect((await ce.getCodeExecution(db.pool, exec.executionId))!.state).toBe("SandboxRunning");
  });

  it("REC-DB-04: duplicate/out-of-order terminal writes are fenced — no extra attempt, no replaced final result", async () => {
    const { exec } = await admitted();
    const trace = { ...runningTrace(exec.executionId, randomUUID()), state: "Failed" as const, failure_code: "PythonException" as const };
    trace.attempts[0] = { ...trace.attempts[0]!, exit_code: 1, ended_at: new Date().toISOString(), terminal_reason: "PythonException" };
    trace.final_attempt_id = trace.attempts[0]!.attempt_id;
    await ce.finishCodeExecution(db.pool, exec.executionId, exec.leaseToken, { state: "Failed", failureCode: "PythonException", trace });
    await expect(ce.finishCodeExecution(db.pool, exec.executionId, exec.leaseToken, { state: "Succeeded", failureCode: null, trace: { ...trace, state: "Succeeded", failure_code: null } })).rejects.toMatchObject({ code: "GenerationCancelled" });
    expect((await ce.getCodeExecution(db.pool, exec.executionId))!.state).toBe("Failed");
  });
});

describe("T026 cleanup selection (FR-011)", () => {
  it("REC-DB-05: sandboxes of reconciled or finished executions are listed for deletion until confirmed; DestroyPending is retried", async () => {
    const { exec, notebookId } = await admitted();
    const attemptId = randomUUID();
    await ce.registerSandbox(db.pool, { attemptId, executionId: exec.executionId, notebookId });
    await ce.markSandboxActive(db.pool, attemptId, "projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/x");
    await sleep(20);
    await ce.reconcileExpiredExecutions(db.pool);
    const open = await ce.listSandboxesToDestroy(db.pool, { minAgeMs: 60_000 });
    expect(open.map((s) => s.attempt_id)).toContain(attemptId);
    await ce.markSandboxDestroyPending(db.pool, attemptId, "DeleteFailed");
    const pending = (await ce.listSandboxesToDestroy(db.pool, { minAgeMs: 60_000 })).find((s) => s.attempt_id === attemptId);
    expect(pending).toMatchObject({ state: "DestroyPending", destroy_attempts: 1 });
    await ce.markSandboxDestroyed(db.pool, attemptId);
    expect((await ce.listSandboxesToDestroy(db.pool, { minAgeMs: 0 })).map((s) => s.attempt_id)).not.toContain(attemptId);
  });

  it("REC-DB-06: the ledger survives notebook deletion so a remote sandbox can still be deleted", async () => {
    const { exec, notebookId } = await admitted();
    const attemptId = randomUUID();
    await ce.registerSandbox(db.pool, { attemptId, executionId: exec.executionId, notebookId });
    await ce.markSandboxActive(db.pool, attemptId, "projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/y");
    await db.pool.query("DELETE FROM notebooks WHERE id = $1", [notebookId]);
    expect((await ce.listSandboxesToDestroy(db.pool, { minAgeMs: 0 })).map((s) => s.attempt_id)).toContain(attemptId);
  });

  it("REC-DB-07: candidates of a reconciled execution are invalidated and selected for object purge", async () => {
    const { exec, notebookId, snapshot } = await admitted();
    const artifactId = randomUUID();
    await ce.insertChartCandidate(db.pool, {
      artifact_id: artifactId,
      execution_id: exec.executionId,
      attempt_id: randomUUID(),
      message_id: null,
      notebook_id: notebookId,
      user_id: owner,
      object_key: `notebooks/${notebookId}/chat-charts/${artifactId}/chart_1.png`,
      object_generation: "1",
      mime_type: "image/png",
      digest: "e".repeat(64),
      byte_size: 10,
      source_snapshot: snapshot.sources,
      citation_chunk_ids: [randomUUID()],
      state: "candidate",
    });
    await sleep(20);
    await ce.reconcileExpiredExecutions(db.pool);
    expect((await db.pool.query("SELECT state FROM chart_artifacts WHERE id = $1", [artifactId])).rows[0].state).toBe("invalidated");
    expect((await ce.listArtifactsToPurge(db.pool)).map((a) => a.artifact_id)).toContain(artifactId);
    await ce.markArtifactObjectDeleted(db.pool, artifactId);
    expect((await ce.listArtifactsToPurge(db.pool)).map((a) => a.artifact_id)).not.toContain(artifactId);
  });
});
