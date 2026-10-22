import { z } from "zod";
import { AppError } from "./errors.ts";

/**
 * Package 3.1 DTOs — Multimodal Ingestion & Sync (FR-SI-01 Subset B, FR-SI-04, FR-SI-05, C-01, C-02).
 * These refine the HTTP/view boundary around the unchanged strict C-01 chunk (document-chunk.ts): no locator
 * variant is added and the derived `display_time` lives only in transcript/view DTOs.
 */

// ---------------------------------------------------------------------------------------------------------
// Media types (FR-SI-01 Subset B)
// ---------------------------------------------------------------------------------------------------------

export const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const AUDIO_MEDIA_TYPES = ["audio/mpeg", "audio/wav", "audio/mp4"] as const;
/** Web URL sources (article HTML normalized to sanitized sections with `dom_path` locators). */
export const WEB_MEDIA_TYPE = "text/html";
/** Video URL sources (caption track or ASR transcript with `time_span` locators). */
export const VIDEO_MEDIA_TYPE = "video_url";

export const V3_MEDIA_TYPES = [DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE, ...AUDIO_MEDIA_TYPES, WEB_MEDIA_TYPE, VIDEO_MEDIA_TYPE] as const;

/** Types a browser upload may claim. `copied_text` and trusted `note_markdown` are server-side only (FR-NM-03). */
export const UPLOADABLE_MEDIA_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  DOCX_MEDIA_TYPE,
  PPTX_MEDIA_TYPE,
  ...AUDIO_MEDIA_TYPES,
] as const;
export type UploadableMediaType = (typeof UPLOADABLE_MEDIA_TYPES)[number];

const UPLOAD_EXTENSIONS: Record<string, UploadableMediaType> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  docx: DOCX_MEDIA_TYPE,
  pptx: PPTX_MEDIA_TYPE,
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

/** Upload admission for FR-SI-01 Subset A + B by file extension; null when unsupported. */
export function uploadMediaTypeForFileName(fileName: string): UploadableMediaType | null {
  const ext = /\.([^.]+)$/.exec(fileName.trim().toLowerCase())?.[1];
  return ext ? (UPLOAD_EXTENSIONS[ext] ?? null) : null;
}

export const UNSUPPORTED_UPLOAD_MESSAGE = "Only PDF, .txt, Markdown, Word (.docx), PowerPoint (.pptx) and MP3/WAV/M4A audio files are supported";

export function isAudioMediaType(mediaType: string): boolean {
  return (AUDIO_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

export function isOfficeMediaType(mediaType: string): boolean {
  return mediaType === DOCX_MEDIA_TYPE || mediaType === PPTX_MEDIA_TYPE;
}

// ---------------------------------------------------------------------------------------------------------
// Fixed user-visible messages (FR-SI-01, FR-SI-05)
// ---------------------------------------------------------------------------------------------------------

export const WEB_EXTRACTION_FAILED_MESSAGE = "Unable to extract content from URL";
export const NO_TRANSCRIPT_MESSAGE = "No transcript available for this video";
export const SYNC_IN_PROGRESS_MESSAGE = "Sync already in progress";
export const CONTENT_QUARANTINED_MESSAGE = "Content was blocked by safety screening";
export const DELEGATED_ACCESS_DENIED_MESSAGE = "Access to the linked document was denied";

export class SyncAlreadyInProgressError extends AppError {
  constructor() {
    super("SyncAlreadyInProgress", 409, SYNC_IN_PROGRESS_MESSAGE);
    this.name = "SyncAlreadyInProgressError";
  }
}

// ---------------------------------------------------------------------------------------------------------
// Titles (FR-SI-05): rename is 1–200 code points; copied-text creation keeps its own 100 limit (FR-SI-01).
// ---------------------------------------------------------------------------------------------------------

export const MAX_SOURCE_TITLE_CODE_POINTS = 200;

export function sourceTitleCodePoints(title: string): number {
  return Array.from(title.trim()).length;
}

export const SourceRenameInputSchema = z
  .object({
    title: z
      .string()
      .refine((value) => {
        const n = sourceTitleCodePoints(value);
        return n >= 1 && n <= MAX_SOURCE_TITLE_CODE_POINTS;
      }, `Title must be 1–${MAX_SOURCE_TITLE_CODE_POINTS} Unicode code points after trimming outer whitespace`)
      .transform((value) => value.trim()),
  })
  .strict();
export type SourceRenameInput = z.infer<typeof SourceRenameInputSchema>;

// ---------------------------------------------------------------------------------------------------------
// Linked sources, imports and sync (FR-SI-01, FR-SI-05, D11)
// ---------------------------------------------------------------------------------------------------------

export const SourceLinkKindSchema = z.enum(["web", "video", "drive"]);
export type SourceLinkKind = z.infer<typeof SourceLinkKindSchema>;

/** Re-sync applies to mutable external links only: Web URLs and linked cloud documents (FR-SI-05). */
export function isSyncEligible(linkKind: string | null | undefined): boolean {
  return linkKind === "web" || linkKind === "drive";
}

export const MAX_SOURCE_URL_LENGTH = 2048;

const HttpUrlSchema = z
  .string()
  .max(MAX_SOURCE_URL_LENGTH)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0 && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "url must be an http(s) URL without credentials");

const UuidSchema = z.string().uuid();
const ExternalDocumentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/, "external_document_id must be a Drive file ID");

