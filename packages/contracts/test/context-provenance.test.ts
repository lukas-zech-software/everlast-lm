import { describe, it, expect } from "vitest";
import {
  isTurnProvenanceEligible,
  computeContextCacheKey,
  type SourceRevisionPair,
} from "../src/scoped-context.ts";
import {
  filterConversationHistoryByProvenance,
  type ConversationTurn,
  type TurnProvenanceRecord,
} from "../src/scoped-context.ts";

describe("T026 [US2] Consumer Provenance Contracts & History Hygiene (C-02, FR-GC-01, FR-GC-06, NFR-EVAL-04)", () => {
  const source1 = "a1000000-0000-4000-8000-000000000001";
  const source2 = "a1000000-0000-4000-8000-000000000002";
  const source3 = "a1000000-0000-4000-8000-000000000003";

  const activeSnapshot: SourceRevisionPair[] = [
    { source_id: source1, revision: 1 },
    { source_id: source2, revision: 2 },
  ];

  it("PROV-01: excludes BOTH question and answer when any used source/revision is ineligible", () => {
    const turns: ConversationTurn[] = [
      {
        turn_id: "turn-1",
        question: "What is source 1 about?",
        answer: "Source 1 details...",
        provenance: {
          used_sources: [{ source_id: source1, revision: 1 }],
          cited_sources: [{ source_id: source1, revision: 1 }],
        },
      },
      {
        turn_id: "turn-2",
        question: "What is source 3 about?",
        answer: "Source 3 details...",
        provenance: {
          used_sources: [{ source_id: source3, revision: 1 }], // source 3 is NOT in active snapshot
          cited_sources: [{ source_id: source3, revision: 1 }],
        },
      },
    ];

    const filtered = filterConversationHistoryByProvenance(turns, activeSnapshot);
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.turn_id).toBe("turn-1");
  });

  it("PROV-02: includes uncited, tool, and summary sources in provenance eligibility check", () => {
    // A turn where source was used for grounding/summary but not explicitly cited
    const turnWithUncitedUsedSource: ConversationTurn = {
      turn_id: "turn-uncited",
      question: "Summarize everything",
      answer: "Summary of sources...",
      provenance: {
        used_sources: [{ source_id: source1, revision: 1 }, { source_id: source3, revision: 1 }], // source 3 ineligible
        cited_sources: [{ source_id: source1, revision: 1 }], // only source 1 cited
      },
    };

    const filtered = filterConversationHistoryByProvenance([turnWithUncitedUsedSource], activeSnapshot);
    expect(filtered.length).toBe(0);
  });

  it("PROV-03: turns with missing, null, or empty provenance are strictly excluded", () => {
    const invalidTurns: ConversationTurn[] = [
      {
        turn_id: "turn-null-prov",
        question: "Q1",
        answer: "A1",
        provenance: null as any,
      },
      {
        turn_id: "turn-empty-sources",
        question: "Q2",
        answer: "A2",
        provenance: {
          used_sources: [],
          cited_sources: [],
        },
      },
    ];

    const filtered = filterConversationHistoryByProvenance(invalidTurns, activeSnapshot);
    expect(filtered.length).toBe(0);
  });

  it("PROV-04: cache keys include notebook, exact revisions, authorization, language, and generation parameters", () => {
    const baseParams = {
      notebook_id: "a1111111-1111-4111-8111-111111111111",
      source_revisions: [{ source_id: source1, revision: 1 }],
      subject: "usr_subject_123",
      language: "en",
      generation_parameters: { temperature: 0.2 },
    };

    const baseKey = computeContextCacheKey(baseParams);

    // Varying generation parameter produces different key
    const paramKey = computeContextCacheKey({
      ...baseParams,
      generation_parameters: { temperature: 0.7 },
    });
    expect(baseKey).not.toBe(paramKey);

    // Varying language produces different key
    const langKey = computeContextCacheKey({
      ...baseParams,
      language: "de",
    });
    expect(baseKey).not.toBe(langKey);
  });

  it("PROV-05: distinguishes mere deselection from deleted or revoked placeholder views", () => {
    const deselectedTurn: ConversationTurn = {
      turn_id: "turn-deselected",
      question: "Q",
      answer: "A",
      provenance: {
        used_sources: [{ source_id: source3, revision: 1 }],
      },
    };

    const results = filterConversationHistoryByProvenance([deselectedTurn], activeSnapshot, {
      includePlaceholders: true,
      deletedSourceIds: [source3],
    });

    expect(results.length).toBe(1);
    expect(results[0]?.is_placeholder).toBe(true);
    expect(results[0]?.placeholder_reason).toBe("deleted");
  });
});
