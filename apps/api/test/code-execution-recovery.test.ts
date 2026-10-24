import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { seedReadySource } from "@everlast/db/testing";
import { admitCodeExecution, getOrCreateThread, markSandboxActive, registerSandbox } from "@everlast/db";
import { LATENCY_TABLE_PAGE, POPULATION_STDDEV_QUESTION } from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] T026 (API part) — cancel/clear/revoke during an attempt, overlap admission, replay,
 * crash reconciliation without Python replay and idempotent destruction (FR-GC-08, FR-GC-06, NFR-EVAL-04; spec
 * FR-006, FR-007, FR-010, FR-011, SC-004, SC-005). Real API/PostgreSQL; model and sandbox are TEST DOUBLES.
 */

class Model implements GroundedModel {
  readonly id = "scripted";
  draft: (i: GroundedModelInput) => GroundedDraft = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
  async generate(input: GroundedModelInput) {
    return this.draft(input);
  }
}

let api: TestApi;
let storage: LocalObjectStorage;
const model = new Model();
const sandbox = new ScriptedSandbox();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);
let reconcile: Record<string, any> = {};

beforeAll(async () => {
  storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-rec-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => ({ embedder, storage, chat: new ChatService({ pool: db.pool, embedder, model, codeExecution: { runtime: sandbox, storage } }) }));
  reconcile = (await import("../src/chat/execution/reconcile.ts").catch(() => ({}))) as Record<string, any>;
});
afterAll(async () => api?.close());
beforeEach(() => sandbox.reset());

