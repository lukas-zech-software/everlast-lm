import {
  ReleaseGateReportSchema,
  type ReleaseGateReport,
  type ReleaseGateStatus,
} from "@everlast/contracts";
import type { EvalRunResult } from "./runner.js";

/**
 * Structured report generator producing eval-report-v1.json and Markdown summaries (Gate v1.0).
 */

export function generateReleaseReport(
  result: EvalRunResult,
  commitHash: string
): ReleaseGateReport {
  const status: ReleaseGateStatus = result.passed ? "GatePassed" : "GateFailed";
  const failures = result.passed ? [] : [...result.failures];

  if (!result.passed && failures.length === 0) {
    failures.push("Evaluation suite failed one or more required gate criteria.");
  }

  const rawReport = {
    commit_hash: commitHash,
    timestamp: new Date().toISOString(),
    metrics: result.metrics,
    status,
    failures,
  };

  return ReleaseGateReportSchema.parse(rawReport);
}

export function formatMarkdownReport(report: ReleaseGateReport): string {
  const statusBadge =
    report.status === "GatePassed"
      ? "✅ **GatePassed** (Eligible for v2.0 progression)"
      : `❌ **GateFailed** (${report.failures.length} issue(s) detected)`;

  const lines = [
    "# Gate v1.0 Evaluation Report",
    "",
    `**Build Commit**: \`${report.commit_hash}\`  `,
    `**Timestamp**: ${report.timestamp}  `,
    `**Status**: ${statusBadge}  `,
    "",
    "## Quality Gate Metrics (NFR-EVAL-01..04)",
    "",
    "| Gate | Metric | Required Threshold | Observed Value | Status |",
    "| :--- | :--- | :--- | :--- | :---: |",
    `| **NFR-EVAL-01** | Grounding Faithfulness (Hallucination Rate) | $< 0.05$ (target $\\le 0.02$) | ${(
      report.metrics.hallucination_rate * 100
    ).toFixed(2)}% | ${report.metrics.hallucination_rate < 0.05 ? "PASS" : "FAIL"} |`,
    `| **NFR-EVAL-02** | Citation Precision | $= 1.00$ ($100%$) | ${(
      report.metrics.citation_precision * 100
    ).toFixed(2)}% | ${report.metrics.citation_precision === 1.0 ? "PASS" : "FAIL"} |`,
    `| **NFR-EVAL-03** | Negative Rejection Rate | $\\ge 0.99$ ($99%$) | ${(
      report.metrics.negative_rejection_rate * 100
    ).toFixed(2)}% | ${report.metrics.negative_rejection_rate >= 0.99 ? "PASS" : "FAIL"} |`,
    `| **NFR-EVAL-04** | Context Scoping Leakage | $= 0\\text{ chunks}$ | ${
      report.metrics.scoping_leakage_count
    } chunks | ${report.metrics.scoping_leakage_count === 0 ? "PASS" : "FAIL"} |`,
    "",
  ];

  if (report.failures.length > 0) {
    lines.push("## Recorded Failures", "");
    report.failures.forEach((f) => lines.push(`- ❌ ${f}`));
    lines.push("");
  } else {
    lines.push(
      "## Gate Status",
      "",
      "All automated quality and security thresholds satisfied. Full Gate v1.0 release pending end-to-end PDF/MD ingestion and citation navigation verification.",
      ""
    );
  }

  return lines.join("\n");
}
