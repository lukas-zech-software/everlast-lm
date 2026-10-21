import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@everlast/db/testing";
import { HashingTestEmbedder, NoOcrEngine } from "@everlast/cloud";
import { createNotebook } from "@everlast/db";
import type { TurnObservation } from "@everlast/api/chat/service";
import { buildGoldenDataset } from "../src/dataset.ts";
import { AdversarialCitingModel, LexicalCitingModel } from "../src/deterministic-models.ts";
import { runCase, runEvaluation, type NotebookContext } from "../src/runner.ts";

/** T014/T022 — the runner measures real pipeline behavior and its detectors are sensitive (NFR-EVAL-02/04). */

let db: TestDatabase;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

function stratified(n: number) {
  const all = buildGoldenDataset();
  const byCat = new Map<string, typeof all>();
  for (const c of all) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  return [...byCat.values()].flatMap((list) => list.slice(0, n));
}

describe("deterministic evaluation over the production pipeline", () => {
  it("EVI-01: a stratified subset yields Precision_ID = 1 and leakage = 0 with valid C-01 corpus chunks", async () => {
    const result = await runEvaluation({ pool: db.pool, embedder, model: new LexicalCitingModel(), ocr: new NoOcrEngine(), judge: null, concurrency: 2 }, stratified(8));
    expect(result.upload.passed).toBe(true);
    expect(result.upload.documents.every((d) => d.status === "Ready" && d.valid_chunks === d.chunks)).toBe(true);
    expect(result.errored).toEqual([]);
    const precision = result.metrics.find((m) => m.name === "citation_precision")!;
    expect(precision).toMatchObject({ value: 1, status: "pass" });
    expect(precision.denominator).toBeGreaterThan(0);
    expect(result.metrics.find((m) => m.name === "scoping_leakage_count")).toMatchObject({ value: 0, status: "pass" });
    expect(result.metrics.filter((m) => m.status === "unavailable").map((m) => m.name).sort()).toEqual(["hallucination_rate", "negative_rejection_rate", "semantic_support_rate"]);
    // History carry-over: the earlier budget turn never reaches the prompt after deselection.
    const his = result.cases.find((c) => c.category === "history_carryover")!;
    expect(his.turns).toHaveLength(2);
    expect(his.turns[1]!.modelInput?.history ?? []).toEqual([]);
  }, 120_000);

  it("EVI-02: an adversarial model citing out-of-prompt chunks never gets an answer published", async () => {
    const foreign = (await db.pool.query<{ chunk_id: string }>("SELECT chunk_id FROM chunks")).rows.map((r) => r.chunk_id);
    const model = new AdversarialCitingModel(() => foreign);
    const result = await runEvaluation({ pool: db.pool, embedder, model, ocr: new NoOcrEngine(), judge: null, concurrency: 1 }, stratified(3).filter((c) => c.category !== "unanswerable"));
    expect(model.attempts).toBeGreaterThan(0);
    expect(result.cases.filter((c) => c.kind === "answer")).toEqual([]);
  }, 120_000);

  it("EVI-03: the leakage detector counts inactive chunks in retrieval and prompt plus deselected facts in the response", async () => {
    const owner = (await db.pool.query<{ id: string }>("INSERT INTO users (id, issuer, subject) VALUES ($1, 'i', $2) RETURNING id", [randomUUID(), randomUUID()])).rows[0]!.id;
    const { notebook } = await createNotebook(db.pool, owner, {});
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    const observations: TurnObservation[] = [];
    const leakyChunk = { chunk_id: randomUUID(), source_id: inactiveId, revision: 1, text: "budget is €9.99M", locator: { page_number: 1, start_offset: 0, end_offset: 5 }, token_count: 3 };
    const fakeChat = {
      async *runTurn() {
        observations.push({
          requestId: randomUUID(),
          snapshot: [{ source_id: activeId, revision: 1 }],
          retrieved: [leakyChunk],
          modelInput: { question: "q", chunks: [leakyChunk], history: [] },
          draft: null,
          result: { kind: "refusal", content: "x", reason: "not_in_sources" },
        });
        yield { type: "final" as const, replayed: false, messages: [{ id: randomUUID(), turn_id: randomUUID(), role: "assistant" as const, kind: "refusal" as const, content: "The budget is €9.99M.", unavailable_reason: null, citations: [], created_at: new Date().toISOString() }] };
      },
    };
    const ctx: NotebookContext = { pool: db.pool, notebookId: notebook.id, ownerId: owner, sources: new Map([["travel", activeId]]), chat: fakeChat as never, observations };
    const result = await runCase(ctx, {
      id: "DES-999",
      category: "deselected_source",
      active: ["travel"],
      deselected: ["budget"],
      history: [],
      question: "What is the budget?",
      answerable: false,
      expected_facts: [],
      forbidden: ["€9.99M"],
      supporting: [],
    });
    expect(result.leakage).toMatchObject({ retrieved: 1, prompt: 2, response: 1 });
  });
});
