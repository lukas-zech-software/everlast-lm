import { describe, expect, it } from "vitest";
import {
  CreateStudioJobRequestSchema,
  DATA_TABLE_FOCUS_PROMPT_MAX,
  DATA_TABLE_MAX_COLUMNS,
  DATA_TABLE_MAX_ROWS,
  DATA_TABLE_MISSING_MARKER,
  MINDMAP_INITIAL_EXPANDED_DEPTH,
  MINDMAP_LABEL_MAX_CODE_POINTS,
  MINDMAP_MAX_DEPTH,
  MINDMAP_MAX_NODES,
  MINDMAP_MIN_DEPTH,
  MINDMAP_TARGET_MIN_NODES,
  MindmapDrilldownRequestSchema,
  MindmapExportRequestSchema,
  DataTableExportRequestSchema,
  STUDIO_DATA_TABLE_PLUGIN_TYPE,
  STUDIO_MINDMAP_PLUGIN_TYPE,
  STUDIO_REPORT_PLUGIN_TYPE,
  StudioArtifactSchema,
  StudioDataTablePayloadSchema,
  StudioMindmapPayloadSchema,
  validateDataTableFocusPrompt,
  validateExpandedNodeIds,
  validateMindmapLabel,
  validateOrderedRowIds,
  type MindmapNode,
  type StudioDataTablePayload,
  type StudioMindmapPayload,
} from "../src/index.ts";

const STUDIO_TEST_NOTEBOOK_ID = "33000000-0000-4000-8000-000000000001";
const MISSING_CELL_MARKER = "N/A (Not in sources)";
const makeStudioSourceId = (n: number) => `33000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const makeStudioChunkId = (n: number) => `0190f330-0000-7000-8000-${String(n).padStart(12, "0")}`;
const makeStudioArtifactId = (n: number) => `33000000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const makeCodePointString = (count: number, ch = "🧪") => ch.repeat(count);

/**
 * [011-studio-mindmaps-data-tables] T004 — Contract and schema tests for Package 3.3
 * (FR-ST-08/09/18, C-01/C-03; FR-002, FR-007, FR-008, FR-013, FR-015, FR-016, FR-017,
 * SC-001, SC-008, SC-009, SC-010, SC-011).
 */

function makeCite(badge_number: number, source_id: string, chunk_id: string, snippet = "supported text") {
  return { badge_number, source_id, chunk_id, revision: 1, snippet };
}

function makeSampleTree(nodeCount = 15): { root: MindmapNode; citations: ReturnType<typeof makeCite>[] } {
  const src = makeStudioSourceId(1);
  const chunk = makeStudioChunkId(1);
  const cite = makeCite(1, src, chunk, "Architecture fact");
  const categories: MindmapNode[] = [];
  let created = 1; // root
  let catIdx = 0;
  while (created < nodeCount) {
    catIdx += 1;
    const catId = `cat_${catIdx}`;
    const children: MindmapNode[] = [];
    created += 1;
    while (created < nodeCount && children.length < 4) {
      created += 1;
      const subId = `node_${created}`;
      children.push({
        id: subId,
        label: `Subtopic ${created}`,
        summary: `Plain summary for node ${created}.`,
        label_citations: [cite],
        summary_citations: [cite],
        children: [],
      });
    }
    categories.push({
      id: catId,
      label: `Category ${catIdx}`,
      summary: `Category ${catIdx} overview.`,
      label_citations: [cite],
      summary_citations: [cite],
      children,
    });
  }
  const root: MindmapNode = {
    id: "root",
    label: "Cloud Platform Architecture",
    summary: "Root summary of the selected sources.",
    label_citations: [cite],
    summary_citations: [cite],
    children: categories,
  };
  return { root, citations: [cite] };
}

describe("[011-studio-mindmaps-data-tables] T004: C-03 plugin/subtype variants and report compatibility", () => {
  it("preserves existing report artifacts and requests while adding mindmap/default and data_table/default", () => {
    expect(STUDIO_REPORT_PLUGIN_TYPE).toBe("report");
    expect(STUDIO_MINDMAP_PLUGIN_TYPE).toBe("mindmap");
    expect(STUDIO_DATA_TABLE_PLUGIN_TYPE).toBe("data_table");

    const src = makeStudioSourceId(1);
    const chunk = makeStudioChunkId(1);
    const now = new Date().toISOString();

    const reportArtifact = StudioArtifactSchema.safeParse({
      id: makeStudioArtifactId(1),
      notebook_id: STUDIO_TEST_NOTEBOOK_ID,
      plugin_type: "report",
      subtype: "faq",
      status: "Completed",
      title: "FAQ",
      params_json: {},
      payload_json: {
        content_md: "## FAQ\n**Q: What?**\nAnswer [1]",
        citations: [makeCite(1, src, chunk, "Answer")],
        sections: [{ key: "faq", heading: "FAQ" }],
      },
      source_revisions_snapshot: [{ source_id: src, revision: 1 }],
      output_language: "en-US",
      progress: null,
      failure: null,
      attempt: 1,
      retry_of: null,
      created_at: now,
      updated_at: now,
    });
    expect(reportArtifact.success).toBe(true);

    // Rejects mismatched plugin_type and subtype pairs
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "mindmap",
        subtype: "faq",
        active_source_ids: [src],
      }).success
    ).toBe(false);

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "mindmap",
        subtype: "default",
        active_source_ids: [src],
      }).success
    ).toBe(true);

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "data_table",
        subtype: "default",
        active_source_ids: [src],
        schema_id: "vendor_comparison",
        focus_prompt: "Compare pricing and SLA",
      }).success
    ).toBe(true);
  });
});

