import { z } from "zod";
import { SourceRevisionPairSchema } from "./scoped-context.ts";

const uuid = z.string().uuid();
const codePoints = (value: string) => Array.from(value.trim()).length;
const trimmedText = (min: number, max: number, label: string) =>
  z.string().transform((value) => value.trim()).refine(
    (value) => codePoints(value) >= min && codePoints(value) <= max,
    `${label} must contain ${min}–${max} Unicode code points after trimming`
  );

export const NotebookSourceSelectionSchema = z.object({
  id: uuid,
  notebook_id: uuid,
  title: z.string().min(1),
  media_type: z.enum(["application/pdf", "text/plain", "text/markdown", "copied_text", "note_markdown"]),
  status: z.enum(["Uploading", "Processing", "Ready", "Failed"]),
  revision_id: z.number().int().positive(),
}).strict();
export type NotebookSourceSelection = z.infer<typeof NotebookSourceSelectionSchema>;

export const SourceGuideStatusSchema = z.enum(["GuidePending", "GuideReady", "GuideFailed"]);
export type SourceGuideStatus = z.infer<typeof SourceGuideStatusSchema>;

/** Identity (notebook_id, source_id, revision, output_language): another language is a cache miss (FR-SI-02, FR-UI-02). */
export const SourceGuideSchema = z.object({
  notebook_id: uuid,
  source_id: uuid,
  revision: z.number().int().positive(),
  output_language: z.string().min(2).max(35),
  status: SourceGuideStatusSchema,
  source_word_count: z.number().int().nonnegative(),
  summary_md: z.string().trim().min(1).max(10000),
  key_topics: z.array(trimmedText(1, 40, "key topic")).max(10),
  supporting_chunk_ids: z.array(uuid),
  /** Observed `Ready` transition of the source revision; latency is measured from here (FR-018, Gate v2.0 #1). */
  ready_at: z.string().datetime().optional(),
  generated_at: z.string().datetime().optional(),
  error: z.string().optional(),
}).strict().superRefine((guide, ctx) => {
  if (guide.status === "GuideReady") {
    if (guide.supporting_chunk_ids.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["supporting_chunk_ids"], message: "ready guides require supporting chunks" });
    // Hard rules: 1..10 topics (1..3 under 50 words), each ≤ 40 code points. "5–10" is the prompt target only:
    // fewer topics are valid, padding is not (FR-SI-02 card; live Gate v2.0 #1, 2026-10-20).
    if (guide.key_topics.length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["key_topics"], message: "ready guides require at least one key topic" });
    }
    if (guide.source_word_count < 50 && guide.key_topics.length > 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["key_topics"], message: "sources under 50 words support at most 3 topics" });
    }
    const words = guide.summary_md.split(/\s+/).filter(Boolean).length;
    if (words > 250) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary_md"], message: "summary must not exceed 250 words" });
  }
});
export type SourceGuide = z.infer<typeof SourceGuideSchema>;

export const StarterPromptSchema = trimmedText(1, 120, "starter prompt");
export const FollowUpSuggestionSchema = trimmedText(1, 100, "follow-up suggestion");

export const NotebookOverviewSchema = z.object({
  notebook_id: uuid,
  source_revisions: z.array(SourceRevisionPairSchema).min(1),
  authorization_key: z.string().min(1),
  output_language: z.string().min(2),
  generation_parameters: z.record(z.unknown()),
  cache_key: z.string().min(1),
  overview_md: z.string().trim().min(1),
  starter_prompts: z.array(StarterPromptSchema).max(5),
  supporting_chunk_ids: z.array(uuid).min(1),
  generated_at: z.string().datetime(),
}).strict();
export type NotebookOverview = z.infer<typeof NotebookOverviewSchema>;

/** One follow-up chip and the chunks it can be answered from (FR-GC-05, FR-008, C-02). */
export const FollowUpChipSchema = z.object({
  text: FollowUpSuggestionSchema,
  supporting_chunk_ids: z.array(uuid).min(1),
}).strict();
export type FollowUpChip = z.infer<typeof FollowUpChipSchema>;

