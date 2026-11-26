import { z } from "zod";
import { UUID_V7_REGEX, type UnifiedDocumentChunk } from "./document-chunk.ts";
import { SourceRevisionPairSchema, type SourceRevisionPair } from "./scoped-context.ts";
import { countCodePoints } from "./text-limits.ts";
import { OutputLanguageSchema } from "./package-v2-1.ts";
import {
  DataTableFocusPromptSchema,
  DataTableSchemaIdSchema,
  STUDIO_DATA_TABLE_PLUGIN_TYPE,
  STUDIO_MINDMAP_PLUGIN_TYPE,
  STUDIO_REPORT_PLUGIN_TYPE,
  StudioDataTableParamsSchema,
  StudioDataTablePayloadSchema,
  StudioMindmapParamsSchema,
  StudioMindmapPayloadSchema,
  StudioPluginTypeSchema,
  type DataTableSchemaId,
  type StudioDataTablePayload,
  type StudioMindmapPayload,
  type StudioPluginType,
} from "./package-v3-3.ts";
import {
  FlashcardCountInputSchema,
  LEARNING_OVERVIEW_MAX_SECTIONS,
  LEARNING_OVERVIEW_MIN_SECTIONS,
  PedagogyDifficultySchema,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  STUDIO_FLASHCARDS_PLUGIN_TYPE,
  STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE,
  STUDIO_QUIZ_PLUGIN_TYPE,
  StudioFlashcardsParamsSchema,
  StudioFlashcardsPayloadSchema,
  StudioLearningOverviewParamsSchema,
  StudioLearningOverviewPayloadSchema,
  StudioQuizParamsSchema,
  StudioQuizPayloadSchema,
  validatePedagogyFocusPrompt,
  type FlashcardCountInput,
  type PedagogyDifficulty,
  type StudioFlashcardsPayload,
  type StudioLearningOverviewPayload,
  type StudioQuizPayload,
} from "./package-v4-1.ts";
import {
  InfographicStyleSchema,
  SLIDE_COUNT_MAX,
  SLIDE_COUNT_MIN,
  STUDIO_INFOGRAPHIC_PLUGIN_TYPE,
  STUDIO_SLIDE_DECK_PLUGIN_TYPE,
  StudioInfographicParamsSchema,
  StudioInfographicPayloadSchema,
  StudioSlideDeckParamsSchema,
  StudioSlideDeckPayloadSchema,
  validateInfographicFocusPrompt,
  validateSlideFocusPrompt,
  type InfographicStyle,
  type StudioInfographicPayload,
  type StudioSlideDeckPayload,
} from "./package-v4-2.ts";

/**
 * Package 2.4 — Studio Text Synthesis & Reports (FR-ST-10, FR-ST-11, C-02, C-03).
 * Defines C-03 StudioGeneratorPlugin, the StudioPluginRegistry and report DTOs once (D2).
 */

export { STUDIO_REPORT_PLUGIN_TYPE } from "./package-v3-3.ts";
export const CUSTOM_REPORT_PROMPT_MAX = 5000;

export const ReportTemplateTypeSchema = z.enum(["briefing_doc", "study_guide", "faq", "timeline"]);
export type ReportTemplateType = z.infer<typeof ReportTemplateTypeSchema>;

export const ReportSubtypeSchema = z.enum([
  "briefing_doc",
  "study_guide",
  "faq",
  "timeline",
  "dynamic",
  "custom",
]);
export type ReportSubtype = z.infer<typeof ReportSubtypeSchema>;

export const StudioJobStatusSchema = z.enum([
  "Queued",
  "Running",
  "Completed",
  "Failed",
  "Cancelled",
]);
export type StudioJobStatus = z.infer<typeof StudioJobStatusSchema>;

const TRANSITIONS: Record<StudioJobStatus, readonly StudioJobStatus[]> = {
  Queued: ["Running", "Cancelled"],
  Running: ["Completed", "Failed", "Cancelled"],
  Completed: [],
  Failed: [],
  Cancelled: [],
};

