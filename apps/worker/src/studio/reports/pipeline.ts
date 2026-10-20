import type { ReportSubtype, StudioFailureCode, StudioGenerationOutcome, StudioProgress } from "@everlast/contracts";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { batchChunks, type BatchLimits } from "./batching.ts";
import type { Finding, ReportBlock, ReportModelClient } from "./model.ts";
import { renderReport } from "./render.ts";
import { TEMPLATES } from "./templates.ts";
import { validateReportBlocks } from "./validation.ts";

export interface GenerateReportInput {
  subtype: ReportSubtype;
  chunks: UnifiedDocumentChunk[];
  model: ReportModelClient;
  custom_prompt?: string | undefined;
  /** Effective output language (FR-UI-02): passed to the model and used for section headings. */
  output_language?: string | undefined;
  limits?: BatchLimits;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome => ({ status: "refused", code, message });
const INSUFFICIENT = "The selected sources do not contain enough supported content for every required section of this report.";

function sortEvents(block: ReportBlock): ReportBlock {
  const items = [...block.items].sort((a, b) => Number(a.date) - Number(b.date));
  return { ...block, items };
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.kind}|${f.chunk_id}|${f.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Bounded parallelism of the map step (D12): batches are independent, so up to this many extract calls run at
 * once; findings are concatenated in batch order, so the result is identical to the sequential run.
 */
export const EXTRACT_CONCURRENCY = 4;

const filled = (b: ReportBlock | undefined): boolean => !!b && (b.items.length > 0 || (b.table?.rows.length ?? 0) > 0);

/** Map-reduce over bounded batches of ALL scoped chunks (D12); no agent loop, no sampling. */
export async function generateReport(input: GenerateReportInput): Promise<StudioGenerationOutcome> {
  const { subtype, chunks, model, signal, output_language } = input;
  const guard = (): void => signal.throwIfAborted();
  const template = TEMPLATES[subtype];
  if (chunks.length === 0) return refuse("InsufficientEvidence", "The selected sources contain no readable content.");

  const batches = input.limits ? batchChunks(chunks, input.limits) : batchChunks(chunks);
  input.reportProgress("reading", 5);
  const perBatch: Finding[][] = new Array(batches.length);
  let next = 0;
  let done = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < batches.length && !failed) {
      const i = next++;
      guard();
      try {
        perBatch[i] = await model.extract({ subtype, custom_prompt: input.custom_prompt, output_language, chunks: batches[i]!, signal });
      } catch (error) {
        failed = true; // no further batches are started once one fails
        throw error;
      }
      done += 1;
      input.reportProgress("extracting", 10 + Math.round((done / batches.length) * 60));
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXTRACT_CONCURRENCY, batches.length) }, worker));
  const findings = perBatch.flat();

  guard();
  input.reportProgress("composing", 75);
  let blocks = await model.compose({ subtype, custom_prompt: input.custom_prompt, output_language, findings: dedupe(findings), signal });
  blocks = blocks.map((b) => (b.id === "events" ? sortEvents(b) : b));

  guard();
  input.reportProgress("validating", 90);
  const problem = validateReportBlocks(blocks, chunks);
  if (problem) return refuse("CitationValidationFailed", problem);

  // FR-015: every required section must be non-empty. The only exception is a Timeline without dated events,
  // which completes with an explicit notice when `cast_of_characters` is supported.
  const byKey = new Map(blocks.map((b) => [b.id, b]));
  let noDatedEvents = false;
  if (template.sections.length > 0) {
    for (const key of template.sections) {
      if (filled(byKey.get(key))) continue;
      if (subtype === "timeline" && key === "events" && filled(byKey.get("cast_of_characters"))) {
        noDatedEvents = true;
        continue;
      }
      return refuse("InsufficientEvidence", INSUFFICIENT);
    }
    if (subtype === "study_guide" && byKey.get("answer_key")!.items.length !== byKey.get("short_answer_questions")!.items.length) {
      return refuse("InsufficientEvidence", "The answer key does not match the short-answer questions.");
    }
  } else if (!blocks.some(filled)) {
    return refuse("InsufficientEvidence", INSUFFICIENT);
  }

  input.reportProgress("publishing", 95);
  return { status: "completed", payload: renderReport({ subtype, blocks, chunks, output_language, noDatedEvents }) };
}
