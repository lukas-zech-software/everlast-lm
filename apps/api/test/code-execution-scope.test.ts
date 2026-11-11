import { PrivateBenchmarkRecorder } from '../src/observability/benchmark.ts';
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
  hasOperationalExecutionEvidence,
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

// NFR-PERF-01 observer double only; no release qualification or private-file proof is claimed.
const observedTraces:unknown[]=[];
const benchmark=new PrivateBenchmarkRecorder({approved_notebook_ids:[],revision:'local',sink:()=>{}});
benchmark.executionIdentity=()=>proofIdentity;
benchmark.beginExecution=()=>({timing:()=>{},finish:trace=>{observedTraces.push(structuredClone(trace));}});
const proofIdentity={instance_boot_id:randomUUID(),candidate_commit:'a'.repeat(40),runtime_config_sha256:'b'.repeat(64)};
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
        benchmark,
        embedder,
        model,
        codeExecution: {runtime:{id:'agent-platform-code-execution',create:async(id,signal)=>({...await sandbox.create(),profileObservation:{...proofIdentity,observed_at:new Date().toISOString(),machine_config:'default' as const}}),execute:(...args)=>sandbox.execute(...args),destroy:(...args)=>sandbox.destroy(...args)},storage},
        resolvePreferences: (ownerId, notebookId, locale) => v2.chatPreferences(ownerId, notebookId, locale),
      }),
    };
  });
});

afterAll(async () => {
  await api?.close();
});

