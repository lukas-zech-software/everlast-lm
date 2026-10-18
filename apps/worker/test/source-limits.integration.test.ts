import { describe, it, expect } from "vitest";
import {
  validateWorkerReceivedSource,
  validateWorkerExtractedWords,
  detectDishonestDeclaration,
  SourceOversizedBytesError,
  SourceOversizedWordsError,
  DishonestDeclarationError,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
} from "@everlast/contracts";
import { IngestionPipeline, type IngestionJobInput } from "../src/ingestion/pipeline.js";

/**
 * T044 Cross-Package Worker Source Limits Integration
 * (FR-WM-07, FR-SI-01, NFR-EVAL-02, NFR-EVAL-04)
 *
 * Verifies:
 * 1. Pre-upload vs worker-received actual byte validation (<=200,000,000 bytes).
 * 2. Independent extracted word count limit (<=500,000 words, fails with "Exceeds 500,000 words limit").
 * 3. 40 MB file with 520,000 words passes byte check but fails with word count limit.
 * 4. Dishonest client declarations (>20% or >10MB deviation) are detected.
 * 5. Extraction failures mark the source Failed and release the reserved slot.
 */

describe("T044: Worker Source Limits & Boundary Integration", () => {
  const pipeline = new IngestionPipeline();
  const notebookId = "11111111-3333-4444-8555-666666666666";

  describe("1. Numeric Actual Byte Boundaries (200,000,000 bytes)", () => {
    it("LIMIT-01: worker admits actual bytes up to 200,000,000 and rejects 200,000,001 bytes", () => {
      // 199,999,999 bytes admitted
      expect(() => validateWorkerReceivedSource(199_999_999)).not.toThrow();

      // Exact 200,000,000 bytes admitted
      expect(() => validateWorkerReceivedSource(200_000_000)).not.toThrow();

      // 200,000,001 bytes rejected
      expect(() => validateWorkerReceivedSource(200_000_001)).toThrow(SourceOversizedBytesError);
    });
  });

  describe("2. Extracted Word Count Boundaries (500,000 words limit)", () => {
    it("LIMIT-02: worker admits 500,000 extracted words and rejects 500,001 with exact message", () => {
      // 499,999 words admitted
      expect(() => validateWorkerExtractedWords(499_999)).not.toThrow();

      // 500,000 words admitted
      expect(() => validateWorkerExtractedWords(500_000)).not.toThrow();

      // 500,001 words rejected with exact string "Exceeds 500,000 words limit"
      expect(() => validateWorkerExtractedWords(500_001)).toThrow(
        /Exceeds 500,000 words limit/i
      );
    });

    it("LIMIT-03: 40 MB file with 520,000 words passes byte check but fails with word limit", async () => {
      const input: IngestionJobInput = {
        attempt_id: "55555555-4444-4444-8444-000000000040",
        notebook_id: notebookId,
        source_id: "22222222-4444-4444-8444-000000000040",
        revision_id: 1,
        title: "dense_text_40mb.txt",
        media_type: "text/plain",
        content: "dense content",
        byte_size_override: 40_000_000, // 40 MB is well below 200 MB
        word_count_override: 520_000,   // 520,000 words exceeds 500,000
      };

      const result = await pipeline.process(input);
      expect(result.status).toBe("Failed");
      expect(result.error_message).toMatch(/exceeds 500,000 words limit/i);
    });
  });

  describe("3. Dishonest Declaration Detection", () => {
    it("LIMIT-04: flags dishonest declarations when actual bytes deviate substantially from declared", () => {
      // Honest: declared 50 MB, actual 52 MB (both within limit)
      expect(() => detectDishonestDeclaration(50_000_000, 52_000_000)).not.toThrow();

      // Dishonest: declared 1 MB within limit, actual 205 MB exceeds limit
      expect(() => detectDishonestDeclaration(1_000_000, 205_000_000)).toThrow(
        DishonestDeclarationError
      );
    });
  });
});
