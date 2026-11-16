import { z } from "zod";
import { UUID_V7_REGEX, type UnifiedDocumentChunk } from "./document-chunk.ts";
import { OutputLanguageSchema } from "./package-v2-1.ts";
import { StudioParamsError, type PromptValidationResult } from "./package-v2-4.ts";
import {
  STUDIO_NODE_ID_PATTERN,
  StudioCoverageManifestSchema,
  StudioEvidenceRefSchema,
  type StudioEvidenceRef,
} from "./package-v3-3.ts";
import type { SourceRevisionPair } from "./scoped-context.ts";

/**
 * [014-studio-active-learning-suite] T005 — Package 4.1 Studio Active Learning Suite Contracts
 * (FR-ST-13, FR-ST-14, FR-ST-15, FR-ST-12, C-01, C-03, D9).
 *
 * Purity rule (`contracts-only`): imports ONLY `zod` and relative `./...` contract modules.
 */

export const STUDIO_FLASHCARDS_PLUGIN_TYPE = "flashcards" as const;
export const STUDIO_QUIZ_PLUGIN_TYPE = "quiz" as const;
export const STUDIO_LEARNING_OVERVIEW_PLUGIN_TYPE = "learning_overview" as const;

export const PEDAGOGY_FOCUS_PROMPT_MAX = 1000;
export const QUIZ_SHORT_ANSWER_MAX = 1000;

export const FLASHCARD_COUNT_BY_PRESET = {
  fewer: 10,
  standard: 20,
  more: 35,
} as const;
export type FlashcardTargetCount = 10 | 20 | 35;
export const FLASHCARD_MAX_CARDS = 35;

export const QUIZ_MIN_QUESTIONS = 5;
export const QUIZ_MAX_QUESTIONS = 25;
export const QUIZ_DEFAULT_QUESTIONS = 10;

export const LEARNING_OVERVIEW_MIN_SECTIONS = 3;
export const LEARNING_OVERVIEW_MAX_SECTIONS = 6;
export const LEARNING_OVERVIEW_DEFAULT_SECTIONS = 4;

export const FlashcardsSubtypeSchema = z.literal("default");
export type FlashcardsSubtype = z.infer<typeof FlashcardsSubtypeSchema>;

export const QuizSubtypeSchema = z.literal("default");
export type QuizSubtype = z.infer<typeof QuizSubtypeSchema>;

export const LearningOverviewSubtypeSchema = z.literal("default");
export type LearningOverviewSubtype = z.infer<typeof LearningOverviewSubtypeSchema>;

export const PedagogyDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type PedagogyDifficulty = z.infer<typeof PedagogyDifficultySchema>;

export const FlashcardCountPresetSchema = z.enum(["fewer", "standard", "more"]);
export type FlashcardCountPreset = z.infer<typeof FlashcardCountPresetSchema>;

export const FlashcardCountInputSchema = z.union([
  FlashcardCountPresetSchema,
  z.literal(10),
  z.literal(20),
  z.literal(35),
]);
export type FlashcardCountInput = z.infer<typeof FlashcardCountInputSchema>;

export function resolveFlashcardTargetCount(input?: FlashcardCountInput): FlashcardTargetCount {
  if (input === undefined || input === "standard" || input === 20) return 20;
  if (input === "fewer" || input === 10) return 10;
  return 35;
}

/** FR-ST-13 / FR-ST-14 / FR-ST-12: Optional focus prompt is 0..1,000 Unicode code points after outer trim; never truncates. */
export function validatePedagogyFocusPrompt(input: string): PromptValidationResult {
  const trimmed = input.trim();
  const codePoints = Array.from(trimmed).length;
  if (codePoints > PEDAGOGY_FOCUS_PROMPT_MAX) {
    return {
      valid: false,
      codePoints,
      error: `Focus prompt exceeds ${PEDAGOGY_FOCUS_PROMPT_MAX} code points (received ${codePoints}).`,
    };
  }
  return { valid: true, codePoints, normalized: trimmed };
}

export const PedagogyFocusPromptSchema = z.string().transform((value, ctx) => {
  const result = validatePedagogyFocusPrompt(value);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid focus prompt" });
    return z.NEVER;
  }
  return result.normalized as string;
});

/** FR-ST-14: Free-text quiz answer is 1..1,000 Unicode code points after outer trim; rejects empty or >1,000 without truncation. */
export function validateShortAnswerInput(input: string): PromptValidationResult {
  const trimmed = input.trim();
  const codePoints = Array.from(trimmed).length;
  if (codePoints < 1) {
    return { valid: false, codePoints: 0, error: "Answer must not be empty or whitespace only." };
  }
  if (codePoints > QUIZ_SHORT_ANSWER_MAX) {
    return {
      valid: false,
      codePoints,
      error: `Answer exceeds ${QUIZ_SHORT_ANSWER_MAX} code points (received ${codePoints}).`,
    };
  }
  return { valid: true, codePoints, normalized: trimmed };
}