export class InvalidStudioTransitionError extends Error {
  constructor(from: StudioJobStatus, to: StudioJobStatus) {
    super(`Illegal Studio job transition ${from} -> ${to}`);
    this.name = "InvalidStudioTransitionError";
  }
}

export function canTransitionStudioStatus(from: StudioJobStatus, to: StudioJobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStudioStatus(status: StudioJobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export const StudioFailureCodeSchema = z.enum([
  "SourceChanged",
  "Unauthorized",
  "CitationValidationFailed",
  "InsufficientEvidence",
  "OutputTooLarge",
  "TableBoundsExceeded",
  "GenerationError",
  "Cancelled",
]);
export type StudioFailureCode = z.infer<typeof StudioFailureCodeSchema>;

export const StudioFailureSchema = z
  .object({ code: StudioFailureCodeSchema, message: z.string().min(1) })
  .strict();
export type StudioFailure = z.infer<typeof StudioFailureSchema>;

export const StudioProgressSchema = z
  .object({
    stage: z.enum(["reading", "extracting", "composing", "validating", "publishing"]),
    percent: z.number().min(0).max(100),
  })
  .strict();
export type StudioProgress = z.infer<typeof StudioProgressSchema>;

export interface PromptValidationResult {
  valid: boolean;
  codePoints: number;
  normalized?: string;
  error?: string;
}

/** FR-ST-11: 1–5,000 Unicode code points after trimming outer whitespace; never truncates. */
export function validateCustomReportPrompt(input: string): PromptValidationResult {
  const trimmed = input.trim();
  const codePoints = countCodePoints(trimmed);
  if (codePoints < 1) {
    return {
      valid: false,
      codePoints: 0,
      error: "Report prompt must not be empty or whitespace only.",
    };
  }
  if (codePoints > CUSTOM_REPORT_PROMPT_MAX) {
    return {
      valid: false,
      codePoints,
      error: `Report prompt exceeds ${CUSTOM_REPORT_PROMPT_MAX} code points (received ${codePoints}).`,
    };
  }
  return { valid: true, codePoints, normalized: trimmed };
}

export const CustomReportPromptSchema = z.string().transform((value, ctx) => {
  const result = validateCustomReportPrompt(value);
  if (!result.valid || result.normalized === undefined) {
    ctx.addIssue({ code: "custom", message: result.error ?? "Invalid report prompt" });
    return z.NEVER;
  }
  return result.normalized;
});

export const ReportCitationSchema = z
  .object({
    badge_number: z.number().int().positive(),
    chunk_id: z.string().regex(UUID_V7_REGEX, "chunk_id must be a valid UUID v7"),
    source_id: z.uuid(),
    revision: z.number().int().positive(),
    snippet: z.string().min(1),
  })
  .strict();
export type ReportCitation = z.infer<typeof ReportCitationSchema>;

/**
 * FR-ST-10 required sections per template, identified by stable keys in `payload_json.sections`; headings follow
 * the output language (FR-UI-02). Dynamic and custom reports use model-defined keys.
 */
export const REQUIRED_REPORT_SECTIONS = {
  briefing_doc: ["executive_summary", "core_themes", "key_takeaways", "quotes"],
  study_guide: [
    "topic_review",
    "short_answer_questions",
    "answer_key",
    "essay_questions",
    "glossary",
  ],
  faq: ["faq"],
  timeline: ["events", "cast_of_characters"],
} as const satisfies Record<ReportTemplateType, readonly string[]>;

export function requiredReportSections(subtype: string): readonly string[] {
  return (REQUIRED_REPORT_SECTIONS as Record<string, readonly string[]>)[subtype] ?? [];
}

export const REPORT_SECTION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const ReportSectionSchema = z
  .object({
    key: z
      .string()
      .regex(REPORT_SECTION_KEY_PATTERN, "section key must be a stable snake_case identifier"),
    heading: z.string().min(1),
  })
  .strict();
export type ReportSection = z.infer<typeof ReportSectionSchema>;

export const StudioReportPayloadSchema = z
  .object({
    content_md: z.string().min(1),
    citations: z
      .array(ReportCitationSchema)
      .min(1, "A completed report must carry at least one citation"),
    sections: z
      .array(ReportSectionSchema)
      .min(1, "A completed report must carry its sections")
      .refine(
        (list) => new Set(list.map((x) => x.key)).size === list.length,
        "section keys must be unique",
      ),
  })
  .strict();
export type StudioReportPayload = z.infer<typeof StudioReportPayloadSchema>;

export const StudioReportParamsSchema = z.object({ custom_prompt: z.string().optional() }).strict();
export type StudioReportParams = z.infer<typeof StudioReportParamsSchema>;

export const StudioSubtypeSchema = z.enum([
  "briefing_doc",
  "study_guide",
  "faq",
  "timeline",
  "dynamic",
  "custom",
  "default",
]);
export type StudioSubtype = z.infer<typeof StudioSubtypeSchema>;

export const StudioParamsJsonSchema = z.union([
  StudioReportParamsSchema,
  StudioDataTableParamsSchema,
  StudioMindmapParamsSchema,
  StudioFlashcardsParamsSchema,
  StudioQuizParamsSchema,
  StudioLearningOverviewParamsSchema,
  StudioSlideDeckParamsSchema,
  StudioInfographicParamsSchema,
]);
export interface StudioParamsJson {
  custom_prompt?: string;
  schema_id?: DataTableSchemaId;
  focus_prompt?: string;
  difficulty?: PedagogyDifficulty;
  card_count?: FlashcardCountInput;
  question_count?: number;
  section_count?: number;
  slide_count?: number;
  style?: InfographicStyle;
  [key: string]: unknown;
}

export const StudioPayloadJsonSchema = z.union([
  StudioReportPayloadSchema,
  StudioMindmapPayloadSchema,
  StudioDataTablePayloadSchema,
  StudioFlashcardsPayloadSchema,
  StudioQuizPayloadSchema,
  StudioLearningOverviewPayloadSchema,
  StudioSlideDeckPayloadSchema,
  StudioInfographicPayloadSchema,
]);
export type StudioPayloadJson =
  | StudioReportPayload
  | StudioMindmapPayload
  | StudioDataTablePayload
  | StudioFlashcardsPayload
  | StudioQuizPayload
  | StudioLearningOverviewPayload
  | StudioSlideDeckPayload
  | StudioInfographicPayload;

const STUDIO_PAYLOAD_SCHEMAS: Record<StudioPluginType, z.ZodType> = {
  [STUDIO_REPORT_PLUGIN_TYPE]: StudioReportPayloadSchema,
  [STUDIO_MINDMAP_PLUGIN_TYPE]: StudioMindmapPayloadSchema,
  [STUDIO_DATA_TABLE_PLUGIN_TYPE]: StudioDataTablePayloadSchema,
  [STUDIO_FLASHCARDS_PLUGIN_TYPE]: StudioFlashcardsPayloadSchema,
  [STUDIO_QUIZ_PLUGIN_TYPE]: StudioQuizPayloadSchema,
  [STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE]: StudioLearningOverviewPayloadSchema,
  [STUDIO_SLIDE_DECK_PLUGIN_TYPE]: StudioSlideDeckPayloadSchema,
  [STUDIO_INFOGRAPHIC_PLUGIN_TYPE]: StudioInfographicPayloadSchema,
};

function forwardPrefixedIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: string,
  ctx: z.RefinementCtx,
): void {
  for (const issue of issues) {
    ctx.addIssue({ ...issue, path: [prefix, ...issue.path] });
  }
}

function validateStudioArtifactSubtype(
  pluginType: StudioPluginType,
  subtype: StudioSubtype,
  ctx: z.RefinementCtx,
): void {
  if (pluginType === STUDIO_REPORT_PLUGIN_TYPE) {
    if (!ReportSubtypeSchema.safeParse(subtype).success) {
      ctx.addIssue({
        code: "custom",
        path: ["subtype"],
        message: `Invalid report subtype ${subtype}`,
      });
    }
  } else if (subtype !== "default") {
    ctx.addIssue({
      code: "custom",
      path: ["subtype"],
      message: `Plugin ${pluginType} requires subtype "default"`,
    });
  }
}

function validateStudioArtifactPayload(
  pluginType: StudioPluginType,
  subtype: StudioSubtype,
  payloadJson: unknown,
  ctx: z.RefinementCtx,
): void {
  if (pluginType === STUDIO_REPORT_PLUGIN_TYPE) {
    const parsed = StudioReportPayloadSchema.safeParse(payloadJson);
    if (!parsed.success) {
      forwardPrefixedIssues(parsed.error.issues, "payload_json", ctx);
      return;
    }
    const present = new Set(parsed.data.sections.map((x) => x.key));
    const missing = requiredReportSections(subtype).filter((key) => !present.has(key));
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["payload_json", "sections"],
        message: `a completed ${subtype} report must carry the sections ${missing.join(", ")}`,
      });
    }
    return;
  }
  const parsed = STUDIO_PAYLOAD_SCHEMAS[pluginType].safeParse(payloadJson);
  if (!parsed.success) {
    forwardPrefixedIssues(parsed.error.issues, "payload_json", ctx);
  }
}

