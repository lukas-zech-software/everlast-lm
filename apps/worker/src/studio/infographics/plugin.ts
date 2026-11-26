import {
  InfographicStyleSchema,
  STUDIO_INFOGRAPHIC_PLUGIN_TYPE,
  StudioParamsError,
  validateInfographicFocusPrompt,
  type InfographicStyle,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioInfographicParams,
  type StudioJobPlan,
  type StudioJobRequest,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicInfographicModel, type InfographicModelClient } from "./model.ts";
import { generateInfographic } from "./pipeline.ts";

/**
 * [015-studio-visuals-presentations] T018 — Visual Infographic Studio generator plugin (`infographic/default`, FR-ST-17, D9, C-03).
 */
export class InfographicGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_INFOGRAPHIC_PLUGIN_TYPE,
    display_name: "Infographic",
    subtypes: ["default"],
  };

  private readonly model: InfographicModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(
    model: InfographicModelClient = new DeterministicInfographicModel(),
    limits?: EvidenceBatchLimits,
  ) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    if (request.subtype !== "default") {
      throw new StudioParamsError(`Unknown infographic subtype ${request.subtype}`);
    }
    let style: InfographicStyle | undefined;
    if (request.params.style !== undefined) {
      const parsedStyle = InfographicStyleSchema.safeParse(request.params.style);
      if (!parsedStyle.success) throw new StudioParamsError("Invalid infographic style.");
      style = parsedStyle.data;
    }
    let focusPrompt: string | undefined;
    if (request.params.focus_prompt !== undefined) {
      const check = validateInfographicFocusPrompt(request.params.focus_prompt);
      if (!check.valid)
        throw new StudioParamsError(check.error ?? "Invalid infographic focus prompt.");
      if (check.normalized) focusPrompt = check.normalized;
    }
    return {
      title: focusPrompt ? `Infographic: ${focusPrompt.slice(0, 48)}` : "Infographic",
      params_json: {
        ...(style === undefined ? {} : { style }),
        ...(focusPrompt === undefined ? {} : { focus_prompt: focusPrompt }),
      },
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    if (ctx.subtype !== "default") {
      throw new StudioParamsError(`Unknown infographic subtype ${ctx.subtype}`);
    }
    const p = ctx.params_json as StudioInfographicParams;
    return generateInfographic({
      chunks: ctx.chunks,
      original_chunks: ctx.original_chunks,
      cached_context: ctx.cached_context,
      before_model_call: ctx.before_model_call,
      load_cited_chunks: ctx.load_cited_chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      style: p.style,
      focus_prompt: p.focus_prompt,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
