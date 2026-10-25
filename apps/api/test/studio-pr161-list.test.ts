import { describe, expect, it } from "vitest";
import { SourceSnapshotInvalidError, StudioPluginRegistry } from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { StudioService } from "../src/studio/service.ts";

/** [011-studio-mindmaps-data-tables] PR #161 review — Studio list stays available and consistent with get (FR-017). */
describe("[011-studio-mindmaps-data-tables] review: Studio list", () => {
  it("keeps report titles like get(), redacts new kinds, and one failing check does not fail the whole list", async () => {
    const repo = new InMemoryStudioArtifactRepository();
    const base = { notebook_id: "nb", owner_id: "u", params_json: {}, snapshot: [{ source_id: "s", revision: 1 }] };
    await repo.createQueued({ ...base, plugin_type: "report", subtype: "faq", title: "My FAQ" });
    await repo.createQueued({ ...base, plugin_type: "mindmap", subtype: "default", title: "Secret source title" });
    await repo.createQueued({ ...base, plugin_type: "data_table", subtype: "default", title: "Another secret", snapshot: [{ source_id: "boom", revision: 1 }] });
    const calls: string[] = [];
    const service = new StudioService({
      repo,
      registry: new StudioPluginRegistry(),
      dispatcher: { enqueue: async () => undefined },
      access: {
        resolveSnapshot: async () => [],
        verifySnapshot: async (_o: string, _n: string, snap: { source_id: string }[]) => {
          calls.push(snap[0]!.source_id);
          if (snap[0]!.source_id === "boom") throw new Error("connection reset");
          throw new SourceSnapshotInvalidError("changed");
        },
      },
    } as any);
    const list = await service.list("u", "nb");
    const titles = Object.fromEntries(list.map((a: any) => [a.plugin_type, a.title]));
    expect(titles.report).toBe("My FAQ");
    expect(titles.mindmap).not.toBe("Secret source title");
    expect(titles.data_table).not.toBe("Another secret");
  });
});

import { buildMindmapExportScene } from "../src/studio/map-export.ts";

describe("[011-studio-mindmaps-data-tables] review: exported node labels stay inside their boxes (FR-ST-09)", () => {
  it("long labels are shortened with an ellipsis, and kept whole in a <title>", () => {
    const long = "An exceptionally long mindmap node label that would overflow its box";
    const cite = { badge_number: 1, source_id: "s", chunk_id: "c", revision: 1, snippet: "x" };
    const payload = {
      root_node: { id: "root", label: long, summary: "s", label_citations: [cite], summary_citations: [cite], children: [] },
      node_count: 1,
      max_depth: 1,
      initial_expanded_depth: 2,
      citations: [cite],
    } as any;
    const scene = buildMindmapExportScene("Map", payload, { format: "svg", expanded_node_ids: ["root"] });
    const text = /<text[^>]*>([^<]*)<\/text>/.exec(scene.svg)![1]!;
    expect(text.length).toBeLessThanOrEqual(24);
    expect(text.endsWith("…")).toBe(true);
    expect(scene.svg).toContain(`<title>${long}</title>`);
  });
});
