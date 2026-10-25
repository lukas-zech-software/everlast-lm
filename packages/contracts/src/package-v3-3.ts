import { z } from "zod";
import { UUID_V7_REGEX } from "./document-chunk.ts";
import { OutputLanguageSchema } from "./package-v2-1.ts";
import type { PromptValidationResult } from "./package-v2-4.ts";

/**
 * [011-studio-mindmaps-data-tables] T008 — Package 3.3 Studio Structure & Data Extraction
 * (FR-ST-08, FR-ST-09, FR-ST-18, C-01, C-03; FR-002, FR-007, FR-008, FR-013, FR-015, FR-016, FR-017).
 */

export const STUDIO_MINDMAP_PLUGIN_TYPE = "mindmap" as const;
export const STUDIO_DATA_TABLE_PLUGIN_TYPE = "data_table" as const;

export const StudioPluginTypeSchema = z.enum(["report", "mindmap", "data_table"]);
export type StudioPluginType = z.infer<typeof StudioPluginTypeSchema>;

export const MindmapSubtypeSchema = z.literal("default");
export type MindmapSubtype = z.infer<typeof MindmapSubtypeSchema>;

export const DataTableSubtypeSchema = z.literal("default");
export type DataTableSubtype = z.infer<typeof DataTableSubtypeSchema>;

export const MINDMAP_MIN_DEPTH = 2;
export const MINDMAP_MAX_DEPTH = 5;
export const MINDMAP_TARGET_MIN_NODES = 15;
export const MINDMAP_MAX_NODES = 120;
export const MINDMAP_INITIAL_EXPANDED_DEPTH = 2 as const;
export const MINDMAP_LABEL_MAX_CODE_POINTS = 80;

export const DATA_TABLE_FOCUS_PROMPT_MAX = 2000;
export const DATA_TABLE_MIN_COLUMNS = 2;
export const DATA_TABLE_MAX_COLUMNS = 25;
export const DATA_TABLE_MIN_ROWS = 1;
export const DATA_TABLE_MAX_ROWS = 500;
export const DATA_TABLE_MISSING_MARKER = "N/A (Not in sources)" as const;

export const STUDIO_NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DATA_TABLE_COLUMN_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const DataTableSchemaIdSchema = z.enum([
  "auto",
  "vendor_comparison",
  "feature_matrix",
  "timeline_events",
  "findings_methodology",
  "key_metrics",
]);
export type DataTableSchemaId = z.infer<typeof DataTableSchemaIdSchema>;

export const StudioEvidenceRefSchema = z
  .object({
    badge_number: z.number().int().positive(),
    chunk_id: z.string().regex(UUID_V7_REGEX, "chunk_id must be a valid UUID v7"),
    source_id: z.string().uuid(),
    revision: z.number().int().positive(),
    snippet: z.string().min(1),
  })
  .strict();
export type StudioEvidenceRef = z.infer<typeof StudioEvidenceRefSchema>;

export const StudioCoverageManifestSchema = z
  .object({
    total_sources: z.number().int().positive(),
    total_chunks: z.number().int().positive(),
    batch_count: z.number().int().positive(),
    processed_batch_count: z.number().int().positive(),
    all_original_chunks_visited: z.literal(true),
  })
  .strict();
export type StudioCoverageManifest = z.infer<typeof StudioCoverageManifestSchema>;

/** FR-ST-08 / FR-002: Node label is 1..80 Unicode code points after trimming outer whitespace; never truncates. */
export function validateMindmapLabel(input: string): PromptValidationResult {
  const trimmed = input.trim();
  const codePoints = Array.from(trimmed).length;
  if (codePoints < 1) {
    return { valid: false, codePoints: 0, error: "Mindmap node label must not be empty or whitespace only." };
  }
  if (codePoints > MINDMAP_LABEL_MAX_CODE_POINTS) {
    return {
      valid: false,
      codePoints,
      error: `Mindmap node label exceeds ${MINDMAP_LABEL_MAX_CODE_POINTS} code points (received ${codePoints}).`,
    };
  }
  if (/<[A-Za-z!/]/.test(trimmed)) {
    return { valid: false, codePoints, error: "Mindmap node label must be plain text without HTML markup." };
  }
  return { valid: true, codePoints, normalized: trimmed };
}

