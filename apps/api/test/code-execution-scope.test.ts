import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { uuidv7 } from "@everlast/contracts";
import { seedReadySource } from "@everlast/db/testing";
import {
  claimSourceOperation,
  commitSyncReplacement,
  deleteSource,
  requestSourceSync,
} from "@everlast/db";
import {
  DECOY_MARKER,
  DECOY_PAGE,
  LATENCY_TABLE_PAGE,
  POPULATION_STDDEV_QUESTION,
  RND_2021_PAGE,
  RND_2025_PAGE,
  UNKNOWN_CHUNK_ID,
  UNKNOWN_SOURCE_ID,
} from "@everlast/testkit/code-execution-fixtures";
import { ChatService, selectEligibleHistory } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { createV2Runtime } from "../src/v2/runtime.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] T032 — C-02 scope, citation-refusal, and cache-key tests for code execution
 * (FR-GC-08, FR-GC-01/02/03, FR-SI-03/05, FR-WM-04/05, C-02, NFR-SEC-02, NFR-EVAL-01..04; spec FR-002,
 * FR-009, FR-010, FR-012, SC-005).
 * Real API, PostgreSQL, C-02 retrieval and v2 overview/follow-ups; model and sandbox are labelled TEST DOUBLES.
 */

class ScriptedModel implements GroundedModel {
  readonly id = "scripted-scope-model";
  calls: GroundedModelInput[] = [];
  script: (input: GroundedModelInput) => Promise<GroundedDraft> | GroundedDraft = ({ chunks }) =>
    latencyComputeDraft(chunks, "pstdev");
  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    this.calls.push(input);
    return this.script(input);
  }
}

let api: TestApi;
let storage: LocalObjectStorage;
const model = new ScriptedModel();
const sandbox = new ScriptedSandbox();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);

beforeAll(async () => {
  storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-ce-scope-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => {
    const v2 = createV2Runtime({
      pool: db.pool,
      sourceLimit: 50,
      model,
      generation: {
        async generateSourceGuide({ source }) {
          return {
            summary_md: `Summary for ${source.title}.`,
            key_topics: ["latency"],
            supporting_chunk_ids: source.chunks.slice(0, 1).map((c) => c.chunk_id),
          };
        },
        async generateOverview({ sources, output_language }) {
          const allChunks = sources.flatMap((s) => s.chunks);
          return {
            overview_md: `Overview (${output_language}) of ${sources.map((s) => `${s.title}@r${s.revision}`).join(", ")}`,
            starter_prompts: ["Calculate population standard deviation", "Plot monthly trend", "Compare min and max"],
            supporting_chunk_ids: allChunks.slice(0, 2).map((c) => c.chunk_id),
          };
        },
        async generateFollowUps({ sources }) {
          const first = sources[0]?.chunks[0]?.chunk_id;
          return {
            suggested_followups: [
              ...(first ? [{ text: "What is the sample standard deviation?", supporting_chunk_ids: [first] }] : []),
              { text: "Forged chip with out-of-scope chunk", supporting_chunk_ids: [UNKNOWN_CHUNK_ID] },
            ],
          };
        },
      },
    });
    return {
      embedder,
      storage,
      v2,
      chat: new ChatService({
        pool: db.pool,
        embedder,
        model,
        codeExecution: { runtime: sandbox, storage },
        resolvePreferences: (ownerId, notebookId, locale) => v2.chatPreferences(ownerId, notebookId, locale),
      }),
    };
  });
});

afterAll(async () => {
  await api?.close();
});

beforeEach(() => {
  sandbox.reset();
  model.calls = [];
  model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
});

async function createOwnedNotebook(as: string) {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const id = ((await res.json()) as any).notebook.id as string;
  const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  return { id, owner };
}