export const StudioArtifactSchema = z
  .object({
    id: z.uuid(),
    notebook_id: z.uuid(),
    plugin_type: StudioPluginTypeSchema,
    subtype: StudioSubtypeSchema,
    status: StudioJobStatusSchema,
    title: z.string().min(1),
    params_json: StudioParamsJsonSchema,
    payload_json: z.unknown().nullable(),
    source_revisions_snapshot: z.array(SourceRevisionPairSchema).min(1),
    output_language: z.string().min(1).nullable(),
    progress: StudioProgressSchema.nullable(),
    failure: StudioFailureSchema.nullable(),
    attempt: z.number().int().positive(),
    retry_of: z.uuid().nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    validateStudioArtifactSubtype(artifact.plugin_type, artifact.subtype, ctx);

    if ((artifact.status === "Completed") !== (artifact.payload_json !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["payload_json"],
        message: "payload_json must be present if and only if status is Completed",
      });
    }
    if (artifact.payload_json !== null) {
      validateStudioArtifactPayload(
        artifact.plugin_type,
        artifact.subtype,
        artifact.payload_json,
        ctx,
      );
    }
    const needsFailure = artifact.status === "Failed" || artifact.status === "Cancelled";
    if (needsFailure !== (artifact.failure !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: "failure must be present if and only if status is Failed or Cancelled",
      });
    }
    const ids = artifact.source_revisions_snapshot.map((s) => s.source_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["source_revisions_snapshot"],
        message: "snapshot source IDs must be unique",
      });
    }
  });
