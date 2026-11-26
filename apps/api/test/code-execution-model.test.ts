import { describe, expect, it, vi } from "vitest";
import { uuidv7, type UnifiedDocumentChunk } from "@everlast/contracts";
import {
  GROUNDED_DRAFT_RESPONSE_SCHEMA,
  GroundedDraftSchema,
  type GroundedDraft,
} from "../src/chat/draft.ts";
import * as verifier from "../src/chat/verifier.ts";
import * as prompt from "../src/chat/prompt.ts";
import { AdkGroundedModel } from "../src/chat/model.ts";

/**
 * [010-code-execution-sandbox] T015 — model boundary, strict draft and verifier outcomes for computation
 * (FR-GC-08, FR-GC-02, NFR-EVAL-02/03; spec FR-001, FR-005, FR-008, FR-012, FR-014, SC-001, SC-007). Pure unit.
 */

const SRC = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a01";
const chunk = (text: string): UnifiedDocumentChunk => ({
  chunk_id: uuidv7(),
  source_id: SRC,
  revision: 1,
  locator: { page_number: 1, start_offset: 0, end_offset: text.length },
  token_count: 3,
  text,
});
const jan = chunk("Jan 2025: 1 ms");
const feb = chunk("Feb 2025: 2 ms");

const computeDraft: GroundedDraft = {
  status: "compute",
  sentences: [
    {
      text: "The table lists latency for Jan 2025 and Feb 2025.",
      citations: [jan.chunk_id, feb.chunk_id],
      kind: "claim",
    },
  ],
  computation: {
    intent: "population standard deviation",
    dataset: [
      { label: "Jan 2025", value: "1", unit: "ms", chunk_id: jan.chunk_id },
      { label: "Feb 2025", value: "2", unit: "ms", chunk_id: feb.chunk_id },
    ],
    code: "import json\nemit('sd', 0.5)",
  },
};

interface DraftSchemaShape {
  properties: {
    status: { enum: string[] };
    computation: { properties: Record<string, unknown> };
    clarification_question: { type: string };
  };
}

describe("T015 strict draft schema (FR-001, FR-014)", () => {
  it("MOD-01: compute and clarify are typed outcomes; answered/not_in_sources stay valid; unknown fields rejected", () => {
    expect(GroundedDraftSchema.safeParse(computeDraft).success).toBe(true);
    expect(
      GroundedDraftSchema.safeParse({
        status: "clarify",
        sentences: [],
        clarification_question: "Sample or population?",
      }).success,
    ).toBe(true);
    expect(
      GroundedDraftSchema.safeParse({
        status: "answered",
        sentences: [{ text: "x", citations: [], kind: "claim" }],
      }).success,
    ).toBe(true);
    expect(GroundedDraftSchema.safeParse({ status: "compute", sentences: [] }).success).toBe(false); // compute needs a computation
    expect(GroundedDraftSchema.safeParse({ status: "clarify", sentences: [] }).success).toBe(false); // clarify needs a question
    expect(
      GroundedDraftSchema.safeParse({
        ...computeDraft,
        computation: { ...computeDraft.computation, shell: "rm -rf /" },
      }).success,
    ).toBe(false);
  });

  it("MOD-02: the Gemini response schema offers the compute/clarify outcomes and their fields", () => {
    const schema = GROUNDED_DRAFT_RESPONSE_SCHEMA as unknown as DraftSchemaShape;
    expect(schema.properties.status.enum).toEqual([
      "answered",
      "not_in_sources",
      "compute",
      "clarify",
    ]);
    expect(Object.keys(schema.properties.computation.properties)).toEqual([
      "intent",
      "dataset",
      "code",
    ]);
    expect(schema.properties.clarification_question.type).toBe("STRING");
  });
});

describe("T015 verifier outcomes (FR-012, FR-014, D13)", () => {
  it("MOD-03: clarify yields a distinct non-computed clarification without citations (not a refusal, not an answer)", () => {
    const result = verifier.verifyDraft(
      {
        status: "clarify",
        sentences: [],
        clarification_question: "Sample or population [[1]]?",
      },
      [jan],
    );
    expect(result).toEqual({ kind: "clarification", content: "Sample or population ［［1］］?" });
  });

  it("MOD-04: compute yields the verified preamble and the computation; invalid preamble citations still refuse", () => {
    const result = verifier.verifyDraft(computeDraft, [jan, feb]);
    expect(result.kind).toBe("compute");
    if (result.kind === "compute") {
      expect(result.computation.dataset).toHaveLength(2);
    }
    const bad = verifier.verifyDraft(
      {
        ...computeDraft,
        sentences: [
          { text: "x", citations: ["0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a8b"], kind: "claim" },
        ],
      },
      [jan, feb],
    );
    expect(bad).toMatchObject({ kind: "refusal", reason: "invalid_citation" });
  });

  it("MOD-05: no naked model arithmetic — a preamble number that its cited chunks do not contain refuses", () => {
    const result = verifier.verifyDraft(
      {
        ...computeDraft,
        sentences: [
          { text: "The mean is 1.5 ms.", citations: [jan.chunk_id, feb.chunk_id], kind: "claim" },
        ],
      },
      [jan, feb],
    );
    expect(result).toMatchObject({ kind: "refusal", reason: "unverifiable" });
  });

  it("MOD-06: ordinary factual answers keep their citation refusal behavior unchanged", () => {
    expect(
      verifier.verifyDraft(
        {
          status: "answered",
          sentences: [{ text: "Jan was 1 ms.", citations: [], kind: "claim" }],
        },
        [jan],
      ),
    ).toMatchObject({ kind: "refusal", reason: "uncited_claim" });
  });
});