export const QuizShortAnswerInputSchema = z.string().transform((value, ctx) => {
  const result = validateShortAnswerInput(value);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid answer" });
    return z.NEVER;
  }
  return result.normalized as string;
});

const PlainTextNoHtmlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((s) => !/<[A-Za-z!/]/.test(s), "Text must be plain text without HTML markup");

const UniqueSourceIdsSchema = z
  .array(z.string().uuid("source ID must be a valid UUID"))
  .min(1, "active_source_ids must contain at least 1 source ID")
  .refine((ids) => new Set(ids).size === ids.length, "active_source_ids must be unique");

/* ------------------------ Flashcards (FR-ST-13) ------------------------ */

export const FlashcardItemSchema = z
  .object({
    id: z.string().uuid("flashcard id must be a valid UUID"),
    front_text: PlainTextNoHtmlSchema,
    back_text: PlainTextNoHtmlSchema,
    source_chunk_ids: z.array(z.string().regex(UUID_V7_REGEX, "source_chunk_ids must contain UUID v7")).min(1),
    citations: z.array(StudioEvidenceRefSchema).min(1),
  })
  .strict()
  .superRefine((card, ctx) => {
    const chunkSet = new Set(card.source_chunk_ids);
    for (const ref of card.citations) {
      if (!chunkSet.has(ref.chunk_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_chunk_ids"],
          message: `Flashcard ${card.id} citation ${ref.chunk_id} must be listed in source_chunk_ids`,
        });
      }
    }
  });
export type FlashcardItem = z.infer<typeof FlashcardItemSchema>;

export const StudioFlashcardsParamsSchema = z
  .object({
    difficulty: PedagogyDifficultySchema.optional(),
    card_count: FlashcardCountInputSchema.optional(),
    focus_prompt: z.string().optional(),
  })
  .strict();
export type StudioFlashcardsParams = z.infer<typeof StudioFlashcardsParamsSchema>;

export const StudioFlashcardsPayloadSchema = z
  .object({
    cards: z.array(FlashcardItemSchema).min(1).max(FLASHCARD_MAX_CARDS),
    difficulty: PedagogyDifficultySchema,
    target_count: z.union([z.literal(10), z.literal(20), z.literal(35)]),
    insufficient_evidence_note: z.string().trim().min(1).nullable(),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const ids = payload.cards.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cards"], message: "Flashcard IDs must be unique" });
    }
    if (payload.cards.length < payload.target_count && !payload.insufficient_evidence_note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insufficient_evidence_note"],
        message: `Flashcard deck with fewer than ${payload.target_count} cards must include insufficient_evidence_note`,
      });
    }
    const badgeSet = new Set(payload.citations.map((c) => `${c.badge_number}|${c.chunk_id}`));
    for (const card of payload.cards) {
      for (const ref of card.citations) {
        if (!badgeSet.has(`${ref.badge_number}|${ref.chunk_id}`)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["citations"],
            message: `Flashcard ${card.id} references citation ${ref.badge_number} (${ref.chunk_id}) not in payload.citations`,
          });
        }
      }
    }
  });
export type StudioFlashcardsPayload = z.infer<typeof StudioFlashcardsPayloadSchema>;

/* ------------------------ Quizzes (FR-ST-14) ------------------------ */

export const QuizQuestionTypeSchema = z.enum([
  "multiple_choice",
  "multiple_select",
  "fill_in_the_blank",
  "short_answer",
]);
export type QuizQuestionType = z.infer<typeof QuizQuestionTypeSchema>;

export const QuizOptionSchema = z
  .object({
    id: z.string().regex(STUDIO_NODE_ID_PATTERN, "option id must be a 1..64 char identifier"),
    text: PlainTextNoHtmlSchema,
  })
  .strict();
export type QuizOption = z.infer<typeof QuizOptionSchema>;

