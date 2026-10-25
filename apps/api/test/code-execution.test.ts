import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { CodeExecutionTraceSchema } from "@everlast/contracts";
import { seedReadySource } from "@everlast/db/testing";
import {
  AMBIGUOUS_STDDEV_QUESTION,
  LATENCY_TABLE_PAGE,
  LATENCY_VALUES,
  MONTHS,
  NUMERIC_TOLERANCE,
  POPULATION_STDDEV,
  POPULATION_STDDEV_QUESTION,
  RND_2021_PAGE,
  RND_2025_PAGE,
  SAMPLE_STDDEV,
  SAMPLE_STDDEV_QUESTION,
  CAGR_2021_2025,
} from "@everlast/testkit/code-execution-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModel, GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, type TestApi } from "./support.ts";
import { latencyComputeDraft, ScriptedSandbox } from "./code-execution-support.ts";

/**
 * [010-code-execution-sandbox] T014 — quantitative chat through the real API, PostgreSQL, C-02 and publication
 * path (FR-GC-08, FR-GC-01/02, C-02; spec FR-001, FR-004, FR-005, FR-008, FR-009, FR-012, FR-013, FR-014, SC-001,
 * SC-007). Model and sandbox are labelled TEST DOUBLES (scripted draft; fixture-interpreting sandbox).
 */

type Script = (input: GroundedModelInput) => Promise<GroundedDraft> | GroundedDraft;

class ScriptedModel implements GroundedModel {
  readonly id = "scripted-test-model";
  calls: GroundedModelInput[] = [];
  script: Script = () => ({ status: "not_in_sources", sentences: [] });
  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    this.calls.push(input);
    return this.script(input);
  }
}

let api: TestApi;
let noSandboxApi: TestApi;
const model = new ScriptedModel();
const sandbox = new ScriptedSandbox();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);

beforeAll(async () => {
  const storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-ce-")), publicBaseUrl: "http://127.0.0.1" });
  api = await startTestApi({}, (db) => ({
    embedder,
    storage,
    chat: new ChatService({ pool: db.pool, embedder, model, codeExecution: { runtime: sandbox, storage } } as any),
  }));
  noSandboxApi = await startTestApi({}, (db) => ({ embedder, chat: new ChatService({ pool: db.pool, embedder, model }) }));
});

afterAll(async () => {
  await api?.close();
  await noSandboxApi?.close();
});

beforeEach(() => {
  sandbox.reset();
  model.calls = [];
});

async function notebook(as: string, target = api): Promise<{ id: string; owner: string }> {
  const res = await target.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const id = ((await res.json()) as any).notebook.id;
  const owner = (await target.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id;
  return { id, owner };
}

interface SseEvent {
  event: string;
  data: any;
  at: number;
}

async function turn(as: string, nb: string, message: string, sources: string[], target = api) {
  const started = Date.now();
  const res = await target.fetch(`/api/notebooks/${nb}/chat/turns`, { method: "POST", as, json: { message, active_source_ids: sources, request_id: randomUUID() } });
  if (res.headers.get("content-type")?.startsWith("application/json")) return { status: res.status, json: (await res.json()) as any, events: [] as SseEvent[], started };
  const text = await res.text();
  const events: SseEvent[] = text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({ event: /^event: (.+)$/m.exec(block)![1]!, data: JSON.parse(/^data: (.+)$/m.exec(block)![1]!), at: Date.now() }));
  return { status: res.status, events, started, final: events.find((e) => e.event === "final")?.data, error: events.find((e) => e.event === "error")?.data };
}

async function latencySource(as: string) {
  const nb = await notebook(as);
  const src = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
  return { nb, src };
}

