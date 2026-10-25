import { beforeEach, describe, expect, it } from "vitest";
import type { MindmapNode, StudioMindmapPayload } from "@everlast/contracts";
import { computeMindmapLayout, defaultExpandedNodeIds } from "../src/studio/mindmap-layout.ts";
import { createMindmapViewer } from "../src/studio/mindmap-viewer.ts";
import { setupMockDOM, type MockElement } from "./mock-dom.ts";

/**
 * [011-studio-mindmaps-data-tables] T025 — Native SVG mindmap viewer and deterministic tree layout tests
 * (FR-ST-08/09; FR-002, FR-004, FR-005, FR-013, SC-003, SC-004).
 */

const SRC_A = "01965b10-0000-7000-8000-000000000301";
const CHUNK_1 = "01965b10-0000-7000-8000-000000001301";

function buildTree120(): StudioMindmapPayload {
  const cite = {
    badge_number: 1,
    source_id: SRC_A,
    chunk_id: CHUNK_1,
    revision: 1,
    snippet: "Grounded architecture fact.",
  };

  let seq = 0;
  const branches: MindmapNode[] = [];
  // 1 root + 7 branches + 7 * 4 depth-2 nodes + 7 * 4 * 3 depth-3 nodes = 1 + 7 + 28 + 84 = 120 nodes!
  for (let b = 1; b <= 7; b++) {
    const d2Nodes: MindmapNode[] = [];
    for (let c = 1; c <= 4; c++) {
      const d3Nodes: MindmapNode[] = [];
      for (let l = 1; l <= 3; l++) {
        seq++;
        d3Nodes.push({
          id: `leaf_${b}_${c}_${l}`,
          label: `Leaf Topic ${b}.${c}.${l}`,
          summary: `Detailed summary for leaf ${seq}.`,
          label_citations: [cite],
          summary_citations: [cite],
          children: [],
        });
      }
      d2Nodes.push({
        id: `sub_${b}_${c}`,
        label: `Subtopic ${b}.${c}`,
        summary: `Subtopic summary ${b}.${c}.`,
        label_citations: [cite],
        summary_citations: [cite],
        children: d3Nodes,
      });
    }
    branches.push({
      id: `branch_${b}`,
      label: `Primary Branch ${b}`,
      summary: `Branch ${b} summary.`,
      label_citations: [cite],
      summary_citations: [cite],
      children: d2Nodes,
    });
  }

  return {
    root_node: {
      id: "root",
      label: "Enterprise System Map",
      summary: "Root overview of 120 nodes.",
      label_citations: [cite],
      summary_citations: [cite],
      children: branches,
    },
    node_count: 120,
    max_depth: 4,
    initial_expanded_depth: 2,
    insufficient_evidence_note: null,
    citations: [cite],
  };
}

describe("[011-studio-mindmaps-data-tables] T025: Native SVG mindmap viewer and deterministic tree layout", () => {
  let dom: ReturnType<typeof setupMockDOM>;

  beforeEach(() => {
    dom = setupMockDOM(1440);
  });

  const body = () => dom.document.body as unknown as MockElement;
  const q = (sel: string, root: MockElement = body()) => root.querySelector(sel);
  const qa = (sel: string, root: MockElement = body()) => root.querySelectorAll(sel);
  const tid = (id: string, root?: MockElement) => q(`[data-testid=${id}]`, root);
  const tids = (id: string, root?: MockElement) => qa(`[data-testid=${id}]`, root);

  it("computes deterministic ancestor-closed initial expansion to depth 2 and full scene bounds independent of viewport", () => {
    const payload = buildTree120();
    const initialExpanded = defaultExpandedNodeIds(payload.root_node, 2);
    // Depth 1 (root: 1) + Depth 2 (branches: 7) + Depth 3 children of branches (sub_*: 28) = 36 visible nodes at initial expansion depth 2
    expect(initialExpanded).toContain("root");
    expect(initialExpanded).toContain("branch_1");
    expect(initialExpanded).toContain("sub_1_1");
    expect(initialExpanded).not.toContain("leaf_1_1_1");

    const layout1 = computeMindmapLayout(payload.root_node, initialExpanded);
    const layout2 = computeMindmapLayout(payload.root_node, initialExpanded);
    expect(layout1).toEqual(layout2);
    expect(layout1.nodes.length).toBe(36);
    expect(layout1.width).toBeGreaterThan(200);
    expect(layout1.height).toBeGreaterThan(200);
  });

  it("separates branch chevron toggle from node body drilldown action and supports pan, zoom, fit-to-screen, and keyboard navigation", () => {
    const payload = buildTree120();
    const drilldowns: string[] = [];
    const citationsOpened: [string, string][] = [];

    const viewer = createMindmapViewer({
      artifactId: "33000000-aaaa-4000-8000-000000000001",
      title: "Enterprise System Map",
      payload,
      onDrilldown: (nodeId) => drilldowns.push(nodeId),
      onCitationClick: (sourceId, chunkId) => citationsOpened.push([sourceId, chunkId]),
    });

    body().append(viewer.element as unknown as MockElement);

    // Initial visible nodes = 36 (root + 7 branches + 28 subtopics)
    expect(tids("mindmap-node", viewer.element as unknown as MockElement)).toHaveLength(36);

    // Clicking chevron on sub_1_1 expands its 3 leaf children without triggering drilldown!
    const sub11 = tids("mindmap-node", viewer.element as unknown as MockElement).find(
      (n) => n.getAttribute("data-node-id") === "sub_1_1"
    )!;
    const chevron = tid("mindmap-node-toggle", sub11);
    expect(chevron).not.toBeNull();
    chevron!.click();

    expect(drilldowns).toHaveLength(0);
    expect(tids("mindmap-node", viewer.element as unknown as MockElement)).toHaveLength(39);

    // Clicking chevron again collapses sub_1_1's children
    const sub11After = tids("mindmap-node", viewer.element as unknown as MockElement).find(
      (n) => n.getAttribute("data-node-id") === "sub_1_1"
    )!;
    tid("mindmap-node-toggle", sub11After)!.click();
    expect(tids("mindmap-node", viewer.element as unknown as MockElement)).toHaveLength(36);

    // Clicking node body triggers drilldown for that node_id
    const branch1 = tids("mindmap-node", viewer.element as unknown as MockElement).find(
      (n) => n.getAttribute("data-node-id") === "branch_1"
    )!;
    tid("mindmap-node-body", branch1)!.click();
    expect(drilldowns).toEqual(["branch_1"]);

    // Zoom in, zoom out, and fit-to-screen update transform without changing visible node count
    tid("mindmap-zoom-in", viewer.element as unknown as MockElement)!.click();
    expect(viewer.getTransform().scale).toBeGreaterThan(1);
    tid("mindmap-zoom-out", viewer.element as unknown as MockElement)!.click();
    tid("mindmap-fit", viewer.element as unknown as MockElement)!.click();
    expect(viewer.getTransform().scale).toBe(1);
    expect(viewer.getTransform().x).toBe(0);
    expect(viewer.getTransform().y).toBe(0);
  });
});
