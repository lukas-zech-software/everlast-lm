import { z } from "zod";
import { CitationSchema } from "./package-v1-3.ts";
import { MAX_SOURCE_BYTES, MAX_SOURCE_WORDS } from "./source-admission.ts";
import { countCodePoints, toCodePoints } from "./text-limits.ts";

// Package 2.3 Notes & Pinboard Lifecycle (FR-NM-01..04, FR-GC-09, C-01, C-02).
// The one shared save-note contract (FR-GC-09, FR-NM-02) is defined here; package-v2-2.ts re-exports it.
// Note-sources are v1 PostgreSQL sources with media_type "note_markdown" (owner decision 2026-10-20, D16).

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
export const NOTE_SOURCE_MEDIA_TYPE = "note_markdown";
export const SAVED_RESPONSE_DEFAULT_TITLE = "Saved response";

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
  const cps = toCodePoints(value);
  return cps.length <= max ? value : cps.slice(0, max).join("");
}

export function noteSourceTitle(noteTitles: string[]): string {
  const [firstTitle] = noteTitles;
  if (noteTitles.length === 1 && firstTitle !== undefined) {
    return clampCodePoints(firstTitle, NOTE_SOURCE_TITLE_MAX_CODE_POINTS);
  }
  return COMBINED_NOTES_TITLE;
}

/**
 * FR-NM-02 / FR-NM-03: removes verified inline citation markers (`[[n]]` as stored by the v1 chat, or the legacy
 * `[n]`) whose `n` is one of `badges`, together with one preceding space or tab. Unverified brackets stay.
 * Linear: the pattern has no nested or overlapping quantifiers.
 */
export function stripCitationMarkers(content: string, badges: ReadonlySet<number>): string {
  return content.replace(
    /[ \t]?\[\[(\d{1,6})\]\]|[ \t]?\[(\d{1,6})\]/g,
    (marker, double: string | undefined, single: string | undefined) =>
      badges.has(Number(double ?? single)) ? "" : marker,
  );
}

const SAFE_SCHEME = /^(https?|mailto):/i;

function skipHtmlBlockContent(
  input: string,
  lower: string,
  tagName: string,
  fromIndex: number,
): number {
  const end = lower.indexOf(`</${tagName}`, fromIndex);
  if (end === -1) return input.length;
  const endClose = input.indexOf(">", end);
  return endClose === -1 ? input.length : endClose + 1;
}

/**
 * One scanning pass over raw HTML (no regex replacement): every `<tag ...>`, `</tag>` or `<!...>` is dropped and
 * `<script>`/`<style>` blocks are dropped with their content. A `<` that does not start a tag stays text.
 */
function stripHtmlPass(input: string): string {
  const lower = input.toLowerCase();
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    const next = input[i + 1] ?? "";
    if (ch !== "<" || !/[a-z!/]/i.test(next)) {
      out += ch;
      i++;
      continue;
    }
    const close = input.indexOf(">", i + 1);
    if (close === -1) break; // an unterminated tag runs to the end: drop it

    const name = /^<\/?([a-z][a-z0-9-]*)/i.exec(input.slice(i, close + 1))?.[1]?.toLowerCase();
    i = close + 1;
    if ((name === "script" || name === "style") && next !== "/") {
      i = skipHtmlBlockContent(input, lower, name, i);
    }
  }
  return out;
}

/** Repeats the pass until nothing changes, so a tag rebuilt from removed pieces is removed as well. */
function stripHtml(input: string): string {
  let current = input;
  for (let round = 0; round < SANITIZE_MAX_ROUNDS; round++) {
    const next = stripHtmlPass(current);
    if (next === current) return next;
    current = next;
  }
  return current.replace(/</g, "&lt;");
}

