import type {
  ReportSubtype,
  SourceRevisionPair,
  StudioFailureCode,
  StudioGenerationOutcome,
  StudioProgress,
  StudioReportPayload,
  UnifiedDocumentChunk,
} from "@everlast/contracts";
import type { BatchLimits } from "./batching.ts";
import { processAllOriginalEvidenceBatches } from "../evidence.ts";
import type { ComposeRequest, Finding, ReportBlock, ReportModelClient } from "./model.ts";
import { renderReport } from "./render.ts";
import { TEMPLATES } from "./templates.ts";
import { validateReportBlocks } from "./validation.ts";

export interface GenerateReportInput {
  subtype: ReportSubtype;
  snapshot?: SourceRevisionPair[] | undefined;
  chunks: UnifiedDocumentChunk[];
  original_chunks?: AsyncIterable<UnifiedDocumentChunk[]> | undefined;
  cached_context?: string | undefined;
  before_model_call?: (() => Promise<void>) | undefined;
  load_cited_chunks?: ((ids: string[]) => Promise<UnifiedDocumentChunk[]>) | undefined;
  model: ReportModelClient;
  custom_prompt?: string | undefined;
  /** Effective output language (FR-UI-02): passed to the model and used for section headings. */
  output_language?: string | undefined;
  limits?: BatchLimits;
  signal: AbortSignal;
  reportProgress: (stage: StudioProgress["stage"], percent: number) => void;
}

const refuse = (
  code: StudioFailureCode,
  message: string,
): StudioGenerationOutcome<StudioReportPayload> => ({ status: "refused", code, message });
const INSUFFICIENT =
  "The selected sources do not contain enough supported content for every required section of this report.";
const MAX_COMPOSE_BYTES = 512_000;

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