describe("US1 quantitative delegation and exact Computed results (FR-001, FR-005, SC-001)", () => {
  it("CE-API-01: population SD is computed in the sandbox, labelled Computed, cited [1], with chart and ordered trace", async () => {
    const { nb, src } = await latencySource("ce01");
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
    const { final, events } = await turn("ce01", nb.id, POPULATION_STDDEV_QUESTION, [src.sourceId]);
    const answer = final.messages[1];
    expect(answer.kind).toBe("answer");
    const value = /Population standard deviation: (\S+) ms \(Computed\)/.exec(answer.content)?.[1];
    expect(Math.abs(Number(value) - POPULATION_STDDEV)).toBeLessThan(NUMERIC_TOLERANCE);
    expect(answer.content).toMatch(/\(Computed\)\[\[1\]\]/);
    expect(answer.citations[0]).toMatchObject({ badge_number: 1, source_id: src.sourceId, status: "available" });
    const trace = CodeExecutionTraceSchema.parse(answer.code_execution_trace);
    expect(trace.state).toBe("Succeeded");
    expect(trace.attempts).toHaveLength(1);
    expect(trace.computed_results[0]!.value).toBe(value); // published verbatim from the sandbox output
    expect(trace.attempts[0]!.code).toContain("# FIXTURE:pstdev");
    expect(trace.attempts[0]!.stdout).toBe("computed population sd\n");
    expect(trace.published_artifact_ids).toHaveLength(1);
    expect(trace.attempts[0]!.artifacts[0]).toBe(`/api/notebooks/${nb.id}/chat/messages/${answer.id}/charts/${trace.published_artifact_ids[0]}`);
    // One fresh sandbox, deleted after the attempt; inputs were the 12 scoped values only.
    expect(sandbox.created).toHaveLength(1);
    expect(sandbox.destroyed).toEqual(sandbox.created);
    const data = JSON.parse(sandbox.calls[0]!.files.find((f) => f.name === "data.json")!.content.toString());
    expect(data.values.map((v: { value: number }) => v.value)).toEqual([...LATENCY_VALUES]);
    // Truthful progress: running_code is emitted after verification of the draft, with the execution identity.
    const running = events.find((e) => e.event === "status" && e.data.phase === "running_code");
    expect(running?.data).toEqual({ phase: "running_code", execution_id: trace.execution_id, attempt: 1 });
    expect(JSON.stringify(running?.data)).not.toMatch(/3\.45|FIXTURE/); // progress carries no numbers or code
  });

  it("CE-API-02: the sample variant computes sqrt(13)", async () => {
    const { nb, src } = await latencySource("ce02");
    model.script = ({ chunks }) => latencyComputeDraft(chunks, "stdev");
    const { final } = await turn("ce02", nb.id, SAMPLE_STDDEV_QUESTION, [src.sourceId]);
    const value = /Sample standard deviation: (\S+) ms \(Computed\)/.exec(final.messages[1].content)?.[1];
    expect(Math.abs(Number(value) - SAMPLE_STDDEV)).toBeLessThan(NUMERIC_TOLERANCE);
  });

  it("CE-API-03: conflicting units are normalized in visible code comments and both sources are cited (FR-008)", async () => {
    const nb = await notebook("ce03");
    const a = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Report2021.pdf", pages: [RND_2021_PAGE], embed });
    const b = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Report2025.pdf", pages: [RND_2025_PAGE], embed });
    model.script = ({ chunks }) => {
      const c21 = chunks.find((c) => c.text.includes("2021"))!;
      const c25 = chunks.find((c) => c.text.includes("2025"))!;
      return {
        status: "compute",
        sentences: [],
        computation: {
          intent: "CAGR 2021-2025",
          dataset: [
            { label: "R&D spend 2021", value: "850", unit: "USD million", chunk_id: c21.chunk_id },
            { label: "R&D spend 2025", value: "1.2", unit: "USD billion", chunk_id: c25.chunk_id },
          ],
          code: "# FIXTURE:cagr\n# Unit normalization: 2025 is reported in USD billion; convert to USD million (x1000) before comparing.\nimport json\nrows = json.load(open('data.json'))['values']\n",
        },
      } as GroundedDraft;
    };
    const { final } = await turn("ce03", nb.id, "Calculate the CAGR of R&D spend from 2021 to 2025", [a.sourceId, b.sourceId]);
    const answer = final.messages[1];
    const value = /CAGR 2021–2025: (\S+) \(Computed\)/.exec(answer.content)?.[1];
    expect(Math.abs(Number(value) - CAGR_2021_2025)).toBeLessThan(NUMERIC_TOLERANCE);
    expect(new Set(answer.citations.map((c: any) => c.source_id))).toEqual(new Set([a.sourceId, b.sourceId]));
    expect(answer.code_execution_trace.attempts[0].code).toContain("# Unit normalization");
  });
});

describe("US1 statistical clarification before computation (FR-014, SC-007)", () => {
  it("CE-API-04: an ambiguous request gets a focused question, zero sandbox calls and no running status; the answer starts a fresh scoped computation", async () => {
    const { nb, src } = await latencySource("ce04");
    model.script = () => ({ status: "clarify", sentences: [], clarification_question: "Should the standard deviation treat the 12 months as the whole population or as a sample?" }) as GroundedDraft;
    const first = await turn("ce04", nb.id, AMBIGUOUS_STDDEV_QUESTION, [src.sourceId]);
    expect(first.final.messages[1]).toMatchObject({ kind: "clarification", content: "Should the standard deviation treat the 12 months as the whole population or as a sample?", citations: [], code_execution_trace: null });
    expect(first.events.some((e) => e.data?.phase === "running_code")).toBe(false);
    expect(sandbox.calls).toHaveLength(0);

    model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
    const second = await turn("ce04", nb.id, "The whole population, please.", [src.sourceId]);
    expect(model.calls.at(-1)!.history.at(-1)).toMatchObject({ question: AMBIGUOUS_STDDEV_QUESTION });
    expect(second.final.messages[1].content).toContain("(Computed)");
    expect(sandbox.calls).toHaveLength(1);
  });
});