export type StudioCombinedPayload = StudioReportPayload &
  Partial<StudioMindmapPayload> &
  Partial<StudioDataTablePayload> &
  Partial<StudioFlashcardsPayload> &
  Partial<StudioQuizPayload> &
  Partial<StudioLearningOverviewPayload> &
  Partial<StudioSlideDeckPayload> &
  Partial<StudioInfographicPayload>;

export interface StudioArtifact {
  id: string;
  notebook_id: string;
  plugin_type: StudioPluginType;
  subtype: StudioSubtype;
  status: StudioJobStatus;
  title: string;
  params_json: StudioParamsJson;
  /** Narrowed by `plugin_type` (`StudioReportPayload` for reports, `StudioMindmapPayload` for mindmaps, `StudioDataTablePayload` for tables); typed permissively so existing report consumers remain compatible. */
  payload_json: StudioCombinedPayload | null;
  source_revisions_snapshot: SourceRevisionPair[];
  output_language: string | null;
  progress: StudioProgress | null;
  failure: StudioFailure | null;
  attempt: number;
  retry_of: string | null;
  created_at: string;
  updated_at: string;
}

const ActiveSourceIdsSchema = z
  .array(z.uuid("source ID must be a valid UUID"))
  .min(1, "active_source_ids must contain at least 1 source ID")
  .refine((ids) => new Set(ids).size === ids.length, "active_source_ids must be unique");