/** For each position, the index of the next `ch` at or after it (or -1): one backward pass, O(n). */
function nextIndexTable(text: string, ch: string): Int32Array {
  const table = new Int32Array(text.length + 1).fill(-1);
  for (let i = text.length - 1; i >= 0; i--) {
    table[i] = text[i] === ch ? i : (table[i + 1] ?? -1);
  }
  return table;
}

function isUnsafeUrl(url: string): boolean {
  let cleaned = "";
  for (const c of url) if (c.charCodeAt(0) > 0x20) cleaned += c;
  return /^[a-z][a-z0-9+.-]*:/i.test(cleaned) && !SAFE_SCHEME.test(cleaned);
}

function extractLinkUrl(markdown: string, start: number, end: number): string {
  let u = start;
  while (u < end && /\s/.test(markdown[u] ?? "")) {
    u++;
  }
  let urlEnd = u;
  while (urlEnd < end && !/\s/.test(markdown[urlEnd] ?? "")) {
    urlEnd++;
  }
  return markdown.slice(u, urlEnd);
}

function trySanitizeMarkdownLinkAt(
  markdown: string,
  index: number,
  nextClose: Int32Array,
  nextParen: Int32Array,
): { replacement: string; nextIndex: number } | null {
  const isImage = markdown[index] === "!" && markdown[index + 1] === "[";
  const bracketStart = isImage ? index + 1 : index;
  if (markdown[bracketStart] !== "[") {
    return null;
  }
  const close = nextClose[bracketStart + 1] ?? -1;
  const end = close === -1 ? -1 : (nextParen[close + 2] ?? -1);
  if (close === -1 || markdown[close + 1] !== "(" || end === -1) {
    return null;
  }
  const url = extractLinkUrl(markdown, close + 2, end);
  if (!isUnsafeUrl(url)) {
    return { replacement: markdown.slice(index, end + 1), nextIndex: end + 1 };
  }
  const text = markdown.slice(bracketStart + 1, close);
  return { replacement: isImage ? "" : text, nextIndex: end + 1 };
}

/**
 * Replaces Markdown links with unsafe schemes by their text and drops such images, in one linear scan
 * (`[text](url ...)`, text without `]`, url up to the first whitespace or `)`).
 */
function dropUnsafeLinks(markdown: string): string {
  const nextClose = nextIndexTable(markdown, "]");
  const nextParen = nextIndexTable(markdown, ")");
  let out = "";
  let i = 0;
  while (i < markdown.length) {
    const match = trySanitizeMarkdownLinkAt(markdown, i, nextClose, nextParen);
    if (match) {
      out += match.replacement;
      i = match.nextIndex;
    } else {
      out += markdown[i] ?? "";
      i++;
    }
  }
  return out;
}

const SANITIZE_MAX_ROUNDS = 8;

/**
 * Removes raw HTML/script content and unsafe link schemes; Markdown syntax is kept. Both linear steps repeat
 * until nothing changes, so neither can rebuild markup the other removed (e.g. `<[img](javascript:x) onerror=…>`).
 * Rounds are capped; input that is still changing then has every `<` escaped, which is always safe.
 */
export function sanitizeNoteMarkdown(markdown: string): string {
  let current = markdown;
  for (let round = 0; round < SANITIZE_MAX_ROUNDS; round++) {
    const next = stripHtml(dropUnsafeLinks(current));
    if (next === current) return next;
    current = next;
  }
  return dropUnsafeLinks(current).replace(/</g, "&lt;");
}

const TitleSchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => {
    const n = countCodePoints(v);
    return n >= 1 && n <= NOTE_TITLE_MAX_CODE_POINTS;
  }, `title must be 1-${NOTE_TITLE_MAX_CODE_POINTS} Unicode code points after trimming`);

const BodySchema = z
  .string()
  .refine(
    (v) => countNoteWords(v) <= NOTE_BODY_MAX_WORDS,
    `content_md must not exceed ${NOTE_BODY_MAX_WORDS} words`,
  )
  .transform(sanitizeNoteMarkdown);