describe("US1 guards before any execution (FR-009, FR-012, FR-013)", () => {
  it("CE-API-05: empty scope 400, invalid text 422, missing notebook 404, foreign notebook 403 — no sandbox call", async () => {
    const { nb, src } = await latencySource("ce05");
    model.script = ({ chunks }) => latencyComputeDraft(chunks);
    expect((await turn("ce05", nb.id, POPULATION_STDDEV_QUESTION, [])).status).toBe(400);
    expect((await turn("ce05", nb.id, "   ", [src.sourceId])).status).toBe(422);
    expect((await turn("ce05", randomUUID(), POPULATION_STDDEV_QUESTION, [src.sourceId])).status).toBe(404);
    expect((await turn("ce05-intruder", nb.id, POPULATION_STDDEV_QUESTION, [src.sourceId])).status).toBe(403);
    expect(sandbox.calls).toHaveLength(0);
  });

  it("CE-API-06: no naked model arithmetic — a preamble number absent from its cited chunk refuses before execution", async () => {
    const { nb, src } = await latencySource("ce06");
    model.script = ({ chunks }) => {
      const draft = latencyComputeDraft(chunks);
      draft.sentences = [{ text: "The average latency is 6.5 ms.", citations: [chunks[0]!.chunk_id], kind: "claim" }];
      return draft;
    };
    const { final } = await turn("ce06", nb.id, POPULATION_STDDEV_QUESTION, [src.sourceId]);
    expect(final.messages[1]).toMatchObject({ kind: "refusal", code_execution_trace: null });
    expect(final.messages[1].content).not.toContain("6.5");
    expect(sandbox.calls).toHaveLength(0);
  });

  it("CE-API-07: an input value that is not in the cited passage is honest insufficient evidence (no trace, no execution)", async () => {
    const { nb, src } = await latencySource("ce07");
    model.script = ({ chunks }) => {
      const draft = latencyComputeDraft(chunks) as any;
      draft.computation.dataset[0].value = "999";
      return draft;
    };
    const { final } = await turn("ce07", nb.id, POPULATION_STDDEV_QUESTION, [src.sourceId]);
    expect(final.messages[1]).toMatchObject({ kind: "refusal", code_execution_trace: null });
    expect(final.messages[1].content).toMatch(/could not be verified/i);
    expect(sandbox.calls).toHaveLength(0);
  });

  it("CE-API-08: a truncated top-k retrieval is expanded to the complete scoped snapshot before computing (whole-table coverage)", async () => {
    const nb = await notebook("ce08");
    const pages = [MONTHS.map((m, i) => `${m} 2025: ${LATENCY_VALUES[i]} ms`).join("\n\n")];
    const src = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages, embed });
    const limited = await startTestApi({}, (db) => ({ embedder, chat: new ChatService({ pool: db.pool, embedder, model, retrievalLimit: 3, codeExecution: { runtime: sandbox, storage: new LocalObjectStorage({ root: tmpdir(), publicBaseUrl: "http://x" }) } } as any) }), { db: api.db });
    try {
      model.script = ({ chunks }) => latencyComputeDraft(chunks, "pstdev");
      const { final } = await turn("ce08", nb.id, POPULATION_STDDEV_QUESTION, [src.sourceId], limited);
      expect(model.calls.map((c) => c.chunks.length)).toEqual([3, 12]);
      const data = JSON.parse(sandbox.calls[0]!.files.find((f) => f.name === "data.json")!.content.toString());
      expect(data.values).toHaveLength(12);
      expect(final.messages[1].content).toContain("(Computed)");
    } finally {
      await limited.close();
    }
  });

  it("CE-API-09: without a configured sandbox a computation is a safe 503 error — nothing is published or pretended", async () => {
    const nb = await notebook("ce09", noSandboxApi);
    const src = await seedReadySource(noSandboxApi.db.pool, nb.owner, nb.id, { title: "Latency.pdf", pages: [LATENCY_TABLE_PAGE], embed });
    model.script = ({ chunks }) => latencyComputeDraft(chunks);
    const result = await turn("ce09", nb.id, POPULATION_STDDEV_QUESTION, [src.sourceId], noSandboxApi);
    expect(result.error?.error.code).toBe("RetryableFailure");
    expect(result.final).toBeUndefined();
    const stored = await noSandboxApi.db.pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE notebook_id = $1", [nb.id]);
    expect(stored.rows[0].n).toBe(0);
  });
});