const CreateStudioJobRequestBaseSchema = z
  .object({
    plugin_type: StudioPluginTypeSchema,
    subtype: StudioSubtypeSchema,
    active_source_ids: ActiveSourceIdsSchema,
    custom_prompt: CustomReportPromptSchema.optional(),
    focus_prompt: DataTableFocusPromptSchema.optional(),
    schema_id: DataTableSchemaIdSchema.optional(),
    difficulty: PedagogyDifficultySchema.optional(),
    card_count: FlashcardCountInputSchema.optional(),
    question_count: z.number().int().min(QUIZ_MIN_QUESTIONS).max(QUIZ_MAX_QUESTIONS).optional(),
    section_count: z
      .number()
      .int()
      .min(LEARNING_OVERVIEW_MIN_SECTIONS)
      .max(LEARNING_OVERVIEW_MAX_SECTIONS)
      .optional(),
    slide_count: z.number().int().min(SLIDE_COUNT_MIN).max(SLIDE_COUNT_MAX).optional(),
    style: InfographicStyleSchema.optional(),
    /** FR-UI-02: one of the supported output-language tags; omitted → resolved server-side. */
    output_language: OutputLanguageSchema.optional(),
  })
  .strict();

type RawCreateStudioJobRequest = z.output<typeof CreateStudioJobRequestBaseSchema>;

interface JobFieldFlags {
  hasPedagogyFields: boolean;
  hasVisualFields: boolean;
}

function addCustomIssue(ctx: z.RefinementCtx, path: string[], message: string): void {
  ctx.addIssue({ code: "custom", path, message });
}

function validateReportJobRequest(
  req: RawCreateStudioJobRequest,
  flags: JobFieldFlags,
  ctx: z.RefinementCtx,
): void {
  if (!ReportSubtypeSchema.safeParse(req.subtype).success) {
    addCustomIssue(ctx, ["subtype"], `Unknown report subtype ${req.subtype}`);
  }
  if ((req.subtype === "dynamic" || req.subtype === "custom") && req.custom_prompt === undefined) {
    addCustomIssue(ctx, ["custom_prompt"], `custom_prompt is required for subtype ${req.subtype}`);
  }
  if (
    req.focus_prompt !== undefined ||
    req.schema_id !== undefined ||
    flags.hasPedagogyFields ||
    flags.hasVisualFields
  ) {
    addCustomIssue(
      ctx,
      ["plugin_type"],
      "focus_prompt, schema_id, active-learning, and visual parameters are not valid for report requests",
    );
  }
}

function validateMindmapJobRequest(
  req: RawCreateStudioJobRequest,
  flags: JobFieldFlags,
  ctx: z.RefinementCtx,
): void {
  if (req.subtype !== "default") {
    addCustomIssue(ctx, ["subtype"], `Unknown mindmap subtype ${req.subtype}`);
  }
  if (
    req.custom_prompt !== undefined ||
    req.focus_prompt !== undefined ||
    req.schema_id !== undefined ||
    flags.hasPedagogyFields ||
    flags.hasVisualFields
  ) {
    addCustomIssue(
      ctx,
      ["plugin_type"],
      "mindmap/default accepts no custom_prompt, focus_prompt, schema_id, active-learning, or visual parameters",
    );
  }
}