export const QuizQuestionSchema = z
  .object({
    id: z.string().uuid("question id must be a valid UUID"),
    type: QuizQuestionTypeSchema,
    prompt: PlainTextNoHtmlSchema,
    hint: PlainTextNoHtmlSchema.optional(),
    options: z.array(QuizOptionSchema).min(2).max(8).optional(),
    correct_answer: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]),
    rubric: PlainTextNoHtmlSchema,
    explanation: PlainTextNoHtmlSchema,
    source_chunk_ids: z.array(z.string().regex(UUID_V7_REGEX, "source_chunk_ids must contain UUID v7")).min(1),
    citations: z.array(StudioEvidenceRefSchema).min(1),
  })
  .strict()
  .superRefine((q, ctx) => {
    const chunkSet = new Set(q.source_chunk_ids);
    for (const ref of q.citations) {
      if (!chunkSet.has(ref.chunk_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_chunk_ids"],
          message: `Question ${q.id} citation ${ref.chunk_id} must be listed in source_chunk_ids`,
        });
      }
    }
    if (q.type === "multiple_choice" || q.type === "multiple_select") {
      if (!q.options || q.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: `Question type ${q.type} requires at least 2 options`,
        });
        return;
      }
      const optionIds = q.options.map((o) => o.id);
      if (new Set(optionIds).size !== optionIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Quiz option IDs must be unique" });
      }
      const optionIdSet = new Set(optionIds);
      if (q.type === "multiple_choice") {
        if (typeof q.correct_answer !== "string" || !optionIdSet.has(q.correct_answer)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["correct_answer"],
            message: "multiple_choice correct_answer must match one option id",
          });
        }
      } else {
        if (
          !Array.isArray(q.correct_answer) ||
          q.correct_answer.length === 0 ||
          new Set(q.correct_answer).size !== q.correct_answer.length ||
          q.correct_answer.some((ans) => !optionIdSet.has(ans))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["correct_answer"],
            message: "multiple_select correct_answer must be a unique non-empty array of option ids",
          });
        }
      }
    } else {
      if (q.options !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: `Question type ${q.type} must not include options`,
        });
      }
      if (typeof q.correct_answer !== "string" || q.correct_answer.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correct_answer"],
          message: `Question type ${q.type} requires a non-empty string correct_answer`,
        });
      }
    }
  });
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const StudioQuizParamsSchema = z
  .object({
    question_count: z.number().int().min(QUIZ_MIN_QUESTIONS).max(QUIZ_MAX_QUESTIONS).optional(),
    difficulty: PedagogyDifficultySchema.optional(),
    focus_prompt: z.string().optional(),
  })
  .strict();
export type StudioQuizParams = z.infer<typeof StudioQuizParamsSchema>;

export const StudioQuizPayloadSchema = z
  .object({
    questions: z.array(QuizQuestionSchema).min(1).max(QUIZ_MAX_QUESTIONS),
    target_count: z.number().int().min(QUIZ_MIN_QUESTIONS).max(QUIZ_MAX_QUESTIONS),
    difficulty: PedagogyDifficultySchema,
    insufficient_evidence_note: z.string().trim().min(1).nullable(),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const ids = payload.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["questions"], message: "Quiz question IDs must be unique" });
    }
    if (payload.questions.length < payload.target_count && !payload.insufficient_evidence_note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insufficient_evidence_note"],
        message: `Quiz with fewer than ${payload.target_count} questions must include insufficient_evidence_note`,
      });
    }
    const badgeSet = new Set(payload.citations.map((c) => `${c.badge_number}|${c.chunk_id}`));
    for (const q of payload.questions) {
      for (const ref of q.citations) {
        if (!badgeSet.has(`${ref.badge_number}|${ref.chunk_id}`)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["citations"],
            message: `Question ${q.id} references citation ${ref.badge_number} (${ref.chunk_id}) not in payload.citations`,
          });
        }
      }
    }
  });
export type StudioQuizPayload = z.infer<typeof StudioQuizPayloadSchema>;

/* ------------------------ Learning Progress (FR-ST-15) ------------------------ */

export const LearningItemOutcomeSchema = z.enum(["mastered", "needs_review"]);
export type LearningItemOutcome = z.infer<typeof LearningItemOutcomeSchema>;

export const LearningItemStateSchema = z
  .object({
    status: LearningItemOutcomeSchema,
    attempts: z.number().int().positive(),
    last_reviewed_at: z.string().datetime(),
  })
  .strict();
export type LearningItemState = z.infer<typeof LearningItemStateSchema>;

export const RecordLearningProgressRequestSchema = z
  .object({
    item_id: z.string().uuid("item_id must be a valid UUID"),
    outcome: LearningItemOutcomeSchema,
  })
  .strict();
export type RecordLearningProgressRequest = z.infer<typeof RecordLearningProgressRequestSchema>;

export const ResetLearningProgressRequestSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();
export type ResetLearningProgressRequest = z.infer<typeof ResetLearningProgressRequestSchema>;

export const LearningProgressDtoSchema = z
  .object({
    user_id: z.string().uuid(),
    artifact_id: z.string().uuid(),
    notebook_id: z.string().uuid(),
    item_states_json: z.record(z.string().uuid(), LearningItemStateSchema),
    updated_at: z.string().datetime(),
  })
  .strict();
export type LearningProgressDto = z.infer<typeof LearningProgressDtoSchema>;

/* ------------------------ Quiz Grading & Explain (FR-ST-13 / FR-ST-14) ------------------------ */

export const GradeQuizQuestionRequestSchema = z
  .object({
    question_id: z.string().uuid("question_id must be a valid UUID"),
    answer: z.union([z.string(), z.array(z.string().trim().min(1)).min(1)]),
    active_source_ids: UniqueSourceIdsSchema.optional(),
  })
  .strict();
export type GradeQuizQuestionRequest = z.infer<typeof GradeQuizQuestionRequestSchema>;

export const GradeQuizQuestionResponseSchema = z
  .object({
    question_id: z.string().uuid(),
    correct: z.boolean(),
    outcome: LearningItemOutcomeSchema,
    grading_mode: z.enum(["deterministic", "semantic"]),
    elapsed_ms: z.number().nonnegative(),
    explanation: z.string().min(1),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    progress: LearningProgressDtoSchema,
  })
  .strict();
