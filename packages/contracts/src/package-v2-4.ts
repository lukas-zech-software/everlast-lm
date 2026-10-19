import { z } from "zod";
import { UUID_V7_REGEX, type UnifiedDocumentChunk } from "./document-chunk.js";
import { SourceRevisionPairSchema, type SourceRevisionPair } from "./scoped-context.js";

/**
 * Package 2.4 — Studio Text Synthesis & Reports (FR-ST-10, FR-ST-11, C-02, C-03).
 * Defines C-03 StudioGeneratorPlugin, the StudioPluginRegistry and report DTOs once (D2).
 */

export const STUDIO_REPORT_PLUGIN_TYPE = "report" as const;
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

export const StudioJobStatusSchema = z.enum(["Queued", "Running", "Completed", "Failed", "Cancelled"]);
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
  const codePoints = Array.from(trimmed).length;
  if (codePoints < 1) {
    return { valid: false, codePoints: 0, error: "Report prompt must not be empty or whitespace only." };
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
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid report prompt" });
    return z.NEVER;
  }
  return result.normalized as string;
});

export const ReportCitationSchema = z
  .object({
    badge_number: z.number().int().positive(),
    chunk_id: z.string().regex(UUID_V7_REGEX, "chunk_id must be a valid UUID v7"),
    source_id: z.string().uuid(),
    revision: z.number().int().positive(),
    snippet: z.string().min(1),
  })
  .strict();
export type ReportCitation = z.infer<typeof ReportCitationSchema>;

export const StudioReportPayloadSchema = z
  .object({
    content_md: z.string().min(1),
    citations: z.array(ReportCitationSchema).min(1, "A completed report must carry at least one citation"),
  })
  .strict();
export type StudioReportPayload = z.infer<typeof StudioReportPayloadSchema>;

export const StudioReportParamsSchema = z.object({ custom_prompt: z.string().optional() }).strict();
export type StudioReportParams = z.infer<typeof StudioReportParamsSchema>;

export const StudioArtifactSchema = z
  .object({
    id: z.string().uuid(),
    notebook_id: z.string().uuid(),
    plugin_type: z.literal(STUDIO_REPORT_PLUGIN_TYPE),
    subtype: ReportSubtypeSchema,
    status: StudioJobStatusSchema,
    title: z.string().min(1),
    params_json: StudioReportParamsSchema,
    payload_json: StudioReportPayloadSchema.nullable(),
    active_source_ids_snapshot: z.array(SourceRevisionPairSchema).min(1),
    output_language: z.string().min(1).nullable(),
    progress: StudioProgressSchema.nullable(),
    failure: StudioFailureSchema.nullable(),
    attempt: z.number().int().positive(),
    retry_of: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if ((artifact.status === "Completed") !== (artifact.payload_json !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload_json"],
        message: "payload_json must be present if and only if status is Completed",
      });
    }
    const needsFailure = artifact.status === "Failed" || artifact.status === "Cancelled";
    if (needsFailure !== (artifact.failure !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "failure must be present if and only if status is Failed or Cancelled",
      });
    }
    const ids = artifact.active_source_ids_snapshot.map((s) => s.source_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["active_source_ids_snapshot"],
        message: "snapshot source IDs must be unique",
      });
    }
  });
export type StudioArtifact = z.infer<typeof StudioArtifactSchema>;

const ActiveSourceIdsSchema = z
  .array(z.string().uuid("source ID must be a valid UUID"))
  .min(1, "active_source_ids must contain at least 1 source ID")
  .refine((ids) => new Set(ids).size === ids.length, "active_source_ids must be unique");

export const CreateStudioJobRequestSchema = z
  .object({
    plugin_type: z.literal(STUDIO_REPORT_PLUGIN_TYPE),
    subtype: ReportSubtypeSchema,
    active_source_ids: ActiveSourceIdsSchema,
    custom_prompt: CustomReportPromptSchema.optional(),
    output_language: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((req, ctx) => {
    if ((req.subtype === "dynamic" || req.subtype === "custom") && req.custom_prompt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom_prompt"],
        message: `custom_prompt is required for subtype ${req.subtype}`,
      });
    }
  });
export type CreateStudioJobRequest = z.output<typeof CreateStudioJobRequestSchema>;

/** Retry is a fresh, explicitly scoped request (C-03, FR-013). */
export const RetryStudioJobRequestSchema = z
  .object({ active_source_ids: ActiveSourceIdsSchema, output_language: z.string().min(1).optional() })
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
    .object({ state: z.literal("SuggestionsReady"), suggestions: z.array(ReportSuggestionSchema).min(3).max(4) })
    .strict(),
  z.object({ state: z.literal("SuggestionsUnavailable"), reason: z.string().min(1) }).strict(),
]);
export type ReportSuggestionsResult = z.infer<typeof ReportSuggestionsResultSchema>;

/** Consumer-side view of Source Guide metadata (FR-SI-02). */
export const SourceGuideStateSchema = z
  .object({
    source_id: z.string().uuid(),
    revision: z.number().int().positive(),
    status: z.enum(["Pending", "Ready", "Failed"]),
    summary: z.string().optional(),
    key_topics: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type SourceGuideState = z.infer<typeof SourceGuideStateSchema>;

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
  params: { custom_prompt?: string | undefined };
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
}

export interface StudioJobPlan {
  title: string;
  params_json: StudioReportParams;
}

export interface StudioGenerationContext {
  artifact_id: string;
  notebook_id: string;
  subtype: string;
  params_json: StudioReportParams;
  snapshot: SourceRevisionPair[];
  /** Chunks obtained exclusively through C-02 getScopedContext. */
  chunks: UnifiedDocumentChunk[];
  output_language?: string | undefined;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

export type StudioGenerationOutcome =
  | { status: "completed"; payload: StudioReportPayload }
  | { status: "refused"; code: StudioFailureCode; message: string };

export interface StudioGeneratorPlugin {
  readonly manifest: StudioGeneratorPluginManifest;
  /** Synchronous validation at submission; throws StudioParamsError. */
  triggerJob(request: StudioJobRequest): StudioJobPlan;
  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome>;
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