function validateDataTableJobRequest(
  req: RawCreateStudioJobRequest,
  flags: JobFieldFlags,
  ctx: z.RefinementCtx,
): void {
  if (req.subtype !== "default") {
    addCustomIssue(ctx, ["subtype"], `Unknown data_table subtype ${req.subtype}`);
  }
  if (req.custom_prompt !== undefined || flags.hasPedagogyFields || flags.hasVisualFields) {
    addCustomIssue(
      ctx,
      ["custom_prompt"],
      "data_table/default uses focus_prompt and schema_id only",
    );
  }
}

function validateFocusPromptForPlugin(
  pluginType: StudioPluginType,
  focusPrompt: string,
): PromptValidationResult {
  if (pluginType === STUDIO_SLIDE_DECK_PLUGIN_TYPE) {
    return validateSlideFocusPrompt(focusPrompt);
  }
  if (pluginType === STUDIO_INFOGRAPHIC_PLUGIN_TYPE) {
    return validateInfographicFocusPrompt(focusPrompt);
  }
  return validatePedagogyFocusPrompt(focusPrompt);
}

const DISALLOWED_PARAM_VALIDATORS: Record<
  StudioPluginType,
  (req: RawCreateStudioJobRequest, flags: JobFieldFlags) => string | null
> = {
  [STUDIO_REPORT_PLUGIN_TYPE]: () => null,
  [STUDIO_MINDMAP_PLUGIN_TYPE]: () => null,
  [STUDIO_DATA_TABLE_PLUGIN_TYPE]: () => null,
  [STUDIO_FLASHCARDS_PLUGIN_TYPE]: (req, flags) =>
    req.question_count !== undefined || req.section_count !== undefined || flags.hasVisualFields
      ? "flashcards/default does not accept question_count, section_count, or visual parameters"
      : null,
  [STUDIO_QUIZ_PLUGIN_TYPE]: (req, flags) =>
    req.card_count !== undefined || req.section_count !== undefined || flags.hasVisualFields
      ? "quiz/default does not accept card_count, section_count, or visual parameters"
      : null,
  [STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE]: (req, flags) =>
    req.card_count !== undefined ||
    req.question_count !== undefined ||
    req.difficulty !== undefined ||
    flags.hasVisualFields
      ? "learning_overview/default accepts section_count and focus_prompt only"
      : null,
  [STUDIO_SLIDE_DECK_PLUGIN_TYPE]: (req, flags) =>
    flags.hasPedagogyFields || req.style !== undefined
      ? "slide_deck/default accepts slide_count and focus_prompt only"
      : null,
  [STUDIO_INFOGRAPHIC_PLUGIN_TYPE]: (req, flags) =>
    flags.hasPedagogyFields || req.slide_count !== undefined
      ? "infographic/default accepts style and focus_prompt only"
      : null,
};

function disallowedPluginParamMessage(
  req: RawCreateStudioJobRequest,
  flags: JobFieldFlags,
): string | null {
  return DISALLOWED_PARAM_VALIDATORS[req.plugin_type](req, flags);
}

function validateStandardPluginJobRequest(
  req: RawCreateStudioJobRequest,
  flags: JobFieldFlags,
  ctx: z.RefinementCtx,
): void {
  if (req.subtype !== "default") {
    addCustomIssue(ctx, ["subtype"], `Unknown ${req.plugin_type} subtype ${req.subtype}`);
  }
  if (req.custom_prompt !== undefined || req.schema_id !== undefined) {
    addCustomIssue(
      ctx,
      ["plugin_type"],
      `${req.plugin_type}/default does not accept custom_prompt or schema_id`,
    );
  }
  if (req.focus_prompt !== undefined) {
    const promptCheck = validateFocusPromptForPlugin(req.plugin_type, req.focus_prompt);
    if (!promptCheck.valid) {
      addCustomIssue(ctx, ["focus_prompt"], promptCheck.error ?? "Invalid focus prompt");
    }
  }
  const paramError = disallowedPluginParamMessage(req, flags);
  if (paramError !== null) {
    addCustomIssue(ctx, ["plugin_type"], paramError);
  }
}

