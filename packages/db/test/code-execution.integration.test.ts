import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chartUrl, type CodeExecutionTrace } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook } from "../src/notebooks.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import { clearThread, getOrCreateThread, listThreadMessages, loadVisibleThread, publishTurn } from "../src/chat-history.ts";
import { runMigrations } from "../src/migrate.ts";

/**
 * [010-code-execution-sandbox] T005 — migration 0010, durable execution admission/lease fencing, ordered trace
 * publication, cleanup ledger and clear-chat invalidation (FR-GC-08, FR-GC-06, NFR-EVAL-04; spec FR-007, FR-010,
 * FR-011, SC-005). Real PostgreSQL; the app pool is passed explicitly (no process-default pool).
 */

let db: TestDatabase;
let owner: string;
let ce: Record<string, any>;
const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
  ce = (await import("../src/code-execution.ts").catch(() => ({}))) as Record<string, any>;
});

afterAll(async () => {
  await db?.drop();
});

async function setup(user = owner) {
  const notebookId = (await createNotebook(db.pool, user, {})).notebook.id;
  const source = await seedReadySource(db.pool, user, notebookId, { title: "Latency.pdf", pages: ["Jan 2025: 1 ms"], embed });
  const snapshot = await captureScopeSnapshot(db.pool, user, notebookId, [source.sourceId]);
  const thread = await getOrCreateThread(db.pool, user, notebookId);
  return { notebookId, source, snapshot, thread };
}

function successTrace(executionId: string, attemptId: string, notebookId: string, messageId: string, artifactId: string, chunkId: string): CodeExecutionTrace {
  return {
    schema_version: 1,
    execution_id: executionId,
    state: "Succeeded",
    attempts: [
      {
        attempt_id: attemptId,
        ordinal: 1,
        code: "emit('n', 1)",
        stdout: "",
        stderr: "",
        exit_code: 0,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        terminal_reason: "Succeeded",
        artifacts: [chartUrl(notebookId, messageId, artifactId)],
      },
    ],
    final_attempt_id: attemptId,
    published_artifact_ids: [artifactId],
    failure_code: null,
    computed_results: [{ label: "n", value: "1", unit: null, citations: [chunkId] }],
  };
}

