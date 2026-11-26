import { z } from "zod";
import { UUID_V7_REGEX, type UnifiedDocumentChunk } from "./document-chunk.ts";
import type { PromptValidationResult } from "./package-v2-4.ts";
import {
  STUDIO_NODE_ID_PATTERN,
  StudioCoverageManifestSchema,
  StudioEvidenceRefSchema,
} from "./package-v3-3.ts";
import {
  escapeXmlText,
  validateSafeDeterministicSvg,
  verifyStudioCitations,
  wrapDiagramText,
} from "./package-v4-1.ts";
import type { SourceRevisionPair } from "./scoped-context.ts";
import { countCodePoints, countWords, toCodePoints } from "./text-limits.ts";

/**
 * [015-studio-visuals-presentations] T005 — Package 4.2 Studio Visuals & Presentations Contracts
 * (FR-ST-16, FR-ST-17, C-01, C-03, D8/DEV-02, D9, Gate v4.0 #3).
 *
 * Purity rule (`contracts-only`): imports ONLY `zod` and relative `./...` contract modules.
 */

export { STUDIO_INFOGRAPHIC_PLUGIN_TYPE, STUDIO_SLIDE_DECK_PLUGIN_TYPE } from "./package-v3-3.ts";

export const SLIDE_COUNT_MIN = 5;
export const SLIDE_COUNT_MAX = 20;
export const SLIDE_COUNT_DEFAULT = 10;
export const SLIDE_FOCUS_PROMPT_MAX = 2000;
export const SLIDE_MAX_BULLETS = 5;
export const SLIDE_MAX_BULLET_WORDS = 15;

export const INFOGRAPHIC_FOCUS_PROMPT_MAX = 1000;

export const SlideDeckSubtypeSchema = z.literal("default");
export type SlideDeckSubtype = z.infer<typeof SlideDeckSubtypeSchema>;

export const InfographicSubtypeSchema = z.literal("default");
export type InfographicSubtype = z.infer<typeof InfographicSubtypeSchema>;

export const SlideLayoutTypeSchema = z.enum([
  "title",
  "two_column",
  "key_metric_callout",
  "comparison_table",
  "diagram_chart",
]);
export type SlideLayoutType = z.infer<typeof SlideLayoutTypeSchema>;

export const InfographicStyleSchema = z.enum([
  "auto",
  "process_flow",
  "comparison",
  "metrics_summary",
  "architecture_diagram",
]);
export type InfographicStyle = z.infer<typeof InfographicStyleSchema>;

export const InfographicResolvedStyleSchema = z.enum([
  "process_flow",
  "comparison",
  "metrics_summary",
  "architecture_diagram",
]);
export type InfographicResolvedStyle = z.infer<typeof InfographicResolvedStyleSchema>;

const PlainTextNoHtmlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((s) => !/<[A-Za-z!/]/.test(s), "Text must be plain text without HTML markup");

function validateCodePointPrompt(
  input: string,
  maxCodePoints: number,
  label: string,
): PromptValidationResult {
  const trimmed = input.trim();
  const codePoints = countCodePoints(trimmed);
  if (codePoints > maxCodePoints) {
    return {
      valid: false,
      codePoints,
      error: `${label} exceeds ${maxCodePoints} code points (received ${codePoints}).`,
    };
  }
  return { valid: true, codePoints, normalized: trimmed };
}

/** FR-ST-16: Optional focus prompt is 0..2,000 trimmed Unicode code points; never truncates. */
export function validateSlideFocusPrompt(input: string): PromptValidationResult {
  return validateCodePointPrompt(input, SLIDE_FOCUS_PROMPT_MAX, "Slide deck focus prompt");
}

/** FR-ST-17: Optional focus prompt is 0..1,000 trimmed Unicode code points; never truncates. */
export function validateInfographicFocusPrompt(input: string): PromptValidationResult {
  return validateCodePointPrompt(input, INFOGRAPHIC_FOCUS_PROMPT_MAX, "Infographic focus prompt");
}

function isHtmlTagStartChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "!" || ch === "/";
}

function stripAngleMarkupPass(current: string): { next: string; changed: boolean } {
  let changed = false;
  const parts: string[] = [];
  let lastCopied = 0;
  let i = 0;
  while (i < current.length) {
    if (current[i] === "<" && isHtmlTagStartChar(current[i + 1])) {
      if (i > lastCopied) {
        parts.push(current.slice(lastCopied, i));
      }
      parts.push(" ");
      const close = current.indexOf(">", i + 1);
      i = close === -1 ? i + 1 : close + 1;
      lastCopied = i;
      changed = true;
      continue;
    }
    i += 1;
  }
  if (!changed) {
    return { next: current, changed: false };
  }
  if (lastCopied < current.length) {
    parts.push(current.slice(lastCopied));
  }
  return { next: parts.join(""), changed: true };
}

/** Linear character scanner that removes `<[A-Za-z!/]...>` markup without regex sanitization pitfalls. */
function stripAngleMarkup(text: string): string {
  let current = text;
  let changed = true;
  while (changed) {
    const pass = stripAngleMarkupPass(current);
    current = pass.next;
    changed = pass.changed;
  }
  return current.replace(/\s+/g, " ").trim();
}

