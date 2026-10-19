import { z } from "zod";
import { CitationSchema } from "./package-v1-3.js";
import { SourceRevisionPairSchema } from "./scoped-context.js";

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
  media_type: z.enum(["application/pdf", "text/plain", "text/markdown", "copied_text"]),
  status: z.enum(["Uploading", "Processing", "Ready", "Failed"]),
  revision_id: z.number().int().positive(),
}).strict();
export type NotebookSourceSelection = z.infer<typeof NotebookSourceSelectionSchema>;

export const SourceGuideStatusSchema = z.enum(["GuidePending", "GuideReady", "GuideFailed"]);
export type SourceGuideStatus = z.infer<typeof SourceGuideStatusSchema>;

export const SourceGuideSchema = z.object({
  notebook_id: uuid,
  source_id: uuid,
  revision: z.number().int().positive(),
  status: SourceGuideStatusSchema,
  source_word_count: z.number().int().nonnegative(),
  summary_md: z.string().trim().min(1).max(10000),
  key_topics: z.array(trimmedText(1, 40, "key topic")).max(10),
  supporting_chunk_ids: z.array(uuid),
  generated_at: z.string().datetime().optional(),
  error: z.string().optional(),
}).strict().superRefine((guide, ctx) => {
  if (guide.status === "GuideReady") {
    if (guide.supporting_chunk_ids.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["supporting_chunk_ids"], message: "ready guides require supporting chunks" });
    const minTopics = guide.source_word_count < 50 ? 1 : 5;
    if (guide.key_topics.length < minTopics) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["key_topics"], message: `must contain at least ${minTopics} topics for this source length` });
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
  starter_prompts: z.array(StarterPromptSchema).min(3).max(5),
  supporting_chunk_ids: z.array(uuid),
  generated_at: z.string().datetime(),
}).strict();
export type NotebookOverview = z.infer<typeof NotebookOverviewSchema>;

export const FollowUpSuggestionsSchema = z.object({
  suggested_followups: z.array(FollowUpSuggestionSchema).max(3),
  supporting_chunk_ids: z.array(uuid),
  source_revisions: z.array(SourceRevisionPairSchema).min(1),
  generated_at: z.string().datetime(),
}).strict().superRefine((result, ctx) => {
  const unique = new Set(result.suggested_followups.map((suggestion) => suggestion.toLocaleLowerCase()));
  if (unique.size !== result.suggested_followups.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["suggested_followups"], message: "follow-up suggestions must be unique" });
  if (result.suggested_followups.length > 0 && result.supporting_chunk_ids.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["supporting_chunk_ids"], message: "follow-up suggestions require supporting chunks" });
});
export type FollowUpSuggestions = z.infer<typeof FollowUpSuggestionsSchema>;

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

export const SaveResponseNoteRequestSchema = z.object({ notebook_id: uuid, message_id: uuid }).strict();
export type SaveResponseNoteRequest = z.infer<typeof SaveResponseNoteRequestSchema>;

export const SavedResponseNoteSchema = z.object({
  id: uuid,
  notebook_id: uuid,
  source_message_id: uuid,
  title: trimmedText(1, 200, "note title"),
  content_md: z.string(),
  citations_json: z.array(CitationSchema),
  origin_type: z.literal("saved_response"),
  read_only: z.literal(true),
  created_at: z.string().datetime(),
}).strict();
export type SavedResponseNote = z.infer<typeof SavedResponseNoteSchema>;

export const SaveResponseNoteResponseSchema = z.object({ note: SavedResponseNoteSchema }).strict();
export type SaveResponseNoteResponse = z.infer<typeof SaveResponseNoteResponseSchema>;
