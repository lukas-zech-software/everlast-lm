import type { ReportSubtype, StudioFailureCode, StudioGenerationOutcome, StudioProgress } from "@everlast/contracts";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import { batchChunks, type BatchLimits } from "./batching.js";
import type { Finding, ReportBlock, ReportModelClient } from "./model.js";
import { renderReport } from "./render.js";
import { TEMPLATES } from "./templates.js";
import { validateReportBlocks } from "./validation.js";

export interface GenerateReportInput {
  subtype: ReportSubtype;
  chunks: UnifiedDocumentChunk[];
  model: ReportModelClient;
  custom_prompt?: string | undefined;
  limits?: BatchLimits;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome => ({ status: "refused", code, message });

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

/** Map-reduce over bounded batches of ALL scoped chunks (D12); no agent loop, no sampling. */
export async function generateReport(input: GenerateReportInput): Promise<StudioGenerationOutcome> {
  const { subtype, chunks, model, signal } = input;
  const guard = (): void => signal.throwIfAborted();
  const template = TEMPLATES[subtype];
  if (chunks.length === 0) return refuse("InsufficientEvidence", "The selected sources contain no readable content.");

  const batches = input.limits ? batchChunks(chunks, input.limits) : batchChunks(chunks);
  const findings: Finding[] = [];
  input.reportProgress("reading", 5);
  for (const [i, batch] of batches.entries()) {
    guard();
    findings.push(...(await model.extract({ subtype, custom_prompt: input.custom_prompt, chunks: batch, signal })));
    input.reportProgress("extracting", 10 + Math.round(((i + 1) / batches.length) * 60));
  }

  guard();
  input.reportProgress("composing", 75);
  let blocks = await model.compose({ subtype, custom_prompt: input.custom_prompt, findings: dedupe(findings), signal });
  blocks = blocks.map((b) => (b.id === "timeline_events" ? sortEvents(b) : b));

  guard();
  input.reportProgress("validating", 90);
  const problem = validateReportBlocks(blocks, chunks);
  if (problem) return refuse("CitationValidationFailed", problem);

  const filled = (id: string): boolean => {
    const b = blocks.find((x) => x.id === id);
    return !!b && (b.items.length > 0 || (b.table?.rows.length ?? 0) > 0);
  };
  const coreOk = template.coreRule === "any" ? template.core.some(filled) : template.core.every(filled);
  if (!coreOk) return refuse("InsufficientEvidence", "The selected sources do not contain enough supported content for this report.");

  input.reportProgress("publishing", 95);
  return { status: "completed", payload: renderReport(template.title, template.blocks, blocks, chunks) };
}