async function turn(as: string, notebookId: string, activeSourceIds: unknown, message = POPULATION_STDDEV_QUESTION, requestId = randomUUID()) {
  const res = await api.fetch(`/api/notebooks/${notebookId}/chat/turns`, {
    method: "POST",
    as,
    json: { message, active_source_ids: activeSourceIds, request_id: requestId },
  });
  if (res.headers.get("content-type")?.startsWith("application/json")) {
    return { status: res.status, json: (await res.json()) as any, final: null, error: null };
  }
  const text = await res.text();
  const events = text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({ event: /^event: (.+)$/m.exec(block)![1]!, data: JSON.parse(/^data: (.+)$/m.exec(block)![1]!) }));
  return {
    status: res.status,
    json: null,
    final: events.find((e) => e.event === "final")?.data ?? null,
    error: events.find((e) => e.event === "error")?.data ?? null,
  };
}

async function resyncSourceToNextRevision(owner: string, notebookId: string, sourceId: string, newPageText: string): Promise<number> {
  await api.db.pool.query("UPDATE sources SET link_kind = 'web', external_url = 'https://example.test/latency' WHERE id = $1", [sourceId]);
  const { operation } = await requestSourceSync(api.db.pool, owner, notebookId, sourceId, {
    attemptId: randomUUID(),
    trigger: "manual",
  });
  const claimed = await claimSourceOperation(api.db.pool, operation.operation_id, { leaseSeconds: 60 });
  if (claimed.status !== "claimed") throw new Error(`expected claimed, got ${claimed.status}`);
  const [embedding] = await embed([newPageText]);
  const revision = claimed.operation.expected_revision! + 1;
  const wordCount = newPageText.split(/\s+/).filter(Boolean).length;
  const committed = await commitSyncReplacement(api.db.pool, {
    operationId: operation.operation_id,
    fencingToken: claimed.fencingToken,
    sourceId,
    expectedRevision: claimed.operation.expected_revision!,
    byteSize: Buffer.byteLength(newPageText),
    wordCount,
    pageCount: 1,
    embeddingModel: embedder.model,
    contentHash: randomUUID().replace(/-/g, "").repeat(2),
    pages: [{ page_number: 1, text: newPageText }],
    chunks: [
      {
        chunk: {
          chunk_id: uuidv7(),
          source_id: sourceId,
          revision,
          locator: { page_number: 1, start_offset: 0, end_offset: newPageText.length },
          token_count: wordCount,
          text: newPageText,
        },
        embedding: embedding!,
      },
    ],
  });
  if (!committed.published) throw new Error(`sync commit failed: ${committed.reason}`);
  return committed.revision;
}