export type GradeQuizQuestionResponse = z.infer<typeof GradeQuizQuestionResponseSchema>;

export const StudioExplainRequestSchema = z
  .object({
    item_id: z.string().uuid("item_id must be a valid UUID"),
    item_kind: z.enum(["flashcard", "quiz_question"]).optional(),
    active_source_ids: UniqueSourceIdsSchema,
    output_language: OutputLanguageSchema.optional(),
  })
  .strict();
export type StudioExplainRequest = z.infer<typeof StudioExplainRequestSchema>;

export interface StudioExplainResponse {
  prompt: string;
  item_id: string;
  item_kind: "flashcard" | "quiz_question";
  messages: unknown[];
}

/* ------------------------ Deterministic Concept Diagram SVG (FR-ST-12, D9) ------------------------ */

export const ConceptDiagramNodeSchema = z
  .object({
    label: PlainTextNoHtmlSchema,
    detail: PlainTextNoHtmlSchema.optional(),
    badge_numbers: z.array(z.number().int().positive()).min(1),
  })
  .strict();
export type ConceptDiagramNode = z.infer<typeof ConceptDiagramNodeSchema>;

export const ConceptDiagramSpecSchema = z
  .object({
    title: PlainTextNoHtmlSchema,
    nodes: z.array(ConceptDiagramNodeSchema).min(2).max(6),
    footer_label: z.string().trim().min(1).default("AI-generated · Illustration"),
  })
  .strict();
export type ConceptDiagramSpec = z.input<typeof ConceptDiagramSpecSchema>;

function escapeXmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wrapDiagramText(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const wordChars = Array.from(word);
    if (wordChars.length > maxCharsPerLine) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < wordChars.length; i += maxCharsPerLine) {
        lines.push(wordChars.slice(i, i + maxCharsPerLine).join(""));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (Array.from(candidate).length <= maxCharsPerLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * D9 deterministic SVG concept diagram renderer (FR-ST-12):
 * Dynamically wraps labels/details and grows box height so text never clips or overlaps.
 * Emits self-contained allowlisted SVG primitives with zero scripts, events, or external URLs.
 */
export function renderDeterministicConceptDiagramSvg(rawSpec: ConceptDiagramSpec): string {
  const spec = ConceptDiagramSpecSchema.parse(rawSpec);
  const cols = spec.nodes.length >= 4 ? 2 : 1;
  const boxWidth = cols === 2 ? 320 : 620;
  const maxChars = cols === 2 ? 34 : 68;
  const gapX = 24;
  const gapY = 22;
  const padX = 24;
  const headerY = 44;
  const titleLines = wrapDiagramText(spec.title, 64);
  const startY = headerY + titleLines.length * 22 + 16;
  const totalWidth = cols === 2 ? padX * 2 + boxWidth * 2 + gapX : padX * 2 + boxWidth;

  interface LayoutBox {
    x: number;
    y: number;
    w: number;
    h: number;
    titleLines: string[];
    detailLines: string[];
    badges: string;
  }

  const prepared = spec.nodes.map((node) => {
    const tLines = wrapDiagramText(node.label, maxChars);
    const dLines = node.detail ? wrapDiagramText(node.detail, maxChars + 4) : [];
    const badges = node.badge_numbers.map((n) => `[${n}]`).join(" ");
    const h = 16 + tLines.length * 18 + (dLines.length > 0 ? 6 + dLines.length * 16 : 0) + 22 + 14;
    return { tLines, dLines, badges, h };
  });

  const boxes: LayoutBox[] = [];
  let cursorY = startY;
  for (let i = 0; i < prepared.length; i += cols) {
    const rowItems = prepared.slice(i, i + cols);
    const rowHeight = Math.max(...rowItems.map((r) => r.h));
    rowItems.forEach((item, colIdx) => {
      boxes.push({
        x: padX + colIdx * (boxWidth + gapX),
        y: cursorY,
        w: boxWidth,
        h: rowHeight,
        titleLines: item.tLines,
        detailLines: item.dLines,
        badges: item.badges,
      });
    });
    cursorY += rowHeight + gapY;
  }

  const footerText = spec.footer_label.includes("AI-generated")
    ? spec.footer_label
    : `AI-generated · Illustration · ${spec.footer_label}`;
  const footerY = cursorY + 14;
  const totalHeight = footerY + 20;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="${escapeXmlText(spec.title)}">`,
    `<title>${escapeXmlText(spec.title)}</title>`,
    `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>`,
  ];

  titleLines.forEach((line, idx) => {
    parts.push(
      `<text x="${padX}" y="${28 + idx * 22}" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="#0f172a">${escapeXmlText(line)}</text>`
    );
  });

  // Connect consecutive boxes cleanly
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i]!;
    const b = boxes[i + 1]!;
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    if (a.y === b.y) {
      parts.push(
        `<line x1="${a.x + a.w}" y1="${a.y + a.h / 2}" x2="${b.x}" y2="${b.y + b.h / 2}" stroke="#64748b" stroke-width="1.5"/>`
      );
    } else {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5"/>`);
    }
  }

  for (const box of boxes) {
    parts.push(
      `<g>`,
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10" fill="#ffffff" stroke="#94a3b8" stroke-width="1.2"/>`
    );
    let textY = box.y + 24;
    for (const line of box.titleLines) {
      parts.push(
        `<text x="${box.x + 14}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#0f172a">${escapeXmlText(line)}</text>`
      );
      textY += 18;
    }
    if (box.detailLines.length > 0) {
      textY += 4;
      for (const line of box.detailLines) {
        parts.push(
          `<text x="${box.x + 14}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#334155">${escapeXmlText(line)}</text>`
        );
        textY += 16;
      }
    }
    parts.push(
      `<text x="${box.x + 14}" y="${box.y + box.h - 10}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#1d4ed8">${escapeXmlText(box.badges)}</text>`,
      `</g>`
    );
  }

  parts.push(
    `<text x="${padX}" y="${footerY}" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#475569">${escapeXmlText(footerText)}</text>`,
    `</svg>`
  );
  return parts.join("");
}