function groupFindingsForReduction(findings: readonly Finding[]): Finding[][] {
  const groups: Finding[][] = [];
  let group: Finding[] = [];
  let bytes = 0;
  for (const finding of findings) {
    const size = Buffer.byteLength(JSON.stringify(finding));
    if (size > MAX_COMPOSE_BYTES / 2) {
      throw new Error("Individual finding exceeds model envelope capacity");
    }
    if (bytes + size > MAX_COMPOSE_BYTES / 2 && group.length > 0) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(finding);
    bytes += size;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

function collectBlockItemFindings(
  block: ReportBlock,
  originals: ReadonlyMap<string, Finding>,
): Finding[] {
  return block.items.map((item) => {
    const parent = originals.get(item.chunk_id);
    if (!parent) throw new Error("Reduction cited non-original evidence");
    return {
      ...parent,
      text: item.text,
      ...(item.quote === undefined ? {} : { quote: item.quote }),
      ...(item.date === undefined ? {} : { date: item.date }),
    };
  });
}

function collectBlockTableFindings(
  block: ReportBlock,
  originals: ReadonlyMap<string, Finding>,
): Finding[] {
  return (block.table?.rows ?? []).map((row) => {
    const parent = originals.get(row.chunk_id);
    if (!parent) throw new Error("Reduction table cited non-original evidence");
    return { ...parent, text: row.cells.join(" | ") };
  });
}

function collectReducedFindings(
  blocks: readonly ReportBlock[],
  originals: ReadonlyMap<string, Finding>,
): Finding[] {
  return blocks.flatMap((block) => [
    ...collectBlockItemFindings(block, originals),
    ...collectBlockTableFindings(block, originals),
  ]);
}

interface CompactFindingsOptions {
  buildRequest: (fs: Finding[]) => ComposeRequest;
  model: ReportModelClient;
  beforeModelCall: (() => Promise<void>) | undefined;
  signal: AbortSignal;
}

async function compactFindings(
  initial: Finding[],
  options: CompactFindingsOptions,
): Promise<Finding[]> {
  let current = initial;
  let rounds = 0;
  while (Buffer.byteLength(JSON.stringify(options.buildRequest(current))) > MAX_COMPOSE_BYTES) {
    if (++rounds > 16) throw new Error("Bounded recursive compose did not converge");
    const before = Buffer.byteLength(JSON.stringify(current));
    const groups = groupFindingsForReduction(current);
    const next: Finding[] = [];
    for (const batch of groups) {
      options.signal.throwIfAborted();
      const originals = new Map(batch.map((f) => [f.chunk_id, f]));
      await options.beforeModelCall?.();
      const blocks = await options.model.compose(options.buildRequest(batch));
      next.push(...collectReducedFindings(blocks, originals));
    }
    current = dedupe(next);
    if (Buffer.byteLength(JSON.stringify(current)) >= before) {
      throw new Error("Model cannot reduce findings within complete envelope capacity");
    }
  }
  return current;
}

function validateRequiredSections(
  subtype: ReportSubtype,
  requiredSections: readonly string[],
  blocks: readonly ReportBlock[],
): { refusal?: StudioGenerationOutcome<StudioReportPayload>; noDatedEvents: boolean } {
  const byKey = new Map(blocks.map((b) => [b.id, b]));
  if (requiredSections.length === 0) {
    return blocks.some(filled)
      ? { noDatedEvents: false }
      : { refusal: refuse("InsufficientEvidence", INSUFFICIENT), noDatedEvents: false };
  }

  let noDatedEvents = false;
  for (const key of requiredSections) {
    if (filled(byKey.get(key))) continue;
    if (subtype === "timeline" && key === "events" && filled(byKey.get("cast_of_characters"))) {
      noDatedEvents = true;
      continue;
    }
    return { refusal: refuse("InsufficientEvidence", INSUFFICIENT), noDatedEvents };
  }

  if (subtype === "study_guide") {
    const answerKey = byKey.get("answer_key");
    const shortAnswers = byKey.get("short_answer_questions");
    if (answerKey && shortAnswers && answerKey.items.length !== shortAnswers.items.length) {
      return {
        refusal: refuse(
          "InsufficientEvidence",
          "The answer key does not match the short-answer questions.",
        ),
        noDatedEvents,
      };
    }
  }
  return { noDatedEvents };
}

/**
 * Bounded parallelism of the map step (D12): batches are independent, so up to this many extract calls run at
 * once; findings are concatenated in batch order, so the result is identical to the sequential run.
 */
export const EXTRACT_CONCURRENCY = 4;

const filled = (b: ReportBlock | undefined): boolean =>
  !!b && (b.items.length > 0 || (b.table?.rows.length ?? 0) > 0);

/** Map-reduce over bounded batches of ALL scoped chunks (D12); no agent loop, no sampling. */
export async function generateReport(
  input: GenerateReportInput,
): Promise<StudioGenerationOutcome<StudioReportPayload>> {
  let chunks = input.chunks;
  const { subtype, model, signal, output_language } = input;
  const guard = (): void => {
    signal.throwIfAborted();
  };
  const template = TEMPLATES[subtype];
  if (chunks.length === 0 && !input.original_chunks) {
    return refuse("InsufficientEvidence", "The selected sources contain no readable content.");
  }

  input.reportProgress("reading", 5);
  let findings: Finding[] = [];
  // NFR-PERF-01 / D12: reduce grounded extracted findings before they can grow into an unbounded final request.
  // Every original batch, including one with no findings, is visited; a non-compressing model fails explicitly.
  const buildComposeRequest = (fs: Finding[]): ComposeRequest => ({
    subtype,
    custom_prompt: input.custom_prompt,
    output_language,
    findings: fs,
    signal,
  });
  const derivedSnapshot = chunks
    .map((c) => ({ source_id: c.source_id, revision: c.revision }))
    .filter((p, i, ps) => ps.findIndex((x) => x.source_id === p.source_id) === i);

  await processAllOriginalEvidenceBatches({
    chunks,
    original_chunks: input.original_chunks,
    snapshot: input.snapshot ?? derivedSnapshot,
    limits: input.limits,
    signal,
    extractBatch: async (batch) => {
      await input.before_model_call?.();
      return model.extract({
        subtype,
        custom_prompt: input.custom_prompt,
        output_language,
        chunks: batch,
        signal,
        cached_context: input.cached_context,
      });
    },
    consumeItems: async (rows) => {
      findings = await compactFindings([...findings, ...rows], {
        buildRequest: buildComposeRequest,
        model,
        beforeModelCall: input.before_model_call,
        signal,
      });
    },
    onBatchComplete: (done, total) => {
      input.reportProgress("extracting", 10 + Math.round((done / Math.max(1, total)) * 60));
    },
  });
  if (findings.length === 0) return refuse("InsufficientEvidence", INSUFFICIENT);
  if (input.load_cited_chunks) {
    chunks = await input.load_cited_chunks([...new Set(findings.map((f) => f.chunk_id))]);
  }

  guard();
  input.reportProgress("composing", 75);
  await input.before_model_call?.();
  let blocks = await model.compose(buildComposeRequest(dedupe(findings)));
  blocks = blocks.map((b) => (b.id === "events" ? sortEvents(b) : b));

  guard();
  input.reportProgress("validating", 90);
  const problem = validateReportBlocks(blocks, chunks);
  if (problem) return refuse("CitationValidationFailed", problem);

  // FR-015: every required section must be non-empty. The only exception is a Timeline without dated events,
  // which completes with an explicit notice when `cast_of_characters` is supported.
  const sectionCheck = validateRequiredSections(subtype, template.sections, blocks);
  if (sectionCheck.refusal) return sectionCheck.refusal;

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload: renderReport({
      subtype,
      blocks,
      chunks,
      output_language,
      noDatedEvents: sectionCheck.noDatedEvents,
    }),
  };
}
