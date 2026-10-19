import { z } from "zod";

/**
 * Structured model output for grounded answers (FR-GC-01, FR-GC-02, D13). The model never streams text to the
 * user; this whole object is buffered and verified before anything is published.
 */
export const GroundedDraftSchema = z
  .object({
    status: z.enum(["answered", "not_in_sources"]),
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
  })
  .strict();

export type GroundedDraft = z.infer<typeof GroundedDraftSchema>;

/** Equivalent response schema for the model's structured output (Gemini `responseSchema`). */
export const GROUNDED_DRAFT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["answered", "not_in_sources"] },
    missing_topic: { type: "STRING" },
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
  propertyOrdering: ["status", "missing_topic", "sentences"],
} as const;
