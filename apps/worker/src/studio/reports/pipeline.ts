import type { ReportSubtype, StudioFailureCode, StudioGenerationOutcome, StudioProgress, StudioReportPayload } from "@everlast/contracts";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { BatchLimits } from "./batching.ts";
import { processAllOriginalEvidenceBatches } from "../evidence.ts";
import type { Finding, ReportBlock, ReportModelClient } from "./model.ts";
import { renderReport } from "./render.ts";
import { TEMPLATES } from "./templates.ts";
import { validateReportBlocks } from "./validation.ts";

export interface GenerateReportInput {
  subtype: ReportSubtype;
  snapshot?:import("@everlast/contracts").SourceRevisionPair[]|undefined;
  chunks: UnifiedDocumentChunk[];
  original_chunks?:AsyncIterable<UnifiedDocumentChunk[]>|undefined;
  cached_context?:string|undefined;
  before_model_call?:(()=>Promise<void>)|undefined;
  load_cited_chunks?:((ids:string[])=>Promise<UnifiedDocumentChunk[]>)|undefined;
  model: ReportModelClient;
  custom_prompt?: string | undefined;
  /** Effective output language (FR-UI-02): passed to the model and used for section headings. */
  output_language?: string | undefined;
  limits?: BatchLimits;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome<StudioReportPayload> => ({ status: "refused", code, message });
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
export async function generateReport(input: GenerateReportInput): Promise<StudioGenerationOutcome<StudioReportPayload>> {
  let chunks=input.chunks;
  const { subtype, model, signal, output_language } = input;
  const guard = (): void => signal.throwIfAborted();
  const template = TEMPLATES[subtype];
  if (chunks.length === 0 && !input.original_chunks) return refuse("InsufficientEvidence", "The selected sources contain no readable content.");

  input.reportProgress("reading", 5);
  let findings:Finding[]=[];
  // NFR-PERF-01 / D12: reduce grounded extracted findings before they can grow into an unbounded final request.
  // Every original batch, including one with no findings, is visited; a non-compressing model fails explicitly.
  const maxComposeBytes=512_000;
  const composeRequest=(fs:Finding[])=>({subtype,custom_prompt:input.custom_prompt,output_language,findings:fs,signal});
  const compact=async()=>{
    let rounds=0;
    while(Buffer.byteLength(JSON.stringify(composeRequest(findings)))>maxComposeBytes){
      if(++rounds>16)throw new Error('Bounded recursive compose did not converge');
      const before=Buffer.byteLength(JSON.stringify(findings));
      const groups:Finding[][]=[];let group:Finding[]=[],bytes=0;
      for(const finding of findings){
        const size=Buffer.byteLength(JSON.stringify(finding));
        if(size>maxComposeBytes/2)throw new Error('Individual finding exceeds model envelope capacity');
        if(bytes+size>maxComposeBytes/2&&group.length){groups.push(group);group=[];bytes=0;}
        group.push(finding);bytes+=size;
      }
      if(group.length)groups.push(group);
      const next:Finding[]=[];
      for(const batch of groups){
        guard();
        const originals=new Map(batch.map(f=>[f.chunk_id,f]));
        await input.before_model_call?.();
        const blocks=await model.compose(composeRequest(batch));
        for(const block of blocks){
          for(const item of block.items){
            const parent=originals.get(item.chunk_id);if(!parent)throw new Error('Reduction cited non-original evidence');
            next.push({...parent,text:item.text,...(item.quote!==undefined?{quote:item.quote}:{}),...(item.date!==undefined?{date:item.date}:{})});
          }
          for(const row of block.table?.rows??[]){
            const parent=originals.get(row.chunk_id);if(!parent)throw new Error('Reduction table cited non-original evidence');
            next.push({...parent,text:row.cells.join(' | ')});
          }
        }
      }
      findings=dedupe(next);
      if(Buffer.byteLength(JSON.stringify(findings))>=before)throw new Error('Model cannot reduce findings within complete envelope capacity');
    }
  };
  await processAllOriginalEvidenceBatches({chunks,original_chunks:input.original_chunks,snapshot:chunks.map(c=>({source_id:c.source_id,revision:c.revision})).filter((p,i,ps)=>ps.findIndex(x=>x.source_id===p.source_id)===i),
    ...(input.snapshot?{snapshot:input.snapshot}:{}),limits:input.limits,signal,
    extractBatch:async batch=>{await input.before_model_call?.();return model.extract({subtype,custom_prompt:input.custom_prompt,output_language,chunks:batch,signal,cached_context:input.cached_context});},
    consumeItems:async rows=>{findings.push(...rows);await compact();},
    onBatchComplete:(done,total)=>input.reportProgress("extracting",10+Math.round(done/Math.max(1,total)*60)),
  });
  if(!findings.length)return refuse("InsufficientEvidence",INSUFFICIENT);
  if(input.load_cited_chunks)chunks=await input.load_cited_chunks([...new Set(findings.map(f=>f.chunk_id))]);

  guard();
  input.reportProgress("composing", 75);
  await input.before_model_call?.();
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