describe("T032 C-02 scope guard and decoy exclusion (FR-002, FR-009, SC-005)", () => {
  it("CE-SCP-01: empty scope is rejected (400 EmptyScope) and non-notebook/foreign source IDs are rejected (403 InvalidScope) with zero sandbox calls", async () => {
    const nbA = await createOwnedNotebook("scp01-a");
    const nbB = await createOwnedNotebook("scp01-b");
    const srcB = await seedReadySource(api.db.pool, nbB.owner, nbB.id, { title: "Foreign.pdf", pages: [DECOY_PAGE], embed });

    const empty = await turn("scp01-a", nbA.id, []);
    expect(empty.status).toBe(400);
    expect(empty.json.error.code).toBe("EmptyScope");

    const unknown = await turn("scp01-a", nbA.id, [UNKNOWN_SOURCE_ID]);
    expect(unknown.status).toBe(403);
    expect(unknown.json.error.code).toBe("InvalidScope");

    const foreign = await turn("scp01-a", nbA.id, [srcB.sourceId]);
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe("InvalidScope");

    expect(sandbox.calls).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
  });

  it("CE-SCP-02: unselected sources in the same notebook and sources in other notebooks never enter retrieval, manifest, code, stdout or published answers (0 leaks)", async () => {
    const nbA = await createOwnedNotebook("scp02-a");
    const nbB = await createOwnedNotebook("scp02-b");
    const selected = await seedReadySource(api.db.pool, nbA.owner, nbA.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
    await seedReadySource(api.db.pool, nbA.owner, nbA.id, { title: "UnselectedDecoy.pdf", pages: [DECOY_PAGE], embed });
    await seedReadySource(api.db.pool, nbB.owner, nbB.id, { title: "OtherNotebookDecoy.pdf", pages: [DECOY_PAGE], embed });

    const res = await turn("scp02-a", nbA.id, [selected.sourceId]);
    expect(res.final).toBeTruthy();
    const answer = res.final.messages[1];
    expect(answer.kind).toBe("answer");

    // Verify 0 decoy leakage across model prompt chunks, sandbox manifest, code, stdout, and published answer.
    const promptText = JSON.stringify(model.calls);
    const manifestText = sandbox.calls.flatMap((c) => c.files.map((f) => f.content.toString("utf8"))).join("\n");
    const answerText = JSON.stringify(res.final);
    expect(promptText).not.toContain(DECOY_MARKER);
    expect(promptText).not.toContain("900 ms");
    expect(manifestText).not.toContain(DECOY_MARKER);
    expect(manifestText).not.toContain("900");
    expect(answerText).not.toContain(DECOY_MARKER);
    expect(answer.citations.every((c: any) => c.source_id === selected.sourceId)).toBe(true);
  });

  it("CE-SCP-03: changing source selection for a later request does not mutate an in-flight turn's submission snapshot", async () => {
    const nb = await createOwnedNotebook("scp03");
    const src1 = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
    const src2 = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "RND.pdf", pages: [RND_2021_PAGE], embed });

    let release!: () => void;
    sandbox.gate = new Promise<void>((r) => (release = r));
    const inFlight = turn("scp03", nb.id, [src1.sourceId]);
    while (sandbox.calls.length === 0) await new Promise((r) => setTimeout(r, 10));

    // While turn 1 is running against [src1], the user requests an overview or inspects [src2]; turn 1 keeps [src1] only.
    const ov = await api.fetch(`/api/notebooks/${nb.id}/overview`, {
      method: "POST",
      as: "scp03",
      json: { source_revisions: [{ source_id: src2.sourceId, revision: 1 }] },
    });
    expect(ov.status).toBe(200);

    release();
    const finished = await inFlight;
    expect(finished.final).toBeTruthy();
    const stored = await api.db.pool.query<{ provenance: { source_id: string; revision: number }[] }>(
      "SELECT provenance FROM chat_messages WHERE notebook_id = $1 ORDER BY seq",
      [nb.id]
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows[0]!.provenance).toEqual([{ source_id: src1.sourceId, revision: 1 }]);
    expect(stored.rows[1]!.provenance).toEqual([{ source_id: src1.sourceId, revision: 1 }]);
  });
});

describe("T032 source replacement, deletion and revocation fences (FR-010, C-02)", () => {
  it("CE-SCP-04: re-syncing (replacing) a captured source to revision 2 during execution refuses publication with ScopeChanged and never substitutes revision 2", async () => {
    const nb = await createOwnedNotebook("scp04");
    const src = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });

    let release!: () => void;
    sandbox.gate = new Promise<void>((r) => (release = r));
    const pending = turn("scp04", nb.id, [src.sourceId]);
    while (sandbox.calls.length === 0) await new Promise((r) => setTimeout(r, 10));

    const newRev = await resyncSourceToNextRevision(nb.owner, nb.id, src.sourceId, `${LATENCY_TABLE_PAGE}\nUpdated rev 2`);
    expect(newRev).toBe(2);

    release();
    const outcome = await pending;
    expect(outcome.final).toBeNull();
    expect(outcome.error?.error.code).toBe("SourceSnapshotInvalid");

    const msgCount = await api.db.pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE notebook_id = $1", [nb.id]);
    expect(msgCount.rows[0].n).toBe(0);
    const exec = await api.db.pool.query("SELECT state, failure_code FROM code_executions WHERE notebook_id = $1", [nb.id]);
    expect(exec.rows[0]).toEqual({ state: "Failed", failure_code: "ScopeChanged" });
    const charts = await api.db.pool.query("SELECT state FROM chart_artifacts WHERE notebook_id = $1", [nb.id]);
    expect(charts.rows.every((r) => r.state === "invalidated")).toBe(true);
  });

  it("CE-SCP-05: deleting a captured source before whole-table read or before commit aborts publication with zero messages or published charts", async () => {
    const nb = await createOwnedNotebook("scp05");
    const src = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });

    model.script = async ({ chunks }) => {
      // Delete the source while the model is drafting (before buildInputManifest / publishTurn).
      await deleteSource(api.db.pool, nb.owner, nb.id, src.sourceId);
      return latencyComputeDraft(chunks, "pstdev");
    };

    const outcome = await turn("scp05", nb.id, [src.sourceId]);
    expect(outcome.final).toBeNull();
    expect(outcome.error?.error.code).toBe("SourceSnapshotInvalid");
    const msgCount = await api.db.pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE notebook_id = $1", [nb.id]);
    expect(msgCount.rows[0].n).toBe(0);
  });
});