describe("T015 computed answer composition (FR-005, FR-012, SC-001)", () => {
  it("MOD-07: each sandbox value is published verbatim, labelled (Computed), with badges for its input chunks", () => {
    const composed = verifier.composeComputedAnswer({
      preamble: [
        {
          text: "The table lists latency for Jan 2025 and Feb 2025.",
          chunkIds: [jan.chunk_id, feb.chunk_id],
        },
      ],
      results: [
        {
          label: "Population standard deviation",
          value: "0.5",
          unit: "ms",
          citations: [jan.chunk_id, feb.chunk_id],
        },
      ],
      retrieved: [jan, feb],
    });
    expect(composed.content).toBe(
      "The table lists latency for Jan 2025 and Feb 2025.[[1]][[2]] Population standard deviation: 0.5 ms (Computed)[[1]][[2]]",
    );
    expect(composed.citations.map((c) => c.chunk_id)).toEqual([jan.chunk_id, feb.chunk_id]);
    expect(verifier.computationFailureMessage("ExecutionTimeout")).toMatch(/15 seconds/);
    for (const code of [
      "PythonException",
      "MemoryLimitExceeded",
      "ExecutionTimeout",
      "ProviderUnavailable",
    ] as const) {
      expect(verifier.computationFailureMessage(code)).not.toMatch(/\d+\.\d+/); // never a guessed number
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
    const model = new AdkGroundedModel({
      project: "p",
      location: "europe-west4",
      model: "gemini-2.5-flash",
    });
    expect(typeof model.correctCode).toBe("function");
  });
});

describe("Security review fix — citation/marker forgery in model text (FR-GC-02, D13)", () => {
  const forged = ["[[[1]]]", "[[[[1]]]]", "[ [1] ]", "[[[[[3]]]]]"];
  it("MOD-10: clarification text cannot forge badges or the Computed marker", () => {
    for (const text of forged) {
      const r = verifier.verifyDraft(
        { status: "clarify", sentences: [], clarification_question: `Sample ${text}?` },
        [jan],
      );
      expect(r.kind).toBe("clarification");
      if (r.kind === "clarification") {
        expect(r.content, text).not.toMatch(/\[\[\d+\]\]/);
      }
    }
    const r = verifier.verifyDraft(
      { status: "clarify", sentences: [], clarification_question: "Result 5 (Computed)?" },
      [jan],
    );
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.content).not.toMatch(/\(\s*computed\s*\)/i);
    }
  });

  it("MOD-11: preamble and ordinary answer sentences cannot forge badges beyond the verifier's own", () => {
    for (const text of forged) {
      const pre = verifier.verifyDraft(
        {
          ...computeDraft,
          sentences: [{ text: `Jan 2025 ${text} data.`, citations: [jan.chunk_id], kind: "claim" }],
        },
        [jan, feb],
      );
      if (pre.kind === "compute") {
        const composed = verifier.composeComputedAnswer({
          preamble: pre.preamble,
          results: [],
          retrieved: [jan, feb],
        });
        expect(composed.content.match(/\[\[\d+\]\]/g), text).toEqual(["[[1]]"]);
      }
      const answer = verifier.verifyDraft(
        {
          status: "answered",
          sentences: [{ text: `Jan was fast ${text}.`, citations: [jan.chunk_id], kind: "claim" }],
        },
        [jan],
      );
      expect(answer.kind).toBe("answer");
      if (answer.kind === "answer") {
        expect(answer.content.match(/\[\[\d+\]\]/g), text).toEqual(["[[1]]"]);
      }
    }
    const fake = verifier.verifyDraft(
      {
        status: "answered",
        sentences: [
          { text: "Jan 2025: 1 ms (Computed)", citations: [jan.chunk_id], kind: "claim" },
        ],
      },
      [jan],
    );
    expect(fake.kind).toBe("answer");
    if (fake.kind === "answer") {
      expect(fake.content).not.toMatch(/\(\s*computed\s*\)/i);
    }
  });
});

it("NFR-PERF-01 trusted operational model setup has a fixed output/RPC budget without changing ordinary requests (LOCAL ADK transport double)", async () => {
  const model = new AdkGroundedModel({
    project: "local-fixture",
    location: "europe-west4",
    model: "gemini-2.5-flash",
  });
  type GenerateRequest = Parameters<typeof model.llm.generateContentAsync>[0];
  const configs: Array<GenerateRequest["config"]> = [];
  vi.spyOn(model.llm, "generateContentAsync").mockImplementation(async function* (request) {
    configs.push(request.config);
    await Promise.resolve();
    yield {
      content: {
        role: "model",
        parts: [{ text: JSON.stringify({ status: "not_in_sources", sentences: [] }) }],
      },
      turnComplete: true,
    };
  });
  await model.generate({
    question: "Bounded setup",
    chunks: [],
    history: [],
    operationalProbe: true,
  });
  expect(configs[0]?.maxOutputTokens).toBe(512);
  await model.generate({ question: "Ordinary request", chunks: [], history: [] });
  expect(configs[1]?.maxOutputTokens).toBeUndefined();
  const llmWithHttpOptions = model.llm as unknown as {
    getHttpOptions: () => { retryOptions?: { attempts?: number } };
  };
  expect(llmWithHttpOptions.getHttpOptions().retryOptions?.attempts).toBe(1);
});