/** FR-ST-18 / FR-007: Optional focus_prompt is 0..2,000 Unicode code points after trimming outer whitespace. */
export function validateDataTableFocusPrompt(input: string): PromptValidationResult {
  const trimmed = input.trim();
  const codePoints = Array.from(trimmed).length;
  if (codePoints > DATA_TABLE_FOCUS_PROMPT_MAX) {
    return {
      valid: false,
      codePoints,
      error: `Data table focus prompt exceeds ${DATA_TABLE_FOCUS_PROMPT_MAX} code points (received ${codePoints}).`,
    };
  }
  return { valid: true, codePoints, normalized: trimmed };
}

export const DataTableFocusPromptSchema = z.string().transform((value, ctx) => {
  const result = validateDataTableFocusPrompt(value);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid focus prompt" });
    return z.NEVER;
  }
  return result.normalized as string;
});

export interface MindmapNode {
  id: string;
  label: string;
  summary: string;
  label_citations: StudioEvidenceRef[];
  summary_citations: StudioEvidenceRef[];
  children: MindmapNode[];
}

export const MindmapNodeSchema: z.ZodType<MindmapNode> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(STUDIO_NODE_ID_PATTERN, "node id must be a 1..64 char opaque identifier"),
      label: z.string().superRefine((val, ctx) => {
        const check = validateMindmapLabel(val);
        if (!check.valid) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.error ?? "Invalid node label" });
        }
      }),
      summary: z
        .string()
        .trim()
        .min(1, "node summary must not be empty")
        .refine((s) => !/<[A-Za-z!/]/.test(s), "node summary must be plain text without HTML markup"),
      label_citations: z.array(StudioEvidenceRefSchema).min(1, "node label must carry at least one citation"),
      summary_citations: z.array(StudioEvidenceRefSchema).min(1, "node summary must carry at least one citation"),
      children: z.array(MindmapNodeSchema),
    })
    .strict()
);

export interface MindmapTreeMetrics {
  nodeCount: number;
  maxDepth: number;
  duplicateIds: string[];
  parentById: Map<string, string | null>;
  nodesById: Map<string, MindmapNode>;
}

export function inspectMindmapTree(root: MindmapNode): MindmapTreeMetrics {
  const parentById = new Map<string, string | null>();
  const nodesById = new Map<string, MindmapNode>();
  const duplicateIds: string[] = [];
  let nodeCount = 0;
  let maxDepth = 0;

  const visit = (node: MindmapNode, parentId: string | null, depth: number): void => {
    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (nodesById.has(node.id)) {
      duplicateIds.push(node.id);
      return;
    }
    nodesById.set(node.id, node);
    parentById.set(node.id, parentId);
    for (const child of node.children) {
      visit(child, node.id, depth + 1);
    }
  };
  visit(root, null, 1);
  return { nodeCount, maxDepth, duplicateIds, parentById, nodesById };
}

