import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chartUrl, uuidv7, type CodeExecutionTrace } from "@everlast/contracts";
import { createTestDatabase, createTestUser, seedReadySource, type TestDatabase } from "../src/testing.ts";
import { createNotebook, deleteNotebook } from "../src/notebooks.ts";
import { captureScopeSnapshot } from "../src/scope-guard.ts";
import {
  clearThread,
  getOrCreateThread,
  listThreadMessages,
  loadVisibleThread,
  projectVisibleMessages,
  publishTurn,
  searchThread,
} from "../src/chat-history.ts";
import {
  admitCodeExecution,
  chartProvenanceAvailable,
  findPublishedChart,
  insertChartCandidate,
  invalidateChartsOfUnavailableSources,
  markSandboxActive,
  registerSandbox,
  listSandboxesToDestroy,
} from "../src/code-execution.ts";
import {
  claimSourceOperation,
  commitSyncReplacement,
  deleteSource,
  requestSourceSync,
} from "../src/source-sync.ts";
import { saveMessageFeedback, saveMessageFollowUps, getMessageFeedback, getMessageFollowUps } from "../src/package-v2-2.ts";
import { configureChatMessageReader } from "../src/poc-bridge.ts";
import { runWithV2Persistence } from "../src/v2-persistence.ts";

/**
 * [010-code-execution-sandbox] T033 — PostgreSQL persistence & history projection tests for code-execution traces
 * and chart artifacts (FR-GC-08, FR-GC-06, FR-SI-05, FR-WM-04, NFR-SEC-02, NFR-EVAL-04; spec FR-005, FR-007,
 * FR-009, FR-010, FR-011). Real PostgreSQL; explicit app pool isolation.
 */

let db: TestDatabase;
let owner: string;
const vec = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const embed = async (texts: string[]) => texts.map(() => vec);

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await createTestUser(db.pool);
  configureChatMessageReader(async (notebookId, userId) => {
    const thread = await getOrCreateThread(db.pool, userId, notebookId);
    const stored = await listThreadMessages(db.pool, thread.id);
    const visible = await projectVisibleMessages(db.pool, notebookId, stored);
    const provenance = new Map(stored.map((m) => [m.id, m.provenance]));
    return visible
      .filter((m) => m.content !== null)
      .map((m) => ({
        id: m.id,
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: m.role,
        content: m.content!,
        active_source_revisions_snapshot: provenance.get(m.id) ?? [],
        citations: m.citations
          .filter((c) => c.status === "available")
          .map((c) => ({
            badge_number: c.badge_number,
            source_id: c.source_id,
            source_title: c.source_title!,
            chunk_id: c.chunk_id,
            snippet: c.snippet!,
            locator: c.locator!,
          })),
        created_at: m.created_at,
      }));
  });
});

afterAll(async () => {
  await db?.drop();
});

async function setupTwoSources(user = owner) {
  const notebookId = (await createNotebook(db.pool, user, {})).notebook.id;
  const s1 = await seedReadySource(db.pool, user, notebookId, { title: "Latency2025.pdf", pages: ["Jan 2025: 1 ms"], embed });
  const s2 = await seedReadySource(db.pool, user, notebookId, { title: "RND2025.pdf", pages: ["R&D spend 2025: $1.2B"], embed });
  const snapshot = await captureScopeSnapshot(db.pool, user, notebookId, [s1.sourceId, s2.sourceId]);
  const thread = await getOrCreateThread(db.pool, user, notebookId);
  return { notebookId, s1, s2, snapshot, thread };
}

