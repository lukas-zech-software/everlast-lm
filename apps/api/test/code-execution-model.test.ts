import { describe, expect, it } from "vitest";
import { uuidv7, type UnifiedDocumentChunk } from "@everlast/contracts";
import { GROUNDED_DRAFT_RESPONSE_SCHEMA, GroundedDraftSchema } from "../src/chat/draft.ts";
import * as verifier from "../src/chat/verifier.ts";
import * as prompt from "../src/chat/prompt.ts";
import { AdkGroundedModel } from "../src/chat/model.ts";

/**
 * [010-code-execution-sandbox] T015 — model boundary, strict draft and verifier outcomes for computation
 * (FR-GC-08, FR-GC-02, NFR-EVAL-02/03; spec FR-001, FR-005, FR-008, FR-012, FR-014, SC-001, SC-007). Pure unit.
 */

const v = verifier as unknown as Record<string, any>;
const SRC = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a01";
const chunk = (text: string): UnifiedDocumentChunk => ({ chunk_id: uuidv7(), source_id: SRC, revision: 1, locator: { page_number: 1, start_offset: 0, end_offset: text.length }, token_count: 3, text });
const jan = chunk("Jan 2025: 1 ms");
const feb = chunk("Feb 2025: 2 ms");

const computeDraft = {
  status: "compute",
  sentences: [{ text: "The table lists latency for Jan 2025 and Feb 2025.", citations: [jan.chunk_id, feb.chunk_id], kind: "claim" }],
  computation: {
    intent: "population standard deviation",
    dataset: [
      { label: "Jan 2025", value: "1", unit: "ms", chunk_id: jan.chunk_id },
      { label: "Feb 2025", value: "2", unit: "ms", chunk_id: feb.chunk_id },
    ],
    code: "import json\nemit('sd', 0.5)",
  },
};

describe("T015 strict draft schema (FR-001, FR-014)", () => {
  it("MOD-01: compute and clarify are typed outcomes; answered/not_in_sources stay valid; unknown fields rejected", () => {
    expect(GroundedDraftSchema.safeParse(computeDraft).success).toBe(true);
    expect(GroundedDraftSchema.safeParse({ status: "clarify", sentences: [], clarification_question: "Sample or population?" }).success).toBe(true);
    expect(GroundedDraftSchema.safeParse({ status: "answered", sentences: [{ text: "x", citations: [], kind: "claim" }] }).success).toBe(true);
    expect(GroundedDraftSchema.safeParse({ status: "compute", sentences: [] }).success).toBe(false); // compute needs a computation
    expect(GroundedDraftSchema.safeParse({ status: "clarify", sentences: [] }).success).toBe(false); // clarify needs a question
    expect(GroundedDraftSchema.safeParse({ ...computeDraft, computation: { ...computeDraft.computation, shell: "rm -rf /" } }).success).toBe(false);
  });

  it("MOD-02: the Gemini response schema offers the compute/clarify outcomes and their fields", () => {
    const schema = GROUNDED_DRAFT_RESPONSE_SCHEMA as any;
    expect(schema.properties.status.enum).toEqual(["answered", "not_in_sources", "compute", "clarify"]);
    expect(Object.keys(schema.properties.computation.properties)).toEqual(["intent", "dataset", "code"]);
    expect(schema.properties.clarification_question.type).toBe("STRING");
  });
});

describe("T015 verifier outcomes (FR-012, FR-014, D13)", () => {
  it("MOD-03: clarify yields a distinct non-computed clarification without citations (not a refusal, not an answer)", () => {
    const result = verifier.verifyDraft({ status: "clarify", sentences: [], clarification_question: "Sample or population [[1]]?" } as any, [jan]);
    expect(result).toEqual({ kind: "clarification", content: "Sample or population [1]?" });
  });

  it("MOD-04: compute yields the verified preamble and the computation; invalid preamble citations still refuse", () => {
    const result = verifier.verifyDraft(computeDraft as any, [jan, feb]) as any;
    expect(result.kind).toBe("compute");
    expect(result.computation.dataset).toHaveLength(2);
    const bad = verifier.verifyDraft({ ...computeDraft, sentences: [{ text: "x", citations: ["0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a8b"], kind: "claim" }] } as any, [jan, feb]);
    expect(bad).toMatchObject({ kind: "refusal", reason: "invalid_citation" });
  });

  it("MOD-05: no naked model arithmetic — a preamble number that its cited chunks do not contain refuses", () => {
    const result = verifier.verifyDraft({ ...computeDraft, sentences: [{ text: "The mean is 1.5 ms.", citations: [jan.chunk_id, feb.chunk_id], kind: "claim" }] } as any, [jan, feb]);
    expect(result).toMatchObject({ kind: "refusal", reason: "unverifiable" });
  });

  it("MOD-06: ordinary factual answers keep their citation refusal behavior unchanged", () => {
    expect(verifier.verifyDraft({ status: "answered", sentences: [{ text: "Jan was 1 ms.", citations: [], kind: "claim" }] }, [jan])).toMatchObject({ kind: "refusal", reason: "uncited_claim" });
  });
});

describe("T015 computed answer composition (FR-005, FR-012, SC-001)", () => {
  it("MOD-07: each sandbox value is published verbatim, labelled (Computed), with badges for its input chunks", () => {
    const composed = v.composeComputedAnswer?.({
      preamble: [{ text: "The table lists latency for Jan 2025 and Feb 2025.", chunkIds: [jan.chunk_id, feb.chunk_id] }],
      results: [{ label: "Population standard deviation", value: "0.5", unit: "ms", citations: [jan.chunk_id, feb.chunk_id] }],
      retrieved: [jan, feb],
    });
    expect(composed?.content).toBe("The table lists latency for Jan 2025 and Feb 2025.[[1]][[2]] Population standard deviation: 0.5 ms (Computed)[[1]][[2]]");
    expect(composed.citations.map((c: any) => c.chunk_id)).toEqual([jan.chunk_id, feb.chunk_id]);
    expect(v.computationFailureMessage?.("ExecutionTimeout")).toMatch(/15 seconds/);
    for (const code of ["PythonException", "MemoryLimitExceeded", "ExecutionTimeout", "ProviderUnavailable"]) {
      expect(v.computationFailureMessage(code)).not.toMatch(/\d+\.\d+/); // never a guessed number
    }
  });
});

describe("T015 prompt and ADK agent wiring (FR-001, FR-008, FR-014)", () => {
  it("MOD-08: the grounding instruction delegates arithmetic to code, demands unit comments and clarification of ambiguity", () => {
    const text = prompt.GROUNDING_INSTRUCTION;
    expect(text).toMatch(/status "compute"/);
    expect(text).toMatch(/emit\(/);
    expect(text).toMatch(/unit/i);
    expect(text).toMatch(/status "clarify"/);
    expect(text).toMatch(/sample or population/i);
    expect(text).toMatch(/never (calculate|compute)/i);
  });

  it("MOD-09: the ADK model exposes the single bounded code-correction call used for the one retry", () => {
    const model = new AdkGroundedModel({ project: "p", location: "europe-west4", model: "gemini-2.5-flash" }) as any;
    expect(typeof model.correctCode).toBe("function");
  });
});