export function enforceSlideBulletLimit(
  rawBullets: readonly string[],
  baseSpeakerNotes: string,
): { bullets: string[]; speaker_notes: string } {
  const cleaned = rawBullets.map((b) => stripAngleMarkup(b)).filter(Boolean);
  const kept: string[] = [];
  const overflow: string[] = [];

  for (const bullet of cleaned) {
    const words = bullet.split(/\s+/).filter(Boolean);
    if (kept.length >= SLIDE_MAX_BULLETS) {
      overflow.push(bullet);
      continue;
    }
    if (words.length <= SLIDE_MAX_BULLET_WORDS) {
      kept.push(bullet);
    } else {
      const head = words.slice(0, SLIDE_MAX_BULLET_WORDS).join(" ");
      kept.push(head);
      overflow.push(bullet);
    }
  }

  const base = stripAngleMarkup(baseSpeakerNotes);
  const notesParts = [base, ...overflow].filter(Boolean);
  const finalBullets =
    kept.length > 0
      ? kept
      : [
          base
            ? base.split(/\s+/).slice(0, SLIDE_MAX_BULLET_WORDS).join(" ")
            : "Key grounded takeaway",
        ];
  const speaker_notes = notesParts.length > 0 ? notesParts.join(" ") : finalBullets.join(" ");
  return { bullets: finalBullets, speaker_notes };
}

/* ------------------------ Slide Deck Contracts (FR-ST-16) ------------------------ */

export const SlideVisualSpecSchema = z
  .object({
    layout: SlideLayoutTypeSchema,
    subtitle: PlainTextNoHtmlSchema.optional(),
    callout: z
      .object({
        value: PlainTextNoHtmlSchema,
        label: PlainTextNoHtmlSchema,
        context: PlainTextNoHtmlSchema.optional(),
      })
      .strict()
      .optional(),
    columns: z
      .object({
        left_heading: PlainTextNoHtmlSchema,
        left_points: z.array(PlainTextNoHtmlSchema).min(1).max(4),
        right_heading: PlainTextNoHtmlSchema,
        right_points: z.array(PlainTextNoHtmlSchema).min(1).max(4),
      })
      .strict()
      .optional(),
    table: z
      .object({
        headers: z.array(PlainTextNoHtmlSchema).min(2).max(5),
        rows: z.array(z.array(PlainTextNoHtmlSchema).min(2).max(5)).min(1).max(6),
      })
      .strict()
      .optional(),
    diagram_steps: z.array(PlainTextNoHtmlSchema).min(2).max(6).optional(),
  })
  .strict();
export type SlideVisualSpec = z.infer<typeof SlideVisualSpecSchema>;

export const SlideItemSchema = z
  .object({
    slide_number: z.number().int().positive(),
    layout: SlideLayoutTypeSchema,
    title: PlainTextNoHtmlSchema,
    bullets: z
      .array(
        PlainTextNoHtmlSchema.refine(
          (b) => countWords(b) <= SLIDE_MAX_BULLET_WORDS,
          `Slide bullet must not exceed ${SLIDE_MAX_BULLET_WORDS} words`,
        ),
      )
      .min(1)
      .max(SLIDE_MAX_BULLETS),
    visual_spec: SlideVisualSpecSchema,
    speaker_notes: PlainTextNoHtmlSchema,
    source_chunk_ids: z
      .array(z.string().regex(UUID_V7_REGEX, "source_chunk_ids must contain UUID v7"))
      .min(1),
    citations: z.array(StudioEvidenceRefSchema).min(1),
  })
  .strict()
  .superRefine((slide, ctx) => {
    if (slide.visual_spec.layout !== slide.layout) {
      ctx.addIssue({
        code: "custom",
        path: ["visual_spec", "layout"],
        message: `Slide ${slide.slide_number} visual_spec.layout (${slide.visual_spec.layout}) must match slide.layout (${slide.layout})`,
      });
    }
    const chunkSet = new Set(slide.source_chunk_ids);
    for (const ref of slide.citations) {
      if (!chunkSet.has(ref.chunk_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["source_chunk_ids"],
          message: `Slide ${slide.slide_number} citation ${ref.chunk_id} must be listed in source_chunk_ids`,
        });
      }
    }
  });
export type SlideItem = z.infer<typeof SlideItemSchema>;

export const StudioSlideDeckParamsSchema = z
  .object({
    slide_count: z.number().int().min(SLIDE_COUNT_MIN).max(SLIDE_COUNT_MAX).optional(),
    focus_prompt: z.string().optional(),
  })
  .strict();
export type StudioSlideDeckParams = z.infer<typeof StudioSlideDeckParamsSchema>;

