import { z } from "zod";
import { CitationSchema } from "./package-v1-3.js";
import { MAX_SOURCE_BYTES, MAX_SOURCE_WORDS } from "./source-admission.js";

// Package 2.3 Notes & Pinboard Lifecycle (FR-NM-01..04, FR-GC-09, C-01, C-02).
// Save-note input is shared in intent with Package 2.2; reconcile at merge (see specs/007 plan.md).

export const DEFAULT_NOTE_TITLE = "New note";
export const NOTE_TITLE_MAX_CODE_POINTS = 200;
export const NOTE_BODY_MAX_WORDS = 100_000;
export const NOTE_ASSISTANT_MAX_NOTES = 50;
export const COMBINED_NOTES_TITLE = "Combined notes";
export const NOTE_SOURCE_TITLE_MAX_CODE_POINTS = 100;
export const SAVED_TO_NOTES_MESSAGE = "Saved to notes";
export const SOURCE_LIMIT_REACHED_MESSAGE = "Source limit reached";
export const NOTE_AUTOSAVE_DEBOUNCE_MS = 500;
export const NOTE_AUTOSAVE_DEADLINE_MS = 1000;
export const NOTE_SOURCE_MAX_BYTES = MAX_SOURCE_BYTES;
export const NOTE_SOURCE_MAX_WORDS = MAX_SOURCE_WORDS;

export const NOTE_ERROR_MESSAGES = {
  SourceLimitReached: SOURCE_LIMIT_REACHED_MESSAGE,
  ComparisonSourceRequired: "Select a comparison source first",
  NoteReadOnly: "Saved responses cannot be edited",
  ConfirmationRequired: "Deletion must be confirmed",
} as const;

export function countNoteWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function clampCodePoints(value: string, max: number): string {
  const cps = Array.from(value);
  return cps.length <= max ? value : cps.slice(0, max).join("");
}

export function noteSourceTitle(noteTitles: string[]): string {
  if (noteTitles.length === 1) {
    return clampCodePoints(noteTitles[0]!, NOTE_SOURCE_TITLE_MAX_CODE_POINTS);
  }
  return COMBINED_NOTES_TITLE;
}

const SAFE_SCHEME = /^(https?|mailto):/i;

/** Removes raw HTML/script content and unsafe link schemes; Markdown syntax is kept. */
export function sanitizeNoteMarkdown(markdown: string): string {
  let sanitized = markdown;
  let previous: string;
  do {
    previous = sanitized;
    sanitized = sanitized
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/?[a-z!][^>]*>/gi, "");
  } while (sanitized !== previous);

  return sanitized.replace(/(!?)\[([^\]]*)\]\(\s*([^)\s]*)[^)]*\)/g, (match, bang: string, text: string, url: string) => {
    const cleaned = url.replace(/[\u0000-\u0020]/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned) && !SAFE_SCHEME.test(cleaned)) {
      return bang ? "" : text;
    }
    return match;
  });
}

const TitleSchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => {
    const n = Array.from(v).length;
    return n >= 1 && n <= NOTE_TITLE_MAX_CODE_POINTS;
  }, `title must be 1-${NOTE_TITLE_MAX_CODE_POINTS} Unicode code points after trimming`);

const BodySchema = z
  .string()
  .refine((v) => countNoteWords(v) <= NOTE_BODY_MAX_WORDS, `content_md must not exceed ${NOTE_BODY_MAX_WORDS} words`)
  .transform(sanitizeNoteMarkdown);

export const NoteOriginTypeSchema = z.enum(["manual", "saved_response"]);
export type NoteOriginType = z.infer<typeof NoteOriginTypeSchema>;

export const NoteSchema = z
  .object({
    id: z.string().uuid(),
    notebook_id: z.string().uuid(),
    owner_id: z.string().min(1),
    title: TitleSchema,
    content_md: z.string(),
    origin_type: NoteOriginTypeSchema,
    source_message_id: z.string().uuid().nullable(),
    citations_json: z.array(CitationSchema),
    origin_note_id: z.string().uuid().nullable(),
    revision: z.number().int().positive(),
    display_order: z.number().int().nonnegative(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type Note = z.infer<typeof NoteSchema>;

export const CreateNoteInputSchema = z
  .object({
    title: TitleSchema.optional().default(DEFAULT_NOTE_TITLE),
    content_md: BodySchema.optional().default(""),
  })
  .strict();
export type CreateNoteInput = z.output<typeof CreateNoteInputSchema>;

export const PatchNoteInputSchema = z
  .object({
    title: TitleSchema.optional(),
    content_md: BodySchema.optional(),
    base_revision: z.number().int().positive().optional(),
  })
  .strict();
export type PatchNoteInput = z.output<typeof PatchNoteInputSchema>;

export const SaveNoteFromMessageInputSchema = z.object({ message_id: z.string().uuid() }).strict();
export type SaveNoteFromMessageInput = z.infer<typeof SaveNoteFromMessageInputSchema>;

export const ConvertToSourceInputSchema = z.union([
  z.object({ note_ids: z.array(z.string().uuid()).min(1) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type ConvertToSourceInput = z.infer<typeof ConvertToSourceInputSchema>;

export const NoteAssistantActionSchema = z.enum(["summarize", "create_outline", "related_ideas", "critique"]);
export type NoteAssistantAction = z.infer<typeof NoteAssistantActionSchema>;

export const NoteAssistantInputSchema = z
  .object({
    action_type: NoteAssistantActionSchema,
    selected_note_ids: z.array(z.string().uuid()).min(1).max(NOTE_ASSISTANT_MAX_NOTES),
    selected_source_ids: z.array(z.string().uuid()).default([]),
  })
  .strict();
export type NoteAssistantInput = z.output<typeof NoteAssistantInputSchema>;

export const NoteSourceOriginSchema = z
  .object({ note_id: z.string().uuid(), revision: z.number().int().positive(), title: z.string() })
  .strict();

export const NoteSourceSchema = z
  .object({
    id: z.string().uuid(),
    notebook_id: z.string().uuid(),
    title: z.string().min(1),
    media_type: z.literal("note_markdown"),
    status: z.enum(["Uploading", "Processing", "Ready", "Failed"]),
    revision_id: z.number().int().positive(),
    byte_size: z.number().int().nonnegative(),
    word_count: z.number().int().nonnegative(),
    origin_notes: z.array(NoteSourceOriginSchema).min(1),
    created_at: z.string().datetime(),
  })
  .strict();
export type NoteSource = z.infer<typeof NoteSourceSchema>;

export interface NoteSourceIngestionInput {
  attempt_id: string;
  notebook_id: string;
  source_id: string;
  revision_id: number;
  title: string;
  markdown: string;
}

export interface NoteSourceIngestionResult {
  status: "Ready" | "Failed";
  byte_size: number;
  word_count: number;
  chunks: import("./document-chunk.js").UnifiedDocumentChunk[];
  error_message?: string;
}

/** FR-NM-03 port, implemented by the worker over the Markdown ingestion path (FR-SI-01, C-01). */
export interface NoteSourceIngestor {
  ingest(input: NoteSourceIngestionInput): Promise<NoteSourceIngestionResult>;
}