export const SourceImportRequestSchema = z.discriminatedUnion("kind", [
  z.object({ attempt_id: UuidSchema, kind: z.literal("web"), url: HttpUrlSchema }).strict(),
  z.object({ attempt_id: UuidSchema, kind: z.literal("video"), url: HttpUrlSchema, connection_id: UuidSchema.optional() }).strict(),
  z.object({ attempt_id: UuidSchema, kind: z.literal("drive"), external_document_id: ExternalDocumentIdSchema, connection_id: UuidSchema }).strict(),
]);
export type SourceImportRequest = z.infer<typeof SourceImportRequestSchema>;

export const SourceImportAcceptedSchema = z
  .object({ source_id: UuidSchema, operation_id: UuidSchema, status: z.literal("Processing") })
  .strict();
export type SourceImportAccepted = z.infer<typeof SourceImportAcceptedSchema>;

export const SourceSyncRequestSchema = z.object({ attempt_id: UuidSchema }).strict();

export const SourceSyncAcceptedSchema = z
  .object({ operation_id: UuidSchema, source_id: UuidSchema, committed_revision: z.number().int().positive() })
  .strict();
export type SourceSyncAccepted = z.infer<typeof SourceSyncAcceptedSchema>;

/** Internal operation lifecycle; never a source eligibility state (FR-SI-03). */
export const SourceOperationStateSchema = z.enum(["Queued", "Running", "Succeeded", "Failed", "Cancelled"]);
export type SourceOperationState = z.infer<typeof SourceOperationStateSchema>;

/** Progress substates shown while a source is Processing (or Ready and re-syncing). */
export const SourceProgressSchema = z.enum(["Fetching", "Transcribing", "Parsing", "Syncing"]);
export type SourceProgress = z.infer<typeof SourceProgressSchema>;

export const SourceOperationDtoSchema = z
  .object({
    operation_id: UuidSchema,
    source_id: UuidSchema,
    kind: z.enum(["import", "sync"]),
    state: SourceOperationStateSchema,
    progress: SourceProgressSchema.nullable(),
    committed_revision: z.number().int().positive().nullable(),
    error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type SourceOperationDto = z.infer<typeof SourceOperationDtoSchema>;

/** Additive v3 fields of the public source DTO (see `SourceDtoSchema`). */
export const SourceSyncStateSchema = z.object({ operation_id: UuidSchema, state: SourceOperationStateSchema }).strict();

/** Resolves a pasted Google Docs/Slides link to its Drive file ID (D11); any other host is rejected. */
export function parseGoogleDocumentLink(link: string): { id: string; kind: "document" | "presentation" } | null {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    const m = /^\/(document|presentation)\/d\/([A-Za-z0-9_-]{1,256})(?:\/|$)/.exec(url.pathname);
    return m ? { id: m[2]!, kind: m[1] as "document" | "presentation" } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Transcript / viewer DTOs (FR-SI-01, FR-SI-04, Gate v3.0 #1)
// ---------------------------------------------------------------------------------------------------------

/** `mm:ss` from integer milliseconds: floor(ms / 60000) minutes (at least two digits) and zero-padded seconds. */
export function formatDisplayTime(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError("display time requires a non-negative integer millisecond offset");
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const TranscriptSegmentViewSchema = z
  .object({
    page_number: z.number().int().positive(),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
    display_time: z.string().regex(/^\d{2,}:\d{2}$/),
    text: z.string(),
  })
  .strict()
  .refine((s) => s.end_ms >= s.start_ms, { message: "end_ms must be >= start_ms", path: ["end_ms"] })
  .refine((s) => s.display_time === formatDisplayTime(s.start_ms), { message: "display_time must derive from start_ms", path: ["display_time"] });
export type TranscriptSegmentView = z.infer<typeof TranscriptSegmentViewSchema>;

/** Player descriptor of the Source Inspector; media bytes are only served through the authorized proxy. */
export const InspectorPlayerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio"), url: z.string().min(1), duration_ms: z.number().int().nonnegative().nullable() }).strict(),
  z.object({ type: z.literal("youtube"), video_id: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/) }).strict(),
  z.object({ type: z.literal("link"), url: z.string().url() }).strict(),
]);
export type InspectorPlayer = z.infer<typeof InspectorPlayerSchema>;

/** Viewer kinds of canonical `source_pages` rows (D15). */
export const ViewerKindSchema = z.enum(["pages", "article", "transcript"]);
export type ViewerKind = z.infer<typeof ViewerKindSchema>;

/** Citation states: `updated` = cited revision replaced by re-sync; `deleted` = source removed or revoked (FR-SI-05). */
export const CitationStatusSchema = z.enum(["available", "updated", "deleted"]);
export type CitationStatus = z.infer<typeof CitationStatusSchema>;