export const StudioSlideDeckPayloadSchema = z
  .object({
    slides: z.array(SlideItemSchema).min(1).max(SLIDE_COUNT_MAX),
    target_count: z.number().int().min(SLIDE_COUNT_MIN).max(SLIDE_COUNT_MAX),
    insufficient_evidence_note: z.string().trim().min(1).nullable(),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    for (const [i, slide] of payload.slides.entries()) {
      if (slide.slide_number !== i + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["slides", i, "slide_number"],
          message: `Slide numbers must be sequential starting at 1 (expected ${i + 1}, received ${slide.slide_number})`,
        });
      }
    }
    if (payload.slides.length < payload.target_count && !payload.insufficient_evidence_note) {
      ctx.addIssue({
        code: "custom",
        path: ["insufficient_evidence_note"],
        message: `Slide deck with fewer than ${payload.target_count} slides must include insufficient_evidence_note`,
      });
    }
    const badgeSet = new Set(payload.citations.map((c) => `${c.badge_number}|${c.chunk_id}`));
    for (const slide of payload.slides) {
      for (const ref of slide.citations) {
        if (!badgeSet.has(`${ref.badge_number}|${ref.chunk_id}`)) {
          ctx.addIssue({
            code: "custom",
            path: ["citations"],
            message: `Slide ${slide.slide_number} references citation ${ref.badge_number} (${ref.chunk_id}) not in payload.citations`,
          });
        }
      }
    }
  });
export type StudioSlideDeckPayload = z.infer<typeof StudioSlideDeckPayloadSchema>;

export const SlideDeckExportFormatSchema = z.enum(["pptx", "pdf"]);
export type SlideDeckExportFormat = z.infer<typeof SlideDeckExportFormatSchema>;

export const SlideDeckExportRequestSchema = z
  .object({
    format: SlideDeckExportFormatSchema,
  })
  .strict();
export type SlideDeckExportRequest = z.infer<typeof SlideDeckExportRequestSchema>;

/* ------------------------ Infographic Contracts (FR-ST-17, D9) ------------------------ */

export const InfographicBlockSchema = z
  .object({
    id: z.string().regex(STUDIO_NODE_ID_PATTERN, "block id must be a 1..64 char identifier"),
    heading: PlainTextNoHtmlSchema,
    body: PlainTextNoHtmlSchema,
    metric_value: PlainTextNoHtmlSchema.optional(),
    metric_label: PlainTextNoHtmlSchema.optional(),
    category: PlainTextNoHtmlSchema.optional(),
    badge_numbers: z.array(z.number().int().positive()).min(1),
  })
  .strict();
export type InfographicBlock = z.infer<typeof InfographicBlockSchema>;

export const StudioInfographicParamsSchema = z
  .object({
    style: InfographicStyleSchema.optional(),
    focus_prompt: z.string().optional(),
  })
  .strict();
export type StudioInfographicParams = z.infer<typeof StudioInfographicParamsSchema>;

export const StudioInfographicPayloadSchema = z
  .object({
    style: InfographicResolvedStyleSchema,
    title: PlainTextNoHtmlSchema,
    subtitle: PlainTextNoHtmlSchema.optional(),
    structured_blocks: z.array(InfographicBlockSchema).min(1).max(12),
    rendered_svg: z
      .string()
      .min(1)
      .superRefine((svg, ctx) => {
        const check = validateSafeDeterministicSvg(svg);
        if (!check.valid) {
          ctx.addIssue({
            code: "custom",
            message: check.error ?? "Invalid infographic SVG",
          });
        }
      }),
    source_chunk_ids: z
      .array(z.string().regex(UUID_V7_REGEX, "source_chunk_ids must contain UUID v7"))
      .min(1),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const blockIds = payload.structured_blocks.map((b) => b.id);
    if (new Set(blockIds).size !== blockIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["structured_blocks"],
        message: "Infographic block IDs must be unique",
      });
    }
    const badgeSet = new Set(payload.citations.map((c) => c.badge_number));
    for (const block of payload.structured_blocks) {
      for (const n of block.badge_numbers) {
        if (!badgeSet.has(n)) {
          ctx.addIssue({
            code: "custom",
            path: ["structured_blocks"],
            message: `Infographic block ${block.id} references missing citation [${n}]`,
          });
        }
      }
    }
    const chunkSet = new Set(payload.source_chunk_ids);
    for (const ref of payload.citations) {
      if (!chunkSet.has(ref.chunk_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["source_chunk_ids"],
          message: `Infographic citation ${ref.chunk_id} must be listed in source_chunk_ids`,
        });
      }
    }
  });
export type StudioInfographicPayload = z.infer<typeof StudioInfographicPayloadSchema>;

export const InfographicExportFormatSchema = z.enum(["svg", "png"]);
export type InfographicExportFormat = z.infer<typeof InfographicExportFormatSchema>;

export const InfographicExportRequestSchema = z
  .object({
    format: InfographicExportFormatSchema,
  })
  .strict();
export type InfographicExportRequest = z.infer<typeof InfographicExportRequestSchema>;

export const StudioInfographicExportSceneSchema = z
  .object({
    format: InfographicExportFormatSchema,
    svg: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
    scale: z.union([z.literal(1), z.literal(2)]),
    filename: z.string().min(1),
  })
  .strict();
export type StudioInfographicExportScene = z.infer<typeof StudioInfographicExportSceneSchema>;

/* ------------------------ Deterministic SVG Infographic Renderer (FR-ST-17, D9) ------------------------ */

