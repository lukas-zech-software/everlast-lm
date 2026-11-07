import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { createTestDatabase, type TestDatabase } from "@everlast/db/testing";
import { HashingTestEmbedder, NoOcrEngine } from "@everlast/cloud";
import { VertexJudge } from "../src/judge.ts";
import { buildGoldenDataset } from "../src/dataset.ts";
import { LexicalCitingModel } from "../src/deterministic-models.ts";
import { runEvaluation } from "../src/runner.ts";
import { buildGateReport } from "../src/report.ts";
let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });
/** [006-source-guide-chat-control] T092, NFR-EVAL-01..04: failed judging retains the case and fails report. */
it("retains a nonretryable judge error and its case in a failing report instead of aborting", async () => {
  const generateContent = vi.fn().mockRejectedValue(Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { status: 403 }));
  const judge = new VertexJudge({ client: { models: { generateContent } } as unknown as GoogleGenAI });
  const cases = buildGoldenDataset().filter(c => c.category === "unanswerable").slice(0, 1);
  await expect(judge.judgeRejection({ question: "Prior diagnostic?", response: "Unavailable." })).rejects.toThrow();
  const run = await runEvaluation({ pool: db.pool, embedder: new HashingTestEmbedder({ NODE_ENV: "test" }), model: new LexicalCitingModel(), ocr: new NoOcrEngine(), judge, concurrency: 1 }, cases);
  expect(run.cases).toHaveLength(1);
  expect(run.errored).toEqual([cases[0]!.id]);
  const report = buildGateReport({ mode: "release", commit: "test", run, preflight: null, ui: {}, dataset: { version: "test", hash: "test", corpus_hash: "test", counts: { unanswerable: 1 } }, models: {} });
  expect(report.state).toBe("GateFailed");
  expect(report.judge_attempts).toHaveLength(1);
  expect(report.criteria.gate2_evaluation.errored_cases).toEqual([cases[0]!.id]);
  expect(JSON.stringify(report)).not.toContain("PRIVATE_PROVIDER_DETAIL");
});