export const StudioMindmapPayloadSchema = z
  .object({
    root_node: MindmapNodeSchema,
    node_count: z.number().int().min(2).max(MINDMAP_MAX_NODES),
    max_depth: z.number().int().min(MINDMAP_MIN_DEPTH).max(MINDMAP_MAX_DEPTH),
    initial_expanded_depth: z.literal(MINDMAP_INITIAL_EXPANDED_DEPTH),
    insufficient_evidence_note: z.string().trim().min(1).nullable(),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const metrics = inspectMindmapTree(payload.root_node);
    if (metrics.duplicateIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["root_node"],
        message: `Duplicate node ID(s): ${metrics.duplicateIds.join(", ")}`,
      });
    }
    if (metrics.nodeCount !== payload.node_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["node_count"],
        message: `node_count (${payload.node_count}) does not match actual tree node count (${metrics.nodeCount})`,
      });
    }
    if (metrics.nodeCount > MINDMAP_MAX_NODES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["node_count"],
        message: `Mindmap exceeds maximum ${MINDMAP_MAX_NODES} nodes (${metrics.nodeCount})`,
      });
    }
    if (metrics.maxDepth < MINDMAP_MIN_DEPTH || metrics.maxDepth > MINDMAP_MAX_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max_depth"],
        message: `Mindmap depth must be between ${MINDMAP_MIN_DEPTH} and ${MINDMAP_MAX_DEPTH} (actual ${metrics.maxDepth})`,
      });
    }
    if (metrics.maxDepth !== payload.max_depth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max_depth"],
        message: `max_depth (${payload.max_depth}) does not match actual tree depth (${metrics.maxDepth})`,
      });
    }
    if (metrics.nodeCount < MINDMAP_TARGET_MIN_NODES && !payload.insufficient_evidence_note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insufficient_evidence_note"],
        message: `Mindmap with fewer than ${MINDMAP_TARGET_MIN_NODES} nodes must include insufficient_evidence_note`,
      });
    }
    const badgeSet = new Set(payload.citations.map((c) => `${c.badge_number}|${c.chunk_id}`));
    for (const node of metrics.nodesById.values()) {
      for (const ref of [...node.label_citations, ...node.summary_citations]) {
        if (!badgeSet.has(`${ref.badge_number}|${ref.chunk_id}`)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["citations"],
            message: `Node ${node.id} references citation ${ref.badge_number} (${ref.chunk_id}) not present in payload.citations`,
          });
        }
      }
    }
  });
export type StudioMindmapPayload = z.infer<typeof StudioMindmapPayloadSchema>;

/** Validates that `expanded_node_ids` is non-empty, duplicate-free, exists in `root`, includes `root.id`, and is ancestor-closed. */
export function validateExpandedNodeIds(
  root: MindmapNode,
  expandedNodeIds: readonly string[]
): { valid: boolean; error?: string } {
  if (expandedNodeIds.length === 0) {
    return { valid: false, error: "expanded_node_ids must contain at least the root node." };
  }
  const unique = new Set(expandedNodeIds);
  if (unique.size !== expandedNodeIds.length) {
    return { valid: false, error: "expanded_node_ids must not contain duplicates." };
  }
  const metrics = inspectMindmapTree(root);
  if (!unique.has(root.id)) {
    return { valid: false, error: `expanded_node_ids must include root node ${root.id}.` };
  }
  for (const id of unique) {
    if (!metrics.nodesById.has(id)) {
      return { valid: false, error: `Unknown node ID ${id} in expanded_node_ids.` };
    }
    const parentId = metrics.parentById.get(id);
    if (parentId !== null && parentId !== undefined && !unique.has(parentId)) {
      return { valid: false, error: `Node ${id} cannot be expanded/visible when its parent ${parentId} is not included.` };
    }
  }
  return { valid: true };
}

/* ------------------------ Data Table Payload (FR-ST-18) ------------------------ */

export const DataTableColumnSchema = z
  .object({
    id: z.string().regex(DATA_TABLE_COLUMN_ID_PATTERN, "column id must be snake_case"),
    label: z
      .string()
      .trim()
      .min(1)
      .refine((l) => Array.from(l.trim()).length <= MINDMAP_LABEL_MAX_CODE_POINTS, "column label exceeds 80 code points"),
    citations: z.array(StudioEvidenceRefSchema).min(1, "column header must carry at least one citation"),
  })
  .strict();
export type DataTableColumn = z.infer<typeof DataTableColumnSchema>;

export const DataTableCellValueSchema = z
  .object({
    value: z.string().trim().min(1),
    citations: z.array(StudioEvidenceRefSchema).min(1),
  })
  .strict();
export type DataTableCellValue = z.infer<typeof DataTableCellValueSchema>;

export const DataTableSupportedCellSchema = z
  .object({
    state: z.literal("supported"),
    display_text: z.string().trim().min(1),
    values: z.array(DataTableCellValueSchema).length(1),
    disagreement: z.literal(false),
  })
  .strict();

