import { z } from "zod";

/**
 * C-01: Unified Document Chunk Contract
 * Exactly 5 projected fields + locator union.
 * Enforces strict schemas, UUID v7 chunk_id, and ordered locator bounds.
 */

export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PageSpanLocatorSchema = z
  .object({
    page_number: z.number().int().positive(),
    physical_page: z.number().int().positive().optional(),
    start_offset: z.number().int().nonnegative(),
    end_offset: z.number().int().nonnegative(),
  })
  .strict()
  .refine((data) => data.end_offset >= data.start_offset, {
    message: "end_offset must be greater than or equal to start_offset",
    path: ["end_offset"],
  });

export type PageSpanLocator = z.infer<typeof PageSpanLocatorSchema>;

export const TimeSpanLocatorSchema = z
  .object({
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
  })
  .strict()
  .refine((data) => data.end_ms >= data.start_ms, {
    message: "end_ms must be greater than or equal to start_ms",
    path: ["end_ms"],
  });

export type TimeSpanLocator = z.infer<typeof TimeSpanLocatorSchema>;

export const DomPathLocatorSchema = z
  .object({
    selector: z.string().min(1),
    start_offset: z.number().int().nonnegative(),
    end_offset: z.number().int().nonnegative(),
  })
  .strict()
  .refine((data) => data.end_offset >= data.start_offset, {
    message: "end_offset must be greater than or equal to start_offset",
    path: ["end_offset"],
  });

export type DomPathLocator = z.infer<typeof DomPathLocatorSchema>;

export const ChunkLocatorSchema = z.union([
  PageSpanLocatorSchema,
  TimeSpanLocatorSchema,
  DomPathLocatorSchema,
]);

export type ChunkLocator = z.infer<typeof ChunkLocatorSchema>;

export const UnifiedDocumentChunkSchema = z
  .object({
    chunk_id: z.string().regex(UUID_V7_REGEX, "chunk_id must be a valid UUID v7"),
    source_id: z.string().uuid("source_id must be a valid UUID"),
    revision: z.number().int().positive("revision must be a positive integer"),
    locator: ChunkLocatorSchema,
    token_count: z.number().int().nonnegative("token_count must be a nonnegative integer"),
    text: z.string().min(1, "text must be a non-empty string"),
  })
  .strict();

export type UnifiedDocumentChunk = z.infer<typeof UnifiedDocumentChunkSchema>;