/** Validates deterministic SVG safety and D9 attribution constraints. */
export function validateSafeDeterministicSvg(svg: string): { valid: boolean; error?: string } {
  const trimmed = svg.trim();
  if (!trimmed.startsWith("<svg") || !trimmed.endsWith("</svg>")) {
    return { valid: false, error: "Diagram SVG must be a valid root <svg>...</svg> document." };
  }
  if (!/viewBox=["']0\s+0\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?["']/.test(trimmed)) {
    return { valid: false, error: "Diagram SVG must specify a positive viewBox." };
  }
  if (/<(?:script|foreignObject|iframe|object|embed)\b/i.test(trimmed)) {
    return { valid: false, error: "Diagram SVG contains forbidden active elements." };
  }
  if (/\bon[a-z]+\s*=/i.test(trimmed)) {
    return { valid: false, error: "Diagram SVG contains forbidden inline event handlers." };
  }
  const sanitizedCheck = trimmed
    .replaceAll('xmlns="http://www.w3.org/2000/svg"', "")
    .replaceAll("xmlns='http://www.w3.org/2000/svg'", "");
  if (/(?:javascript:|data:text\/html|https?:\/\/|(?:xlink:)?href\s*=)/i.test(sanitizedCheck)) {
    return { valid: false, error: "Diagram SVG must not contain external URLs or links." };
  }
  if (!trimmed.includes("AI-generated")) {
    return { valid: false, error: "Diagram SVG must carry an AI-generated illustration label." };
  }
  return { valid: true };
}

/* ------------------------ Learning Overview (FR-ST-12) ------------------------ */

export const LearningOverviewModuleSchema = z
  .object({
    id: z.string().uuid("module id must be a valid UUID"),
    title: PlainTextNoHtmlSchema,
    summary_md: z.string().trim().min(1, "module summary_md must not be empty"),
    diagram_svg: z.string().min(1).superRefine((svg, ctx) => {
      const check = validateSafeDeterministicSvg(svg);
      if (!check.valid) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.error ?? "Invalid diagram_svg" });
      }
    }),
    flashcards: z.array(FlashcardItemSchema).min(1).max(5),
    checkpoint_quiz: z.array(QuizQuestionSchema).min(1).max(4),
    citations: z.array(StudioEvidenceRefSchema).min(1),
  })
  .strict();
export type LearningOverviewModule = z.infer<typeof LearningOverviewModuleSchema>;

export const StudioLearningOverviewParamsSchema = z
  .object({
    section_count: z
      .number()
      .int()
      .min(LEARNING_OVERVIEW_MIN_SECTIONS)
      .max(LEARNING_OVERVIEW_MAX_SECTIONS)
      .optional(),
    focus_prompt: z.string().optional(),
  })
  .strict();
export type StudioLearningOverviewParams = z.infer<typeof StudioLearningOverviewParamsSchema>;

export const StudioLearningOverviewPayloadSchema = z
  .object({
    modules: z.array(LearningOverviewModuleSchema).min(1).max(LEARNING_OVERVIEW_MAX_SECTIONS),
    target_section_count: z.number().int().min(LEARNING_OVERVIEW_MIN_SECTIONS).max(LEARNING_OVERVIEW_MAX_SECTIONS),
    insufficient_evidence_note: z.string().trim().min(1).nullable(),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const modIds = payload.modules.map((m) => m.id);
    if (new Set(modIds).size !== modIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["modules"], message: "Learning overview module IDs must be unique" });
    }
    const itemIds: string[] = [];
    for (const mod of payload.modules) {
      for (const c of mod.flashcards) itemIds.push(c.id);
      for (const q of mod.checkpoint_quiz) itemIds.push(q.id);
    }
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules"],
        message: "Embedded flashcard and quiz question IDs must be globally unique within the overview",
      });
    }
    if (payload.modules.length < payload.target_section_count && !payload.insufficient_evidence_note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insufficient_evidence_note"],
        message: `Learning overview with fewer than ${payload.target_section_count} modules must include insufficient_evidence_note`,
      });
    }
    const badgeSet = new Set(payload.citations.map((c) => `${c.badge_number}|${c.chunk_id}`));
    for (const mod of payload.modules) {
      const refs = [
        ...mod.citations,
        ...mod.flashcards.flatMap((c) => c.citations),
        ...mod.checkpoint_quiz.flatMap((q) => q.citations),
      ];
      for (const ref of refs) {
        if (!badgeSet.has(`${ref.badge_number}|${ref.chunk_id}`)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["citations"],
            message: `Module ${mod.id} references citation ${ref.badge_number} (${ref.chunk_id}) not in payload.citations`,
          });
        }
      }
    }
  });