function twoAttemptTrace(input: {
  executionId: string;
  attempt1Id: string;
  attempt2Id: string;
  notebookId: string;
  messageId: string;
  artifactId: string;
  chunkId: string;
}): CodeExecutionTrace {
  return {
    schema_version: 1,
    execution_id: input.executionId,
    state: "Succeeded",
    attempts: [
      {
        attempt_id: input.attempt1Id,
        ordinal: 1,
        code: "1/0",
        stdout: "",
        stderr: "ZeroDivisionError: division by zero",
        exit_code: 1,
        started_at: "2026-10-24T10:00:00.000Z",
        ended_at: "2026-10-24T10:00:01.000Z",
        terminal_reason: "PythonException",
        artifacts: [],
      },
      {
        attempt_id: input.attempt2Id,
        ordinal: 2,
        code: "emit('Population standard deviation', '3.452052529534663', unit='ms')",
        stdout: "computed population sd\n",
        stderr: "",
        exit_code: 0,
        started_at: "2026-10-24T10:00:01.000Z",
        ended_at: "2026-10-24T10:00:02.000Z",
        terminal_reason: "Succeeded",
        artifacts: [chartUrl(input.notebookId, input.messageId, input.artifactId)],
      },
    ],
    final_attempt_id: input.attempt2Id,
    published_artifact_ids: [input.artifactId],
    failure_code: null,
    computed_results: [
      {
        label: "Population standard deviation",
        value: "3.452052529534663",
        unit: "ms",
        citations: [input.chunkId],
      },
    ],
  };
}

async function publishComputedTurn(ctx: Awaited<ReturnType<typeof setupTwoSources>>) {
  const exec = await admitCodeExecution(db.pool, {
    thread: ctx.thread,
    requestId: randomUUID(),
    snapshot: ctx.snapshot.sources,
  });
  const attempt1Id = randomUUID();
  const attempt2Id = randomUUID();
  const artifactId = randomUUID();
  const failedCandidateId = randomUUID();
  const messageId = randomUUID();

  // Failed attempt candidate (must be invalidated on publication) + final attempt candidate (published).
  await insertChartCandidate(db.pool, {
    artifact_id: failedCandidateId,
    execution_id: exec.executionId,
    attempt_id: attempt1Id,
    message_id: null,
    notebook_id: ctx.notebookId,
    user_id: owner,
    object_key: `notebooks/${ctx.notebookId}/chat-charts/${failedCandidateId}/chart_1.png`,
    object_generation: "1",
    mime_type: "image/png",
    digest: "a".repeat(64),
    byte_size: 16,
    source_snapshot: ctx.snapshot.sources,
    citation_chunk_ids: [ctx.s1.chunkIds[0]!],
    state: "candidate",
  });
  await insertChartCandidate(db.pool, {
    artifact_id: artifactId,
    execution_id: exec.executionId,
    attempt_id: attempt2Id,
    message_id: null,
    notebook_id: ctx.notebookId,
    user_id: owner,
    object_key: `notebooks/${ctx.notebookId}/chat-charts/${artifactId}/chart_1.png`,
    object_generation: "1",
    mime_type: "image/png",
    digest: "b".repeat(64),
    byte_size: 32,
    source_snapshot: ctx.snapshot.sources,
    citation_chunk_ids: [ctx.s1.chunkIds[0]!],
    state: "candidate",
  });

  const trace = twoAttemptTrace({
    executionId: exec.executionId,
    attempt1Id,
    attempt2Id,
    notebookId: ctx.notebookId,
    messageId,
    artifactId,
    chunkId: ctx.s1.chunkIds[0]!,
  });

  await publishTurn(db.pool, {
    thread: ctx.thread,
    snapshot: ctx.snapshot,
    requestId: randomUUID(),
    question: "What is the population SD?",
    answer: {
      id: messageId,
      kind: "answer",
      content: "Population standard deviation: 3.452052529534663 ms (Computed)[[1]][[2]]",
      citations: [
        { badge_number: 1, source_id: ctx.s1.sourceId, chunk_id: ctx.s1.chunkIds[0]!, revision: 1 },
        { badge_number: 2, source_id: ctx.s2.sourceId, chunk_id: ctx.s2.chunkIds[0]!, revision: 1 },
      ],
      trace,
    },
    execution: {
      executionId: exec.executionId,
      leaseToken: exec.leaseToken,
      publishArtifactIds: [artifactId],
    },
  });

  return { exec, attempt1Id, attempt2Id, artifactId, failedCandidateId, messageId, trace };
}