describe("T005 migration 0010 (FR-GC-08 FR-007)", () => {
  it("CE-DB-01: 0010_code_execution is applied after 0009, additive and idempotent", async () => {
    const versions = (await db.pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => r.version);
    const at = versions.indexOf("0009_multimodal_ingestion_sync.sql");
    expect(versions[at + 1]).toBe("0010_code_execution.sql");
    const tables = (await db.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(["code_executions", "code_execution_sandboxes", "chart_artifacts"]));
    const column = await db.pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'code_execution_trace'");
    expect(column.rows[0]?.is_nullable).toBe("YES");
    await runMigrations(db.pool); // second pass is a no-op
  });

  it("CE-DB-02: legacy chat rows stay valid and reload with a null trace", async () => {
    const { notebookId, snapshot, thread, source } = await setup();
    await publishTurn(db.pool, { thread, snapshot, requestId: randomUUID(), question: "q", answer: { kind: "answer", content: "a[[1]]", citations: [{ badge_number: 1, source_id: source.sourceId, chunk_id: source.chunkIds[0]!, revision: 1 }] } });
    const stored = await listThreadMessages(db.pool, thread.id);
    expect(stored.map((m) => (m as any).code_execution_trace ?? null)).toEqual([null, null]);
    const visible = await loadVisibleThread(db.pool, owner, notebookId);
    expect(visible[1]).toMatchObject({ kind: "answer", code_execution_trace: null });
  });

  it("CE-DB-03: database constraints reject invalid states, ordinals, MIME types and digests", async () => {
    const { notebookId, thread } = await setup();
    const bad = (sql: string, params: unknown[]) => expect(db.pool.query(sql, params)).rejects.toThrow();
    await bad(
      `INSERT INTO code_executions (id, thread_id, notebook_id, user_id, request_id, generation_epoch, state, attempt_ordinal, source_snapshot, trace, lease_token, lease_expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'Running', 0, '[]', '{}', $6, now())`,
      [randomUUID(), thread.id, notebookId, owner, randomUUID(), randomUUID()]
    );
    await bad(
      `INSERT INTO code_executions (id, thread_id, notebook_id, user_id, request_id, generation_epoch, state, attempt_ordinal, source_snapshot, trace, lease_token, lease_expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'SandboxRunning', 3, '[]', '{}', $6, now())`,
      [randomUUID(), thread.id, notebookId, owner, randomUUID(), randomUUID()]
    );
    await bad(
      `INSERT INTO chart_artifacts (id, attempt_id, notebook_id, user_id, object_key, object_generation, mime_type, digest, byte_size, source_snapshot, citation_chunk_ids, state)
       VALUES ($1, $2, $3, $4, 'k', '1', 'text/html', $5, 1, '[]', '[]', 'candidate')`,
      [randomUUID(), randomUUID(), notebookId, owner, "a".repeat(64)]
    );
    await bad(
      `INSERT INTO chart_artifacts (id, attempt_id, notebook_id, user_id, object_key, object_generation, mime_type, digest, byte_size, source_snapshot, citation_chunk_ids, state)
       VALUES ($1, $2, $3, $4, 'k', '1', 'image/png', 'nothex', 1, '[]', '[]', 'candidate')`,
      [randomUUID(), randomUUID(), notebookId, owner]
    );
    // A trace may only be stored on an assistant message, as a version-1 object.
    await bad(
      `INSERT INTO chat_messages (id, thread_id, notebook_id, user_id, turn_id, request_id, role, kind, content, generation_epoch, code_execution_trace)
       VALUES ($1, $2, $3, $4, $5, $6, 'user', 'question', 'q', 0, '{"schema_version":1}')`,
      [randomUUID(), thread.id, notebookId, owner, randomUUID(), randomUUID()]
    );
  });
});