beforeEach(() => {
  observedTraces.length=0;
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
    const canonical=await api.db.pool.query('SELECT trace FROM code_executions WHERE notebook_id=$1',[nb.id]);
    expect(observedTraces).toEqual([canonical.rows[0].trace]);
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

it('FR-GC-08 NFR-PERF-01 canonical operational proof binds actual stored profile/boot/scope and confirmed cleanup',async()=>{
 const nb=await createOwnedNotebook('operational-proof');const src=await seedReadySource(api.db.pool,nb.owner,nb.id,{title:'Latency.pdf',pages:[LATENCY_TABLE_PAGE],embed});
 const since=Date.now()-1000;const outcome=await turn('operational-proof',nb.id,[src.sourceId]);expect(outcome.final).not.toBeNull();
 const input={...proofIdentity,owner_id:nb.owner,notebook_id:nb.id,sources:[{source_id:src.sourceId,revision:1}],observed_after:since};
 expect(await hasOperationalExecutionEvidence(api.db.pool,input)).toBe(true);
 expect(await hasOperationalExecutionEvidence(api.db.pool,{...input,instance_boot_id:randomUUID()})).toBe(false);
 expect(await hasOperationalExecutionEvidence(api.db.pool,{...input,sources:[{source_id:src.sourceId,revision:2}]})).toBe(false);
 await api.db.pool.query("UPDATE code_execution_sandboxes SET state='DestroyPending' WHERE notebook_id=$1",[nb.id]);
 expect(await hasOperationalExecutionEvidence(api.db.pool,input)).toBe(false);
});

it('NFR-PERF-01 actual API-owned operational adapters read scoped data and clean a cache created after cancellation (LOCAL model/cache doubles)',async()=>{
 const {createOperationalProbePorts}=await import('../src/services/source-context.ts');
 const nb=await createOwnedNotebook('operational-adapters'),src=await seedReadySource(api.db.pool,nb.owner,nb.id,{title:'Latency.pdf',pages:[LATENCY_TABLE_PAGE],embed});
 const recorder=new PrivateBenchmarkRecorder({approved_notebook_ids:[nb.id],revision:'local',sink:()=>{}});
 // Observer/identity seam only for this LOCAL adapter integration; no deployed qualification is claimed.
 recorder.executionIdentity=()=>proofIdentity;
 const actor={owner_id:nb.owner,notebook_id:nb.id,sources:[{source_id:src.sourceId,revision:1}]};
 const signal=new AbortController().signal,deleted:string[]=[];
 const scripted={id:'LOCAL-factual-port',generate:async(input:GroundedModelInput)=>({status:'answered' as const,sentences:[{kind:'claim' as const,text:'The source contains latency data.',citations:[input.chunks[0]!.chunk_id]}]})};
 const cache={identity:'LOCAL cache double',create:async({pages}:{pages:unknown[]})=>{expect(pages.length).toBeGreaterThan(0);return {handle:'LOCAL-private-cache',expiresAt:Date.now()+60000};},delete:async(handle:string)=>{deleted.push(handle);}};
 const ports=createOperationalProbePorts({pool:api.db.pool,benchmark:recorder,model:scripted,embedder,cache});
 await expect(ports.runtime_observation(actor,signal)).rejects.toThrow(/lifecycle/);
 expect((await turn('operational-adapters',nb.id,[src.sourceId])).final).not.toBeNull();
 await ports.runtime_observation(actor,signal);await ports.retrieval(actor,signal);await ports.model(actor,signal);await ports.cache(actor,signal);
 expect(deleted).toEqual(['LOCAL-private-cache']);
 let release!:(value:{handle:string;expiresAt:number})=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 const late=createOperationalProbePorts({pool:api.db.pool,benchmark:recorder,model:scripted,embedder,cache:{...cache,create:async()=>{started();return new Promise(resolve=>{release=resolve;});}}});
 await late.retrieval(actor,signal);const controller=new AbortController(),pending=late.cache(actor,controller.signal);await entered;controller.abort();release({handle:'LOCAL-late-cache',expiresAt:Date.now()+60000});
 await expect(pending).rejects.toThrow();expect(deleted).toContain('LOCAL-late-cache');
 await expect(ports.retrieval({...actor,sources:[{source_id:src.sourceId,revision:2}]},signal)).rejects.toThrow(/revision/);
});

it('FR-GC-08 NFR-PERF-01 disabled instrumentation adds no profile metadata or optional failure write to ordinary execution',async()=>{
 const disabled=await startTestApi({},db=>({embedder,storage,chat:new ChatService({pool:db.pool,embedder,model,codeExecution:{runtime:{id:'agent-platform-code-execution',create:async()=>({...await sandbox.create(),profileObservation:{...proofIdentity,observed_at:new Date().toISOString(),machine_config:'default' as const}}),execute:(...args)=>sandbox.execute(...args),destroy:(...args)=>sandbox.destroy(...args)},storage}})}));
 try{
  const notebookResponse=await disabled.fetch('/api/notebooks',{method:'POST',as:'disabled-proof',json:{}});const notebook=(await notebookResponse.json()).notebook.id;
  const owner=(await disabled.db.pool.query("SELECT id FROM users WHERE subject='local:disabled-proof'")).rows[0].id;
  const src=await seedReadySource(disabled.db.pool,owner,notebook,{title:'Latency.pdf',pages:[LATENCY_TABLE_PAGE],embed});
  const response=await disabled.fetch(`/api/notebooks/${notebook}/chat/turns`,{method:'POST',as:'disabled-proof',json:{message:POPULATION_STDDEV_QUESTION,active_source_ids:[src.sourceId],request_id:randomUUID()}});
  expect(await response.text()).toContain('event: final');
  const row=(await disabled.db.pool.query('SELECT runtime_metadata FROM code_executions WHERE notebook_id=$1',[notebook])).rows[0];expect(row.runtime_metadata.profile_observation).toBeUndefined();expect(row.runtime_metadata.instance_boot_id).toBeUndefined();
 }finally{await disabled.close();}
});

it.each(['local-files','remote-bridge'])('NFR-PERF-01 actual server %s wiring stays disabled until signed private adapters succeed with LOCAL providers',async mode=>{
 const {startApiServer}=await import('../src/server.ts');const {OPERATIONAL_PROVIDER_BUDGET}=await import('../src/observability/benchmark.ts');
 const {generateKeyPairSync,sign,createHash}=await import('node:crypto');const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'012-server-')),channel=join(dir,'private'),publicDir=join(dir,'public');mkdirSync(channel,{mode:0o700});mkdirSync(publicDir);
 const actors=[];
 for(const who of ['server-proof-a','server-proof-b']){const nb=await createOwnedNotebook(who),src=await seedReadySource(api.db.pool,nb.owner,nb.id,{title:'Latency.pdf',pages:[LATENCY_TABLE_PAGE],embed});actors.push({who,owner_id:nb.owner,notebook_id:nb.id,sources:[{source_id:src.sourceId,revision:1}]});}
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const runtimeConfig={reasoning_engine:'projects/test/locations/europe-west4/reasoningEngines/123',region:'europe-west4',vcpu:2,memory_gb:1.5,network:'none',file_io_mb:100,deadline_ms:15000};
 const calibration={offset_ms:0,uncertainty_ms:1,measured_at_ms:Date.now()-10,expires_at_ms:Date.now()+60000,measurement_id:'LOCAL clock double'},qualification='LOCAL provider doubles; not release evidence';
 const metadata={schema_version:1,candidate_commit:'a'.repeat(40),serving_revision:'server-test',fixture_sha256:'f'.repeat(64),classification_basis:'application-serving-readiness',qualification_sha256:createHash('sha256').update(qualification).digest('hex'),runtime_config_sha256:hash(runtimeConfig),clock_calibration_sha256:hash(calibration),approved_notebook_ids:actors.map(a=>a.notebook_id)};
 const configFile=join(channel,'execution-config.json');writeFileSync(configFile,JSON.stringify({file:join(channel,'code.json'),metadata,runtime:runtimeConfig,calibration,qualification}),{mode:0o600});
 const keys=generateKeyPairSync('ed25519');writeFileSync(join(channel,'trusted-public-key.pem'),keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
 let modelProbes=0,cacheCreates=0,cacheDeletes=0;
 const servingModel:GroundedModel={id:'LOCAL-serving-model',generate:async input=>{if(input.operationalProbe){modelProbes++;return {status:'answered',sentences:[{kind:'claim',text:'The source contains latency data.',citations:[input.chunks[0]!.chunk_id]}]};}return latencyComputeDraft(input.chunks,'pstdev');}};
 const localRuntime={id:'agent-platform-code-execution',create:async()=>({...await sandbox.create(),profileObservation:{runtime_config_sha256:hash(runtimeConfig),observed_at:new Date().toISOString(),machine_config:'default' as const}}),execute:(...args:Parameters<typeof sandbox.execute>)=>sandbox.execute(...args),destroy:(...args:Parameters<typeof sandbox.destroy>)=>sandbox.destroy(...args)};
 const localCache={identity:'LOCAL cache double',create:async()=>{cacheCreates++;return {handle:'LOCAL-cache',expiresAt:Date.now()+60000};},delete:async()=>{cacheDeletes++;}};
 const env={NODE_ENV:'test',AUTH_MODE:'local',PORT:'0',V2_POC:'off',EVERLAST_DEV_TEST_EMBEDDER:'1',WEB_DIST_DIR:publicDir,BENCHMARK_APPROVED_NOTEBOOKS:actors.map(a=>a.notebook_id).join(','),BENCHMARK_EXECUTION_CONFIG_FILE:configFile,BENCHMARK_EVIDENCE_FILE:join(channel,'records.jsonl'),CODE_EXECUTION_ENABLED:'true',CODE_EXECUTION_REASONING_ENGINE:runtimeConfig.reasoning_engine,COMMIT_SHA:metadata.candidate_commit,K_REVISION:metadata.serving_revision};
 const extra={pool:api.db.pool,embedder,storage,v2:api.deps.v2};let running:Awaited<ReturnType<typeof startApiServer>>|undefined;
 const close=async()=>{if(running){const current=running;running=undefined;await new Promise<void>(resolve=>current.server.close(()=>resolve()));}};
 try{
  running=await startApiServer(env,extra,{model:servingModel,runtime:localRuntime,cache:localCache});expect(running.deps.benchmark!.readiness().ready_at_ms).toBeNull();expect(modelProbes+cacheCreates).toBe(0);await close();
  const {LocalPrivateBridgeObjects,PrivateBenchmarkOperator,privateDigest}=await import('@everlast/cloud/private-benchmark');
  const campaign=randomUUID(),objects=new LocalPrivateBridgeObjects(join(dir,'objects'));
  const remoteEnv={...env,BENCHMARK_BRIDGE_ENABLED:'true',BENCHMARK_BRIDGE_EXPIRES_AT_MS:String(Date.now()+60000),BENCHMARK_BRIDGE_CAMPAIGN_ID:campaign,BENCHMARK_BRIDGE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}).toString(),BENCHMARK_BRIDGE_EXECUTION_CONFIG:readFileSync(configFile,'utf8')};
  running=await startApiServer(mode==='remote-bridge'?remoteEnv:{...env,BENCHMARK_OPERATIONAL_DIRECTORY:channel},extra,{model:servingModel,runtime:localRuntime,cache:localCache,bridgeObjects:objects});
  const operator=new PrivateBenchmarkOperator({objects,calibration,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),identity:{campaign_id:campaign,candidate_commit:metadata.candidate_commit,serving_revision:metadata.serving_revision,instance_boot_id:running.deps.benchmark!.readiness().instance_boot_id}});

  await new Promise(resolve=>setTimeout(resolve,1100));expect(modelProbes+cacheCreates).toBe(0);
  const port=(running.server.address() as {port:number}).port;
  for(const actor of actors){const token=running.deps.localIssuer!.issue('local:'+actor.who);const response=await fetch(`http://127.0.0.1:${port}/api/notebooks/${actor.notebook_id}/chat/turns`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({request_id:randomUUID(),message:POPULATION_STDDEV_QUESTION,active_source_ids:actor.sources.map(s=>s.source_id)})});expect(await response.text()).toContain('event: final');}
  const remote=mode==='remote-bridge'?await operator.challenge():undefined;
  const challenge=remote?.challenge.challenge??JSON.parse(readFileSync(join(channel,'challenge.json'),'utf8'));
  const plan={id:randomUUID(),instance_boot_id:challenge.instance_boot_id,revision:metadata.serving_revision,candidate_commit:metadata.candidate_commit,fixture_sha256:metadata.fixture_sha256,classification_basis:metadata.classification_basis,runtime_config_sha256:metadata.runtime_config_sha256,clock_calibration_sha256:metadata.clock_calibration_sha256,qualification_sha256:metadata.qualification_sha256,source_tree_sha256:challenge.source_tree_sha256,operational_config_sha256:challenge.operational_config_sha256,provider_budget:OPERATIONAL_PROVIDER_BUDGET,issued_at:Date.now()-1,expires_at:Date.now()+30000,timeout_ms:10000,operations:['retrieval','model','cache','runtime_observation'],actors:actors.map(({who:_who,...actor})=>actor)};
  if(remote)Object.assign(plan,{bridge:{campaign_id:campaign,challenge_generation:remote.ref.generation,challenge_sha256:remote.ref.sha256,channel_policy_sha256:privateDigest(JSON.stringify(remote.challenge.policy))}});
  const payload=JSON.stringify(plan);if(remote){
   writeFileSync(join(channel,'calibration.json'),JSON.stringify(calibration),{mode:0o600});writeFileSync(join(channel,'identity.json'),JSON.stringify(remote.challenge.identity),{mode:0o600});writeFileSync(join(channel,'payload.json'),payload,{mode:0o600});writeFileSync(join(channel,'signature.txt'),sign(null,Buffer.from(payload),keys.privateKey).toString('base64'),{mode:0o600});
   const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['scripts/private-benchmark.mjs','deliver','--calibration-file',join(channel,'calibration.json'),'--local-root',join(dir,'objects'),'--identity-file',join(channel,'identity.json'),'--public-key-file',join(channel,'trusted-public-key.pem'),'--payload-file',join(channel,'payload.json'),'--signature-file',join(channel,'signature.txt')]);
  }else{writeFileSync(join(channel,'authorization.json'),payload,{mode:0o600});writeFileSync(join(channel,'authorization.sig'),sign(null,Buffer.from(payload),keys.privateKey).toString('base64'),{mode:0o600});}
  await new Promise(resolve=>setTimeout(resolve,2500));expect(running.deps.benchmark!.readiness().ready_at_ms).not.toBeNull();expect({modelProbes,cacheCreates,cacheDeletes}).toEqual({modelProbes:2,cacheCreates:2,cacheDeletes:2});
  if(remote){
   const actor=actors[0]!,token=running.deps.localIssuer!.issue('local:'+actor.who);const response=await fetch(`http://127.0.0.1:${port}/api/notebooks/${actor.notebook_id}/chat/turns`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({request_id:randomUUID(),message:POPULATION_STDDEV_QUESTION,active_source_ids:actor.sources.map(s=>s.source_id)})});expect(await response.text()).toContain('event: final');
   await new Promise(resolve=>setTimeout(resolve,1200));const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['scripts/private-benchmark.mjs','download','--calibration-file',join(channel,'calibration.json'),'--local-root',join(dir,'objects'),'--identity-file',join(channel,'identity.json'),'--public-key-file',join(channel,'trusted-public-key.pem'),'--directory',join(dir,'download')]);expect(JSON.parse(readFileSync(join(dir,'download','code-evidence.json'),'utf8')).measurements).toHaveLength(1);
   const downloaded=await operator.download();expect(downloaded.files.outcomes).toEqual(expect.arrayContaining([expect.objectContaining({result:'OBSERVED_READY',release_eligible:false})]));expect(downloaded.files.code).toMatchObject({measurements:expect.arrayContaining([expect.objectContaining({qualified:true})])});
  }else expect(JSON.parse(readFileSync(join(channel,'status.json'),'utf8'))).toMatchObject({result:'OBSERVED_READY',release_eligible:false});
  operator.close();
  const recorder=running.deps.benchmark!;await close();expect(recorder.readiness().ready_at_ms).toBeNull();
 }finally{await close();rmSync(dir,{recursive:true,force:true});}
},20000);