export type StudioLearningOverviewPayload = z.infer<typeof StudioLearningOverviewPayloadSchema>;


// ---- Shared Active Learning Domain Evaluators & Citation Validators (Package 4.1, CC-09 / NFR-EVAL-02/04) ----

export const MC_GRADING_MAX_ELAPSED_MS = 50;
export const SHORT_ANSWER_GRADING_MAX_ELAPSED_MS = 1500;

/** Verifies every citation badge resolves to an in-snapshot chunk containing the exact snippet (NFR-EVAL-02 / D13). */
export function verifyStudioCitations(
  citations: readonly StudioEvidenceRef[],
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[],
  contextLabel = "Artifact"
): { error: string | null; badgeMap: Map<number, StudioEvidenceRef> } {
  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const chunkById = new Map(chunks.map((c) => [c.chunk_id, c]));
  const badgeMap = new Map<number, StudioEvidenceRef>();
  for (const cite of citations) {
    const chunk = chunkById.get(cite.chunk_id);
    if (!chunk) {
      return { error: `${contextLabel}: citation ${cite.badge_number} (${cite.chunk_id}) does not resolve to a scoped chunk`, badgeMap };
    }
    const expectedRevision = revisions.get(cite.source_id);
    if (expectedRevision !== cite.revision || chunk.source_id !== cite.source_id || chunk.revision !== cite.revision) {
      return { error: `${contextLabel}: citation ${cite.badge_number} does not match the captured source revision snapshot`, badgeMap };
    }
    if (!chunk.text.includes(cite.snippet)) {
      return { error: `${contextLabel}: citation ${cite.badge_number} snippet is not present in the cited chunk`, badgeMap };
    }
    const prev = badgeMap.get(cite.badge_number);
    if (prev && (prev.chunk_id !== cite.chunk_id || prev.snippet !== cite.snippet)) {
      return { error: `Duplicate conflicting citation badge ${cite.badge_number}`, badgeMap };
    }
    badgeMap.set(cite.badge_number, cite);
  }
  return { error: null, badgeMap };
}

export function validateFlashcardsPayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[]
): string | null {
  const parsed = StudioFlashcardsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const deck = parsed.data;
  const payloadCheck = verifyStudioCitations(deck.citations, chunks, snapshot, "Flashcards payload");
  if (payloadCheck.error) return payloadCheck.error;

  for (const card of deck.cards) {
    const cardCheck = verifyStudioCitations(card.citations, chunks, snapshot, `Flashcard ${card.id}`);
    if (cardCheck.error) return cardCheck.error;
  }
  return null;
}

export function validateQuizPayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[]
): string | null {
  const parsed = StudioQuizPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const quiz = parsed.data;
  const payloadCheck = verifyStudioCitations(quiz.citations, chunks, snapshot, "Quiz payload");
  if (payloadCheck.error) return payloadCheck.error;

  for (const q of quiz.questions) {
    const qCheck = verifyStudioCitations(q.citations, chunks, snapshot, `Question ${q.id}`);
    if (qCheck.error) return qCheck.error;
  }
  return null;
}

