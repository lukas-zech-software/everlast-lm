import {
  FlashcardCountInputSchema,
  FlashcardsSubtypeSchema,
  PedagogyDifficultySchema,
  STUDIO_FLASHCARDS_PLUGIN_TYPE,
  StudioParamsError,
  validatePedagogyFocusPrompt,
  type FlashcardCountInput,
  type PedagogyDifficulty,
  type StudioFlashcardsParams,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicFlashcardsModel, type FlashcardsModelClient } from "./model.ts";
import { generateFlashcards } from "./pipeline.ts";

/**
 * [014-studio-active-learning-suite] T010, T011 — Flashcards Studio generator plugin (`flashcards/default`, FR-ST-13, C-03).
 */
export class FlashcardsGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_FLASHCARDS_PLUGIN_TYPE,
    display_name: "Flashcards",
    subtypes: ["default"],
  };

  private readonly model: FlashcardsModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(model: FlashcardsModelClient = new DeterministicFlashcardsModel(), limits?: EvidenceBatchLimits) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    const parsedSubtype = FlashcardsSubtypeSchema.safeParse(request.subtype);
    if (!parsedSubtype.success) {
      throw new StudioParamsError(`Unknown flashcards subtype ${request.subtype}`);
    }
    let difficulty: PedagogyDifficulty | undefined;
    if (request.params.difficulty !== undefined) {
      const parsedDiff = PedagogyDifficultySchema.safeParse(request.params.difficulty);
      if (!parsedDiff.success) throw new StudioParamsError("Invalid flashcards difficulty.");
      difficulty = parsedDiff.data;
    }
    let cardCount: FlashcardCountInput | undefined;
    if (request.params.card_count !== undefined) {
      const parsedCount = FlashcardCountInputSchema.safeParse(request.params.card_count);
      if (!parsedCount.success) throw new StudioParamsError("Invalid flashcards card_count.");
      cardCount = parsedCount.data;
    }
    let focusPrompt: string | undefined;
    if (request.params.focus_prompt !== undefined) {
      const check = validatePedagogyFocusPrompt(request.params.focus_prompt);
      if (!check.valid) throw new StudioParamsError(check.error ?? "Invalid focus prompt.");
      if (check.normalized) focusPrompt = check.normalized;
    }
    return {
      title: focusPrompt ? `Flashcards: ${focusPrompt.slice(0, 48)}` : "Flashcards",
      params_json: {
        ...(difficulty !== undefined ? { difficulty } : {}),
        ...(cardCount !== undefined ? { card_count: cardCount } : {}),
        ...(focusPrompt !== undefined ? { focus_prompt: focusPrompt } : {}),
      },
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    FlashcardsSubtypeSchema.parse(ctx.subtype);
    const p = ctx.params_json as StudioFlashcardsParams;
    return generateFlashcards({
      chunks: ctx.chunks,
      original_chunks: ctx.original_chunks,
      cached_context: ctx.cached_context,
      before_model_call: ctx.before_model_call,
      load_cited_chunks: ctx.load_cited_chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      difficulty: p.difficulty,
      card_count: p.card_count,
      focus_prompt: p.focus_prompt,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
