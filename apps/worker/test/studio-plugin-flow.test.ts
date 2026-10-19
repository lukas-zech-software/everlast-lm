import { describe, it, expect } from "vitest";
import { StudioParamsError, StudioPluginRegistry, type ReportSubtype } from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { StudioJobRunner } from "../src/studio/runner.js";
import { ReportGeneratorPlugin } from "../src/studio/reports/plugin.js";
import { DeterministicReportModel } from "../src/studio/reports/deterministic-model.js";
import {
  FakeAccess, FakeScopedContext, NB, OWNER, SRC_HISTORY, SRC_TECH, SRC_UNSELECTED,
  historyChunks, techChunks, unselectedChunks,
} from "./studio-fixtures.js";

function setup() {
  const repo = new InMemoryStudioArtifactRepository();
  const registry = new StudioPluginRegistry();
  const plugin = new ReportGeneratorPlugin(new DeterministicReportModel());
  registry.register(plugin);
  const scoped = new FakeScopedContext([...historyChunks(), ...techChunks(), ...unselectedChunks()]);
  const access = new FakeAccess(new Map([[SRC_HISTORY, 1], [SRC_TECH, 1], [SRC_UNSELECTED, 1]]));
  const runner = new StudioJobRunner({ repo, registry, scopedContext: scoped, access });
  const snapshot = [SRC_HISTORY, SRC_TECH].map((source_id) => ({ source_id, revision: 1 }));
  const submit = async (subtype: ReportSubtype, custom_prompt?: string) => {
    const plan = plugin.triggerJob({ notebook_id: NB, subtype, params: { custom_prompt }, snapshot });
    return repo.createQueued({ notebook_id: NB, owner_id: OWNER, subtype, ...plan, snapshot });
  };
  return { repo, runner, plugin, access, submit };
}

describe("ReportGeneratorPlugin end-to-end through the runner (FR-ST-10)", () => {
  it.each(["briefing_doc", "study_guide", "faq", "timeline"] as const)("%s completes with zero leakage", async (subtype) => {
    const s = setup();
    const done = await s.runner.run((await s.submit(subtype)).id);
    expect(done.status).toBe("Completed");
    for (const c of done.payload_json!.citations) expect(c.source_id).not.toBe(SRC_UNSELECTED);
    expect(done.payload_json!.content_md).not.toContain("Zorblax");
  });

  it("fails on replaced revision, publishes nothing, and retry needs a fresh attempt", async () => {
    const s = setup();
    const a = await s.submit("briefing_doc");
    s.access.revisions.set(SRC_HISTORY, 2);
    const failed = await s.runner.run(a.id);
    expect(failed).toMatchObject({ status: "Failed", payload_json: null });
    expect(failed.failure?.code).toBe("SourceChanged");
    const retry = await s.repo.createRetry({
      previous_id: a.id,
      owner_id: OWNER,
      snapshot: [{ source_id: SRC_HISTORY, revision: 2 }, { source_id: SRC_TECH, revision: 1 }],
    });
    expect(retry).toMatchObject({ attempt: 2, retry_of: a.id, status: "Queued" });
  });

  it("triggerJob validates subtype and custom prompt synchronously", () => {
    const { plugin } = setup();
    const req = (subtype: string, p?: string) => ({ notebook_id: NB, subtype, params: { custom_prompt: p }, snapshot: [] });
    expect(() => plugin.triggerJob(req("nope"))).toThrow(StudioParamsError);
    expect(() => plugin.triggerJob(req("custom"))).toThrow(StudioParamsError);
    expect(() => plugin.triggerJob(req("custom", "   "))).toThrow(StudioParamsError);
    expect(() => plugin.triggerJob(req("custom", "x".repeat(5001)))).toThrow(StudioParamsError);
    expect(plugin.triggerJob(req("custom", "x".repeat(5000))).params_json.custom_prompt).toHaveLength(5000);
  });
});
