import { z } from "zod";
import { ChunkLocatorSchema } from "./document-chunk.js";

/**
 * Package 1.3 DTOs and Schemas (Grounded Chat & Citation Engine)
 * FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, C-01, C-02
 */

export const ChatRoleSchema = z.enum(["user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const CitationSchema = z
  .object({
    badge_number: z.number().int().positive("badge_number must be a positive integer"),
    source_id: z.string().uuid("source_id must be a valid UUID"),
    source_title: z.string().min(1, "source_title must be non-empty"),
    chunk_id: z.string().uuid("chunk_id must be a valid UUID"),
    snippet: z.string().min(1, "snippet must be non-empty"),
    locator: ChunkLocatorSchema,
  })
  .strict();
export type Citation = z.infer<typeof CitationSchema>;

export const UserMessageInputSchema = z
  .object({
    notebook_id: z.string().uuid("notebook_id must be a valid UUID"),
    message: z
      .string()
      .transform((val) => val.trim())
      .refine(
        (val) => {
          const codePoints = Array.from(val).length;
          return codePoints >= 1 && codePoints <= 10000;
        },
        {
          message:
            "message must be between 1 and 10,000 Unicode code points after outer whitespace trimming",
        }
      ),
    active_source_ids: z
      .array(z.string().uuid("active_source_id must be a valid UUID"))
      .min(1, "active_source_ids must contain at least one source UUID"),
  })
  .strict();
export type UserMessageInput = z.infer<typeof UserMessageInputSchema>;

export const ActiveSourceRevisionRecordSchema = z
  .object({
    source_id: z.string().uuid("source_id must be a valid UUID"),
    revision: z.number().int().positive("revision must be a positive integer"),
  })
  .strict();
export type ActiveSourceRevisionRecord = z.infer<typeof ActiveSourceRevisionRecordSchema>;

export const ChatMessageSchema = z
  .object({
    id: z.string().uuid("id must be a valid UUID"),
    thread_id: z.string().uuid("thread_id must be a valid UUID"),
    notebook_id: z.string().uuid("notebook_id must be a valid UUID"),
    user_id: z.string().min(1, "user_id must be non-empty"),
    role: ChatRoleSchema,
    content: z.string(),
    active_source_revisions_snapshot: z.array(ActiveSourceRevisionRecordSchema),
    citations: z.array(CitationSchema).optional().default([]),
    created_at: z.string().datetime("created_at must be a valid ISO datetime"),
  })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatThreadSchema = z
  .object({
    id: z.string().uuid("id must be a valid UUID"),
    notebook_id: z.string().uuid("notebook_id must be a valid UUID"),
    user_id: z.string().min(1, "user_id must be non-empty"),
    generation_epoch: z.number().int().nonnegative("generation_epoch must be a non-negative integer"),
    created_at: z.string().datetime("created_at must be a valid ISO datetime"),
    updated_at: z.string().datetime("updated_at must be a valid ISO datetime"),
  })
  .strict();
export type ChatThread = z.infer<typeof ChatThreadSchema>;
