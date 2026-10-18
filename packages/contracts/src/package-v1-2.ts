import { z } from "zod";
import { UnifiedDocumentChunkSchema } from "./document-chunk.js";

/**
 * Package 1.2 DTOs and Schemas (Text/PDF Ingestion & Inspector)
 * FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02, Gate v1.0
 */

/** Maximum source byte size: 200 MB = 200,000,000 bytes inclusive per Constitution II */
export const MAX_SOURCE_BYTE_SIZE = 200_000_000;

/** Maximum extracted words per source: 500,000 words inclusive per Constitution II / FR-SI-01 */
export const MAX_SOURCE_WORD_COUNT = 500_000;

/** Default title for copied text sub-dialog per FR-SI-01 */
export const DEFAULT_COPIED_TEXT_TITLE = "Pasted text";

/** Validates title is between 1 and 100 Unicode code points after trimming outer whitespace */
export const SourceTitleSchema = z
  .string()
  .refine(
    (val) => {
      const trimmed = val.trim();
      const codePoints = Array.from(trimmed).length;
      return codePoints >= 1 && codePoints <= 100;
    },
    {
      message: "Title must be between 1 and 100 Unicode code points after trimming outer whitespace",
    }
  );

export const SourceMediaTypeSchema = z.enum([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "copied_text",
]);
export type SourceMediaType = z.infer<typeof SourceMediaTypeSchema>;

export const SourceStatusSchema = z.enum([
  "Uploading",
  "Processing",
  "Ready",
  "Failed",
]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceSchema = z
  .object({
    id: z.string().uuid(),
    notebook_id: z.string().uuid(),
    title: SourceTitleSchema,
    media_type: SourceMediaTypeSchema,
    status: SourceStatusSchema,
    byte_size: z.number().int().nonnegative().max(MAX_SOURCE_BYTE_SIZE),
    word_count: z.number().int().nonnegative().max(MAX_SOURCE_WORD_COUNT),
    revision_id: z.number().int().positive(),
    attempt_id: z.string().uuid(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type Source = z.infer<typeof SourceSchema>;

export const CopiedTextInputSchema = z
  .object({
    text: z
      .string()
      .refine((val) => Array.from(val.trim()).length >= 1, {
        message: "Text must have at least 1 character after trimming outer whitespace",
      })
      .refine(
        (val) => {
          const trimmed = val.trim();
          if (trimmed.length === 0) return true;
          const words = trimmed.split(/\s+/).filter(Boolean).length;
          return words <= MAX_SOURCE_WORD_COUNT;
        },
        {
          message: `Text must not exceed ${MAX_SOURCE_WORD_COUNT} words`,
        }
      ),
    title: z
      .string()
      .refine(
        (val) => {
          const trimmed = val.trim();
          const codePoints = Array.from(trimmed).length;
          return codePoints >= 1 && codePoints <= 100;
        },
        {
          message: "Title must be between 1 and 100 Unicode code points after trimming outer whitespace",
        }
      )
      .default(DEFAULT_COPIED_TEXT_TITLE),
  })
  .strict();
export type CopiedTextInput = z.infer<typeof CopiedTextInputSchema>;

export const ActiveSourceSelectionSchema = z
  .object({
    notebook_id: z.string().uuid(),
    active_source_ids: z.array(z.string().uuid()),
  })
  .strict();
export type ActiveSourceSelection = z.infer<typeof ActiveSourceSelectionSchema>;

export const SourceInspectorQuerySchema = z
  .object({
    source_id: z.string().uuid(),
    highlight_chunk_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type SourceInspectorQuery = z.infer<typeof SourceInspectorQuerySchema>;
