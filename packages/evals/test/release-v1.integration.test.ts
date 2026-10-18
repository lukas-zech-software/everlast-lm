import { describe, it, expect } from "vitest";
import path from "path";
import {
  runEvaluationSuite,
  generateReleaseReport,
  formatMarkdownReport,
} from "../src/index.js";
import { ReleaseGateReportSchema } from "@everlast/contracts";

describe("T014 [US2] Integration: Evaluation Runner & Reporting (Gate v1.0)", () => {
  const goldenBenchmarkPath = path.resolve(
    process.cwd(),
    "packages/evals/fixtures/v1/golden.jsonl"
  );
  const commitHash = "cc430e4202dfe37b6f4724d90f05172d19f5c5b7";

  it("produces schema-valid ReleaseGateReport and markdown audit when gate passes", async () => {
    const result = await runEvaluationSuite({
      goldenBenchmarkPath,
      commitHash,
      dryRun: false,
    });

    const report = generateReleaseReport(result, commitHash);

    // Validate against shared strict Zod contract
    const parsed = ReleaseGateReportSchema.parse(report);
    expect(parsed.commit_hash).toBe(commitHash);
    expect(parsed.status).toBe("GatePassed");
    expect(parsed.failures).toHaveLength(0);

    // Markdown summary
    const md = formatMarkdownReport(report);
    expect(md).toContain("# Gate v1.0 Evaluation Report");
    expect(md).toContain("GatePassed");
    expect(md).toContain("NFR-EVAL-01");
    expect(md).toContain("NFR-EVAL-02");
    expect(md).toContain("NFR-EVAL-03");
    expect(md).toContain("NFR-EVAL-04");
  });

  it("produces schema-valid GateFailed report with exact failure reasons when metrics miss thresholds", () => {
    const failingResult = {
      metrics: {
        hallucination_rate: 0.08, // Fails < 0.05
        citation_precision: 0.99, // Fails = 1.00
        negative_rejection_rate: 0.95, // Fails >= 0.99
        scoping_leakage_count: 2, // Fails = 0
      },
      totalCases: 200,
      unanswerableCount: 100,
      deselectionCount: 50,
      synthesisCount: 50,
      passed: false,
      failures: [
        "hallucination_rate 0.08 exceeds threshold < 0.05 (NFR-EVAL-01)",
        "citation_precision 0.99 does not meet required 1.00 (NFR-EVAL-02)",
      ],
      failingCaseIds: ["case-syn-003", "case-desel-012"],
    };

    const report = generateReleaseReport(failingResult, commitHash);
    const parsed = ReleaseGateReportSchema.parse(report);

    expect(parsed.status).toBe("GateFailed");
    expect(parsed.failures.length).toBeGreaterThan(0);
    expect(parsed.failures.some((f) => f.includes("hallucination_rate"))).toBe(true);

    const md = formatMarkdownReport(report);
    expect(md).toContain("GateFailed");
    expect(md).toContain("hallucination_rate");
  });
});
