import { describe, expect, it } from "vitest";
import { MINDMAP_MAX_NODES, type MindmapNode } from "@everlast/contracts";
import { DeterministicMindmapModel, type MindmapFinding } from "../src/studio/mindmaps/model.ts";

/** [011-studio-mindmaps-data-tables] PR #161 review — every selected source keeps a branch (FR-ST-08). */
describe("[011-studio-mindmaps-data-tables] review: mindmap node budget is shared fairly across sources", () => {
  it("a source with many findings does not crowd out the other selected sources", async () => {
    const finding = (source: string, i: number): MindmapFinding => ({
      topic: `Topic ${source}`,
      subtopic: `Point ${source} ${i}`,
      detail: `Detailed statement number ${i} about ${source} with enough words to add a detail node`,
      chunk_id: `${source}-c${i}`,
      source_id: source,
      revision: 1,
      snippet: `statement ${i}`,
    });
    const findings = [
      ...Array.from({ length: 80 }, (_, i) => finding("A", i)),
      ...Array.from({ length: 2 }, (_, i) => finding("B", i)),
      ...Array.from({ length: 2 }, (_, i) => finding("C", i)),
    ];
    const map = await new DeterministicMindmapModel().compose({ findings, chunks: [], signal: new AbortController().signal });
    const sourcesIn = (n: MindmapNode): Set<string> => new Set([...n.label_citations.map((c) => c.source_id), ...n.children.flatMap((c) => [...sourcesIn(c)])]);
    expect([...sourcesIn(map.root_node)].sort()).toEqual(["A", "B", "C"]);
    expect(map.node_count).toBeLessThanOrEqual(MINDMAP_MAX_NODES);
  });
});

import { DeterministicDataTableModel, type TableObservation } from "../src/studio/tables/model.ts";

describe("[011-studio-mindmaps-data-tables] review: separate key findings are not a conflict (FR-ST-18 FR-008)", () => {
  it("several Key Finding sentences of one item form one supported cell with all citations", async () => {
    const obs = (i: number, attribute_id = "summary", attribute_label = "Key Finding"): TableObservation => ({
      item_label: "Vendor Alpha",
      attribute_id,
      attribute_label,
      value_text: `Separate fact number ${i}.`,
      chunk_id: `c${i}`,
      source_id: "s1",
      revision: 1,
      snippet: `Separate fact number ${i}.`,
    });
    const { payload } = await new DeterministicDataTableModel().compose({ observations: [obs(1), obs(2), obs(3)], chunks: [], signal: new AbortController().signal });
    const cell = payload.rows[0]!.cells["summary"]!;
    expect(cell.state).toBe("supported");
    expect(cell.disagreement).toBe(false);
    expect(cell.values).toHaveLength(1);
    expect(cell.values[0]!.citations).toHaveLength(3);
  });
});