export interface RenderInfographicInput {
  style: InfographicResolvedStyle;
  title: string;
  subtitle?: string | undefined;
  blocks: readonly InfographicBlock[];
  citations: ReadonlyArray<{ badge_number: number; label: string }>;
}

const STYLE_LABELS: Record<InfographicResolvedStyle, string> = {
  process_flow: "Process Flow",
  comparison: "Comparison",
  metrics_summary: "Metrics Summary",
  architecture_diagram: "Architecture Diagram",
};

const STYLE_ACCENTS: Record<
  InfographicResolvedStyle,
  { header: string; accent: string; tint: string; border: string }
> = {
  process_flow: { header: "#0f172a", accent: "#0284c7", tint: "#e0f2fe", border: "#7dd3fc" },
  comparison: { header: "#1e1b4b", accent: "#6d28d9", tint: "#ede9fe", border: "#c4b5fd" },
  metrics_summary: { header: "#064e3b", accent: "#059669", tint: "#d1fae5", border: "#6ee7b7" },
  architecture_diagram: {
    header: "#172554",
    accent: "#2563eb",
    tint: "#dbeafe",
    border: "#93c5fd",
  },
};

interface InfographicPalette {
  header: string;
  accent: string;
  tint: string;
  border: string;
}

interface PlacedInfographicCard {
  block: InfographicBlock;
  headingLines: string[];
  bodyLines: string[];
  hasMetric: boolean;
  badgesText: string;
  index: number;
  x: number;
  y: number;
  w: number;
  height: number;
}

const INFOGRAPHIC_HEADING_CHARS: Record<1 | 2 | 3, number> = { 1: 82, 2: 38, 3: 24 };
const INFOGRAPHIC_BODY_CHARS: Record<1 | 2 | 3, number> = { 1: 96, 2: 48, 3: 30 };

function resolveInfographicColumnCount(
  style: InfographicResolvedStyle,
  blockCount: number,
): 1 | 2 | 3 {
  if (blockCount === 1) return 1;
  if (style === "metrics_summary" && blockCount >= 3) return 3;
  return 2;
}

function layoutInfographicCards(
  input: RenderInfographicInput,
  geometry: { padX: number; innerWidth: number; headerHeight: number },
): { placed: PlacedInfographicCard[]; cursorY: number } {
  const cols = resolveInfographicColumnCount(input.style, input.blocks.length);
  const gapX = 20;
  const gapY = 22;
  const boxWidth = Math.floor((geometry.innerWidth - gapX * (cols - 1)) / cols);
  const maxHeadingChars = INFOGRAPHIC_HEADING_CHARS[cols];
  const maxBodyChars = INFOGRAPHIC_BODY_CHARS[cols];

  const prepared = input.blocks.map((block) => {
    const headingLines = wrapDiagramText(block.heading, maxHeadingChars);
    const bodyLines = wrapDiagramText(block.body, maxBodyChars);
    const hasMetric =
      block.metric_value !== undefined ||
      (input.style === "metrics_summary" && Boolean(block.category));
    const badgesText = block.badge_numbers.map((n) => `[${n}]`).join(" ");
    const metricHeight = hasMetric ? 40 : 0;
    const catHeight = block.category ? 20 : 0;
    const height =
      18 +
      catHeight +
      metricHeight +
      headingLines.length * 19 +
      6 +
      bodyLines.length * 17 +
      26 +
      14;
    return { block, headingLines, bodyLines, hasMetric, badgesText, height };
  });

  const placed: PlacedInfographicCard[] = [];
  let cursorY = geometry.headerHeight + 22;
  for (let i = 0; i < prepared.length; i += cols) {
    const rowItems = prepared.slice(i, i + cols);
    const rowHeight = Math.max(...rowItems.map((r) => r.height));
    rowItems.forEach((item, colIdx) => {
      placed.push({
        ...item,
        index: i + colIdx,
        x: geometry.padX + colIdx * (boxWidth + gapX),
        y: cursorY,
        w: boxWidth,
        height: rowHeight,
      });
    });
    cursorY += rowHeight + gapY;
  }
  return { placed, cursorY };
}

function appendInfographicConnectors(
  parts: string[],
  style: InfographicResolvedStyle,
  placed: readonly PlacedInfographicCard[],
  accent: string,
): void {
  if (style !== "process_flow" && style !== "architecture_diagram") return;
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i];
    const b = placed[i + 1];
    if (!a || !b) continue;
    if (a.y === b.y) {
      const x1 = a.x + a.w;
      const y1 = a.y + a.height / 2;
      const x2 = b.x;
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2 - 6}" y2="${y1}" stroke="${accent}" stroke-width="2"/>`,
      );
      if (style === "process_flow") {
        parts.push(
          `<polygon points="${x2 - 6},${y1 - 5} ${x2},${y1} ${x2 - 6},${y1 + 5}" fill="${accent}"/>`,
        );
      }
    } else {
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.height;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 - 6}" stroke="${accent}" stroke-width="2"/>`,
      );
      if (style === "process_flow") {
        parts.push(
          `<polygon points="${x2 - 5},${y2 - 6} ${x2},${y2} ${x2 + 5},${y2 - 6}" fill="${accent}"/>`,
        );
      }
    }
  }
}