describe("T032 invalid citation refusal without retry or stripped fallback (FR-012, SC-005)", () => {
  it("CE-SCP-06: an out-of-scope citation in the compute draft preamble or dataset is refused immediately without running Python or stripping the citation", async () => {
    const nb = await createOwnedNotebook("scp06");
    const src = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });

    // Case A: preamble cites UNKNOWN_CHUNK_ID -> refused before sandbox allocation.
    model.script = ({ chunks }) => {
      const draft = latencyComputeDraft(chunks, "pstdev");
      draft.sentences = [{ text: "The latency table lists monthly server latency in ms for 2025.", citations: [UNKNOWN_CHUNK_ID], kind: "claim" }];
      return draft;
    };
    const resA = await turn("scp06", nb.id, [src.sourceId]);
    expect(resA.final.messages[1]).toMatchObject({ kind: "refusal", citations: [], code_execution_trace: null });
    expect(resA.final.messages[1].content).not.toContain("(Computed)");
    expect(sandbox.calls).toHaveLength(0);

    // Case B: dataset row cites UNKNOWN_CHUNK_ID -> refused before sandbox allocation.
    model.script = ({ chunks }) => {
      const draft = latencyComputeDraft(chunks, "pstdev") as any;
      draft.computation.dataset[0].chunk_id = UNKNOWN_CHUNK_ID;
      return draft;
    };
    const resB = await turn("scp06", nb.id, [src.sourceId]);
    expect(resB.final.messages[1]).toMatchObject({ kind: "refusal", citations: [], code_execution_trace: null });
    expect(sandbox.calls).toHaveLength(0);
  });
});

