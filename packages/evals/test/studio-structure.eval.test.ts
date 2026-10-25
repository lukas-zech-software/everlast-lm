import { describe, expect, it } from "vitest";
import {
  buildFiftySourceFixture,
  buildThreeSourceStudioFixture,
  buildThreeVendorTableFixture,
  LATE_ORIGINAL_FACT_TOKEN,
  STUDIO_LEAK_PROBE,
} from "../src/fixtures/studio-structure.ts";
import { runStudioStructureDeterministicEval } from "../src/studio-structure-eval.ts";

/**
 * [011-studio-mindmaps-data-tables] T014, T051 — Deterministic citation precision (1.0) and zero-leakage (0)
 * evaluation suite for Package 3.3 mindmaps, data tables, drilldown, history, cache, and exports
 * (FR-ST-08/09/18, FR-GC-02, C-01..C-03, NFR-EVAL-02/04; SC-007, SC-008).
 */

describe("[011-studio-mindmaps-data-tables] T014: Studio structure deterministic citation & leakage evals", () => {
  it("achieves 1.0 citation-ID precision and 0 cross-scope leakage across multimodal mindmaps, >=50-source synthesis, data tables, drilldowns, and exports", async () => {
    const threeSource = buildThreeSourceStudioFixture();
    const fiftySource = buildFiftySourceFixture(50);
    const vendorTable = buildThreeVendorTableFixture();

    expect(threeSource.chunks.length).toBeGreaterThan(0);
    expect(fiftySource.chunks.some((c) => c.text.includes(LATE_ORIGINAL_FACT_TOKEN))).toBe(true);
    expect(vendorTable.chunks.length).toBe(4);

    const result = await runStudioStructureDeterministicEval();
    expect(result.passed).toBe(true);
    expect(result.citation_precision).toBe(1);
    expect(result.leakage_count).toBe(0);
    expect(result.late_fact_retained).toBe(true);
    expect(result.invalid_citation_rejected).toBe(true);
    expect(result.missing_scope_drilldown_blocked).toBe(true);
    expect(JSON.stringify(result.cases)).not.toContain(STUDIO_LEAK_PROBE);
  });
});