function appendInfographicCard(
  parts: string[],
  style: InfographicResolvedStyle,
  card: PlacedInfographicCard,
  palette: InfographicPalette,
): void {
  parts.push(
    `<g>`,
    `<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.height}" rx="12" fill="#ffffff" stroke="${palette.border}" stroke-width="1.5"/>`,
  );

  if (style === "process_flow") {
    parts.push(
      `<circle cx="${card.x + 24}" cy="${card.y + 24}" r="12" fill="${palette.accent}"/>`,
      `<text x="${card.x + 20}" y="${card.y + 28}" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="#ffffff">${card.index + 1}</text>`,
    );
  }

  let textY = card.y + 24;
  const textX = style === "process_flow" ? card.x + 44 : card.x + 16;

  if (card.block.category) {
    parts.push(
      `<text x="${textX}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${palette.accent}">${escapeXmlText(card.block.category.toUpperCase())}</text>`,
    );
    textY += 20;
  } else if (style === "process_flow") {
    textY += 6;
  }

  if (card.hasMetric) {
    const val = card.block.metric_value ?? card.block.category ?? `${card.index + 1}`;
    const lbl = card.block.metric_label ?? "Key Metric";
    parts.push(
      `<rect x="${card.x + 14}" y="${textY - 12}" width="${card.w - 28}" height="34" rx="8" fill="${palette.tint}"/>`,
      `<text x="${card.x + 24}" y="${textY + 10}" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" fill="${palette.header}">${escapeXmlText(val)}</text>`,
      `<text x="${card.x + 128}" y="${textY + 9}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="${palette.accent}">${escapeXmlText(lbl)}</text>`,
    );
    textY += 38;
  }

  for (const line of card.headingLines) {
    parts.push(
      `<text x="${textX}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#0f172a">${escapeXmlText(line)}</text>`,
    );
    textY += 19;
  }

  textY += 4;
  for (const line of card.bodyLines) {
    parts.push(
      `<text x="${card.x + 16}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#334155">${escapeXmlText(line)}</text>`,
    );
    textY += 17;
  }

  parts.push(
    `<text x="${card.x + 16}" y="${card.y + card.height - 12}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${palette.accent}">${escapeXmlText(card.badgesText)}</text>`,
    `</g>`,
  );
}

/**
 * D9 deterministic vector infographic renderer (FR-ST-17):
 * Wraps long headings and bodies dynamically and adjusts row/box heights so zero text clips or overlaps.
 * Emits allowlisted inert SVG primitives (`<svg>`, `<title>`, `<rect>`, `<line>`, `<polygon>`, `<circle>`, `<text>`, `<g>`).
 */
export function renderInfographicSvg(input: RenderInfographicInput): {
  svg: string;
  width: number;
  height: number;
} {
  const width = 960;
  const padX = 32;
  const innerWidth = width - padX * 2;
  const palette = STYLE_ACCENTS[input.style];

  const titleLines = wrapDiagramText(input.title, 48);
  const subtitleLines = input.subtitle ? wrapDiagramText(input.subtitle, 84) : [];
  const headerHeight = 46 + titleLines.length * 28 + subtitleLines.length * 18 + 20;

  const { placed, cursorY } = layoutInfographicCards(input, { padX, innerWidth, headerHeight });

  const footerCitationsText = input.citations
    .map((c) => `[${c.badge_number}] ${c.label}`)
    .join("   ");
  const footerCiteLines = wrapDiagramText(
    footerCitationsText || "[1] Grounded notebook source",
    96,
  );
  const footerTop = cursorY + 8;
  const footerHeight = 28 + footerCiteLines.length * 16 + 18;
  const totalHeight = footerTop + footerHeight + 16;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="${width}" height="${totalHeight}" role="img" aria-label="${escapeXmlText(input.title)}">`,
    `<title>${escapeXmlText(input.title)}</title>`,
    `<rect x="0" y="0" width="${width}" height="${totalHeight}" rx="16" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>`,
    `<rect x="0" y="0" width="${width}" height="${headerHeight}" rx="16" fill="${palette.header}"/>`,
    `<rect x="${padX}" y="18" width="180" height="22" rx="11" fill="${palette.accent}"/>`,
    `<text x="${padX + 12}" y="33" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#ffffff">${escapeXmlText(STYLE_LABELS[input.style].toUpperCase())}</text>`,
  ];

  let headerY = 66;
  for (const line of titleLines) {
    parts.push(
      `<text x="${padX}" y="${headerY}" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${escapeXmlText(line)}</text>`,
    );
    headerY += 28;
  }
  for (const line of subtitleLines) {
    parts.push(
      `<text x="${padX}" y="${headerY}" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#cbd5e1">${escapeXmlText(line)}</text>`,
    );
    headerY += 18;
  }

  appendInfographicConnectors(parts, input.style, placed, palette.accent);
  for (const card of placed) {
    appendInfographicCard(parts, input.style, card, palette);
  }

  parts.push(
    `<rect x="${padX}" y="${footerTop}" width="${innerWidth}" height="${footerHeight}" rx="10" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>`,
    `<text x="${padX + 14}" y="${footerTop + 20}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#475569">AI-generated · Illustration · Grounded Sources</text>`,
  );
  let footerY = footerTop + 38;
  for (const line of footerCiteLines) {
    parts.push(
      `<text x="${padX + 14}" y="${footerY}" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#334155">${escapeXmlText(line)}</text>`,
    );
    footerY += 16;
  }
  parts.push(`</svg>`);

  return { svg: parts.join(""), width, height: totalHeight };
}

