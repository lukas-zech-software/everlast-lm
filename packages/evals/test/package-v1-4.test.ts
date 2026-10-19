import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@everlast/db/testing";
import { HashingTestEmbedder, NoOcrEngine } from "@everlast/cloud";
import { buildGoldenDataset, datasetCounts, datasetHash, corpusHash, DATASET_VERSION } from "../src/dataset.ts";
import { LexicalCitingModel } from "../src/deterministic-models.ts";
import { runEvaluation } from "../src/runner.ts";
import { buildGateReport } from "../src/report.ts";

/**
 * T019/T028 (package 1.4 integrated regression; Gate v1.0, NFR-EVAL-02/04): the full golden dataset runs through
 * the production pipeline; deterministic metrics pass while the gate stays pending without judged results.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe("package 1.4 integrated regression", () => {
  it("PKG14-01: full dataset — Precision_ID 1.0, leakage 0, judged metrics UNAVAILABLE, gate pending (never passed)", async () => {
    const cases = buildGoldenDataset();
    const run = await runEvaluation(
      { pool: db.pool, embedder: new HashingTestEmbedder({ NODE_ENV: "test" }), model: new LexicalCitingModel(), ocr: new NoOcrEngine(), judge: null, concurrency: 3 },
      cases
    );
    expect(run.errored).toEqual([]);
    expect(run.metrics.find((m) => m.name === "citation_precision")).toMatchObject({ value: 1, status: "pass" });
    expect(run.metrics.find((m) => m.name === "scoping_leakage_count")).toMatchObject({ value: 0, status: "pass" });
    const report = buildGateReport({
      mode: "deterministic",
      commit: "test",
      run,
      preflight: null,
      ui: {},
      dataset: { version: DATASET_VERSION, hash: datasetHash(cases), corpus_hash: corpusHash(), counts: datasetCounts(cases) },
      models: {},
    });
    expect(report.state).toBe("GatePending");
    expect(report.criteria.gate2_evaluation.status).toBe("unavailable");
  }, 300_000);
});
