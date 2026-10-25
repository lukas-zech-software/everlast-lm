import {
  inspectMindmapTree,
  MINDMAP_LABEL_MAX_CODE_POINTS,
  MINDMAP_MAX_DEPTH,
  MINDMAP_MAX_NODES,
  MINDMAP_MIN_DEPTH,
  MINDMAP_TARGET_MIN_NODES,
  StudioMindmapPayloadSchema,
  validateMindmapLabel,
  type SourceRevisionPair,
  type StudioEvidenceRef,
  type StudioMindmapPayload,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T011, T017 — Mindmap graph and factual-field citation validator
 * (FR-ST-08, FR-GC-02, C-03; FR-002, FR-003, FR-011, FR-013, FR-014, SC-001, SC-008).
 *
 * Returns `null` when valid, or a descriptive validation failure string (resulting in
 * `CitationValidationFailed` with zero published payload and no silent retry).
 */
export function validateMindmapPayload(
  payload: unknown,
  chunks: readonly UnifiedDocumentChunk[],
  snapshot: readonly SourceRevisionPair[]
): string | null {
  const parsed = StudioMindmapPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => i.message).join("; ");
  }
  const map: StudioMindmapPayload = parsed.data;
  const metrics = inspectMindmapTree(map.root_node);

  if (metrics.duplicateIds.length > 0) {
    return `Mindmap contains duplicate node ID(s): ${metrics.duplicateIds.join(", ")}`;
  }
  if (metrics.nodeCount > MINDMAP_MAX_NODES) {
    return `Mindmap node count (${metrics.nodeCount}) exceeds maximum of ${MINDMAP_MAX_NODES}`;
  }
  if (metrics.maxDepth < MINDMAP_MIN_DEPTH || metrics.maxDepth > MINDMAP_MAX_DEPTH) {
    return `Mindmap depth (${metrics.maxDepth}) must be between ${MINDMAP_MIN_DEPTH} and ${MINDMAP_MAX_DEPTH}`;
  }
  if (metrics.nodeCount < MINDMAP_TARGET_MIN_NODES && !map.insufficient_evidence_note) {
    return `Mindmap with ${metrics.nodeCount} nodes (< ${MINDMAP_TARGET_MIN_NODES}) requires insufficient_evidence_note`;
  }

  const revisions = new Map(snapshot.map((p) => [p.source_id, p.revision]));
  const chunkById = new Map(chunks.map((c) => [c.chunk_id, c]));
  const badgeMap = new Map<number, StudioEvidenceRef>();

  const verifyCitation = (cite: StudioEvidenceRef, context: string): string | null => {
    const chunk = chunkById.get(cite.chunk_id);
    if (!chunk) {
      return `${context}: citation ${cite.badge_number} (${cite.chunk_id}) does not resolve to a scoped chunk`;
    }
    const expectedRevision = revisions.get(cite.source_id);
    if (expectedRevision !== cite.revision || chunk.source_id !== cite.source_id || chunk.revision !== cite.revision) {
      return `${context}: citation ${cite.badge_number} does not match the captured source revision snapshot`;
    }
    if (!chunk.text.includes(cite.snippet)) {
      return `${context}: citation ${cite.badge_number} snippet is not present in the cited chunk`;
    }
    return null;
  };

  for (const cite of map.citations) {
    const err = verifyCitation(cite, "Payload citations");
    if (err) return err;
    const prev = badgeMap.get(cite.badge_number);
    if (prev && (prev.chunk_id !== cite.chunk_id || prev.snippet !== cite.snippet)) {
      return `Duplicate conflicting citation badge ${cite.badge_number}`;
    }
    badgeMap.set(cite.badge_number, cite);
  }

  for (const node of metrics.nodesById.values()) {
    const labelCheck = validateMindmapLabel(node.label);
    if (!labelCheck.valid || labelCheck.codePoints > MINDMAP_LABEL_MAX_CODE_POINTS) {
      return `Node ${node.id} has invalid label: ${labelCheck.error ?? "exceeds 80 code points"}`;
    }
    if (node.label_citations.length === 0) {
      return `Node ${node.id} label is missing supporting citations`;
    }
    if (node.summary_citations.length === 0) {
      return `Node ${node.id} summary is missing supporting citations`;
    }
    for (const cite of node.label_citations) {
      const err = verifyCitation(cite, `Node ${node.id} label`);
      if (err) return err;
    }
    for (const cite of node.summary_citations) {
      const err = verifyCitation(cite, `Node ${node.id} summary`);
      if (err) return err;
    }
  }

  return null;
}
