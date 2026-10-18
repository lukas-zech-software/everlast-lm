import { describe, it, expect } from "vitest";
import {
  ScopedContextRequestSchema,
  SourceRevisionPairSchema,
  createScopedContextEnvelope,
  computeContextCacheKey,
  isTurnProvenanceEligible,
  validateScopeSourceOwnership,
  validateSourceStatusReady,
  filterScopedChunks,
  assertInspectionIsolation,
  EmptyScopeError,
  InvalidScopeError,
  type ScopedContextProvider,
  type ScopedContextRequest,
} from "../src/scoped-context.js";

describe("Contract C-02: ScopedContextProvider Request-Bound Envelope", () => {
  const validNotebookId = "a1111111-1111-4111-8111-111111111111";
  const validSourceId1 = "a1000000-0000-4000-8000-000000000001";
  const validSourceId2 = "a1000000-0000-4000-8000-000000000002";
  const principal = { subject: "usr_subject_alpha_123" };

  it("C02-01: enforces public two-argument getScopedContext signature", () => {
    const mockProvider: ScopedContextProvider = {
      async getScopedContext(notebook_id: string, active_source_ids: string[]) {
        expect(arguments.length).toBe(2);
        return [];
      },
    };

    expect(typeof mockProvider.getScopedContext).toBe("function");
    expect(mockProvider.getScopedContext.length).toBe(2);
  });

  it("C02-02: rejects empty active_source_ids with EmptyScopeError (no 'all Ready' server fallback)", () => {
    expect(() =>
      createScopedContextEnvelope({
        notebook_id: validNotebookId,
        active_source_ids: [],
        principal,
      })
    ).toThrow(EmptyScopeError);

    expect(() =>
      ScopedContextRequestSchema.parse({
        notebook_id: validNotebookId,
        active_source_ids: [],
      })
    ).toThrow();
  });

  it("C02-03: rejects omitted or non-array active_source_ids", () => {
    expect(() =>
      ScopedContextRequestSchema.parse({
        notebook_id: validNotebookId,
      })
    ).toThrow();

    expect(() =>
      ScopedContextRequestSchema.parse({
        notebook_id: validNotebookId,
        active_source_ids: "not-an-array",
      })
    ).toThrow();
  });

  it("C02-04: normalizes duplicate source IDs into a unique sorted set", () => {
    const envelope = createScopedContextEnvelope({
      notebook_id: validNotebookId,
      active_source_ids: [validSourceId2, validSourceId1, validSourceId2],
      principal,
    });

    expect(envelope.active_source_ids).toEqual([validSourceId1, validSourceId2]);
    expect(envelope.active_source_ids.length).toBe(2);
  });

  it("C02-05: rejects non-UUID strings in notebook_id and source_ids", () => {
    expect(() =>
      createScopedContextEnvelope({
        notebook_id: "not-a-uuid",
        active_source_ids: [validSourceId1],
        principal,
      })
    ).toThrow();

    expect(() =>
      createScopedContextEnvelope({
        notebook_id: validNotebookId,
        active_source_ids: ["not-a-uuid"],
        principal,
      })
    ).toThrow();
  });

  it("C02-06: binds principal, purpose (generation or inspection), and optional query in envelope", () => {
    const envelopeGen = createScopedContextEnvelope({
      notebook_id: validNotebookId,
      active_source_ids: [validSourceId1],
      principal,
      purpose: "generation",
      query: "Explain quantum computing",
    });

    expect(envelopeGen.principal.subject).toBe("usr_subject_alpha_123");
    expect(envelopeGen.purpose).toBe("generation");
    expect(envelopeGen.query).toBe("Explain quantum computing");

    const envelopeInsp = createScopedContextEnvelope({
      notebook_id: validNotebookId,
      active_source_ids: [validSourceId1],
      principal,
      purpose: "inspection",
    });
    expect(envelopeInsp.purpose).toBe("inspection");
  });

  it("C02-07: captures immutable (source_id, revision) submission snapshot", () => {
    const snapshot = [
      { source_id: validSourceId1, revision: 1 },
      { source_id: validSourceId2, revision: 3 },
    ];

    const envelope = createScopedContextEnvelope({
      notebook_id: validNotebookId,
      active_source_ids: [validSourceId1, validSourceId2],
      principal,
      source_revisions: snapshot,
    });

    expect(envelope.source_revisions).toEqual(snapshot);

    // Rejects non-positive revisions in snapshot
    expect(() =>
      SourceRevisionPairSchema.parse({ source_id: validSourceId1, revision: 0 })
    ).toThrow();
  });

  it("C02-08: computeContextCacheKey produces distinct, deterministic keys for scope parameters", () => {
    const key1 = computeContextCacheKey({
      notebook_id: validNotebookId,
      source_revisions: [{ source_id: validSourceId1, revision: 1 }],
      subject: "usr_alpha",
      language: "en",
    });

    const key2 = computeContextCacheKey({
      notebook_id: validNotebookId,
      source_revisions: [{ source_id: validSourceId1, revision: 2 }], // revision changed
      subject: "usr_alpha",
      language: "en",
    });

    const key3 = computeContextCacheKey({
      notebook_id: validNotebookId,
      source_revisions: [{ source_id: validSourceId1, revision: 1 }],
      subject: "usr_beta", // different subject
      language: "en",
    });

    expect(typeof key1).toBe("string");
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);

    // Deterministic: identical inputs produce identical key
    const key1Recompute = computeContextCacheKey({
      notebook_id: validNotebookId,
      source_revisions: [{ source_id: validSourceId1, revision: 1 }],
      subject: "usr_alpha",
      language: "en",
    });
    expect(key1).toBe(key1Recompute);
  });

  it("C02-09: isTurnProvenanceEligible validates historical turn provenance against active snapshot", () => {
    const activeSnapshot = [
      { source_id: validSourceId1, revision: 1 },
      { source_id: validSourceId2, revision: 1 },
    ];

    // Eligible turn: uses source 1 revision 1
    const eligibleTurnProvenance = [
      { source_id: validSourceId1, revision: 1 },
    ];
    expect(
      isTurnProvenanceEligible(eligibleTurnProvenance, activeSnapshot)
    ).toBe(true);

    // Ineligible turn: uses source 1 revision 2 (stale revision)
    const staleTurnProvenance = [
      { source_id: validSourceId1, revision: 2 },
    ];
    expect(
      isTurnProvenanceEligible(staleTurnProvenance, activeSnapshot)
    ).toBe(false);

    // Ineligible turn: uses deselected source (source 3)
    const deselectedTurnProvenance = [
      { source_id: "b2000000-0000-4000-8000-000000000001", revision: 1 },
    ];
    expect(
      isTurnProvenanceEligible(deselectedTurnProvenance, activeSnapshot)
    ).toBe(false);

    // Ineligible: empty or missing provenance cannot be eligible
    expect(isTurnProvenanceEligible([], activeSnapshot)).toBe(false);
    expect(isTurnProvenanceEligible(undefined, activeSnapshot)).toBe(false);
  });

  it("C02-10: rejects extra unknown properties on request envelope (strict schema)", () => {
    const extraData = {
      notebook_id: validNotebookId,
      active_source_ids: [validSourceId1],
      forbidden_role: "admin",
    };
    expect(() => ScopedContextRequestSchema.parse(extraData)).toThrow();
  });

  describe("T024 [US2] Scope Guard Boundary Assertions (C-02, FR-WM-04)", () => {
    it("C02-11: cross-notebook source even with same owner triggers InvalidScopeError", () => {
      const foreignNotebookSourceId = "b2000000-0000-4000-8000-000000000001";
      expect(() =>
        validateScopeSourceOwnership(validNotebookId, [validSourceId1, foreignNotebookSourceId], {
          [validSourceId1]: validNotebookId,
          [foreignNotebookSourceId]: "b2222222-2222-4222-8222-222222222222",
        })
      ).toThrow(InvalidScopeError);
    });

    it("C02-12: unknown source ID triggers InvalidScopeError", () => {
      const unknownSourceId = "00000000-0000-4000-8000-000000000000";
      expect(() =>
        validateScopeSourceOwnership(validNotebookId, [unknownSourceId], {
          [validSourceId1]: validNotebookId,
        })
      ).toThrow(InvalidScopeError);
    });

    it("C02-13: non-Ready selection (Uploading, Processing, Failed) rejected with InvalidScopeError", () => {
      expect(() =>
        validateSourceStatusReady([validSourceId1], {
          [validSourceId1]: "Processing",
        })
      ).toThrow(InvalidScopeError);

      expect(() =>
        validateSourceStatusReady([validSourceId1], {
          [validSourceId1]: "Failed",
        })
      ).toThrow(InvalidScopeError);
    });

    it("C02-14: entire request rejection: invalid scope rejects whole request with zero chunks", () => {
      expect(() =>
        filterScopedChunks(validNotebookId, [validSourceId1, "b2000000-0000-4000-8000-000000000001"], [])
      ).toThrow(InvalidScopeError);
    });

    it("C02-15: inspector singleton read scope cannot mutate active generation selection", () => {
      const activeGenerationSet = new Set([validSourceId1]);
      const inspectedSourceId = validSourceId2;

      assertInspectionIsolation(activeGenerationSet, inspectedSourceId);
      // Active generation set must remain unchanged
      expect(Array.from(activeGenerationSet)).toEqual([validSourceId1]);
    });
  });
});