export const CreateStudioJobRequestSchema = CreateStudioJobRequestBaseSchema.superRefine(
  (req, ctx) => {
    const flags: JobFieldFlags = {
      hasPedagogyFields:
        req.difficulty !== undefined ||
        req.card_count !== undefined ||
        req.question_count !== undefined ||
        req.section_count !== undefined,
      hasVisualFields: req.slide_count !== undefined || req.style !== undefined,
    };
    if (req.plugin_type === STUDIO_REPORT_PLUGIN_TYPE) {
      validateReportJobRequest(req, flags, ctx);
    } else if (req.plugin_type === STUDIO_MINDMAP_PLUGIN_TYPE) {
      validateMindmapJobRequest(req, flags, ctx);
    } else if (req.plugin_type === STUDIO_DATA_TABLE_PLUGIN_TYPE) {
      validateDataTableJobRequest(req, flags, ctx);
    } else {
      validateStandardPluginJobRequest(req, flags, ctx);
    }
  },
);
export type CreateStudioJobRequest = z.output<typeof CreateStudioJobRequestSchema>;

/** Retry is a fresh, explicitly scoped request (C-03, FR-013). */
export const RetryStudioJobRequestSchema = z
  .object({
    active_source_ids: ActiveSourceIdsSchema,
    output_language: OutputLanguageSchema.optional(),
  })
  .strict();
export type RetryStudioJobRequest = z.output<typeof RetryStudioJobRequestSchema>;

export const ReportSuggestionSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    prompt_template: CustomReportPromptSchema,
  })
  .strict();
export type ReportSuggestion = z.infer<typeof ReportSuggestionSchema>;

export const ReportSuggestionsResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("SuggestionsLoading") }).strict(),
  z
    .object({
      state: z.literal("SuggestionsReady"),
      suggestions: z.array(ReportSuggestionSchema).min(3).max(4),
    })
    .strict(),
  z.object({ state: z.literal("SuggestionsUnavailable"), reason: z.string().min(1) }).strict(),
]);
export type ReportSuggestionsResult = z.infer<typeof ReportSuggestionsResultSchema>;

/** Consumer-side view of Source Guide metadata (FR-SI-02). */
export const SourceGuideStateSchema = z
  .object({
    source_id: z.uuid(),
    revision: z.number().int().positive(),
    status: z.enum(["Pending", "Ready", "Failed"]),
    summary: z.string().optional(),
    key_topics: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type SourceGuideState = z.infer<typeof SourceGuideStateSchema>;

/* ------------------------ Report model outputs (FR-ST-10/11) ------------------------ */

export const REPORT_FINDING_KINDS = [
  "summary",
  "fact",
  "quote",
  "term",
  "event",
  "person",
  "qa",
  "risk",
] as const;
const ModelText = z.string().trim().min(1).max(4000);
const OptionalModelText = ModelText.optional();

/** Map step: chunk-anchored findings of one bounded batch (shape only; chunk membership is checked by the adapter). */
export const ReportExtractOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        kind: z.enum(REPORT_FINDING_KINDS),
        text: ModelText,
        chunk_id: z.string().min(1),
        quote: OptionalModelText,
        date: OptionalModelText,
        question: OptionalModelText,
      }),
    )
    .max(1000),
});
export type ReportExtractOutput = z.infer<typeof ReportExtractOutputSchema>;

/**
 * Reduce-step item: it references a finding by its index; the adapter copies that finding's chunk_id, quote and
 * date, so verbatim evidence cannot be reworded by the model (FR-014, Gate v2.0 #3).
 */
const ReportModelItemSchema = z.object({
  text: ModelText,
  finding: z.number().int().min(0),
  question: OptionalModelText,
});

