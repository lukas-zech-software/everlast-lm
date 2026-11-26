import { ContextPlanSchema } from "@everlast/contracts";
import type { z } from "zod";

export type ContextPlan = z.infer<typeof ContextPlanSchema>;

const BROAD_PATTERNS = [
  /summarize\s+(the\s+)?(main\s+)?themes\s+across\s+(all|\d+)/i,
  /overview\s+across\s+(all|\d+)\s+sources/i,
  /themes\s+across\s+all/i,
  /across\s+all\s+\d+\s+sources/i,
  /across\s+all\s+sources/i,
  /synthesize\s+(the\s+)?themes/i,
];

function isBroadComparison(question: string): boolean {
  // Whitespace immediately after "compare" may include line breaks. A later
  // line break ends the comparison unless the "themes" phrase already started.
  const comparisonParts =
    /(compare\s+)|(themes\s+(?:of|across)\s+(?:all|\d+))|[\r\n\u2028\u2029]/gi;
  let hasCompare = false;
  for (const [, compare, themes] of question.matchAll(comparisonParts)) {
    if (themes === undefined) {
      hasCompare = compare !== undefined;
    } else if (hasCompare) {
      return true;
    }
  }
  return false;
}

export function classifyQuery(question: string): "detailed" | "broad" {
  const q = question.trim();
  return BROAD_PATTERNS.some((pattern) => pattern.test(q)) || isBroadComparison(q)
    ? "broad"
    : "detailed";
}

export interface PlanChatContextInput {
  requestId: string;
  scopeManifestHash: string;
  question: string;
  model: string;
  modelVersion: string;
  inputLimit: number;
  outputReserve: number;
  instructionTokens: number;
  historyTokens: number;
  guideTokens: number;
  chunkMarkerTokens: number;
  evidenceTokens: number;
  requiredGuideIds?: string[];
  detailChunkIds?: string[];
  purpose?: "inspection" | "generation";
}

export function planChatContext(input: PlanChatContextInput): ContextPlan {
  const queryClass = classifyQuery(input.question);
  const requiredGuideIds = input.requiredGuideIds ?? [];
  const detailChunkIds = input.detailChunkIds ?? [];

  return ContextPlanSchema.parse({
    request_id: input.requestId,
    scope_manifest_hash: input.scopeManifestHash,
    purpose: input.purpose ?? "generation",
    query_class: queryClass,
    mode: "retrieval",
    model: input.model,
    model_version: input.modelVersion,
    input_limit: input.inputLimit,
    output_reserve: input.outputReserve,
    instruction_tokens: input.instructionTokens,
    history_tokens: input.historyTokens,
    guide_tokens: input.guideTokens,
    chunk_marker_tokens: input.chunkMarkerTokens,
    evidence_tokens: input.evidenceTokens,
    detail_chunk_ids: detailChunkIds,
    required_guide_ids: requiredGuideIds,
  });
}
