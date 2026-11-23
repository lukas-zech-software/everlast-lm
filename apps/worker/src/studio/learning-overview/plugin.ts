import {
  LEARNING_OVERVIEW_MAX_SECTIONS,
  LEARNING_OVERVIEW_MIN_SECTIONS,
  LearningOverviewSubtypeSchema,
  STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE,
  StudioParamsError,
  validatePedagogyFocusPrompt,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
  type StudioLearningOverviewParams,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicLearningOverviewModel, type LearningOverviewModelClient } from "./model.ts";
import { generateLearningOverview } from "./pipeline.ts";

/**
 * [014-studio-active-learning-suite] T027 — Learning Overview Studio generator plugin (`learning_overview/default`, FR-ST-12, C-03).
 */
export class LearningOverviewGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE,
    display_name: "Learning Overview",
    subtypes: ["default"],
  };

  private readonly model: LearningOverviewModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(
    model: LearningOverviewModelClient = new DeterministicLearningOverviewModel(),
    limits?: EvidenceBatchLimits
  ) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    const parsedSubtype = LearningOverviewSubtypeSchema.safeParse(request.subtype);
    if (!parsedSubtype.success) {
      throw new StudioParamsError(`Unknown learning_overview subtype ${request.subtype}`);
    }
    let sectionCount: number | undefined;
    if (request.params.section_count !== undefined) {
      const s = request.params.section_count;
      if (!Number.isInteger(s) || s < LEARNING_OVERVIEW_MIN_SECTIONS || s > LEARNING_OVERVIEW_MAX_SECTIONS) {
        throw new StudioParamsError(
          `Learning Overview section_count must be an integer between ${LEARNING_OVERVIEW_MIN_SECTIONS} and ${LEARNING_OVERVIEW_MAX_SECTIONS}.`
        );
      }
      sectionCount = s;
    }
    let focusPrompt: string | undefined;
    if (request.params.focus_prompt !== undefined) {
      const check = validatePedagogyFocusPrompt(request.params.focus_prompt);
      if (!check.valid) throw new StudioParamsError(check.error ?? "Invalid focus prompt.");
      if (check.normalized) focusPrompt = check.normalized;
    }
    return {
      title: focusPrompt ? `Learning Overview: ${focusPrompt.slice(0, 40)}` : "Learning Overview",
      params_json: {
        ...(sectionCount !== undefined ? { section_count: sectionCount } : {}),
        ...(focusPrompt !== undefined ? { focus_prompt: focusPrompt } : {}),
      },
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    LearningOverviewSubtypeSchema.parse(ctx.subtype);
    const p = ctx.params_json as StudioLearningOverviewParams;
    return generateLearningOverview({
      chunks: ctx.chunks,
      original_chunks: ctx.original_chunks,
      cached_context: ctx.cached_context,
      before_model_call: ctx.before_model_call,
      load_cited_chunks: ctx.load_cited_chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      section_count: p.section_count,
      focus_prompt: p.focus_prompt,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