export const DataTableConflictCellSchema = z
  .object({
    state: z.literal("conflict"),
    display_text: z.string().trim().min(1),
    values: z
      .array(DataTableCellValueSchema)
      .min(2)
      .refine(
        (vals) => new Set(vals.map((v) => v.value.trim())).size === vals.length,
        "conflict cell must contain at least 2 distinct values"
      ),
    disagreement: z.literal(true),
  })
  .strict();

export const DataTableMissingCellSchema = z
  .object({
    state: z.literal("missing"),
    display_text: z.literal(DATA_TABLE_MISSING_MARKER),
    values: z.array(DataTableCellValueSchema).length(0),
    disagreement: z.literal(false),
  })
  .strict();

export const DataTableCellSchema = z.discriminatedUnion("state", [
  DataTableSupportedCellSchema,
  DataTableConflictCellSchema,
  DataTableMissingCellSchema,
]);
export type DataTableCell = z.infer<typeof DataTableCellSchema>;

export const DataTableRowSchema = z
  .object({
    item_id: z.string().regex(STUDIO_NODE_ID_PATTERN, "item_id must be a 1..64 char identifier"),
    item_label: z.string().trim().min(1),
    item_citations: z.array(StudioEvidenceRefSchema).min(1),
    cells: z.record(z.string(), DataTableCellSchema),
  })
  .strict();
export type DataTableRow = z.infer<typeof DataTableRowSchema>;

export const StudioDataTablePayloadSchema = z
  .object({
    columns: z.array(DataTableColumnSchema).min(DATA_TABLE_MIN_COLUMNS).max(DATA_TABLE_MAX_COLUMNS),
    rows: z.array(DataTableRowSchema).min(DATA_TABLE_MIN_ROWS).max(DATA_TABLE_MAX_ROWS),
    schema_id: DataTableSchemaIdSchema.optional(),
    focus_prompt: z.string().nullable().optional(),
    insufficient_evidence_note: z.string().trim().min(1).nullable().optional(),
    citations: z.array(StudioEvidenceRefSchema).min(1),
    coverage: StudioCoverageManifestSchema.optional(),
  })
  .strict()
  .superRefine((table, ctx) => {
    const colIds = table.columns.map((c) => c.id);
    if (new Set(colIds).size !== colIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns"], message: "column IDs must be unique" });
    }
    const colLabels = table.columns.map((c) => c.label.trim().toLowerCase());
    if (new Set(colLabels).size !== colLabels.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns"], message: "column labels must be unique" });
    }
    const rowIds = table.rows.map((r) => r.item_id);
    if (new Set(rowIds).size !== rowIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows"], message: "row item_ids must be unique" });
    }
    const rowLabels = table.rows.map((r) => r.item_label.trim().toLowerCase());
    if (new Set(rowLabels).size !== rowLabels.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows"], message: "row item_labels must be unique (one item per row)" });
    }
    let hasSupportedOrConflict = false;
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]!;
      const cellKeys = Object.keys(row.cells);
      if (cellKeys.length !== colIds.length || !colIds.every((id) => id in row.cells)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", i, "cells"],
          message: "Every row must contain cells for the exact column ID set (rectangular table invariant).",
        });
      }
      for (const cell of Object.values(row.cells)) {
        if (cell.state === "supported" || cell.state === "conflict") {
          hasSupportedOrConflict = true;
        }
      }
    }
    if (!hasSupportedOrConflict) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows"],
        message: "A completed data table must contain at least one source-supported cell.",
      });
    }
  });
export type StudioDataTablePayload = z.infer<typeof StudioDataTablePayloadSchema>;

/** Validates that `ordered_row_ids` is a complete, duplicate-free permutation of `rows.map(r => r.item_id)`. */
export function validateOrderedRowIds(
  rows: readonly Pick<DataTableRow, "item_id">[],
  orderedRowIds: readonly string[]
): { valid: boolean; error?: string } {
  if (orderedRowIds.length !== rows.length) {
    return {
      valid: false,
      error: `ordered_row_ids length (${orderedRowIds.length}) must equal row count (${rows.length}); filtering is not allowed.`,
    };
  }
  const expected = new Set(rows.map((r) => r.item_id));
  const seen = new Set<string>();
  for (const id of orderedRowIds) {
    if (seen.has(id)) return { valid: false, error: `Duplicate row ID ${id} in ordered_row_ids.` };
    if (!expected.has(id)) return { valid: false, error: `Unknown row ID ${id} in ordered_row_ids.` };
    seen.add(id);
  }
  return { valid: true };
}

