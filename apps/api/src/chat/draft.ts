import { z } from "zod";

/**
 * Structured model output for grounded answers (FR-GC-01, FR-GC-02, D13). The model never streams text to the
 * user; this whole object is buffered and verified before anything is published.
 */
const DatasetValueSchema = z
  .object({
    label: z.string().min(1).max(200),
    /** Copied exactly as written in the cited chunk (verified against its text before execution). */
    value: z.string().min(1).max(64),
    /** An empty unit from the model means unitless (Gemini returns "" for a nullable STRING). */
    unit: z
      .string()
      .max(40)
      .nullable()
      .optional()
      .transform((u) => (u === "" ? null : u)),
    chunk_id: z.string(),
  })
  .strict();

/**
 * FR-GC-08 (specs/010): the model never does arithmetic itself. For quantitative questions it returns the source
 * values it relies on (each tied to its chunk) and Python that computes over exactly those values in the sandbox.
 */
export const ComputationSchema = z
  .object({
    intent: z.string().min(1).max(500),
    dataset: z.array(DatasetValueSchema).max(5000),
    code: z.string().min(1).max(20_000),
  })
  .strict();
export type Computation = z.infer<typeof ComputationSchema>;

export const GroundedDraftSchema = z
  .object({
    status: z.enum(["answered", "not_in_sources", "compute", "clarify"]),
    /** Short noun phrase naming what the sources do not cover (refusals and partial answers). */
    missing_topic: z.string().max(200).optional(),
    sentences: z
      .array(
        z
          .object({
            text: z.string().min(1).max(4000),
            /** chunk_ids from the provided context that support this sentence. */
            citations: z.array(z.string()).max(32),
            /** "claim" = factual/synthesized statement (must cite); "meta" = statement about source coverage. */
            kind: z.enum(["claim", "meta"]),
          })
          .strict()
      )
      .max(60),
    /** FR-014: one focused question when the statistical intent is ambiguous (status "clarify"). */
    clarification_question: z.string().min(1).max(500).optional(),
    /** FR-001: values + code for the sandbox (status "compute"). */
    computation: ComputationSchema.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.status === "compute" && !d.computation) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "compute needs a computation", path: ["computation"] });
    if (d.status === "clarify" && !d.clarification_question) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "clarify needs a question", path: ["clarification_question"] });
  });

export type GroundedDraft = z.infer<typeof GroundedDraftSchema>;

/** Equivalent response schema for the model's structured output (Gemini `responseSchema`). */
export const GROUNDED_DRAFT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["answered", "not_in_sources", "compute", "clarify"] },
    missing_topic: { type: "STRING" },
    clarification_question: { type: "STRING" },
    computation: {
      type: "OBJECT",
      properties: {
        intent: { type: "STRING" },
        dataset: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { label: { type: "STRING" }, value: { type: "STRING" }, unit: { type: "STRING", nullable: true }, chunk_id: { type: "STRING" } },
            required: ["label", "value", "chunk_id"],
            propertyOrdering: ["label", "value", "unit", "chunk_id"],
          },
        },
        code: { type: "STRING" },
      },
      required: ["intent", "dataset", "code"],
      propertyOrdering: ["intent", "dataset", "code"],
    },
    sentences: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          citations: { type: "ARRAY", items: { type: "STRING" } },
          kind: { type: "STRING", enum: ["claim", "meta"] },
        },
        required: ["text", "citations", "kind"],
        propertyOrdering: ["text", "citations", "kind"],
      },
    },
  },
  required: ["status", "sentences"],
  propertyOrdering: ["status", "missing_topic", "clarification_question", "sentences", "computation"],
} as const;

/** Response schema for the configured runtime: without a sandbox the model cannot choose compute/clarify (FR-GC-08). */
export function groundedDraftResponseSchema(options: { codeExecution: boolean }): Record<string, unknown> {
  if (options.codeExecution) return GROUNDED_DRAFT_RESPONSE_SCHEMA;
  const { computation: _c, clarification_question: _q, ...properties } = GROUNDED_DRAFT_RESPONSE_SCHEMA.properties;
  return {
    ...GROUNDED_DRAFT_RESPONSE_SCHEMA,
    properties: { ...properties, status: { type: "STRING", enum: ["answered", "not_in_sources"] } },
    propertyOrdering: ["status", "missing_topic", "sentences"],
  };
}
