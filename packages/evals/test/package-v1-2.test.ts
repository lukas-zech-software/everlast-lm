import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@everlast/db/testing";
import { HashingTestEmbedder, NoOcrEngine } from "@everlast/cloud";
import { buildGoldenDataset } from "../src/dataset.ts";
import { LexicalCitingModel } from "../src/deterministic-models.ts";
import { runEvaluation } from "../src/runner.ts";

/**
 * T028/T038 (package 1.2 regression; Gate v1.0 #1, NFR-EVAL-04): the synthetic corpus (PDF + Markdown) ingests
 * through the real pipeline into valid C-01 chunks, and deselection cases leak nothing.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe("package 1.2 regression", () => {
  it("PKG12-01: PDF and Markdown corpus documents reach Ready with only valid C-01 chunks; deselection leaks 0", async () => {
    const cases = buildGoldenDataset().filter((c) => c.category === "deselected_source" || c.category === "history_carryover");
    const result = await runEvaluation(
      { pool: db.pool, embedder: new HashingTestEmbedder({ NODE_ENV: "test" }), model: new LexicalCitingModel(), ocr: new NoOcrEngine(), judge: null, concurrency: 2 },
      cases
    );
    expect(result.upload.passed).toBe(true);
    expect(new Set(result.upload.documents.map((d) => d.media_type))).toEqual(new Set(["application/pdf", "text/markdown"]));
    expect(result.metrics.find((m) => m.name === "scoping_leakage_count")).toMatchObject({ value: 0, status: "pass" });
    expect(result.errored).toEqual([]);
  }, 180_000);
});