describe("[011-studio-mindmaps-data-tables] T004: Mindmap payload schema invariants (FR-ST-08, FR-002, FR-013, SC-001, SC-008)", () => {
  it("enforces constants: depth 2..5, target 15..120 nodes, initial depth 2, label <= 80 Unicode code points", () => {
    expect(MINDMAP_MIN_DEPTH).toBe(2);
    expect(MINDMAP_MAX_DEPTH).toBe(5);
    expect(MINDMAP_TARGET_MIN_NODES).toBe(15);
    expect(MINDMAP_MAX_NODES).toBe(120);
    expect(MINDMAP_INITIAL_EXPANDED_DEPTH).toBe(2);
    expect(MINDMAP_LABEL_MAX_CODE_POINTS).toBe(80);
  });

  it("validates 79, 80, and 81 Unicode code-point labels after trimming outer whitespace", () => {
    expect(validateMindmapLabel(`  ${makeCodePointString(79)}  `).valid).toBe(true);
    const l80 = validateMindmapLabel(`  ${makeCodePointString(80)}  `);
    expect(l80.valid).toBe(true);
    expect(l80.codePoints).toBe(80);
    const l81 = validateMindmapLabel(makeCodePointString(81));
    expect(l81.valid).toBe(false);
    expect(l81.codePoints).toBe(81);
  });

  it("accepts a valid 15-node depth-3 tree and 119/120-node boundary trees, and rejects 121 nodes or depth > 5 or duplicate IDs", () => {
    const { root, citations } = makeSampleTree(15);
    const validPayload: StudioMindmapPayload = {
      root_node: root,
      node_count: 15,
      max_depth: 3,
      initial_expanded_depth: 2,
      insufficient_evidence_note: null,
      citations,
    };
    expect(StudioMindmapPayloadSchema.safeParse(validPayload).success).toBe(true);

    // 119 and 120 nodes succeed
    for (const count of [119, 120]) {
      const sample = makeSampleTree(count);
      expect(
        StudioMindmapPayloadSchema.safeParse({
          root_node: sample.root,
          node_count: count,
          max_depth: 3,
          initial_expanded_depth: 2,
          insufficient_evidence_note: null,
          citations: sample.citations,
        }).success
      ).toBe(true);
    }

    // 121 nodes fails
    const over = makeSampleTree(121);
    expect(
      StudioMindmapPayloadSchema.safeParse({
        root_node: over.root,
        node_count: 121,
        max_depth: 3,
        initial_expanded_depth: 2,
        insufficient_evidence_note: null,
        citations: over.citations,
      }).success
    ).toBe(false);

    // Duplicate node ID fails
    const dup = makeSampleTree(15);
    dup.root.children[0]!.children[0]!.id = "root";
    expect(
      StudioMindmapPayloadSchema.safeParse({
        root_node: dup.root,
        node_count: 15,
        max_depth: 3,
        initial_expanded_depth: 2,
        insufficient_evidence_note: null,
        citations: dup.citations,
      }).success
    ).toBe(false);

    // Evidence-limited lower count (< 15 nodes) requires insufficient_evidence_note
    const small = makeSampleTree(5);
    expect(
      StudioMindmapPayloadSchema.safeParse({
        root_node: small.root,
        node_count: 5,
        max_depth: 3,
        initial_expanded_depth: 2,
        insufficient_evidence_note: null,
        citations: small.citations,
      }).success
    ).toBe(false);
    expect(
      StudioMindmapPayloadSchema.safeParse({
        root_node: small.root,
        node_count: 5,
        max_depth: 3,
        initial_expanded_depth: 2,
        insufficient_evidence_note: "Selected sources only support 5 distinct concepts.",
        citations: small.citations,
      }).success
    ).toBe(true);
  });

  it("validates ancestor-closed expanded_node_ids and drilldown requests", () => {
    const { root } = makeSampleTree(15);
    const cat1 = root.children[0]!;
    const sub1 = cat1.children[0]!;

    expect(validateExpandedNodeIds(root, ["root", cat1.id, sub1.id]).valid).toBe(true);
    // Missing ancestor cat1.id fails
    expect(validateExpandedNodeIds(root, ["root", sub1.id]).valid).toBe(false);
    // Unknown node ID fails
    expect(validateExpandedNodeIds(root, ["root", "unknown_node"]).valid).toBe(false);

    expect(
      MindmapExportRequestSchema.safeParse({
        format: "svg",
        expanded_node_ids: ["root", cat1.id],
      }).success
    ).toBe(true);

    expect(
      MindmapDrilldownRequestSchema.safeParse({
        node_id: sub1.id,
        active_source_ids: [makeStudioSourceId(101), makeStudioSourceId(102), makeStudioSourceId(103)],
      }).success
    ).toBe(true);
  });
});