describe("T032 overview/follow-up cache-key composition and provenance-eligible history (FR-009, FR-GC-03/05)", () => {
  it("CE-SCP-07: overview cache keys include notebook_id, exact source_revisions, authorization_key and output_language; follow-ups drop out-of-scope chips", async () => {
    const nb = await createOwnedNotebook("scp07");
    const src1 = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
    const src2 = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "RND.pdf", pages: [RND_2025_PAGE], embed });

    const ov1 = await (
      await api.fetch(`/api/notebooks/${nb.id}/overview`, {
        method: "POST",
        as: "scp07",
        json: { source_revisions: [{ source_id: src1.sourceId, revision: 1 }], output_language: "en-US" },
      })
    ).json() as any;
    const ov1Replay = await (
      await api.fetch(`/api/notebooks/${nb.id}/overview`, {
        method: "POST",
        as: "scp07",
        json: { source_revisions: [{ source_id: src1.sourceId, revision: 1 }], output_language: "en-US" },
      })
    ).json() as any;
    expect(ov1.cache_key).toBeTruthy();
    expect(ov1.cache_key).toBe(ov1Replay.cache_key);

    // Changing source selection changes source_revisions and produces a distinct cache_key.
    const ovBoth = await (
      await api.fetch(`/api/notebooks/${nb.id}/overview`, {
        method: "POST",
        as: "scp07",
        json: {
          source_revisions: [
            { source_id: src1.sourceId, revision: 1 },
            { source_id: src2.sourceId, revision: 1 },
          ],
          output_language: "en-US",
        },
      })
    ).json() as any;
    expect(ovBoth.cache_key).not.toBe(ov1.cache_key);

    // Changing output_language changes cache_key for the same source selection.
    const ovDe = await (
      await api.fetch(`/api/notebooks/${nb.id}/overview`, {
        method: "POST",
        as: "scp07",
        json: { source_revisions: [{ source_id: src1.sourceId, revision: 1 }], output_language: "de-DE" },
      })
    ).json() as any;
    expect(ovDe.output_language).toBe("de-DE");
    expect(ovDe.cache_key).not.toBe(ov1.cache_key);

    // Re-syncing src1 to revision 2 invalidates the revision-1 cache key and rejects stale revision-1 overview GETs.
    await resyncSourceToNextRevision(nb.owner, nb.id, src1.sourceId, `${LATENCY_TABLE_PAGE}\nRev 2`);
    const staleGet = await api.fetch(`/api/notebooks/${nb.id}/overview?cache_key=${encodeURIComponent(ov1.cache_key)}`, { as: "scp07" });
    expect(staleGet.status).toBe(409);

    const ovRev2 = await (
      await api.fetch(`/api/notebooks/${nb.id}/overview`, {
        method: "POST",
        as: "scp07",
        json: { source_revisions: [{ source_id: src1.sourceId, revision: 2 }], output_language: "de-DE" },
      })
    ).json() as any;
    expect(ovRev2.source_revisions).toEqual([{ source_id: src1.sourceId, revision: 2 }]);
    expect(ovRev2.cache_key).not.toBe(ovDe.cache_key);

    // Publish a computed turn on revision 2 and verify follow-ups filter out the forged UNKNOWN_CHUNK_ID chip.
    const chatTurn = await turn("scp07", nb.id, [src1.sourceId]);
    const assistantMsgId = chatTurn.final.messages[1].id as string;
    const followUpsRes = await api.fetch(`/api/notebooks/${nb.id}/chat/messages/${assistantMsgId}/follow-ups`, {
      method: "POST",
      as: "scp07",
      json: { source_revisions: [{ source_id: src1.sourceId, revision: 2 }] },
    });
    expect(followUpsRes.status).toBe(200);
    const followUps = (await followUpsRes.json()) as any;
    expect(followUps.suggested_followups).toHaveLength(1);
    expect(followUps.suggested_followups[0].text).toBe("What is the sample standard deviation?");
  });

  it("CE-SCP-08: selectEligibleHistory includes computed turns only when their complete provenance matches the current active snapshot", () => {
    const s1 = randomUUID();
    const s2 = randomUUID();
    const messages = [
      {
        id: randomUUID(),
        seq: 1,
        turn_id: "t1",
        request_id: randomUUID(),
        role: "user" as const,
        kind: "question" as const,
        content: "Q1 on s1@1",
        provenance: [{ source_id: s1, revision: 1 }],
        citations: [],
        code_execution_trace: null,
        created_at: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        seq: 2,
        turn_id: "t1",
        request_id: randomUUID(),
        role: "assistant" as const,
        kind: "answer" as const,
        content: "Population standard deviation: 3.45 ms (Computed)[[1]]",
        provenance: [{ source_id: s1, revision: 1 }],
        citations: [],
        code_execution_trace: null,
        created_at: new Date().toISOString(),
      },
    ];

    // Exact match or superset keeps the turn (with citation badges stripped).
    expect(selectEligibleHistory(messages, [{ source_id: s1, revision: 1 }])).toEqual([
      { question: "Q1 on s1@1", answer: "Population standard deviation: 3.45 ms (Computed)" },
    ]);
    expect(
      selectEligibleHistory(messages, [
        { source_id: s1, revision: 1 },
        { source_id: s2, revision: 1 },
      ])
    ).toHaveLength(1);

    // Deselected source (only s2 active) or re-synced source (s1@2) excludes the historical turn from new prompts.
    expect(selectEligibleHistory(messages, [{ source_id: s2, revision: 1 }])).toEqual([]);
    expect(selectEligibleHistory(messages, [{ source_id: s1, revision: 2 }])).toEqual([]);
  });
});