export function validateLearningOverviewPayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[]
): string | null {
  const parsed = StudioLearningOverviewPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const overview = parsed.data;
  const payloadCheck = verifyStudioCitations(overview.citations, chunks, snapshot, "Learning overview payload");
  if (payloadCheck.error) return payloadCheck.error;

  for (const mod of overview.modules) {
    if (!mod.summary_md.trim() || !/\[\d+\]/.test(mod.summary_md)) {
      return `Module ${mod.id} summary_md is missing inline citations.`;
    }
    for (const match of mod.summary_md.matchAll(/\[(\d+)\]/g)) {
      const badge = Number(match[1]);
      if (!payloadCheck.badgeMap.has(badge)) {
        return `Module ${mod.id} summary references missing citation [${badge}].`;
      }
    }
    const svgCheck = validateSafeDeterministicSvg(mod.diagram_svg);
    if (!svgCheck.valid) {
      return `Module ${mod.id} diagram_svg failed validation: ${svgCheck.error ?? "unsafe SVG"}`;
    }
    if (mod.flashcards.length === 0) {
      return `Module ${mod.id} is missing required embedded flashcards.`;
    }
    if (mod.checkpoint_quiz.length === 0) {
      return `Module ${mod.id} is missing required checkpoint quiz questions.`;
    }
    const modCheck = verifyStudioCitations(mod.citations, chunks, snapshot, `Module ${mod.id}`);
    if (modCheck.error) return modCheck.error;
    for (const card of mod.flashcards) {
      const cardCheck = verifyStudioCitations(card.citations, chunks, snapshot, `Module ${mod.id} card ${card.id}`);
      if (cardCheck.error) return cardCheck.error;
    }
    for (const q of mod.checkpoint_quiz) {
      const qCheck = verifyStudioCitations(q.citations, chunks, snapshot, `Module ${mod.id} question ${q.id}`);
      if (qCheck.error) return qCheck.error;
    }
  }
  return null;
}

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:the\s+)?(?:rubric|previous|all|above|prior|system)\b/i,
  /\bdisregard\s+(?:the\s+)?(?:rubric|previous|all|instructions)\b/i,
  /\boverride\s+(?:the\s+)?(?:grade|rubric|score|evaluation)\b/i,
  /\bmark\s+(?:this|my)?\s*(?:answer|response|submission)?\s*(?:as\s+)?(?:100%\s+)?correct\b/i,
  /\b(?:grade|score)\s+(?:this|me|it)\s+(?:as\s+)?(?:100%|full\s+marks|correct|pass)\b/i,
  /\byou\s+must\s+(?:mark|grade|treat)\s+(?:this|it)\s+as\s+correct\b/i,
  /\bsystem\s+prompt\b/i,
  /\bdeveloper\s+instruction\b/i,
];

export function isPromptInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

const STORAGE_UNIT_FACTORS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1_000,
  kilobyte: 1_000,
  kilobytes: 1_000,
  kib: 1_024,
  mb: 1_000_000,
  megabyte: 1_000_000,
  megabytes: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gigabyte: 1_000_000_000,
  gigabytes: 1_000_000_000,
  gib: 1_073_741_824,
  tb: 1_000_000_000_000,
  terabyte: 1_000_000_000_000,
  terabytes: 1_000_000_000_000,
  tib: 1_099_511_627_776,
};

const TIME_UNIT_FACTORS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

interface NormalizedQuantity {
  dimension: "storage" | "time" | "percent" | "count";
  value: number;
}

function extractQuantities(text: string): NormalizedQuantity[] {
  const out: NormalizedQuantity[] = [];
  const unitRe =
    /(\d+(?:[.,]\d+)?)\s*(terabytes?|tib|tb|gigabytes?|gib|gb|megabytes?|mib|mb|kilobytes?|kib|kb|bytes?|milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|min|hours?|hrs?|h|%)\b/gi;
  for (const m of text.matchAll(unitRe)) {
    const rawNum = Number(m[1]!.replaceAll(",", ""));
    const unit = m[2]!.toLowerCase();
    if (!Number.isFinite(rawNum)) continue;
    if (unit in STORAGE_UNIT_FACTORS) {
      out.push({ dimension: "storage", value: rawNum * STORAGE_UNIT_FACTORS[unit]! });
    } else if (unit in TIME_UNIT_FACTORS) {
      out.push({ dimension: "time", value: rawNum * TIME_UNIT_FACTORS[unit]! });
    } else if (unit === "%") {
      out.push({ dimension: "percent", value: rawNum });
    }
  }
  return out;
}

function quantitiesEquivalent(a: NormalizedQuantity, b: NormalizedQuantity): boolean {
  if (a.dimension !== b.dimension) return false;
  if (a.value === 0 && b.value === 0) return true;
  const max = Math.max(Math.abs(a.value), Math.abs(b.value), 1);
  return Math.abs(a.value - b.value) / max <= 0.01;
}

function normalizeQuizText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUIZ_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "by",
  "must",
  "state",
  "match",
  "matches",
  "or",
  "equivalent",
  "and",
]);

function significantTokens(text: string): string[] {
  return normalizeQuizText(text)
    .split(" ")
    .filter((w) => w.length > 0 && !QUIZ_STOPWORDS.has(w));
}

export function evaluateDeterministicSemantic(
  userAnswer: string,
  expected: string,
  rubric: string
): { matched: boolean; conclusive: boolean } {
  if (isPromptInjectionAttempt(userAnswer)) {
    return { matched: false, conclusive: true };
  }

  const normUser = normalizeQuizText(userAnswer);
  const normExpected = normalizeQuizText(expected);
  if (normUser === normExpected) {
    return { matched: true, conclusive: true };
  }

  const userQuantities = extractQuantities(userAnswer);
  const expectedQuantities = extractQuantities(`${expected} ${rubric}`);
  if (expectedQuantities.length > 0 && userQuantities.length > 0) {
    const allUserMatch = userQuantities.every((uq) =>
      expectedQuantities.some((eq) => quantitiesEquivalent(uq, eq))
    );
    const anyExpectedMatch = expectedQuantities.some((eq) =>
      userQuantities.some((uq) => quantitiesEquivalent(uq, eq))
    );
    if (allUserMatch && anyExpectedMatch) {
      return { matched: true, conclusive: true };
    }
    return { matched: false, conclusive: true };
  }

  const expectedTokens = significantTokens(expected);
  const userTokenSet = new Set(significantTokens(userAnswer));
  if (expectedTokens.length > 0) {
    const overlap = expectedTokens.filter((t) => userTokenSet.has(t)).length;
    const ratio = overlap / expectedTokens.length;
    if (ratio >= 0.8) {
      return { matched: true, conclusive: true };
    }
    if (ratio === 0) {
      return { matched: false, conclusive: false };
    }
  }
  return { matched: false, conclusive: false };
}