export const StudioMindmapParamsSchema = z.object({}).strict();
export type StudioMindmapParams = z.infer<typeof StudioMindmapParamsSchema>;

export const StudioDataTableParamsSchema = z
  .object({
    focus_prompt: z.string().optional(),
    schema_id: DataTableSchemaIdSchema.optional(),
  })
  .strict();
export type StudioDataTableParams = z.infer<typeof StudioDataTableParamsSchema>;

export const MindmapExportFormatSchema = z.enum(["svg", "png"]);
export type MindmapExportFormat = z.infer<typeof MindmapExportFormatSchema>;

export const MindmapExportRequestSchema = z
  .object({
    format: MindmapExportFormatSchema,
    expanded_node_ids: z.array(z.string().regex(STUDIO_NODE_ID_PATTERN)).min(1).max(MINDMAP_MAX_NODES),
  })
  .strict();
export type MindmapExportRequest = z.infer<typeof MindmapExportRequestSchema>;

export const StudioMindmapExportSceneSchema = z
  .object({
    format: MindmapExportFormatSchema,
    svg: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
    scale: z.union([z.literal(1), z.literal(2)]),
    visible_node_ids: z.array(z.string().regex(STUDIO_NODE_ID_PATTERN)).min(1),
    filename: z.string().min(1),
  })
  .strict();
export type StudioMindmapExportScene = z.infer<typeof StudioMindmapExportSceneSchema>;

export const DataTableExportFormatSchema = z.enum(["csv", "xlsx"]);
export type DataTableExportFormat = z.infer<typeof DataTableExportFormatSchema>;

export const DataTableExportRequestSchema = z
  .object({
    format: DataTableExportFormatSchema,
    ordered_row_ids: z.array(z.string().regex(STUDIO_NODE_ID_PATTERN)).min(1).max(DATA_TABLE_MAX_ROWS).optional(),
  })
  .strict();
export type DataTableExportRequest = z.infer<typeof DataTableExportRequestSchema>;

export const MindmapDrilldownRequestSchema = z
  .object({
    node_id: z.string().regex(STUDIO_NODE_ID_PATTERN),
    active_source_ids: z
      .array(z.string().uuid("source ID must be a valid UUID"))
      .min(1, "active_source_ids must contain at least 1 source ID")
      .refine((ids) => new Set(ids).size === ids.length, "active_source_ids must be unique"),
    request_id: z.string().uuid().optional(),
    output_language: OutputLanguageSchema.optional(),
  })
  .strict();
export type MindmapDrilldownRequest = z.infer<typeof MindmapDrilldownRequestSchema>;

export interface StudioDrilldownResponse {
  prompt: string;
  node_id: string;
  node_label: string;
  parent_label: string | null;
  messages: unknown[];
}

/* ------------------------ Structured Model Schemas (FR-ST-08/18) ------------------------ */

export const MindmapFindingSchema = z
  .object({
    category: z.string().trim().min(1).max(80),
    subtopic: z.string().trim().min(1).max(80),
    fact_label: z.string().trim().min(1).max(80).optional(),
    summary: z.string().trim().min(1).max(500),
    chunk_id: z.string().regex(UUID_V7_REGEX),
    snippet: z.string().trim().min(1),
  })
  .strict();
export type MindmapFinding = z.infer<typeof MindmapFindingSchema>;

export const DataTableFindingSchema = z
  .object({
    item_label: z.string().trim().min(1).max(120),
    attribute_id: z.string().regex(DATA_TABLE_COLUMN_ID_PATTERN),
    attribute_label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(1000),
    chunk_id: z.string().regex(UUID_V7_REGEX),
    snippet: z.string().trim().min(1),
  })
  .strict();
export type DataTableFinding = z.infer<typeof DataTableFindingSchema>;
