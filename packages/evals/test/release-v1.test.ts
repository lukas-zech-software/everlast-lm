import { describe, it, expect } from "vitest";
import path from "path";
import {
  loadGoldenBenchmark,
  runEvaluationSuite,
  verifyEnterpriseNoTraining,
  assertNoScopingLeakage,
} from "../src/index.js";

describe("T012 [US2] Acceptance: Evaluation & Security Gate Suite (NFR-EVAL-01..04, NFR-SEC-01)", () => {
  const goldenBenchmarkPath = path.resolve(
    process.cwd(),
    "packages/evals/fixtures/v1/golden.jsonl"
  );

  describe("Scenario: Release Gate v1.0 passes all four evaluation metrics", () => {
    it("Given v1.0 application and golden evaluation dataset, When runner executes NFR-EVAL-01..04, Then all metrics pass gate thresholds", async () => {
      const result = await runEvaluationSuite({
        goldenBenchmarkPath,
        commitHash: "cc430e4202dfe37b6f4724d90f05172d19f5c5b7",
        dryRun: false,
      });

      // Assert mathematical gate thresholds
      expect(result.metrics.hallucination_rate).toBeLessThan(0.05); // NFR-EVAL-01
      expect(result.metrics.citation_precision).toBe(1.0); // NFR-EVAL-02
      expect(result.metrics.negative_rejection_rate).toBeGreaterThanOrEqual(0.99); // NFR-EVAL-03
      expect(result.metrics.scoping_leakage_count).toBe(0); // NFR-EVAL-04

      // Gate evaluation outcome
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.failingCaseIds).toHaveLength(0);
    });
  });

  describe("Scenario: Deselected source does not leak via conversation history (NFR-EVAL-04)", () => {
    it("verifies zero chunk leakage from deselected sources in retrieval and prompt context", () => {
      const deselectedSourceId = "s-aurora-confidential-002";
      const retrievedChunks = [
        { id: "chunk-a-001", source_id: "s-project-a-001" },
        { id: "chunk-a-002", source_id: "s-project-a-001" },
      ];

      const leakageCheck = assertNoScopingLeakage(retrievedChunks, [deselectedSourceId]);
      expect(leakageCheck.leakageDetected).toBe(false);
      expect(leakageCheck.leakedChunkCount).toBe(0);
      expect(leakageCheck.leakedChunkIds).toHaveLength(0);
    });

    it("detects leakage if any chunk from deselected source appears in context", () => {
      const deselectedSourceId = "s-aurora-confidential-002";
      const leakyChunks = [
        { id: "chunk-a-001", source_id: "s-project-a-001" },
        { id: "chunk-b-leak-002", source_id: deselectedSourceId },
      ];

      const leakageCheck = assertNoScopingLeakage(leakyChunks, [deselectedSourceId]);
      expect(leakageCheck.leakageDetected).toBe(true);
      expect(leakageCheck.leakedChunkCount).toBe(1);
      expect(leakageCheck.leakedChunkIds).toContain("chunk-b-leak-002");
    });
  });

  describe("Golden Benchmark Dataset Requirements", () => {
    it("loads golden dataset and verifies required case category quotas", () => {
      const cases = loadGoldenBenchmark(goldenBenchmarkPath);

      expect(cases.length).toBeGreaterThanOrEqual(200);

      const unanswerable = cases.filter((c) => c.category === "unanswerable");
      const deselection = cases.filter((c) => c.category === "deselected_source");
      const synthesis = cases.filter((c) => c.category === "synthesis");

      expect(unanswerable.length).toBeGreaterThanOrEqual(100); // NFR-EVAL-03
      expect(deselection.length).toBeGreaterThanOrEqual(50); // NFR-EVAL-04
      expect(synthesis.length).toBeGreaterThanOrEqual(50); // NFR-EVAL-01, 02
    });
  });

  describe("Enterprise No-Training Compliance (NFR-SEC-01)", () => {
    it("passes preflight when configured for europe-west4 with keyless enterprise credentials", () => {
      const preflight = verifyEnterpriseNoTraining({
        region: "europe-west4",
        allowedRegions: ["europe-west4", "eu"],
      });

      expect(preflight.valid).toBe(true);
      expect(preflight.enterpriseNoTrainingEnforced).toBe(true);
      expect(preflight.errors).toHaveLength(0);
    });

    it("fails preflight and refuses execution if consumer API keys are present", () => {
      const preflightWithConsumerKey = verifyEnterpriseNoTraining({
        region: "europe-west4",
        geminiApiKey: "AIzaSyFakeConsumerKey123",
      });

      expect(preflightWithConsumerKey.valid).toBe(false);
      expect(preflightWithConsumerKey.enterpriseNoTrainingEnforced).toBe(false);
      expect(preflightWithConsumerKey.errors.some((e) => e.includes("consumer API key"))).toBe(true);
    });
  });
});
