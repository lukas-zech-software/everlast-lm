import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { CodeExecutionTraceSchema } from "@everlast/contracts";
import { reconcileExpiredExecutions } from "@everlast/db";
import { seedReadySource } from "@everlast/db/testing";
import { LATENCY_TABLE_PAGE, POPULATION_STDDEV_QUESTION } from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { CodeCorrectionInput, GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] PR #159 review — the execution lease must stay alive through the slow correction
 * call and the second sandbox creation, so the reconciler cannot fence a live retry (FR-GC-08 FR-006/FR-007).
 * Real API + PostgreSQL; model and sandbox are labelled TEST DOUBLES.
 */
let api: TestApi;
let reconciled: string[] = [];
class SlowCorrectionModel implements GroundedModel {
  readonly id = "scripted";
  async generate({ chunks }: GroundedModelInput): Promise<GroundedDraft> {
    return latencyComputeDraft(chunks, "raise");
  }
  async correctCode(_input: CodeCorrectionInput): Promise<string> {
    // The correction outlives several lease periods; a reconciler tick runs meanwhile.
    await new Promise((r) => setTimeout(r, 900));
    reconciled = await reconcileExpiredExecutions(api.db.pool);
    return "# FIXTURE:pstdev\nemit('sd', 1)";
  }
}

beforeAll(async () => {
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  const storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-lease-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => ({
    embedder,
    storage,
    chat: new ChatService({ pool: db.pool, embedder, model: new SlowCorrectionModel(), codeExecution: { runtime: new ScriptedSandbox(), storage, deadlineMs: 300, leaseMs: 300 } }),
  }));
  (globalThis as any).__embed = (t: string[]) => embedder.embed(t);
});
afterAll(async () => api?.close());

describe("[010-code-execution-sandbox] review: lease heartbeat during correction (FR-006, FR-007)", () => {
  it("a correction slower than the lease is not reconciled and the second attempt succeeds", async () => {
    const as = "lease01";
    const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
    const notebookId = ((await res.json()) as any).notebook.id as string;
    const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
    const src = await seedReadySource(api.db.pool, owner, notebookId, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed: (globalThis as any).__embed });
    const turn = await api.fetch(`/api/notebooks/${notebookId}/chat/turns`, { method: "POST", as, json: { message: POPULATION_STDDEV_QUESTION, active_source_ids: [src.sourceId], request_id: randomUUID() } });
    const text = await turn.text();
    const final = /event: final\ndata: (.+)/.exec(text)?.[1];
    expect(final, text).toBeTruthy();
    const trace = CodeExecutionTraceSchema.parse(JSON.parse(final!).messages[1].code_execution_trace);
    expect(reconciled).not.toContain(trace.execution_id);
    expect(trace.state).toBe("Succeeded");
    expect(trace.attempts.map((a) => a.terminal_reason)).toEqual(["PythonException", "Succeeded"]);
  });
});