/* ------------------------ Shared Validators (NFR-EVAL-02 / NFR-EVAL-04) ------------------------ */

export function validateSlideDeckPayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[],
): string | null {
  const parsed = StudioSlideDeckPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const deck = parsed.data;
  const payloadCheck = verifyStudioCitations(
    deck.citations,
    chunks,
    snapshot,
    "Slide deck payload",
  );
  if (payloadCheck.error) return payloadCheck.error;

  for (const slide of deck.slides) {
    const slideCheck = verifyStudioCitations(
      slide.citations,
      chunks,
      snapshot,
      `Slide ${slide.slide_number}`,
    );
    if (slideCheck.error) return slideCheck.error;
  }
  return null;
}

export function validateInfographicPayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[],
): string | null {
  const parsed = StudioInfographicPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const infographic = parsed.data;
  const svgCheck = validateSafeDeterministicSvg(infographic.rendered_svg);
  if (!svgCheck.valid) {
    return svgCheck.error ?? "Infographic SVG failed safety validation";
  }
  const payloadCheck = verifyStudioCitations(
    infographic.citations,
    chunks,
    snapshot,
    "Infographic payload",
  );
  if (payloadCheck.error) return payloadCheck.error;
  return null;
}

/* ------------------------ Pure OOXML PPTX & 16:9 PDF Builders (Gate v4.0 #3) ------------------------ */

export interface OoxmlZipEntry {
  name: string;
  content: string;
}

const P_NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const RT_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

interface TextShapeSpec {
  id: number;
  name: string;
  phType: string | null;
  x: number;
  y: number;
  cx: number;
  cy: number;
  paragraphs: Array<{ text: string; size?: number; bold?: boolean; color?: string }>;
}

