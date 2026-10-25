import type { MindmapNode } from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T030 — Deterministic tree layout for native SVG mindmap viewer and exports
 * (FR-ST-08/09; FR-002, FR-004, FR-005, FR-013, SC-003, SC-004).
 */

export interface PositionedMindmapNode {
  id: string;
  label: string;
  summary: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
  node: MindmapNode;
}

export interface MindmapEdge {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  path: string;
}

export interface MindmapLayout {
  nodes: PositionedMindmapNode[];
  edges: MindmapEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 48;
const LEVEL_X_GAP = 280;
const ROW_Y_GAP = 64;
const PADDING = 48;

/**
 * Computes the default ancestor-closed visible node ID set expanded to `maxDepth` (0-indexed depth from root = 0,
 * so `maxDepth = 2` includes root (0), primary branches (1), and depth-2 children (2)).
 */
export function defaultExpandedNodeIds(root: MindmapNode, maxDepth = 2): string[] {
  const ids: string[] = [];
  const walk = (node: MindmapNode, depth: number) => {
    ids.push(node.id);
    if (depth >= maxDepth) return;
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return ids;
}

/**
 * Deterministic horizontal tree layout over the ancestor-closed visible node IDs.
 * Full scene bounds (`width`, `height`) depend only on the visible tree, never on the browser viewport transform.
 */
export function computeMindmapLayout(
  root: MindmapNode,
  visibleNodeIds: Iterable<string>
): MindmapLayout {
  const visible = new Set(visibleNodeIds);
  visible.add(root.id);

  const nodes: PositionedMindmapNode[] = [];
  const edges: MindmapEdge[] = [];
  let leafRow = 0;

  const place = (node: MindmapNode, depth: number, parentId: string | null): PositionedMindmapNode => {
    const visibleChildren = node.children.filter((c) => visible.has(c.id));
    const x = PADDING + depth * LEVEL_X_GAP;
    let y: number;

    const placedChildren: PositionedMindmapNode[] = [];
    if (visibleChildren.length === 0) {
      y = PADDING + leafRow * ROW_Y_GAP;
      leafRow += 1;
    } else {
      for (const child of visibleChildren) {
        placedChildren.push(place(child, depth + 1, node.id));
      }
      const firstY = placedChildren[0]!.y;
      const lastY = placedChildren[placedChildren.length - 1]!.y;
      y = Math.round((firstY + lastY) / 2);
    }

    const positioned: PositionedMindmapNode = {
      id: node.id,
      label: node.label,
      summary: node.summary,
      depth,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      hasChildren: node.children.length > 0,
      expanded: visibleChildren.length > 0,
      parentId,
      node,
    };
    nodes.push(positioned);

    for (const child of placedChildren) {
      const x1 = x + NODE_WIDTH;
      const y1 = y + Math.round(NODE_HEIGHT / 2);
      const x2 = child.x;
      const y2 = child.y + Math.round(NODE_HEIGHT / 2);
      const midX = Math.round((x1 + x2) / 2);
      edges.push({
        fromId: node.id,
        toId: child.id,
        x1,
        y1,
        x2,
        y2,
        path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      });
    }

    return positioned;
  };

  place(root, 0, null);

  let maxRight = 400;
  let maxBottom = 240;
  for (const n of nodes) {
    if (n.x + n.width + PADDING > maxRight) maxRight = n.x + n.width + PADDING;
    if (n.y + n.height + PADDING > maxBottom) maxBottom = n.y + n.height + PADDING;
  }

  return {
    nodes,
    edges,
    width: maxRight,
    height: maxBottom,
  };
}