export interface DeterministicQuizGradeResult {
  question_id: string;
  correct: boolean;
  outcome: "mastered" | "needs_review";
  grading_mode: "deterministic" | "semantic";
  elapsed_ms: number;
  explanation: string;
  citations: StudioEvidenceRef[];
}

export interface DeterministicQuizGradeEvaluation {
  result: DeterministicQuizGradeResult;
  conclusive: boolean;
  normalizedAnswer?: string | undefined;
  expectedText?: string | undefined;
}

function nowMs(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

export function gradeQuizQuestionDeterministic(
  question: QuizQuestion,
  answer: string | string[]
): DeterministicQuizGradeEvaluation {
  const started = nowMs();

  if (question.type === "multiple_choice") {
    const chosen = Array.isArray(answer) ? (answer.length === 1 ? answer[0] : "") : answer.trim();
    if (!chosen) {
      throw new StudioParamsError("Please select one option.");
    }
    const correct = typeof question.correct_answer === "string" && chosen === question.correct_answer;
    const elapsed_ms = Math.max(0, Number((nowMs() - started).toFixed(2)));
    return {
      conclusive: true,
      result: {
        question_id: question.id,
        correct,
        outcome: correct ? "mastered" : "needs_review",
        grading_mode: "deterministic",
        elapsed_ms,
        explanation: question.explanation,
        citations: question.citations,
      },
    };
  }

  if (question.type === "multiple_select") {
    const chosen = Array.isArray(answer)
      ? [...new Set(answer.map((s) => s.trim()).filter(Boolean))]
      : [answer.trim()].filter(Boolean);
    if (chosen.length === 0) {
      throw new StudioParamsError("Please select at least one option.");
    }
    const expected = Array.isArray(question.correct_answer) ? [...new Set(question.correct_answer)] : [question.correct_answer];
    const correct = chosen.length === expected.length && expected.every((optId) => chosen.includes(optId));
    const elapsed_ms = Math.max(0, Number((nowMs() - started).toFixed(2)));
    return {
      conclusive: true,
      result: {
        question_id: question.id,
        correct,
        outcome: correct ? "mastered" : "needs_review",
        grading_mode: "deterministic",
        elapsed_ms,
        explanation: question.explanation,
        citations: question.citations,
      },
    };
  }

  if (Array.isArray(answer)) {
    throw new StudioParamsError("Free-text answers must be submitted as a string.");
  }
  const textCheck = validateShortAnswerInput(answer);
  if (!textCheck.valid || !textCheck.normalized) {
    throw new StudioParamsError(textCheck.error ?? "Invalid answer.");
  }
  const normalizedAnswer = textCheck.normalized;
  const expectedText = Array.isArray(question.correct_answer) ? question.correct_answer.join(", ") : question.correct_answer;
  const det = evaluateDeterministicSemantic(normalizedAnswer, expectedText, question.rubric);
  const elapsed_ms = Math.max(0, Number((nowMs() - started).toFixed(2)));
  return {
    conclusive: det.conclusive,
    normalizedAnswer,
    expectedText,
    result: {
      question_id: question.id,
      correct: det.matched,
      outcome: det.matched ? "mastered" : "needs_review",
      grading_mode: "semantic",
      elapsed_ms,
      explanation: question.explanation,
      citations: question.citations,
    },
  };
}

/** Verifies every supporting (source_id, revision) cited by an Explain item is present in S_aktiv (Gate v4.0 #1 / C-02). */
export function verifyExplainSupportingSources(
  citations: readonly Pick<StudioEvidenceRef, "source_id" | "revision">[],
  snapshot: readonly SourceRevisionPair[]
): { ok: true } | { ok: false; missingSources: string[] } {
  const requiredBySource = new Map<string, number>();
  for (const cite of citations) {
    requiredBySource.set(cite.source_id, cite.revision);
  }
  const activeRevisionBySource = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const missingSources: string[] = [];
  for (const [sourceId, requiredRev] of requiredBySource.entries()) {
    const activeRev = activeRevisionBySource.get(sourceId);
    if (activeRev === undefined || activeRev !== requiredRev) {
      missingSources.push(sourceId);
    }
  }
  if (missingSources.length > 0) {
    return { ok: false, missingSources };
  }
  return { ok: true };
}
