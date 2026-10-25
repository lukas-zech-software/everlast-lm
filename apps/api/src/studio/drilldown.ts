import {
  EmptyScopeError,
  inspectMindmapTree,
  MindmapDrilldownRequestSchema,
  StudioParamsError,
  type SourceRevisionPair,
  type StudioDrilldownResponse,
  type StudioMindmapPayload,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import type { StoredCitation, VisibleMessage } from "@everlast/db";
import type { NoteAssistantModel } from "../notes/assistant-model.ts";

/**
 * [011-studio-mindmaps-data-tables] T032 — Server-side mindmap node drilldown guard and chat turn admission
 * (FR-ST-09, FR-GC-01/02/06, C-02, NFR-EVAL-04; FR-005, FR-006, FR-010, FR-011, FR-014, SC-007, SC-008).
 *
 * Rules:
 * 1. Never trusts client-supplied node or parent labels; resolves `node_id` and its parent exclusively from the
 *    authorized stored `Completed` mindmap tree.
 * 2. Requires `active_source_ids` to be non-empty (`400 EmptyScopeError` if empty).
 * 3. Computes the union of supporting `source_id`s across the clicked node's `label_citations` + `summary_citations`
 *    AND its parent node's `label_citations` + `summary_citations` (when non-root).
 * 4. If any required supporting `(source_id, revision)` is not present in the caller's current Ready selection,
 *    throws `StudioSupportingSourcesRequiredError` (`409 SupportingSourcesRequired`) BEFORE constructing any prompt
 *    or calling the model/chat history (zero leakage of deselected node/parent text).
 */

export class StudioSupportingSourcesRequiredError extends Error {
  readonly missingSourceIds: string[];
  constructor(missingSourceIds: string[], message = "Select all supporting sources for this mindmap node and its parent branch before asking in chat.") {
    super(message);
    this.name = "StudioSupportingSourcesRequiredError";
    this.missingSourceIds = missingSourceIds;
  }
}

export interface StudioDrilldownPort {
  readScope(ownerId: string, notebookId: string, sourceIds: string[]): Promise<{
    snapshot: SourceRevisionPair[];
    chunks: UnifiedDocumentChunk[];
  }>;
  answer?: NoteAssistantModel | undefined;
  publishTurn(input: {
    ownerId: string;
    notebookId: string;
    snapshot: SourceRevisionPair[];
    question: string;
    answer: { kind: "answer" | "refusal"; content: string; citations: StoredCitation[] };
  }): Promise<VisibleMessage[]>;
}

export function buildContextualDrilldownPrompt(nodeLabel: string, parentLabel: string | null): string {
  if (parentLabel) {
    return `Explain the subtopic "${nodeLabel}" in the context of "${parentLabel}" using only the selected sources, and cite supporting passages.`;
  }
  return `Explain the central topic "${nodeLabel}" using only the selected sources, and cite supporting passages.`;
}

export async function executeMindmapDrilldown(input: {
  ownerId: string;
  notebookId: string;
  payload: StudioMindmapPayload;
  rawRequest: unknown;
  port: StudioDrilldownPort;
}): Promise<StudioDrilldownResponse> {
  const rawIds = (input.rawRequest as { active_source_ids?: unknown } | null)?.active_source_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new EmptyScopeError("active_source_ids must contain at least one source UUID.");
  }

  const req = MindmapDrilldownRequestSchema.parse(input.rawRequest);
  const metrics = inspectMindmapTree(input.payload.root_node);
  const targetNode = metrics.nodesById.get(req.node_id);
  if (!targetNode) {
    throw new StudioParamsError(`Mindmap node ${req.node_id} does not exist in this artifact.`);
  }

  const parentId = metrics.parentById.get(req.node_id) ?? null;
  const parentNode = parentId ? metrics.nodesById.get(parentId) ?? null : null;

  // Union of factual evidence citations for targetNode + parentNode (FR-005, FR-006)
  const requiredCitations = [
    ...targetNode.label_citations,
    ...targetNode.summary_citations,
    ...(parentNode ? [...parentNode.label_citations, ...parentNode.summary_citations] : []),
  ];
  const requiredBySource = new Map<string, number>();
  for (const cite of requiredCitations) {
    requiredBySource.set(cite.source_id, cite.revision);
  }

  // Resolve current Ready snapshot for the caller's explicit active_source_ids
  const { snapshot, chunks } = await input.port.readScope(input.ownerId, input.notebookId, req.active_source_ids);
  const currentRevisionBySource = new Map(snapshot.map((p) => [p.source_id, p.revision]));

  const missingSources: string[] = [];
  for (const [sourceId, requiredRev] of requiredBySource.entries()) {
    const activeRev = currentRevisionBySource.get(sourceId);
    if (activeRev === undefined || activeRev !== requiredRev) {
      missingSources.push(sourceId);
    }
  }
  if (missingSources.length > 0) {
    throw new StudioSupportingSourcesRequiredError(missingSources);
  }

  // Only AFTER eligibility passes do we construct the prompt containing node/parent labels!
  const prompt = buildContextualDrilldownPrompt(targetNode.label, parentNode?.label ?? null);

  let answer: { kind: "answer" | "refusal"; content: string; citations: StoredCitation[] };
  if (input.port.answer) {
    answer = await input.port.answer.answer({ question: prompt, chunks });
  } else {
    // Deterministic grounded answer fallback citing the node's verified supporting chunks
    const validCitations: StoredCitation[] = [];
    const seenChunks = new Set<string>();
    for (const c of [...targetNode.label_citations, ...targetNode.summary_citations]) {
      if (seenChunks.has(c.chunk_id)) continue;
      seenChunks.add(c.chunk_id);
      validCitations.push({
        badge_number: validCitations.length + 1,
        chunk_id: c.chunk_id,
        source_id: c.source_id,
        revision: c.revision,
      });
    }
    const markers = validCitations.map((c) => `[${c.badge_number}]`).join("");
    answer = {
      kind: "answer",
      content: `${targetNode.summary} ${markers}`.trim(),
      citations: validCitations,
    };
  }

  const messages = await input.port.publishTurn({
    ownerId: input.ownerId,
    notebookId: input.notebookId,
    snapshot,
    question: prompt,
    answer,
  });

  return {
    prompt,
    node_id: targetNode.id,
    node_label: targetNode.label,
    parent_label: parentNode?.label ?? null,
    messages,
  };
}