function textShapeXml(spec: TextShapeSpec): string {
  const nvPr = spec.phType ? `<p:nvPr><p:ph type="${spec.phType}"/></p:nvPr>` : "<p:nvPr/>";
  const body = spec.paragraphs
    .map((p) => {
      const sz = (p.size ?? 18) * 100;
      const bAttr = p.bold ? ' b="1"' : "";
      const color = p.color ?? "0F172A";
      return `<a:p><a:r><a:rPr lang="en-US" sz="${sz}"${bAttr}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${escapeXmlText(p.text)}</a:t></a:r></a:p>`;
    })
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${spec.id}" name="${escapeXmlText(spec.name)}"/><p:cNvSpPr txBox="1"/>${nvPr}</p:nvSpPr><p:spPr><a:xfrm><a:off x="${spec.x}" y="${spec.y}"/><a:ext cx="${spec.cx}" cy="${spec.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function slideVisualLines(slide: SlideItem): string[] {
  const vs = slide.visual_spec;
  const lines: string[] = [];
  if (vs.subtitle) lines.push(vs.subtitle);
  if (vs.callout) {
    lines.push(
      `${vs.callout.value} — ${vs.callout.label}${vs.callout.context ? ` (${vs.callout.context})` : ""}`,
    );
  }
  if (vs.columns) {
    lines.push(`${vs.columns.left_heading}: ${vs.columns.left_points.join("; ")}`);
    lines.push(`${vs.columns.right_heading}: ${vs.columns.right_points.join("; ")}`);
  }
  if (vs.table) {
    lines.push(vs.table.headers.join(" | "));
    for (const row of vs.table.rows) lines.push(row.join(" | "));
  }
  if (vs.diagram_steps) {
    lines.push(vs.diagram_steps.map((s, idx) => `${idx + 1}. ${s}`).join(" -> "));
  }
  return lines;
}

function slideXmlForItem(slide: SlideItem, totalSlides: number): string {
  const titleShape = textShapeXml({
    id: 2,
    name: "Title 1",
    phType: "title",
    x: 685800,
    y: 457200,
    cx: 10820400,
    cy: 914400,
    paragraphs: [{ text: slide.title, size: 28, bold: true, color: "0F172A" }],
  });
  const visualLines = slideVisualLines(slide);
  const bulletParagraphs = [
    ...visualLines.map((line) => ({ text: line, size: 16, bold: true, color: "1D4ED8" })),
    ...slide.bullets.map((b) => ({ text: `• ${b}`, size: 18, color: "1E293B" })),
  ];
  const bodyShape = textShapeXml({
    id: 3,
    name: "Content 2",
    phType: "body",
    x: 685800,
    y: 1524000,
    cx: 10820400,
    cy: 4419600,
    paragraphs: bulletParagraphs,
  });
  const citesText = `Slide ${slide.slide_number} of ${totalSlides} · Layout: ${slide.layout} · Sources: ${slide.citations
    .map((c) => `[${c.badge_number}]`)
    .join(" ")} · AI-generated`;
  const footerShape = textShapeXml({
    id: 4,
    name: "Footer 3",
    phType: null,
    x: 685800,
    y: 6096000,
    cx: 10820400,
    cy: 457200,
    paragraphs: [{ text: citesText, size: 11, color: "475569" }],
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${titleShape}${bodyShape}${footerShape}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesXmlForSlide(slide: SlideItem): string {
  const noteLines = slide.speaker_notes.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const paras = (noteLines.length > 0 ? noteLines : [slide.speaker_notes])
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${escapeXmlText(line)}</a:t></a:r></a:p>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${slide.slide_number}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

/**
 * FR-ST-16 / Gate v4.0 #3: Produces complete, sanitized OOXML PresentationML parts for `.pptx` export.
 * Contains editable text shapes, 16:9 widescreen dimensions, and linked `notesSlide` speaker notes.
 * Zero macros, ActiveX, OLE objects, or external relationships.
 */
export function buildSlideDeckOoxmlEntries(
  deckTitle: string,
  payload: StudioSlideDeckPayload,
): OoxmlZipEntry[] {
  const slideOverrides = payload.slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
    )
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>${slideOverrides}</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RT_BASE}extended-properties" Target="docProps/app.xml"/></Relationships>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXmlText(deckTitle)}</dc:title><dc:creator>Everlast Studio</dc:creator></cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Everlast Studio</Application><Slides>${payload.slides.length}</Slides></Properties>`;

  const slideIds = payload.slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`)
    .join("");
  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${P_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const slideRelsXml = payload.slides
    .map(
      (_, i) =>
        `<Relationship Id="rId${10 + i}" Type="${RT_BASE}slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join("");
  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${RT_BASE}notesMaster" Target="notesMasters/notesMaster1.xml"/><Relationship Id="rId3" Type="${RT_BASE}theme" Target="theme/theme1.xml"/><Relationship Id="rId4" Type="${RT_BASE}presProps" Target="presProps.xml"/><Relationship Id="rId5" Type="${RT_BASE}viewProps" Target="viewProps.xml"/><Relationship Id="rId6" Type="${RT_BASE}tableStyles" Target="tableStyles.xml"/>${slideRelsXml}</Relationships>`;

  const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Everlast Theme"><a:themeElements><a:clrScheme name="Everlast"><a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="0284C7"/></a:accent2><a:accent3><a:srgbClr val="059669"/></a:accent3><a:accent4><a:srgbClr val="6D28D9"/></a:accent4><a:accent5><a:srgbClr val="D97706"/></a:accent5><a:accent6><a:srgbClr val="DC2626"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Everlast"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Everlast"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

  const slideMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT_BASE}theme" Target="../theme/theme1.xml"/></Relationships>`;

  const slideLayoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${P_NS} type="titleAndContent"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

  const notesMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;

  const notesMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}theme" Target="../theme/theme1.xml"/></Relationships>`;

  const entries: OoxmlZipEntry[] = [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "docProps/core.xml", content: coreXml },
    { name: "docProps/app.xml", content: appXml },
    { name: "ppt/presentation.xml", content: presentationXml },
    { name: "ppt/_rels/presentation.xml.rels", content: presentationRels },
    { name: "ppt/theme/theme1.xml", content: themeXml },
    { name: "ppt/slideMasters/slideMaster1.xml", content: slideMasterXml },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", content: slideMasterRels },
    { name: "ppt/slideLayouts/slideLayout1.xml", content: slideLayoutXml },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", content: slideLayoutRels },
    { name: "ppt/notesMasters/notesMaster1.xml", content: notesMasterXml },
    { name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", content: notesMasterRels },
    {
      name: "ppt/presProps.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr ${P_NS}/>`,
    },
    {
      name: "ppt/viewProps.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr ${P_NS}/>`,
    },
    {
      name: "ppt/tableStyles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    },
  ];

  const total = payload.slides.length;
  for (const [i, slide] of payload.slides.entries()) {
    const k = i + 1;
    entries.push({ name: `ppt/slides/slide${k}.xml`, content: slideXmlForItem(slide, total) });
    entries.push({
      name: `ppt/slides/_rels/slide${k}.xml.rels`,
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT_BASE}notesSlide" Target="../notesSlides/notesSlide${k}.xml"/></Relationships>`,
    });
    entries.push({ name: `ppt/notesSlides/notesSlide${k}.xml`, content: notesXmlForSlide(slide) });
    entries.push({
      name: `ppt/notesSlides/_rels/notesSlide${k}.xml.rels`,
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${RT_BASE}slide" Target="../slides/slide${k}.xml"/><Relationship Id="rId2" Type="${RT_BASE}notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>`,
    });
  }
  return entries;
}

const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

function toLatin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function escapePdfString(text: string): string {
  const encoded = toCodePoints(text)
    .map((ch) => {
      if (WIN_ANSI[ch] !== undefined) return String.fromCharCode(WIN_ANSI[ch]);
      const code = ch.charCodeAt(0);
      return code <= 0xff && (code < 0x80 || code > 0x9f) ? ch : "?";
    })
    .join("");
  return encoded.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function buildSlidePdfOperations(
  deckTitle: string,
  slide: SlideItem,
  totalSlides: number,
): string[] {
  const ops: string[] = [
    // Background & top accent bar
    "0.98 0.99 1 rg 0 0 960 540 re f",
    "0.06 0.09 0.16 rg 0 470 960 70 re f",
    "0.15 0.39 0.92 rg 0 466 960 4 re f",
    // Header bar text
    "BT",
    "/F2 11 Tf",
    "0.80 0.85 0.96 rg",
    "48 514 Td",
    `(${escapePdfString(`${deckTitle}  |  Slide ${slide.slide_number} of ${totalSlides}  |  ${slide.layout}`)}) Tj`,
    "ET",
  ];

  let y = 434;
  const titleLines = wrapDiagramText(slide.title, 60).slice(0, 2);
  ops.push("BT", "/F2 22 Tf", "0.06 0.09 0.16 rg");
  for (const tLine of titleLines) {
    ops.push(`1 0 0 1 48 ${y} Tm (${escapePdfString(tLine)}) Tj`);
    y -= 26;
  }
  ops.push("ET");
  y -= 6;

  const visualLines = slideVisualLines(slide).slice(0, 4);
  if (visualLines.length > 0) {
    const boxHeight = visualLines.length * 18 + 16;
    const boxBottom = y - boxHeight + 14;
    ops.push(`0.94 0.96 1 rg 48 ${boxBottom} 864 ${boxHeight} re f`);
    ops.push("BT", "/F2 12 Tf", "0.11 0.31 0.85 rg");
    for (const vLine of visualLines) {
      for (const wrapped of wrapDiagramText(vLine, 92).slice(0, 2)) {
        ops.push(`1 0 0 1 60 ${y} Tm (${escapePdfString(wrapped)}) Tj`);
        y -= 17;
      }
    }
    ops.push("ET");
    y -= 12;
  }

  ops.push("BT", "/F1 14 Tf", "0.12 0.16 0.23 rg");
  for (const bullet of slide.bullets) {
    for (const line of wrapDiagramText(`- ${bullet}`, 88)) {
      if (y < 76) break;
      ops.push(`1 0 0 1 48 ${y} Tm (${escapePdfString(line)}) Tj`);
      y -= 20;
    }
    y -= 4;
  }
  ops.push("ET");

  const citeBadges = slide.citations.map((c) => `[${c.badge_number}]`).join(" ");
  ops.push(
    "0.80 0.84 0.90 RG 1 w 48 54 m 912 54 l S",
    "BT",
    "/F1 10 Tf",
    "0.28 0.33 0.41 rg",
    `1 0 0 1 48 36 Tm (${escapePdfString(`Citations: ${citeBadges}   |   AI-generated · Grounded in active notebook sources`)}) Tj`,
    "ET",
  );
  return ops;
}

/**
 * FR-ST-16 / Gate v4.0 #3: Builds a valid 16:9 (960 x 540 pt) multi-page PDF 1.4 binary buffer
 * with exact xref table and one landscape page per slide, parseable by `pdfjs-dist`.
 */
export function buildSlideDeckPdfBytes(
  deckTitle: string,
  payload: StudioSlideDeckPayload,
): Uint8Array {
  const objects: Uint8Array[] = [];
  const add = (body: Uint8Array | string): number => {
    objects.push(typeof body === "string" ? toLatin1Bytes(body) : body);
    return objects.length;
  };
  const makeStream = (dict: string, data: Uint8Array): Uint8Array =>
    concatBytes([
      toLatin1Bytes(`<< ${dict} /Length ${data.byteLength} >>\nstream\n`),
      data,
      toLatin1Bytes("\nendstream"),
    ]);

  const catalogId = add("");
  const pagesId = add("");
  const fontRegularId = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBoldId = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const pageIds: number[] = [];

  const totalSlides = payload.slides.length;
  for (const slide of payload.slides) {
    const ops = buildSlidePdfOperations(deckTitle, slide, totalSlides);
    const contentId = add(makeStream("", toLatin1Bytes(ops.join("\n"))));
    const resources = `<< /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >>`;
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 960 540] /Resources ${resources} /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  objects[catalogId - 1] = toLatin1Bytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = toLatin1Bytes(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );

  const header = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  ]);
  const parts: Uint8Array[] = [header];
  const offsets: number[] = [];
  let length = header.byteLength;
  objects.forEach((body, idx) => {
    offsets.push(length);
    const chunk = concatBytes([
      toLatin1Bytes(`${idx + 1} 0 obj\n`),
      body,
      toLatin1Bytes("\nendobj\n"),
    ]);
    parts.push(chunk);
    length += chunk.byteLength;
  });

  const xrefStart = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
  ].join("");
  parts.push(toLatin1Bytes(xref));
  parts.push(
    toLatin1Bytes(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    ),
  );
  return concatBytes(parts);
}
