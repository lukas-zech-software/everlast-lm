import {
  SLIDE_COUNT_MAX,
  SLIDE_COUNT_MIN,
  STUDIO_SLIDE_DECK_PLUGIN_TYPE,
  StudioParamsError,
  validateSlideFocusPrompt,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
  type StudioSlideDeckParams,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicSlideDeckModel, type SlideDeckModelClient } from "./model.ts";
import { generateSlideDeck } from "./pipeline.ts";

/**
 * [015-studio-visuals-presentations] T011 — Slide Deck Studio generator plugin (`slide_deck/default`, FR-ST-16, C-03).
 */
export class SlideDeckGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_SLIDE_DECK_PLUGIN_TYPE,
    display_name: "Slide Deck",
    subtypes: ["default"],
  };

  private readonly model: SlideDeckModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(
    model: SlideDeckModelClient = new DeterministicSlideDeckModel(),
    limits?: EvidenceBatchLimits,
  ) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    if (request.subtype !== "default") {
      throw new StudioParamsError(`Unknown slide_deck subtype ${request.subtype}`);
    }
    let slideCount: number | undefined;
    if (request.params.slide_count !== undefined) {
      const count = request.params.slide_count;
      if (
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < SLIDE_COUNT_MIN ||
        count > SLIDE_COUNT_MAX
      ) {
        throw new StudioParamsError(
          `Slide count must be an integer between ${SLIDE_COUNT_MIN} and ${SLIDE_COUNT_MAX}.`,
        );
      }
      slideCount = count;
    }
    let focusPrompt: string | undefined;
    if (request.params.focus_prompt !== undefined) {
      const check = validateSlideFocusPrompt(request.params.focus_prompt);
      if (!check.valid)
        throw new StudioParamsError(check.error ?? "Invalid slide deck focus prompt.");
      if (check.normalized) focusPrompt = check.normalized;
    }
    return {
      title: focusPrompt ? `Slide Deck: ${focusPrompt.slice(0, 48)}` : "Slide Deck",
      params_json: {
        ...(slideCount === undefined ? {} : { slide_count: slideCount }),
        ...(focusPrompt === undefined ? {} : { focus_prompt: focusPrompt }),
      },
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    if (ctx.subtype !== "default") {
      throw new StudioParamsError(`Unknown slide_deck subtype ${ctx.subtype}`);
    }
    const p = ctx.params_json as StudioSlideDeckParams;
    return generateSlideDeck({
      chunks: ctx.chunks,
      original_chunks: ctx.original_chunks,
      cached_context: ctx.cached_context,
      before_model_call: ctx.before_model_call,
      load_cited_chunks: ctx.load_cited_chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      slide_count: p.slide_count,
      focus_prompt: p.focus_prompt,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
