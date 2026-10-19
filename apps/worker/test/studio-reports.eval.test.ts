import { describe, it, expect } from "vitest";
import { StudioPluginRegistry, type ReportSubtype } from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { StudioJobRunner } from "../src/studio/runner.js";
import { ReportGeneratorPlugin } from "../src/studio/reports/plugin.js";
import { DeterministicReportModel } from "../src/studio/reports/deterministic-model.js";
import { FakeAccess, FakeScopedContext, NB, OWNER, SRC_HISTORY, SRC_TECH, SRC_UNSELECTED, historyChunks, techChunks, unselectedChunks } from "./studio-fixtures.js";

// Deterministic eval (NFR-EVAL-02, NFR-EVAL-04, FR-017); LLM-judged evals NFR-EVAL-01/03 are UNAVAILABLE here.
describe("Studio reports deterministic eval", () => {
  it("citation precision 1.0, leakage 0, P95 ≤ 25 s across all six subtypes", async () => {
    const subtypes: ReportSubtype[] = ["briefing_doc", "study_guide", "faq", "timeline", "dynamic", "custom"];
    const durations: number[] = [];
    let cited = 0;
    let valid = 0;
    let leaked = 0;
    for (const subtype of subtypes) {
      const repo = new InMemoryStudioArtifactRepository();
      const registry = new StudioPluginRegistry();
      const plugin = new ReportGeneratorPlugin(new DeterministicReportModel());
      registry.register(plugin);
      const chunks = [...historyChunks(), ...techChunks(), ...unselectedChunks()];
      const runner = new StudioJobRunner({
        repo, registry,
        scopedContext: new FakeScopedContext(chunks),
        access: new FakeAccess(new Map([[SRC_HISTORY, 1], [SRC_TECH, 1], [SRC_UNSELECTED, 1]])),
      });
      const snapshot = [SRC_HISTORY, SRC_TECH].map((source_id) => ({ source_id, revision: 1 }));
      const plan = plugin.triggerJob({ notebook_id: NB, subtype, params: { custom_prompt: "Summarise the key facts." }, snapshot });
      const a = await repo.createQueued({ notebook_id: NB, owner_id: OWNER, subtype, ...plan, snapshot });
      const t0 = performance.now();
      const done = await runner.run(a.id);
      durations.push((performance.now() - t0) / 1000);
      expect(done.status).toBe("Completed");
      const byId = new Map(chunks.map((c) => [c.chunk_id, c]));
      for (const c of done.payload_json!.citations) {
        cited++;
        const chunk = byId.get(c.chunk_id);
        if (chunk && chunk.source_id === c.source_id && chunk.text.includes(c.snippet)) valid++;
        if (c.source_id === SRC_UNSELECTED) leaked++;
      }
    }
    durations.sort((x, y) => x - y);
    expect(valid / cited).toBe(1);
    expect(leaked).toBe(0);
    expect(durations[Math.ceil(durations.length * 0.95) - 1]!).toBeLessThanOrEqual(25);
  });
});
