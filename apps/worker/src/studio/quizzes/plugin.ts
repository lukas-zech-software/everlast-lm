import {
  PedagogyDifficultySchema,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QuizSubtypeSchema,
  STUDIO_QUIZ_PLUGIN_TYPE,
  StudioParamsError,
  validatePedagogyFocusPrompt,
  type PedagogyDifficulty,
  type StudioGenerationContext,
  type StudioGenerationOutcome,
  type StudioGeneratorPlugin,
  type StudioJobPlan,
  type StudioJobRequest,
  type StudioQuizParams,
} from "@everlast/contracts";
import type { EvidenceBatchLimits } from "../evidence.ts";
import { DeterministicQuizModel, type QuizModelClient } from "./model.ts";
import { generateQuiz } from "./pipeline.ts";

/**
 * [014-studio-active-learning-suite] T017 — Quiz Studio generator plugin (`quiz/default`, FR-ST-14, C-03).
 */
export class QuizGeneratorPlugin implements StudioGeneratorPlugin {
  readonly manifest = {
    plugin_type: STUDIO_QUIZ_PLUGIN_TYPE,
    display_name: "Quiz",
    subtypes: ["default"],
  };

  private readonly model: QuizModelClient;
  private readonly limits?: EvidenceBatchLimits | undefined;

  constructor(model: QuizModelClient = new DeterministicQuizModel(), limits?: EvidenceBatchLimits) {
    this.model = model;
    this.limits = limits;
  }

  triggerJob(request: StudioJobRequest): StudioJobPlan {
    const parsedSubtype = QuizSubtypeSchema.safeParse(request.subtype);
    if (!parsedSubtype.success) {
      throw new StudioParamsError(`Unknown quiz subtype ${request.subtype}`);
    }
    let difficulty: PedagogyDifficulty | undefined;
    if (request.params.difficulty !== undefined) {
      const parsedDiff = PedagogyDifficultySchema.safeParse(request.params.difficulty);
      if (!parsedDiff.success) throw new StudioParamsError("Invalid quiz difficulty.");
      difficulty = parsedDiff.data;
    }
    let questionCount: number | undefined;
    if (request.params.question_count !== undefined) {
      const q = request.params.question_count;
      if (!Number.isInteger(q) || q < QUIZ_MIN_QUESTIONS || q > QUIZ_MAX_QUESTIONS) {
        throw new StudioParamsError(`Quiz question_count must be an integer between ${QUIZ_MIN_QUESTIONS} and ${QUIZ_MAX_QUESTIONS}.`);
      }
      questionCount = q;
    }
    let focusPrompt: string | undefined;
    if (request.params.focus_prompt !== undefined) {
      const check = validatePedagogyFocusPrompt(request.params.focus_prompt);
      if (!check.valid) throw new StudioParamsError(check.error ?? "Invalid focus prompt.");
      if (check.normalized) focusPrompt = check.normalized;
    }
    return {
      title: focusPrompt ? `Quiz: ${focusPrompt.slice(0, 48)}` : "Quiz",
      params_json: {
        ...(difficulty !== undefined ? { difficulty } : {}),
        ...(questionCount !== undefined ? { question_count: questionCount } : {}),
        ...(focusPrompt !== undefined ? { focus_prompt: focusPrompt } : {}),
      },
    };
  }

  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome> {
    QuizSubtypeSchema.parse(ctx.subtype);
    const p = ctx.params_json as StudioQuizParams;
    return generateQuiz({
      chunks: ctx.chunks,
      original_chunks: ctx.original_chunks,
      cached_context: ctx.cached_context,
      before_model_call: ctx.before_model_call,
      load_cited_chunks: ctx.load_cited_chunks,
      snapshot: ctx.snapshot,
      model: this.model,
      question_count: p.question_count,
      difficulty: p.difficulty,
      focus_prompt: p.focus_prompt,
      output_language: ctx.output_language,
      ...(this.limits ? { limits: this.limits } : {}),
      signal: ctx.signal,
      reportProgress: ctx.reportProgress,
    });
  }
}
