import { describe, it, expect } from "vitest";
import { StudioPluginRegistry } from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { StudioJobRunner } from "../src/studio/runner.js";
import { ReportGeneratorPlugin } from "../src/studio/reports/plugin.js";
import { DeterministicReportModel } from "../src/studio/reports/deterministic-model.js";
import { FakeAccess, FakeScopedContext, NB, OWNER, SRC_UNSELECTED, VENDOR_A, VENDOR_B, VENDOR_C, unselectedChunks, vendorChunks } from "./studio-fixtures.js";

describe("custom / dynamic reports (FR-ST-11, FR-011)", () => {
  it("risk-matrix prompt yields a cited table with one row per vendor source and no unselected content", async () => {
    const repo = new InMemoryStudioArtifactRepository();
    const registry = new StudioPluginRegistry();
    const plugin = new ReportGeneratorPlugin(new DeterministicReportModel());
    registry.register(plugin);
    const scoped = new FakeScopedContext([...vendorChunks(), ...unselectedChunks()]);
    const access = new FakeAccess(new Map([[VENDOR_A, 1], [VENDOR_B, 1], [VENDOR_C, 1], [SRC_UNSELECTED, 1]]));
    const runner = new StudioJobRunner({ repo, registry, scopedContext: scoped, access });
    const snapshot = [VENDOR_A, VENDOR_B, VENDOR_C].map((source_id) => ({ source_id, revision: 1 }));
    const prompt = "Compare vendor architectures. Include a risk matrix.";
    const plan = plugin.triggerJob({ notebook_id: NB, subtype: "dynamic", params: { custom_prompt: prompt }, snapshot });
    const a = await repo.createQueued({ notebook_id: NB, owner_id: OWNER, subtype: "dynamic", ...plan, snapshot });
    const done = await runner.run(a.id);
    expect(done.status).toBe("Completed");
    const rows = done.payload_json!.content_md.split("\n").filter((l) => /^\| Source \d/.test(l));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => /\[\d+\] \|$/.test(r))).toBe(true);
    expect(new Set(done.payload_json!.citations.map((c) => c.source_id))).toEqual(new Set([VENDOR_A, VENDOR_B, VENDOR_C]));
    expect(done.payload_json!.content_md).not.toContain("Zorblax");
  });
});