describe("T033 history persistence, reload fidelity and provenance projection (FR-005, FR-007, FR-011)", () => {
  it("CE-HIST-DB-01: legacy, refusal and clarification turns store null trace; computed turns preserve exact values and ordered attempts across reload", async () => {
    const ctx = await setupTwoSources();
    // 1. Legacy/ordinary turn
    await publishTurn(db.pool, {
      thread: ctx.thread,
      snapshot: ctx.snapshot,
      requestId: randomUUID(),
      question: "Ordinary question?",
      answer: {
        kind: "answer",
        content: "Ordinary answer[[1]].",
        citations: [{ badge_number: 1, source_id: ctx.s1.sourceId, chunk_id: ctx.s1.chunkIds[0]!, revision: 1 }],
      },
    });
    // 2. Clarification turn
    await publishTurn(db.pool, {
      thread: ctx.thread,
      snapshot: ctx.snapshot,
      requestId: randomUUID(),
      question: "Ambiguous SD?",
      answer: { kind: "clarification", content: "Sample or population?", citations: [] },
    });
    // 3. Computed turn with 2 attempts
    const computed = await publishComputedTurn(ctx);

    const visible = await loadVisibleThread(db.pool, owner, ctx.notebookId);
    expect(visible).toHaveLength(6);
    expect(visible[1]).toMatchObject({ kind: "answer", code_execution_trace: null });
    expect(visible[3]).toMatchObject({ kind: "clarification", code_execution_trace: null });

    const reloaded = visible[5]!;
    expect(reloaded.id).toBe(computed.messageId);
    expect(reloaded.content).toBe("Population standard deviation: 3.452052529534663 ms (Computed)[[1]][[2]]");
    expect(reloaded.code_execution_trace).toEqual(computed.trace);
    expect(reloaded.code_execution_trace!.attempts.map((a) => [a.ordinal, a.terminal_reason])).toEqual([
      [1, "PythonException"],
      [2, "Succeeded"],
    ]);

    // Only the final attempt's chart is published; the failed attempt's candidate is invalidated.
    const chartStates = await db.pool.query<{ id: string; state: string }>(
      "SELECT id, state FROM chart_artifacts WHERE execution_id = $1",
      [computed.exec.executionId]
    );
    const byId = new Map(chartStates.rows.map((r) => [r.id, r.state]));
    expect(byId.get(computed.artifactId)).toBe("published");
    expect(byId.get(computed.failedCandidateId)).toBe("invalidated");
  });

  it("CE-HIST-DB-02: source re-sync (replacement to revision 2) marks citations 'updated' with null locator while keeping historical message, trace and chart viewable", async () => {
    const ctx = await setupTwoSources();
    const computed = await publishComputedTurn(ctx);

    // Re-sync s1 to revision 2.
    await db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://example.test/s1' WHERE id = $1", [ctx.s1.sourceId]);
    const { operation } = await requestSourceSync(db.pool, owner, ctx.notebookId, ctx.s1.sourceId, {
      attemptId: randomUUID(),
      trigger: "manual",
    });
    const claim = await claimSourceOperation(db.pool, operation.operation_id, { leaseSeconds: 60 });
    if (claim.status !== "claimed") throw new Error("expected claimed");
    const newText = "Jan 2025: 10 ms";
    await commitSyncReplacement(db.pool, {
      operationId: operation.operation_id,
      fencingToken: claim.fencingToken,
      sourceId: ctx.s1.sourceId,
      expectedRevision: 1,
      byteSize: newText.length,
      wordCount: 4,
      pageCount: 1,
      embeddingModel: "t",
      contentHash: "h2",
      pages: [{ page_number: 1, text: newText }],
      chunks: [
        {
          chunk: {
            chunk_id: uuidv7(),
            source_id: ctx.s1.sourceId,
            revision: 2,
            locator: { page_number: 1, start_offset: 0, end_offset: newText.length },
            token_count: 4,
            text: newText,
          },
          embedding: vec,
        },
      ],
    });

    const visible = await loadVisibleThread(db.pool, owner, ctx.notebookId);
    const assistant = visible[1]!;
    expect(assistant.content).toContain("3.452052529534663 ms (Computed)");
    expect(assistant.unavailable_reason).toBeNull();
    expect(assistant.code_execution_trace).toEqual(computed.trace);

    const cit1 = assistant.citations.find((c) => c.source_id === ctx.s1.sourceId)!;
    const cit2 = assistant.citations.find((c) => c.source_id === ctx.s2.sourceId)!;
    expect(cit1).toMatchObject({
      status: "updated",
      source_title: "Latency2025.pdf",
      snippet: "Jan 2025: 1 ms",
      locator: null,
    });
    expect(cit2).toMatchObject({
      status: "available",
      source_title: "RND2025.pdf",
    });
    expect(cit2.locator).not.toBeNull();

    // Chart provenance remains available for authorized viewers after re-sync, and invalidateChartsOfUnavailableSources leaves it published.
    expect(await chartProvenanceAvailable(db.pool, ctx.notebookId, ctx.snapshot.sources)).toBe(true);
    await invalidateChartsOfUnavailableSources(db.pool);
    const published = await findPublishedChart(db.pool, {
      ownerId: owner,
      notebookId: ctx.notebookId,
      messageId: computed.messageId,
      artifactId: computed.artifactId,
    });
    expect(published?.artifact_id).toBe(computed.artifactId);
  });

  it("CE-HIST-DB-03: deleting a cited source hides message content, redacts code_execution_trace to null, excludes from search, and invalidates chart artifacts synchronously", async () => {
    const ctx = await setupTwoSources();
    const computed = await publishComputedTurn(ctx);

    await deleteSource(db.pool, owner, ctx.notebookId, ctx.s1.sourceId);

    const visible = await loadVisibleThread(db.pool, owner, ctx.notebookId);
    const assistant = visible[1]!;
    expect(assistant).toMatchObject({
      id: computed.messageId,
      content: null,
      unavailable_reason: "source_deleted",
      code_execution_trace: null,
    });
    const deletedCit = assistant.citations.find((c) => c.source_id === ctx.s1.sourceId)!;
    expect(deletedCit).toEqual({
      badge_number: 1,
      source_id: ctx.s1.sourceId,
      chunk_id: ctx.s1.chunkIds[0]!,
      status: "deleted",
      source_title: null,
      source_media_type: null,
      snippet: null,
      locator: null,
    });

    // Search never matches redacted computed content.
    expect(await searchThread(db.pool, owner, ctx.notebookId, "3.452052529534663")).toEqual([]);
    expect(await searchThread(db.pool, owner, ctx.notebookId, "Computed")).toEqual([]);

    // Chart provenance is immediately false and the chart row is synchronously marked invalidated by deleteSource.
    expect(await chartProvenanceAvailable(db.pool, ctx.notebookId, ctx.snapshot.sources)).toBe(false);
    expect(
      await findPublishedChart(db.pool, {
        ownerId: owner,
        notebookId: ctx.notebookId,
        messageId: computed.messageId,
        artifactId: computed.artifactId,
      })
    ).toBeNull();
    const stateRow = await db.pool.query<{ state: string }>("SELECT state FROM chart_artifacts WHERE id = $1", [computed.artifactId]);
    expect(stateRow.rows[0]?.state).toBe("invalidated");
  });
});