export const FollowUpSuggestionsSchema = z.object({
  suggested_followups: z.array(FollowUpChipSchema).max(3),
  source_revisions: z.array(SourceRevisionPairSchema).min(1),
  output_language: z.string().min(2).max(35),
  generated_at: z.string().datetime(),
}).strict().superRefine((result, ctx) => {
  const unique = new Set(result.suggested_followups.map((chip) => chip.text.toLocaleLowerCase()));
  if (unique.size !== result.suggested_followups.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["suggested_followups"], message: "follow-up suggestions must be unique" });
});
export type FollowUpSuggestions = z.infer<typeof FollowUpSuggestionsSchema>;

/**
 * Raw structured-model outputs (FR-SI-02, FR-GC-04/05): shape only. Limits, support IDs and C-02 scope are
 * validated by the generation pipelines before anything is stored or shown.
 */
export const SourceGuideGenerationSchema = z.object({
  summary_md: z.string().min(1),
  key_topics: z.array(z.string().min(1)).max(10),
  supporting_chunk_ids: z.array(uuid),
}).strict();
export const OverviewGenerationSchema = z.object({
  overview_md: z.string().min(1),
  starter_prompts: z.array(StarterPromptSchema).max(5),
  supporting_chunk_ids: z.array(uuid).min(1),
}).strict();
export const FollowUpGenerationSchema = z.object({
  suggested_followups: z.array(z.object({ text: FollowUpSuggestionSchema, supporting_chunk_ids: z.array(uuid) }).strict()).max(3),
}).strict();

export const PersistedMessageFollowUpsSchema = z.object({
  notebook_id: uuid,
  user_id: z.string().min(1),
  message_id: uuid,
  suggestions: FollowUpSuggestionsSchema,
}).strict();
export type PersistedMessageFollowUps = z.infer<typeof PersistedMessageFollowUpsSchema>;

export const ChatStyleSchema = z.enum(["default", "learning_guide", "analyst", "custom"]);
export const ResponseLengthSchema = z.enum(["default", "longer", "shorter"]);
export const ChatConfigurationSchema = z.object({
  style: ChatStyleSchema.default("default"),
  custom_instructions: z.string().transform((value) => value.trim()).optional(),
  response_length: ResponseLengthSchema.default("default"),
}).strict().superRefine((config, ctx) => {
  if (config.style === "custom") {
    const length = codePoints(config.custom_instructions ?? "");
    if (length < 1 || length > 5000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["custom_instructions"], message: "custom instructions must contain 1–5,000 Unicode code points after trimming" });
    }
  } else if (config.custom_instructions !== undefined && config.custom_instructions !== "") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["custom_instructions"], message: "custom instructions are allowed only with custom style" });
  }
});
export type ChatConfiguration = z.infer<typeof ChatConfigurationSchema>;

export const FeedbackRatingSchema = z.enum(["up", "down"]);
export const FeedbackCategorySchema = z.enum(["hallucination", "wrong_citation", "incomplete", "other"]);
const MessageFeedbackBaseSchema = z.object({
  message_id: uuid,
  rating: FeedbackRatingSchema,
  category: FeedbackCategorySchema.optional(),
  comment: trimmedText(0, 1000, "feedback comment").optional(),
}).strict();

function validateFeedback(feedback: z.infer<typeof MessageFeedbackBaseSchema>, ctx: z.RefinementCtx) {
  if (feedback.rating === "down" && !feedback.category) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "negative feedback requires a category" });
  }
  if (feedback.rating === "up" && feedback.category) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "positive feedback cannot include a negative category" });
  }
}

export const MessageFeedbackInputSchema = MessageFeedbackBaseSchema.superRefine(validateFeedback);
export type MessageFeedbackInput = z.infer<typeof MessageFeedbackInputSchema>;

export const MessageFeedbackSchema = MessageFeedbackBaseSchema.extend({
  notebook_id: uuid,
  user_id: z.string().min(1),
  created_at: z.string().datetime(),
}).strict().superRefine(validateFeedback);
export type MessageFeedback = z.infer<typeof MessageFeedbackSchema>;

// FR-GC-09 / FR-NM-02: the one shared save-note contract is defined in Package 2.3 and re-exported here.
export {
  SaveResponseNoteRequestSchema,
  SavedResponseNoteSchema,
  SaveResponseNoteResponseSchema,
  type SaveResponseNoteRequest,
  type SavedResponseNote,
  type SaveResponseNoteResponse,
} from "./package-v2-3.ts";
