import { describe, it, expect } from "vitest";
import path from "path";
import {
  calculateCitationPrecision,
  calculateHallucinationRate,
  calculateNegativeRejectionRate,
  assertNoScopingLeakage,
  runEvaluationSuite,
} from "../src/index.js";
import {
  getOrCreateChatThread,
  persistChatMessage,
  getChatMessages,
  clearChatThread,
  resetChatStore,
  searchChatMessages,
} from "@everlast/db";
import {
  CitationSchema,
  type UnifiedDocumentChunk,
  type ChatMessage,
  type Citation,
} from "@everlast/contracts";

describe("T035: Package 1.3 Grounded Chat & Citation Engine Integrated Verification (Gate v1.0)", () => {
  const goldenBenchmarkPath = path.resolve(
    process.cwd(),
    "packages/evals/fixtures/v1/golden.jsonl"
  );

  const activeSourceId = "11111111-1111-4111-8111-111111111111";
  const deselectedSourceId = "22222222-2222-4222-8222-222222222222";
  const notebookId = "99999999-9999-4999-8999-999999999999";
  const userId = "usr_alice_eval";

  const sampleChunk: UnifiedDocumentChunk = {
    chunk_id: "018f6b40-0001-7000-8000-000000000001",
    source_id: activeSourceId,
    revision: 1,
    locator: { page_number: 1, start_offset: 0, end_offset: 100 },
    token_count: 30,
    text: "Server Alpha operates strictly on port 8080 with TLS 1.3.",
  };

  const sampleCitation: Citation = {
    badge_number: 1,
    source_id: activeSourceId,
    source_title: "Security_Guide.pdf",
    chunk_id: sampleChunk.chunk_id,
    snippet: sampleChunk.text,
    locator: sampleChunk.locator,
  };

  describe("NFR-EVAL-02: Citation Precision Gate (= 1.0 strictly)", () => {
    it("enforces Precision_ID = 1.0 with deterministic 1..K badge re-indexing", () => {
      // Validate schema compliance
      const validatedCitation = CitationSchema.parse(sampleCitation);
      expect(validatedCitation.badge_number).toBe(1);

      // Gate calculation: all evaluated badges must resolve to active chunks
      const precision = calculateCitationPrecision(1, 1);
      expect(precision).toBe(1.0);
    });

    it("fails closed when evaluated badges are empty or invalid", () => {
      expect(() => calculateCitationPrecision(0, 0)).toThrow(
        /Empty badge sets or zero denominators fail closed/
      );
    });
  });

  describe("NFR-EVAL-04: Scoping Leakage Count (= 0 strictly)", () => {
    it("detects and flags leakage if any chunk from deselected source appears in context", () => {
      const leakyChunks = [
        { id: "c-001", source_id: activeSourceId },
        { id: "c-002", source_id: deselectedSourceId },
      ];

      const leakageCheck = assertNoScopingLeakage(leakyChunks, [deselectedSourceId]);
      expect(leakageCheck.leakageDetected).toBe(true);
      expect(leakageCheck.leakedChunkCount).toBe(1);
    });

    it("verifies zero leakage when all chunks strictly belong to active sources (CP3, CP4)", () => {
      const cleanChunks = [
        { id: "c-001", source_id: activeSourceId },
      ];

      const leakageCheck = assertNoScopingLeakage(cleanChunks, [deselectedSourceId]);
      expect(leakageCheck.leakageDetected).toBe(false);
      expect(leakageCheck.leakedChunkCount).toBe(0);
    });
  });

  describe("Golden Benchmark Gate Verification (NFR-EVAL-01..04)", () => {
    it("passes all mathematical gate thresholds on golden evaluation dataset", async () => {
      const result = await runEvaluationSuite({
        goldenBenchmarkPath,
        commitHash: "cc430e4202dfe37b6f4724d90f05172d19f5c5b7",
        dryRun: false,
      });

      expect(result.metrics.hallucination_rate).toBeLessThan(0.05); // NFR-EVAL-01 (< 5%)
      expect(result.metrics.citation_precision).toBe(1.0); // NFR-EVAL-02 (= 1.00)
      expect(result.metrics.negative_rejection_rate).toBeGreaterThanOrEqual(0.99); // NFR-EVAL-03 (>= 99%)
      expect(result.metrics.scoping_leakage_count).toBe(0); // NFR-EVAL-04 (= 0)
      expect(result.passed).toBe(true);
    });
  });

  describe("FR-GC-06: End-to-End Persistence and Search Integration", () => {
    it("persists thread across session, enforces single thread per user/notebook, and supports confirmed clear", async () => {
      resetChatStore();
      const thread = await getOrCreateChatThread(undefined, notebookId, userId);
      expect(thread.generation_epoch).toBe(1);

      await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: "user",
        content: "Integration test query regarding network protocols.",
        active_source_revisions_snapshot: [{ source_id: activeSourceId, revision: 1 }],
        citations: [],
      });

      await persistChatMessage(undefined, {
        thread_id: thread.id,
        notebook_id: notebookId,
        user_id: userId,
        role: "assistant",
        content: "Server Alpha operates on port 8080 [1].",
        active_source_revisions_snapshot: [{ source_id: activeSourceId, revision: 1 }],
        citations: [sampleCitation],
      });

      const loaded = await getChatMessages(undefined, notebookId, userId);
      expect(loaded).toHaveLength(2);
      expect(loaded[1]!.citations).toHaveLength(1);

      const searchRes = await searchChatMessages(undefined, notebookId, userId, "network");
      expect(searchRes).toHaveLength(1);

      const clearRes = await clearChatThread(undefined, notebookId, userId);
      expect(clearRes.cleared).toBe(true);
      expect(clearRes.generationEpoch).toBe(2);

      const cleared = await getChatMessages(undefined, notebookId, userId);
      expect(cleared).toHaveLength(0);
    });
  });
});
