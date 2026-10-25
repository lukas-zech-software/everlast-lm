import {
  inspectMindmapTree,
  MindmapExportRequestSchema,
  StudioParamsError,
  validateExpandedNodeIds,
  type MindmapNode,
  type StudioMindmapExportScene,
  type StudioMindmapPayload,
} from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T031 — Trusted full-expanded-tree SVG scene generator and export validator
 * (FR-ST-09, C-03, NFR-SEC-02; FR-004, FR-010, FR-011, FR-014, SC-004, SC-008).
 *
 * Emits allowlisted inert SVG primitives (`<svg>`, `<style>`, `<g>`, `<path>`, `<rect>`, `<text>`) with XML-escaped
 * text, zero `<script>`, zero `on*` event attributes, zero `<foreignObject>`, and zero external URLs or font fetches.
 */

const NODE_WIDTH = 220;
/** About what fits in NODE_WIDTH minus padding at 13px. */
const MAX_LABEL_CHARS = 24;
const NODE_HEIGHT = 48;
const LEVEL_X_GAP = 280;
const ROW_Y_GAP = 64;
const PADDING = 48;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "mindmap";
}

interface PlacedNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacedEdge {
  path: string;
}

function layoutTree(root: MindmapNode, visibleSet: ReadonlySet<string>): {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
} {
  const nodes: PlacedNode[] = [];
  const edges: PlacedEdge[] = [];
  let leafRow = 0;

  const place = (node: MindmapNode, depth: number): PlacedNode => {
    const visibleChildren = node.children.filter((c) => visibleSet.has(c.id));
    const x = PADDING + depth * LEVEL_X_GAP;
    let y: number;
    const placedChildren: PlacedNode[] = [];

    if (visibleChildren.length === 0) {
      y = PADDING + leafRow * ROW_Y_GAP;
      leafRow += 1;
    } else {
      for (const child of visibleChildren) {
        placedChildren.push(place(child, depth + 1));
      }
      y = Math.round((placedChildren[0]!.y + placedChildren[placedChildren.length - 1]!.y) / 2);
    }

    const placed: PlacedNode = {
      id: node.id,
      label: node.label,
      depth,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    nodes.push(placed);

    for (const child of placedChildren) {
      const x1 = x + NODE_WIDTH;
      const y1 = y + Math.round(NODE_HEIGHT / 2);
      const x2 = child.x;
      const y2 = child.y + Math.round(NODE_HEIGHT / 2);
      const midX = Math.round((x1 + x2) / 2);
      edges.push({
        path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      });
    }
    return placed;
  };

  place(root, 0);

  let width = 400;
  let height = 240;
  for (const n of nodes) {
    if (n.x + n.width + PADDING > width) width = n.x + n.width + PADDING;
    if (n.y + n.height + PADDING > height) height = n.y + n.height + PADDING;
  }

  return { nodes, edges, width, height };
}

export function buildMindmapExportScene(
  title: string,
  payload: StudioMindmapPayload,
  rawRequest: unknown
): StudioMindmapExportScene {
  const req = MindmapExportRequestSchema.parse(rawRequest);
  const check = validateExpandedNodeIds(payload.root_node, req.expanded_node_ids);
  if (!check.valid) {
    throw new StudioParamsError(check.error ?? "Invalid expanded_node_ids");
  }

  const metrics = inspectMindmapTree(payload.root_node);
  const visibleSet = new Set(req.expanded_node_ids);
  for (const id of visibleSet) {
    if (!metrics.nodesById.has(id)) {
      throw new StudioParamsError(`Unknown node ID ${id} in expanded_node_ids`);
    }
  }

  const { nodes, edges, width, height } = layoutTree(payload.root_node, visibleSet);
  const scale = req.format === "png" ? (2 as const) : (1 as const);

  const edgeElements = edges
    .map((e) => `    <path class="mm-edge" d="${escapeXml(e.path)}" fill="none" stroke="#64748b" stroke-width="2" />`)
    .join("\n");

  const nodeElements = nodes
    .map((n) => {
      const fill = n.depth === 0 ? "#1e293b" : n.depth === 1 ? "#334155" : "#f8fafc";
      const textFill = n.depth <= 1 ? "#f8fafc" : "#0f172a";
      const stroke = n.depth <= 1 ? "#0f172a" : "#94a3b8";
      const textX = n.x + 14;
      const textY = n.y + 29;
      // Labels stay inside their fixed-width box: shortened with an ellipsis and kept whole in a <title>
      // (PR #161 review, FR-ST-09). No clipPath: exports must not contain url() references.
      const chars = [...n.label];
      const shown = chars.length > MAX_LABEL_CHARS ? `${chars.slice(0, MAX_LABEL_CHARS - 1).join("").trimEnd()}…` : n.label;
      return [
        `    <g class="mm-node" data-node-id="${escapeXml(n.id)}" data-depth="${n.depth}">`,
        `      <title>${escapeXml(n.label)}</title>`,
        `      <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" ry="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`,
        `      <text x="${textX}" y="${textY}" fill="${textFill}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="500">${escapeXml(shown)}</text>`,
        `    </g>`,
      ].join("\n");
    })
    .join("\n");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-scale="${scale}">`,
    `  <rect width="100%" height="100%" fill="#ffffff" />`,
    `  <g class="mm-edges">`,
    edgeElements,
    `  </g>`,
    `  <g class="mm-nodes">`,
    nodeElements,
    `  </g>`,
    `</svg>`,
  ].join("\n");

  return {
    format: req.format,
    svg,
    width,
    height,
    scale,
    visible_node_ids: nodes.map((n) => n.id),
    filename: `${safeSlug(title)}.${req.format}`,
  };
}