describe("T005 durable admission and lease fencing (FR-GC-08, FR-GC-06)", () => {
  it("CE-DB-04: one active execution per user and notebook; overlap is rejected with 409", async () => {
    const { snapshot, thread } = await setup();
    const first = await ce.admitCodeExecution?.(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    expect(first?.executionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(ce.admitCodeExecution(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources })).rejects.toMatchObject({ code: "ExecutionInProgress", status: 409 });
    await ce.finishCodeExecution(db.pool, first.executionId, first.leaseToken, { state: "Failed", failureCode: "ProviderUnavailable", trace: { schema_version: 1, execution_id: first.executionId, state: "Failed", attempts: [], final_attempt_id: null, published_artifact_ids: [], failure_code: "ProviderUnavailable", computed_results: [] } });
    const second = await ce.admitCodeExecution(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    expect(second.executionId).not.toBe(first.executionId);
  });

  it("CE-DB-05: the same request ID can never allocate a second execution (no duplicate Python run)", async () => {
    const { snapshot, thread } = await setup();
    const requestId = randomUUID();
    const first = await ce.admitCodeExecution?.(db.pool, { thread, requestId, snapshot: snapshot.sources });
    await ce.finishCodeExecution(db.pool, first.executionId, first.leaseToken, { state: "Failed", failureCode: "ProviderUnavailable", trace: { schema_version: 1, execution_id: first.executionId, state: "Failed", attempts: [], final_attempt_id: null, published_artifact_ids: [], failure_code: "ProviderUnavailable", computed_results: [] } });
    await expect(ce.admitCodeExecution(db.pool, { thread, requestId, snapshot: snapshot.sources })).rejects.toMatchObject({ status: 409 });
  });

  it("CE-DB-06: progress writes are fenced by the lease token; a stale holder cannot overwrite", async () => {
    const { snapshot, thread } = await setup();
    const exec = await ce.admitCodeExecution?.(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    await expect(ce.recordCodeExecutionProgress(db.pool, exec.executionId, randomUUID(), { state: "SandboxRunning", attemptOrdinal: 1 })).rejects.toMatchObject({ code: "GenerationCancelled" });
    await ce.recordCodeExecutionProgress(db.pool, exec.executionId, exec.leaseToken, { state: "SandboxRunning", attemptOrdinal: 1 });
    const row = (await db.pool.query("SELECT state, attempt_ordinal FROM code_executions WHERE id = $1", [exec.executionId])).rows[0];
    expect(row).toEqual({ state: "SandboxRunning", attempt_ordinal: 1 });
  });
});

describe("T005 atomic ordered-trace publication (FR-007, FR-010)", () => {
  it("CE-DB-07: answer, trace and chart publication commit together and reload in order", async () => {
    const { notebookId, snapshot, thread, source } = await setup();
    const exec = await ce.admitCodeExecution?.(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    const attemptId = randomUUID();
    const artifactId = randomUUID();
    const messageId = randomUUID();
    await ce.insertChartCandidate(db.pool, {
      artifact_id: artifactId,
      execution_id: exec.executionId,
      attempt_id: attemptId,
      message_id: null,
      notebook_id: notebookId,
      user_id: owner,
      object_key: `notebooks/${notebookId}/chat-charts/${artifactId}.png`,
      object_generation: "1",
      mime_type: "image/png",
      digest: "c".repeat(64),
      byte_size: 10,
      source_snapshot: snapshot.sources,
      citation_chunk_ids: [source.chunkIds[0]],
      state: "candidate",
    });
    const trace = successTrace(exec.executionId, attemptId, notebookId, messageId, artifactId, source.chunkIds[0]!);
    const requestId = randomUUID();
    await publishTurn(db.pool, {
      thread,
      snapshot,
      requestId,
      question: "sd?",
      answer: { id: messageId, kind: "answer", content: "n = 1 (Computed)[[1]]", citations: [{ badge_number: 1, source_id: source.sourceId, chunk_id: source.chunkIds[0]!, revision: 1 }], trace },
      execution: { executionId: exec.executionId, leaseToken: exec.leaseToken, publishArtifactIds: [artifactId] },
    } as any);
    const visible = await loadVisibleThread(db.pool, owner, notebookId);
    expect(visible.at(-1)).toMatchObject({ id: messageId, code_execution_trace: trace });
    const chart = (await db.pool.query("SELECT state, message_id FROM chart_artifacts WHERE id = $1", [artifactId])).rows[0];
    expect(chart).toEqual({ state: "published", message_id: messageId });
    const execRow = (await db.pool.query("SELECT state, message_id FROM code_executions WHERE id = $1", [exec.executionId])).rows[0];
    expect(execRow).toEqual({ state: "Succeeded", message_id: messageId });
  });

  it("CE-DB-08: publication fails closed when the lease was lost (clear/reconcile) — nothing is written", async () => {
    const { notebookId, snapshot, thread, source } = await setup();
    const exec = await ce.admitCodeExecution?.(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    const trace = successTrace(exec.executionId, randomUUID(), notebookId, randomUUID(), randomUUID(), source.chunkIds[0]!);
    trace.published_artifact_ids = [];
    trace.attempts[0]!.artifacts = [];
    const requestId = randomUUID();
    await expect(
      publishTurn(db.pool, {
        thread,
        snapshot,
        requestId,
        question: "q",
        answer: { kind: "answer", content: "x", citations: [], trace },
        execution: { executionId: exec.executionId, leaseToken: randomUUID(), publishArtifactIds: [] },
      } as any)
    ).rejects.toMatchObject({ code: "GenerationCancelled" });
    expect((await listThreadMessages(db.pool, thread.id)).filter((m) => m.request_id === requestId)).toHaveLength(0);
  });

  it("CE-DB-09: a clarification-only turn is stored with kind clarification and no trace", async () => {
    const { notebookId, snapshot, thread } = await setup();
    await publishTurn(db.pool, { thread, snapshot, requestId: randomUUID(), question: "sd?", answer: { kind: "clarification", content: "Sample or population?", citations: [] } } as any);
    const visible = await loadVisibleThread(db.pool, owner, notebookId);
    expect(visible.at(-1)).toMatchObject({ kind: "clarification", content: "Sample or population?", code_execution_trace: null });
  });
});

describe("T005 cleanup ledger, clear-chat invalidation and pool isolation (FR-011, SC-005)", () => {
  it("CE-DB-10: sandbox handles are recorded server-side until destruction is confirmed", async () => {
    const { notebookId, snapshot, thread } = await setup();
    const exec = await ce.admitCodeExecution?.(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    const attemptId = randomUUID();
    await ce.registerSandbox(db.pool, { attemptId, executionId: exec.executionId, notebookId });
    await ce.markSandboxActive(db.pool, attemptId, "projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/9");
    expect((await ce.listSandboxesToDestroy(db.pool, { minAgeMs: 0 })).map((s: any) => s.attempt_id)).toContain(attemptId);
    await ce.markSandboxDestroyed(db.pool, attemptId);
    expect((await ce.listSandboxesToDestroy(db.pool, { minAgeMs: 0 })).map((s: any) => s.attempt_id)).not.toContain(attemptId);
  });

  it("CE-DB-11: clear chat deletes traces/executions, invalidates charts and fences the in-flight lease", async () => {
    const { notebookId, snapshot, thread, source } = await setup();
    const exec = await ce.admitCodeExecution?.(db.pool, { thread, requestId: randomUUID(), snapshot: snapshot.sources });
    const artifactId = randomUUID();
    await ce.insertChartCandidate(db.pool, {
      artifact_id: artifactId,
      execution_id: exec.executionId,
      attempt_id: randomUUID(),
      message_id: null,
      notebook_id: notebookId,
      user_id: owner,
      object_key: `notebooks/${notebookId}/chat-charts/${artifactId}.png`,
      object_generation: "1",
      mime_type: "image/png",
      digest: "d".repeat(64),
      byte_size: 10,
      source_snapshot: snapshot.sources,
      citation_chunk_ids: [source.chunkIds[0]],
      state: "candidate",
    });
    await clearThread(db.pool, owner, notebookId);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM code_executions WHERE thread_id = $1", [thread.id])).rows[0].n).toBe(0);
    expect((await db.pool.query("SELECT state FROM chart_artifacts WHERE id = $1", [artifactId])).rows[0].state).toBe("invalidated");
    await expect(ce.recordCodeExecutionProgress(db.pool, exec.executionId, exec.leaseToken, { state: "SandboxRunning", attemptOrdinal: 1 })).rejects.toMatchObject({ code: "GenerationCancelled" });
    expect((await ce.listArtifactsToPurge(db.pool)).map((a: any) => a.artifact_id)).toContain(artifactId);
  });

  it("CE-DB-12: another user's notebook cannot admit or read executions; a second app pool sees only its own database", async () => {
    const other = await createTestUser(db.pool);
    const { thread, snapshot } = await setup();
    // Admission is bound to the thread's own owner; a forged thread record for another user is rejected.
    await expect(ce.admitCodeExecution?.(db.pool, { thread: { ...thread, user_id: other }, requestId: randomUUID(), snapshot: snapshot.sources })).rejects.toBeTruthy();
    const second = await createTestDatabase();
    try {
      expect((await second.pool.query("SELECT count(*)::int AS n FROM code_executions")).rows[0].n).toBe(0);
    } finally {
      await second.drop();
    }
  });
});