export const NoteOriginTypeSchema = z.enum(["manual", "saved_response"]);
export type NoteOriginType = z.infer<typeof NoteOriginTypeSchema>;

export const NoteSchema = z
  .object({
    id: z.uuid(),
    notebook_id: z.uuid(),
    owner_id: z.string().min(1),
    title: TitleSchema,
    content_md: z.string(),
    origin_type: NoteOriginTypeSchema,
    source_message_id: z.uuid().nullable(),
    citations_json: z.array(CitationSchema),
    origin_note_id: z.uuid().nullable(),
    revision: z.number().int().positive(),
    display_order: z.number().int().nonnegative(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
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

// ---- Shared save-note contract (FR-GC-09, FR-NM-02; spec/requirements/README.md v2 row) ---------------------
// POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note. Body IDs must equal the path IDs (else 400);
// user identity comes only from the authenticated API context.

export const SaveResponseNoteRequestSchema = z
  .object({ notebook_id: z.uuid(), message_id: z.uuid() })
  .strict();
export type SaveResponseNoteRequest = z.infer<typeof SaveResponseNoteRequestSchema>;

export const SavedResponseNoteSchema = z
  .object({
    id: z.uuid(),
    notebook_id: z.uuid(),
    source_message_id: z.uuid(),
    title: TitleSchema,
    content_md: z.string(),
    citations_json: z.array(CitationSchema),
    origin_type: z.literal("saved_response"),
    read_only: z.literal(true),
    created_at: z.iso.datetime(),
  })
  .strict();
export type SavedResponseNote = z.infer<typeof SavedResponseNoteSchema>;

export const SaveResponseNoteResponseSchema = z.object({ note: SavedResponseNoteSchema }).strict();
export type SaveResponseNoteResponse = z.infer<typeof SaveResponseNoteResponseSchema>;

/** `reuse: true` returns an existing Ready note-source of the same notes and revisions (FR-NM-04 snapshot phase). */
export const ConvertToSourceInputSchema = z.union([
  z.object({ note_ids: z.array(z.uuid()).min(1), reuse: z.boolean().optional() }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type ConvertToSourceInput = z.infer<typeof ConvertToSourceInputSchema>;

export const NoteAssistantActionSchema = z.enum([
  "summarize",
  "create_outline",
  "related_ideas",
  "critique",
]);
export type NoteAssistantAction = z.infer<typeof NoteAssistantActionSchema>;

export const NoteAssistantInputSchema = z
  .object({
    action_type: NoteAssistantActionSchema,
    selected_note_ids: z.array(z.uuid()).min(1).max(NOTE_ASSISTANT_MAX_NOTES),
    selected_source_ids: z.array(z.uuid()).default([]),
  })
  .strict();
export type NoteAssistantInput = z.output<typeof NoteAssistantInputSchema>;

export const NoteSourceOriginSchema = z
  .object({ note_id: z.uuid(), revision: z.number().int().positive(), title: z.string() })
  .strict();

export type NoteSourceOrigin = z.infer<typeof NoteSourceOriginSchema>;

/** A note-source as the notes routes return it: the v1 source row plus its provenance (FR-NM-03). */
export const NoteSourceSchema = z
  .object({
    id: z.uuid(),
    notebook_id: z.uuid(),
    title: z.string().min(1),
    media_type: z.literal(NOTE_SOURCE_MEDIA_TYPE),
    status: z.enum(["Uploading", "Processing", "Ready", "Failed"]),
    revision_id: z.number().int().positive(),
    byte_size: z.number().int().nonnegative(),
    word_count: z.number().int().nonnegative(),
    origin_notes: z.array(NoteSourceOriginSchema).min(1),
    /** Citations copied from saved-response notes: provenance only, never cited by new answers. */
    origin_citations: z.array(CitationSchema),
    created_at: z.iso.datetime(),
  })
  .strict();
export type NoteSource = z.infer<typeof NoteSourceSchema>;