async function setup(as: string) {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const notebookId = ((await res.json()) as any).notebook.id as string;
  const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  const src = await seedReadySource(api.db.pool, owner, notebookId, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
  return { notebookId, owner, src };
}

function send(as: string, notebookId: string, sourceId: string, requestId = randomUUID()) {
  return api
    .fetch(`/api/notebooks/${notebookId}/chat/turns`, { method: "POST", as, json: { message: POPULATION_STDDEV_QUESTION, active_source_ids: [sourceId], request_id: requestId } })
    .then((r) => r.text());
}

const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 5_000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("T026 cancellation fences during an attempt (FR-010, FR-011)", () => {
  it("REC-API-01: Clear chat during the attempt deletes the sandbox and nothing is (re)published", async () => {
    const { notebookId, src } = await setup("rec01");
    let release!: () => void;
    sandbox.gate = new Promise<void>((r) => (release = r));
    const pending = send("rec01", notebookId, src.sourceId);
    await waitFor(() => sandbox.calls.length === 1);
    expect((await api.fetch(`/api/notebooks/${notebookId}/chat`, { method: "DELETE", as: "rec01" })).status).toBe(200);
    release();
    const text = await pending;
    expect(text).toContain("event: error");
    expect(text).not.toContain("event: final");
    expect(sandbox.destroyed).toEqual(sandbox.created);
    const rows = await api.db.pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE notebook_id = $1", [notebookId]);
    expect(rows.rows[0].n).toBe(0);
    expect((await api.db.pool.query("SELECT count(*)::int AS n FROM chart_artifacts WHERE notebook_id = $1 AND state = 'published'", [notebookId])).rows[0].n).toBe(0);
  });

  it("REC-API-02: revoking (deleting) a captured source during execution fails publication — no stale answer, chart or trace", async () => {
    const { notebookId, src } = await setup("rec02");
    let release!: () => void;
    sandbox.gate = new Promise<void>((r) => (release = r));
    const pending = send("rec02", notebookId, src.sourceId);
    await waitFor(() => sandbox.calls.length === 1);
    expect((await api.fetch(`/api/notebooks/${notebookId}/sources/${src.sourceId}`, { method: "DELETE", as: "rec02" })).status).toBe(204);
    release();
    const text = await pending;
    expect(text).toContain("event: error");
    expect((await api.db.pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE notebook_id = $1", [notebookId])).rows[0].n).toBe(0);
    const exec = (await api.db.pool.query("SELECT state, failure_code FROM code_executions WHERE notebook_id = $1", [notebookId])).rows[0];
    expect(exec).toEqual({ state: "Failed", failure_code: "ScopeChanged" });
    expect((await api.db.pool.query("SELECT state FROM chart_artifacts WHERE notebook_id = $1", [notebookId])).rows.map((r) => r.state)).toEqual(["invalidated"]);
  });
});

describe("T026 admission, replay and allocation boundaries (FR-007)", () => {
  it("REC-API-03: an overlapping computation in the same notebook is rejected (ExecutionInProgress) without a second sandbox", async () => {
    const { notebookId, src } = await setup("rec03");
    let release!: () => void;
    sandbox.gate = new Promise<void>((r) => (release = r));
    const first = send("rec03", notebookId, src.sourceId);
    await waitFor(() => sandbox.calls.length === 1);
    const second = await send("rec03", notebookId, src.sourceId);
    expect(second).toContain('"code":"ExecutionInProgress"');
    release();
    expect(await first).toContain("event: final");
    expect(sandbox.created).toHaveLength(1);
  });

  it("REC-API-04: replaying a finished request returns the stored result and runs no Python", async () => {
    const { notebookId, src } = await setup("rec04");
    const requestId = randomUUID();
    const first = await send("rec04", notebookId, src.sourceId, requestId);
    const again = await send("rec04", notebookId, src.sourceId, requestId);
    expect(again).toContain('"replayed":true');
    expect(JSON.parse(/event: final\ndata: (.+)/.exec(again)![1]!).messages[1].id).toBe(JSON.parse(/event: final\ndata: (.+)/.exec(first)![1]!).messages[1].id);
    expect(sandbox.calls).toHaveLength(1);
  });

  it("REC-API-05: a request rejected before allocation (unverifiable inputs) leaves no execution record", async () => {
    const { notebookId, src } = await setup("rec05");
    model.draft = ({ chunks }) => {
      const d = latencyComputeDraft(chunks) as any;
      d.computation.dataset[0].value = "999";
      return d;
    };
    try {
      await send("rec05", notebookId, src.sourceId);
    } finally {
      model.draft = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
    }
    expect((await api.db.pool.query("SELECT count(*)::int AS n FROM code_executions WHERE notebook_id = $1", [notebookId])).rows[0].n).toBe(0);
  });
});

describe("T029 crash reconciliation without replay (FR-006, FR-011)", () => {
  it("REC-API-06: expired executions are ended, their sandboxes deleted idempotently, and Python is never re-executed", async () => {
    const { notebookId, owner } = await setup("rec06");
    const thread = await getOrCreateThread(api.db.pool, owner, notebookId);
    const exec = await admitCodeExecution(api.db.pool, { thread, requestId: randomUUID(), snapshot: [], leaseMs: 1 });
    const attemptId = randomUUID();
    await registerSandbox(api.db.pool, { attemptId, executionId: exec.executionId, notebookId });
    await markSandboxActive(api.db.pool, attemptId, "projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/orphan");
    await new Promise((r) => setTimeout(r, 20));
    const report = await reconcile.reconcileCodeExecutions?.({ pool: api.db.pool, runtime: sandbox, storage, sandboxMinAgeMs: 60_000 });
    expect(report?.reconciled).toBeGreaterThanOrEqual(1);
    expect(sandbox.destroyed).toContain("projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/orphan");
    expect(sandbox.calls).toHaveLength(0); // no replay
    const ledger = (await api.db.pool.query("SELECT state FROM code_execution_sandboxes WHERE attempt_id = $1", [attemptId])).rows[0];
    expect(ledger.state).toBe("Destroyed");
    // Second pass is a no-op (idempotent).
    sandbox.destroyed = [];
    await reconcile.reconcileCodeExecutions({ pool: api.db.pool, runtime: sandbox, storage, sandboxMinAgeMs: 60_000 });
    expect(sandbox.destroyed).not.toContain("projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/orphan");
  });

  it("REC-API-07: a failed deletion stays DestroyPending and is retried later; a never-created sandbox is closed without a provider call", async () => {
    const { notebookId, owner } = await setup("rec07");
    const thread = await getOrCreateThread(api.db.pool, owner, notebookId);
    const exec = await admitCodeExecution(api.db.pool, { thread, requestId: randomUUID(), snapshot: [], leaseMs: 1 });
    const failing = randomUUID();
    const never = randomUUID();
    await registerSandbox(api.db.pool, { attemptId: failing, executionId: exec.executionId, notebookId });
    await markSandboxActive(api.db.pool, failing, "projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/stuck");
    await registerSandbox(api.db.pool, { attemptId: never, executionId: exec.executionId, notebookId });
    await new Promise((r) => setTimeout(r, 20));
    const flaky = { ...sandbox, id: "flaky", create: sandbox.create.bind(sandbox), execute: sandbox.execute.bind(sandbox), destroy: async () => Promise.reject(new Error("503")) };
    await reconcile.reconcileCodeExecutions?.({ pool: api.db.pool, runtime: flaky, storage, sandboxMinAgeMs: 0 });
    const states = Object.fromEntries((await api.db.pool.query("SELECT attempt_id, state FROM code_execution_sandboxes WHERE attempt_id = ANY($1::uuid[])", [[failing, never]])).rows.map((r) => [r.attempt_id, r.state]));
    expect(states[failing]).toBe("DestroyPending");
    expect(states[never]).toBe("Destroyed");
  });

  it("REC-API-08: invalidated chart objects are deleted from storage (Clear chat → asynchronous physical cleanup)", async () => {
    const { notebookId, src } = await setup("rec08");
    await send("rec08", notebookId, src.sourceId);
    const chart = (await api.db.pool.query("SELECT id, object_key, object_generation FROM chart_artifacts WHERE notebook_id = $1", [notebookId])).rows[0];
    await api.fetch(`/api/notebooks/${notebookId}/chat`, { method: "DELETE", as: "rec08" });
    await reconcile.reconcileCodeExecutions?.({ pool: api.db.pool, runtime: sandbox, storage });
    await expect(storage.read(chart.object_key, chart.object_generation)).rejects.toBeTruthy();
    expect((await api.db.pool.query("SELECT object_deleted_at IS NOT NULL AS gone FROM chart_artifacts WHERE id = $1", [chart.id])).rows[0].gone).toBe(true);
  });
});