/** Reduce step: sections keyed by stable section keys with localized headings. */
export const ReportComposeOutputSchema = z.object({
  sections: z
    .array(
      z.object({
        key: z.string().regex(REPORT_SECTION_KEY_PATTERN),
        heading: z.string().trim().min(1).max(200),
        items: z.array(ReportModelItemSchema).max(500),
        table: z
          .object({
            columns: z.array(z.string().min(1)).min(1).max(8),
            rows: z
              .array(z.object({ cells: z.array(z.string()).max(8), chunk_id: z.string().min(1) }))
              .max(200),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type ReportComposeOutput = z.infer<typeof ReportComposeOutputSchema>;

/** Dynamic report suggestions from Source Guides (FR-ST-11): 3–4 validated cards. */
export const ReportSuggestionsOutputSchema = z.object({
  suggestions: z.array(ReportSuggestionSchema).min(3).max(4),
});

/* ------------------------------ C-03 plugin ------------------------------ */

export const StudioGeneratorPluginManifestSchema = z
  .object({
    plugin_type: z.string().min(1),
    display_name: z.string().min(1),
    subtypes: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type StudioGeneratorPluginManifest = z.infer<typeof StudioGeneratorPluginManifestSchema>;

export class StudioParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioParamsError";
  }
}

export interface StudioJobRequest {
  notebook_id: string;
  subtype: string;
  params: {
    custom_prompt?: string | undefined;
    focus_prompt?: string | undefined;
    schema_id?: DataTableSchemaId | undefined;
    difficulty?: PedagogyDifficulty | undefined;
    card_count?: FlashcardCountInput | undefined;
    question_count?: number | undefined;
    section_count?: number | undefined;
    slide_count?: number | undefined;
    style?: InfographicStyle | undefined;
  };
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
}

export interface StudioJobPlan {
  title: string;
  params_json: StudioParamsJson;
}

export interface StudioGenerationContext {
  artifact_id: string;
  notebook_id: string;
  subtype: string;
  params_json: StudioParamsJson;
  snapshot: SourceRevisionPair[];
  /** Chunks obtained exclusively through C-02 getScopedContext. */
  chunks: UnifiedDocumentChunk[];
  /** NFR-PERF-01 / D12: bounded original C-02 pages; legacy arrays remain a compatibility adapter. */
  original_chunks?: AsyncIterable<UnifiedDocumentChunk[]> | undefined;
  cached_context?: string | undefined;
  before_model_call?: (() => Promise<void>) | undefined;
  load_cited_chunks?: ((ids: string[]) => Promise<UnifiedDocumentChunk[]>) | undefined;
  output_language?: string | undefined;
  signal: AbortSignal;
  reportProgress: (stage: StudioProgress["stage"], percent: number) => void;
}

export type StudioGenerationOutcome<TPayload extends StudioPayloadJson = StudioPayloadJson> =
  | { status: "completed"; payload: TPayload }
  | { status: "refused"; code: StudioFailureCode; message: string };

export interface StudioGeneratorPlugin {
  readonly manifest: StudioGeneratorPluginManifest;
  /** Synchronous validation at submission; throws StudioParamsError. */
  triggerJob: (request: StudioJobRequest) => StudioJobPlan;
  generate: (ctx: StudioGenerationContext) => Promise<StudioGenerationOutcome>;
}

export class StudioPluginRegistry {
  private readonly plugins = new Map<string, StudioGeneratorPlugin>();

  register(plugin: StudioGeneratorPlugin): void {
    const manifest = StudioGeneratorPluginManifestSchema.parse(plugin.manifest);
    if (this.plugins.has(manifest.plugin_type)) {
      throw new Error(`Studio plugin ${manifest.plugin_type} is already registered`);
    }
    this.plugins.set(manifest.plugin_type, plugin);
  }

  get(pluginType: string): StudioGeneratorPlugin {
    const plugin = this.plugins.get(pluginType);
    if (!plugin) {
      throw new Error(`Unknown Studio plugin ${pluginType}`);
    }
    return plugin;
  }

  list(): StudioGeneratorPlugin[] {
    return [...this.plugins.values()];
  }
}
