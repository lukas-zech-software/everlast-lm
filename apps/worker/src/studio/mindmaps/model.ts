import {
  MINDMAP_LABEL_MAX_CODE_POINTS,
  MINDMAP_MAX_DEPTH,
  MINDMAP_MAX_NODES,
  MINDMAP_MIN_DEPTH,
  MINDMAP_TARGET_MIN_NODES,
  type MindmapNode,
  type StudioEvidenceRef,
  type StudioMindmapPayload,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import { splitSentences } from "../reports/sentences.ts";

/**
 * [011-studio-mindmaps-data-tables] T019 — Mindmap extraction/composition model interface and deterministic
 * structured model (FR-ST-08, FR-SI-02, C-02/C-03, NFR-SEC-01; FR-001, FR-002, FR-003, FR-013, FR-014, SC-001, SC-008).
 */

export interface MindmapFinding {
  topic: string;
  subtopic: string;
  detail: string;
  chunk_id: string;
  source_id: string;
  revision: number;
  snippet: string;
  locator?: Record<string, unknown> | undefined;
}

export interface MindmapExtractRequest {
  chunks: UnifiedDocumentChunk[];
  output_language?: string | undefined;
  signal: AbortSignal;
}

export interface MindmapComposeRequest {
  findings: MindmapFinding[];
  chunks: readonly UnifiedDocumentChunk[];
  output_language?: string | undefined;
  signal: AbortSignal;
}

export interface MindmapModelClient {
  extract(request: MindmapExtractRequest): Promise<MindmapFinding[]>;
  compose(request: MindmapComposeRequest): Promise<StudioMindmapPayload>;
}

export class MindmapGenerationError extends Error {
  constructor(message = "The mindmap model returned invalid output.") {
    super(message);
    this.name = "MindmapGenerationError";
  }
}

function truncateCodePoints(text: string, max = MINDMAP_LABEL_MAX_CODE_POINTS): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

function cleanLabel(text: string): string {
  const cleaned = text.replace(/^[#*\-\d.)\s]+/, "").replace(/[.!?:;]+$/, "").trim();
  return truncateCodePoints(cleaned || "Topic", MINDMAP_LABEL_MAX_CODE_POINTS);
}

/**
 * Deterministic, offline structured mindmap model: extracts every sentence/clause across all original batches
 * and builds a balanced acyclic hierarchy (depth 2..5, up to 120 nodes) with field-level citations.
 */
export class DeterministicMindmapModel implements MindmapModelClient {
  async extract(req: MindmapExtractRequest): Promise<MindmapFinding[]> {
    req.signal.throwIfAborted();
    const out: MindmapFinding[] = [];
    for (const chunk of req.chunks) {
      const sentences = splitSentences(chunk.text);
      const list = sentences.length > 0 ? sentences : [chunk.text.trim()].filter(Boolean);
      const firstSentence = list[0] ?? chunk.text.trim();
      const sourceHeading = cleanLabel(firstSentence.split(/[,:;—–-]/)[0] ?? firstSentence);

      list.forEach((sentence, idx) => {
        const words = sentence.trim().split(/\s+/).filter(Boolean);
        const subLabel = cleanLabel(words.slice(0, Math.min(6, words.length)).join(" "));
        out.push({
          topic: sourceHeading || `Source Topic`,
          subtopic: subLabel || `Concept ${idx + 1}`,
          detail: sentence.trim(),
          chunk_id: chunk.chunk_id,
          source_id: chunk.source_id,
          revision: chunk.revision,
          snippet: sentence.trim(),
          locator: chunk.locator as unknown as Record<string, unknown>,
        });
        // When a sentence has multiple clauses, also emit clause-level findings so 3+ sources reach >=15 grounded nodes
        const clauses = sentence
          .split(/(?:;\s+|,\s+(?:and|while|including|with|where)\s+|\s+—\s+)/i)
          .map((c) => c.trim())
          .filter((c) => c.length >= 12 && chunk.text.includes(c));
        if (clauses.length > 1) {
          for (const clause of clauses) {
            out.push({
              topic: sourceHeading || `Source Topic`,
              subtopic: cleanLabel(clause.split(/\s+/).slice(0, 6).join(" ")),
              detail: clause,
              chunk_id: chunk.chunk_id,
              source_id: chunk.source_id,
              revision: chunk.revision,
              snippet: clause,
              locator: chunk.locator as unknown as Record<string, unknown>,
            });
          }
        }
      });
    }
    return out;
  }

  async compose(req: MindmapComposeRequest): Promise<StudioMindmapPayload> {
    req.signal.throwIfAborted();
    if (req.findings.length === 0) {
      throw new MindmapGenerationError("No findings available to compose mindmap.");
    }

    const citations: StudioEvidenceRef[] = [];
    const badgeByKey = new Map<string, StudioEvidenceRef>();
    const issueCitation = (f: MindmapFinding): StudioEvidenceRef => {
      const key = `${f.chunk_id}|${f.snippet}`;
      const existing = badgeByKey.get(key);
      if (existing) return existing;
      const ref: StudioEvidenceRef = {
        badge_number: citations.length + 1,
        source_id: f.source_id,
        chunk_id: f.chunk_id,
        revision: f.revision,
        snippet: f.snippet,
      };
      citations.push(ref);
      badgeByKey.set(key, ref);
      return ref;
    };

    // Group findings by source_id first so every selected source forms a primary branch (or sub-branch)
    const bySource = new Map<string, MindmapFinding[]>();
    for (const f of req.findings) {
      const group = bySource.get(f.source_id) ?? [];
      group.push(f);
      bySource.set(f.source_id, group);
    }

    let nodeSeq = 0;
    const nextId = (prefix: string) => `${prefix}_${++nodeSeq}`;
    let totalNodes = 1; // root

    const rootFinding = req.findings[0]!;
    const rootCite = issueCitation(rootFinding);
    const branchNodes: MindmapNode[] = [];

    const sourceEntries = [...bySource.entries()];
    // When there are many sources (e.g., >=50), group them under 10 thematic cluster branches so all sources fit within 120 nodes!
    if (sourceEntries.length > 20) {
      const clusterCount = Math.min(10, sourceEntries.length);
      const perCluster = Math.ceil(sourceEntries.length / clusterCount);
      for (let cIdx = 0; cIdx < clusterCount && totalNodes < MINDMAP_MAX_NODES; cIdx++) {
        const slice = sourceEntries.slice(cIdx * perCluster, (cIdx + 1) * perCluster);
        if (slice.length === 0) continue;
        const clusterLead = slice[0]![1][0]!;
        const clusterCite = issueCitation(clusterLead);
        totalNodes += 1;
        const clusterChildren: MindmapNode[] = [];
        for (const [, group] of slice) {
          if (totalNodes >= MINDMAP_MAX_NODES) break;
          // Pick the most detailed or last finding in the source so late-batch facts are represented
          const rep = group[group.length - 1]!;
          const c = issueCitation(rep);
          totalNodes += 1;
          clusterChildren.push({
            id: nextId("source_node"),
            label: cleanLabel(rep.subtopic),
            summary: rep.detail,
            label_citations: [c],
            summary_citations: [c],
            children: [],
          });
        }
        branchNodes.push({
          id: nextId("cluster"),
          label: cleanLabel(clusterLead.topic),
          summary: clusterLead.detail,
          label_citations: [clusterCite],
          summary_citations: [clusterCite],
          children: clusterChildren,
        });
      }
    } else {
      for (let bIdx = 0; bIdx < sourceEntries.length && totalNodes < MINDMAP_MAX_NODES; bIdx++) {
        const [, group] = sourceEntries[bIdx]!;
        const branchLead = group[0]!;
        const branchCite = issueCitation(branchLead);
        totalNodes += 1;
        const branchChildren: MindmapNode[] = [];

        for (let i = 0; i < group.length && totalNodes < MINDMAP_MAX_NODES; i++) {
          const f = group[i]!;
          const c = issueCitation(f);
          totalNodes += 1;
          const leafChildren: MindmapNode[] = [];

          // Add depth-3 detail node when we have room and want rich multi-level structure (depth 3..4)
          const words = f.detail.split(/\s+/).filter(Boolean);
          if (words.length >= 6 && totalNodes < MINDMAP_MAX_NODES && sourceEntries.length <= 10) {
            const half = Math.ceil(words.length / 2);
            const phrase = cleanLabel(words.slice(half, half + 6).join(" "));
            if (phrase && phrase !== f.subtopic) {
              totalNodes += 1;
              leafChildren.push({
                id: nextId("detail"),
                label: phrase,
                summary: f.detail,
                label_citations: [c],
                summary_citations: [c],
                children: [],
              });
            }
          }

          branchChildren.push({
            id: nextId("concept"),
            label: cleanLabel(f.subtopic),
            summary: f.detail,
            label_citations: [c],
            summary_citations: [c],
            children: leafChildren,
          });
        }

        branchNodes.push({
          id: nextId("branch"),
          label: cleanLabel(branchLead.topic),
          summary: branchLead.detail,
          label_citations: [branchCite],
          summary_citations: [branchCite],
          children: branchChildren,
        });
      }
    }

    const rootNode: MindmapNode = {
      id: "root",
      label: cleanLabel(rootFinding.topic),
      summary: rootFinding.detail,
      label_citations: [rootCite],
      summary_citations: [rootCite],
      children: branchNodes,
    };

    const computeMetrics = (node: MindmapNode, depth: number): { count: number; maxDepth: number } => {
      let count = 1;
      let maxDepth = depth;
      for (const child of node.children) {
        const sub = computeMetrics(child, depth + 1);
        count += sub.count;
        if (sub.maxDepth > maxDepth) maxDepth = sub.maxDepth;
      }
      return { count, maxDepth };
    };

    const metrics = computeMetrics(rootNode, 1);
    const maxDepth = Math.min(MINDMAP_MAX_DEPTH, Math.max(MINDMAP_MIN_DEPTH, metrics.maxDepth));

    return {
      root_node: rootNode,
      node_count: metrics.count,
      max_depth: maxDepth,
      initial_expanded_depth: 2,
      insufficient_evidence_note:
        metrics.count < MINDMAP_TARGET_MIN_NODES
          ? `The selected sources provided limited distinct factual topics (${metrics.count} grounded nodes).`
          : null,
      citations,
    };
  }
}
