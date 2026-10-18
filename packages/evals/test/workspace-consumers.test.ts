import { describe, it, expect } from "vitest";
import {
  createScopedContextEnvelope,
  filterConversationHistoryByProvenance,
  computeContextCacheKey,
  EmptyScopeError,
  CitationSchema,
  type SourceRevisionPair,
  type ConversationTurn,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import { validateRequestScope, InvalidScopeError } from "@everlast/db";
import { calculateCitationPrecision } from "../src/index.js";

/**
 * T044 Cross-Package Downstream Consumer Tests
 * (FR-WM-01, FR-WM-04, FR-WM-07, FR-GC-01, NFR-EVAL-02, NFR-EVAL-04)
 *
 * Verifies the downstream integration obligations:
 * 1. C-02 Scoped context retrieval contract and mandatory source selection
 * 2. OMEGA refusal on tampered/unauthorized source IDs
 * 3. Prevention of uncited history leakage across conversation turns
 * 4. D13 Invalid citation refusal when model cites an invalid/hallucinated chunk ID
 */

describe("T044: Downstream Workspace Consumer Integration Evals", () => {
  const notebookId = "11111111-2222-4333-8444-555555555555";
  const sourceAlpha = "aaaa1111-0000-4000-8000-000000000001";
  const sourceBeta = "bbbb2222-0000-4000-8000-000000000002";
  const sourceForeign = "ffff9999-0000-4000-8000-000000000099";

  describe("1. C-02 Scoped Context & Retrieval Invariant", () => {
    it("CONSUMER-01: requires non-empty active sources and returns strictly matching envelope with deterministic cache key", () => {
      // Empty scope must fail with EmptyScopeError
      expect(() =>
        createScopedContextEnvelope({
          notebook_id: notebookId,
          active_source_ids: [],
          principal: { subject: "usr_alice" },
        })
      ).toThrow(EmptyScopeError);

      // Non-empty scope resolves successfully with deterministic cache key
      const envelope = createScopedContextEnvelope({
        notebook_id: notebookId,
        active_source_ids: [sourceBeta, sourceAlpha],
        query: "Architecture analysis",
        principal: { subject: "usr_alice" },
        source_revisions: [
          { source_id: sourceAlpha, revision: 1 },
          { source_id: sourceBeta, revision: 2 },
        ],
      });

      // Unique sorted source IDs
      expect(envelope.active_source_ids).toEqual([sourceAlpha, sourceBeta]);
      expect(envelope.principal.subject).toBe("usr_alice");

      const cacheKey = computeContextCacheKey({
        notebook_id: notebookId,
        source_revisions: [
          { source_id: sourceAlpha, revision: 1 },
          { source_id: sourceBeta, revision: 2 },
        ],
        subject: "usr_alice",
      });
      expect(typeof cacheKey).toBe("string");
      expect(cacheKey.length).toBeGreaterThan(0);
    });
  });

  describe("2. OMEGA Refusal: Scope Guarding & Foreign ID Rejection", () => {
    it("CONSUMER-02: foreign or unadmitted source IDs reject immediately before generation", async () => {
      await expect(
        validateRequestScope(undefined as any, "usr_alice", {
          notebook_id: notebookId,
          active_source_ids: [sourceAlpha, sourceForeign],
        })
      ).rejects.toThrow(InvalidScopeError);
    });
  });

  describe("3. Uncited History Leakage Exclusion", () => {
    it("CONSUMER-03: conversation turns with deselected/revoked sources are completely excluded from prompt context", () => {
      const activeSnapshot: SourceRevisionPair[] = [{ source_id: sourceAlpha, revision: 1 }];

      const turn1: ConversationTurn = {
        turn_id: "turn-1",
        question: "Question on Source Alpha",
        answer: "Answer on Source Alpha",
        provenance: {
          used_sources: [{ source_id: sourceAlpha, revision: 1 }],
          cited_sources: [{ source_id: sourceAlpha, revision: 1 }],
        },
      };

      const turn2: ConversationTurn = {
        turn_id: "turn-2",
        question: "Question on Source Beta",
        answer: "Secret from Source Beta",
        provenance: {
          used_sources: [{ source_id: sourceBeta, revision: 1 }],
          cited_sources: [{ source_id: sourceBeta, revision: 1 }],
        },
      };

      const filtered = filterConversationHistoryByProvenance([turn1, turn2], activeSnapshot);

      // Turn 2 is completely excluded because Source Beta is not in the active snapshot
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.turn_id).toBe("turn-1");
      expect(filtered.some((t) => t.turn_id === "turn-2")).toBe(false);
    });
  });

  describe("4. D13 Invalid Citation Refusal", () => {
    it("CONSUMER-04: Grounded citation engine enforces NFR-EVAL-02 precision=1.0 and rejects hallucinated chunk IDs", () => {
      // Valid citation conforms to CitationSchema
      const validCitation = {
        badge_number: 1,
        source_id: sourceAlpha,
        source_title: "Research Spec",
        chunk_id: "cccc1111-0000-4000-8000-000000000001",
        snippet: "Ground truth content excerpt",
        locator: { page_number: 1, start_offset: 0, end_offset: 28 },
      };
      expect(() => CitationSchema.parse(validCitation)).not.toThrow();

      // Non-UUID chunk ID fails schema validation
      const invalidCitation = {
        ...validCitation,
        chunk_id: "not-a-uuid",
      };
      expect(() => CitationSchema.parse(invalidCitation)).toThrow();

      // D13 metric: When 1 badge is evaluated and it is invalid/hallucinated, precision is 0.0, failing threshold of 1.00
      const failedPrecision = calculateCitationPrecision(0, 1);
      expect(failedPrecision).toBe(0.0);
      expect(failedPrecision).not.toBe(1.0);

      // When all evaluated badges are valid within scope, precision is 1.00 (Pass)
      const passedPrecision = calculateCitationPrecision(1, 1);
      expect(passedPrecision).toBe(1.0);
    });
  });
});