describe("T033 clear-chat hygiene, notebook deletion cascade, and app-pool isolation (FR-010, FR-011)", () => {
  it("CE-HIST-DB-04: clearThread removes messages, code_executions, feedback and follow-ups, invalidates charts, and advances generation_epoch", async () => {
    const ctx = await setupTwoSources();
    const computed = await publishComputedTurn(ctx);

    await runWithV2Persistence(db.pool, async () => {
      await saveMessageFeedback({
        notebook_id: ctx.notebookId,
        user_id: owner,
        message_id: computed.messageId,
        rating: "up",
      });
      await saveMessageFollowUps({
        notebook_id: ctx.notebookId,
        user_id: owner,
        message_id: computed.messageId,
        followups: {
          suggested_followups: [{ text: "Follow-up 1?", supporting_chunk_ids: [ctx.s1.chunkIds[0]!] }],
          source_revisions: ctx.snapshot.sources,
          output_language: "en-US",
          generated_at: new Date().toISOString(),
        },
      });
    });

    const { generation_epoch } = await clearThread(db.pool, owner, ctx.notebookId);
    expect(generation_epoch).toBe(ctx.thread.generation_epoch + 1);
    expect(await listThreadMessages(db.pool, ctx.thread.id)).toEqual([]);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM code_executions WHERE thread_id = $1", [ctx.thread.id])).rows[0].n).toBe(0);
    expect(
      (await db.pool.query("SELECT state FROM chart_artifacts WHERE id = $1", [computed.artifactId])).rows[0].state
    ).toBe("invalidated");

    await runWithV2Persistence(db.pool, async () => {
      expect(await getMessageFeedback(ctx.notebookId, owner, computed.messageId)).toBeNull();
      expect(await getMessageFollowUps(ctx.notebookId, owner, computed.messageId, "en-US")).toBeNull();
    });
  });

  it("CE-HIST-DB-05: deleteNotebook cascades threads, messages, code_executions and chart_artifacts while preserving code_execution_sandboxes for remote teardown", async () => {
    const ctx = await setupTwoSources();
    const computed = await publishComputedTurn(ctx);
    const attemptId = randomUUID();
    await registerSandbox(db.pool, { attemptId, executionId: computed.exec.executionId, notebookId: ctx.notebookId });
    await markSandboxActive(db.pool, attemptId, "projects/p/locations/europe-west4/reasoningEngines/1/sandboxEnvironments/nb-del");

    await deleteNotebook(db.pool, owner, ctx.notebookId);

    expect((await db.pool.query("SELECT count(*)::int AS n FROM chat_threads WHERE notebook_id = $1", [ctx.notebookId])).rows[0].n).toBe(0);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE notebook_id = $1", [ctx.notebookId])).rows[0].n).toBe(0);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM code_executions WHERE notebook_id = $1", [ctx.notebookId])).rows[0].n).toBe(0);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM chart_artifacts WHERE notebook_id = $1", [ctx.notebookId])).rows[0].n).toBe(0);
    // Sandbox ledger has no FK cascade to notebooks/code_executions so reconciler can destroy the remote sandbox.
    const open = await listSandboxesToDestroy(db.pool, { minAgeMs: 0 });
    expect(open.find((s) => s.attempt_id === attemptId)).toMatchObject({
      attempt_id: attemptId,
      execution_id: computed.exec.executionId,
      notebook_id: ctx.notebookId,
      state: "Active",
    });
  });

  it("CE-HIST-DB-06: two independent app pools have zero cross-pool visibility of threads, traces or chart artifacts", async () => {
    const ctx = await setupTwoSources();
    const computed = await publishComputedTurn(ctx);
    const otherDb = await createTestDatabase();
    try {
      const otherOwner = await createTestUser(otherDb.pool);
      const otherNb = (await createNotebook(otherDb.pool, otherOwner, {})).notebook.id;
      expect(await loadVisibleThread(otherDb.pool, otherOwner, otherNb)).toEqual([]);
      expect(
        await findPublishedChart(otherDb.pool, {
          ownerId: owner,
          notebookId: ctx.notebookId,
          messageId: computed.messageId,
          artifactId: computed.artifactId,
        })
      ).toBeNull();
    } finally {
      await otherDb.drop();
    }
  });
});
