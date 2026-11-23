import { describe, expect, it } from "vitest";
import { runStudioActiveLearningDeterministicEval } from "../src/studio-active-learning-eval.ts";

/**
 * [014-studio-active-learning-suite] T030 — Deterministic citation precision (NFR-EVAL-02 = 1.0)
 * and zero-leakage (NFR-EVAL-04 = 0) eval suite for Package 4.1 (FR-ST-12..15, Gate v4.0 #1).
 */

describe("[014-studio-active-learning-suite] T030: Active Learning deterministic eval gates (NFR-EVAL-02 / NFR-EVAL-04)", () => {
  it("achieves 1.0 citation precision, 0 deselected-source leakage, semantic unit equivalence, prompt-injection rejection, and Explain scope guard", async () => {
    const report = await runStudioActiveLearningDeterministicEval();
    expect(report.citation_precision).toBe(1);
    expect(report.leakage_count).toBe(0);
    expect(report.invalid_citation_rejected).toBe(true);
    expect(report.explain_missing_scope_blocked).toBe(true);
    expect(report.injection_rejected).toBe(true);
    expect(report.semantic_unit_equivalence_passed).toBe(true);
    expect(report.passed).toBe(true);
  });
});