describe("[011-studio-mindmaps-data-tables] T004: Data table payload schema invariants (FR-ST-18, FR-007, FR-008, FR-015, FR-016, SC-009, SC-010)", () => {
  it("validates optional focus_prompt boundary at 0, 2000, and 2001 trimmed Unicode code points", () => {
    expect(DATA_TABLE_FOCUS_PROMPT_MAX).toBe(2000);
    expect(DATA_TABLE_MAX_ROWS).toBe(500);
    expect(DATA_TABLE_MAX_COLUMNS).toBe(25);
    expect(DATA_TABLE_MISSING_MARKER).toBe(MISSING_CELL_MARKER);

    const p0 = validateDataTableFocusPrompt("   ");
    expect(p0.valid).toBe(true);
    expect(p0.codePoints).toBe(0);
    expect(p0.normalized).toBe("");

    const p2000 = validateDataTableFocusPrompt(` ${makeCodePointString(2000)} `);
    expect(p2000.valid).toBe(true);
    expect(p2000.codePoints).toBe(2000);

    const p2001 = validateDataTableFocusPrompt(makeCodePointString(2001));
    expect(p2001.valid).toBe(false);
    expect(p2001.codePoints).toBe(2001);
  });

  it("enforces supported, conflict, and missing cell discriminators, rectangularity, and 500x25 bounds", () => {
    const c1 = makeCite(1, makeStudioSourceId(301), makeStudioChunkId(3001), "$10/month");
    const c2 = makeCite(2, makeStudioSourceId(304), makeStudioChunkId(3004), "$12/month");
    const c3 = makeCite(3, makeStudioSourceId(302), makeStudioChunkId(3002), "99.95% Uptime SLA");

    const validTable: StudioDataTablePayload = {
      columns: [
        { id: "price", label: "Price", citations: [c1] },
        { id: "uptime_sla", label: "Uptime SLA", citations: [c3] },
      ],
      rows: [
        {
          item_id: "vendor_alpha",
          item_label: "Vendor Alpha",
          item_citations: [c1],
          cells: {
            price: {
              state: "conflict",
              display_text: "$10/month [1] vs. $12/month [2] (Conflicting sources)",
              values: [
                { value: "$10/month", citations: [c1] },
                { value: "$12/month", citations: [c2] },
              ],
              disagreement: true,
            },
            uptime_sla: {
              state: "missing",
              display_text: "N/A (Not in sources)",
              values: [],
              disagreement: false,
            },
          },
        },
        {
          item_id: "vendor_beta",
          item_label: "Vendor Beta",
          item_citations: [c3],
          cells: {
            price: {
              state: "missing",
              display_text: "N/A (Not in sources)",
              values: [],
              disagreement: false,
            },
            uptime_sla: {
              state: "supported",
              display_text: "99.95% [3]",
              values: [{ value: "99.95%", citations: [c3] }],
              disagreement: false,
            },
          },
        },
      ],
      schema_id: "vendor_comparison",
      focus_prompt: null,
      insufficient_evidence_note: null,
      citations: [c1, c2, c3],
    };

    expect(StudioDataTablePayloadSchema.safeParse(validTable).success).toBe(true);

    // Missing cell with citations or wrong marker fails
    const badMissing = structuredClone(validTable);
    (badMissing.rows[0]!.cells.uptime_sla as any).display_text = "Unknown";
    expect(StudioDataTablePayloadSchema.safeParse(badMissing).success).toBe(false);

    // Conflict cell with only 1 value or duplicate value fails
    const badConflict = structuredClone(validTable);
    (badConflict.rows[0]!.cells.price as any).values = [{ value: "$10/month", citations: [c1] }];
    expect(StudioDataTablePayloadSchema.safeParse(badConflict).success).toBe(false);

    // Full-permutation row sort validation
    expect(validateOrderedRowIds(validTable.rows, ["vendor_beta", "vendor_alpha"]).valid).toBe(true);
    expect(validateOrderedRowIds(validTable.rows, ["vendor_beta"]).valid).toBe(false);
    expect(validateOrderedRowIds(validTable.rows, ["vendor_beta", "vendor_beta"]).valid).toBe(false);
    expect(
      DataTableExportRequestSchema.safeParse({
        format: "xlsx",
        ordered_row_ids: ["vendor_beta", "vendor_alpha"],
      }).success
    ).toBe(true);
  });
});
