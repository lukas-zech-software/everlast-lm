import { z } from "zod";
import { DEFAULT_NOTEBOOK_TITLE } from "./text-limits.js";

export { DEFAULT_NOTEBOOK_TITLE };

/**
 * Workspace and Notebook Contracts (FR-WM-01, FR-WM-04, FR-WM-07).
 * Enforces UUID v4 identities, UTC ISO timestamps, and 1–100 code-point title bounds.
 */

export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const NotebookTitleSchema = z
  .string()
  .refine((val) => {
    const trimmed = val.trim();
    const codePoints = Array.from(trimmed).length;
    return codePoints >= 1 && codePoints <= 100;
  }, {
    message: "Title must be between 1 and 100 Unicode code points after outer whitespace trimming",
  });

export const NotebookSchema = z
  .object({
    id: z.string().regex(UUID_V4_REGEX, "id must be a valid UUID v4"),
    owner_id: z.string().min(1, "owner_id must not be empty"),
    title: NotebookTitleSchema,
    created_at: z.string().datetime({ message: "created_at must be a valid UTC ISO 8601 timestamp" }),
    updated_at: z.string().datetime({ message: "updated_at must be a valid UTC ISO 8601 timestamp" }),
    archived_at: z
      .string()
      .datetime({ message: "archived_at must be a valid UTC ISO 8601 timestamp" })
      .nullable()
      .optional(),
  })
  .strict();

export type Notebook = z.infer<typeof NotebookSchema>;

export const CreateNotebookInputSchema = z
  .object({
    title: z.string().optional(),
  })
  .strict();

export type CreateNotebookInput = z.infer<typeof CreateNotebookInputSchema>;

export const UpdateNotebookInputSchema = z
  .object({
    title: NotebookTitleSchema,
  })
  .strict();

export type UpdateNotebookInput = z.infer<typeof UpdateNotebookInputSchema>;
