import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalRunResult } from "./runner.ts";
import type { PreflightReport } from "./security-preflight.ts";
import type { MetricResult } from "./metrics.ts";
import type { ResponseLengthMetric } from "./response-length.ts";

/**
 * Gate v1.0 report and lifecycle (NFR-EVAL-01..04, Gate v1.0). GatePending → GatePassed | GateFailed.
 * The gate passes only when upload/schema (#1), all evaluation metrics (#2) and citation navigation (#3)
 * passed in a release run. Any failure fails closed; missing evidence leaves the gate pending.
 */

export type GateState = "GatePending" | "GatePassed" | "GateFailed";
export type CriterionStatus = "pass" | "fail" | "pending" | "unavailable";

export interface UiGateEvidence {
  gate1_upload_schema?: { status: "pass" | "fail"; detail: string; at: string };
  gate3_citation_navigation?: { status: "pass" | "fail"; detail: string; at: string };
}

export interface GateReport {
  schema: "everlast.gate-v1-report/1";
  mode: "release" | "deterministic";
  state: GateState;
  commit: string;
  timestamp: string;
  dataset: {
    version: string;
    hash: string;
    corpus_hash: string;
    counts: Record<string, number>;
    /** Judged release sample (Constitution v2.0.0): fixed case IDs and selection method. */
    sample?: { size: number; method: string; case_ids: string[] } | null;
  };
  models: Record<string, string>;
  criteria: {
    gate1_upload_schema: { status: CriterionStatus; detail: string };
    gate2_evaluation: { status: CriterionStatus; metrics: MetricResult[]; errored_cases: string[] };
    gate3_citation_navigation: { status: CriterionStatus; detail: string };
  };
  security_preflight: PreflightReport | null;
  /** v2.0 release metrics outside Gate v1.0 (FR-GC-07 response length); recorded, not part of the v1 gate state. */
  release_metrics?: { response_length: ResponseLengthMetric };
  failures: string[];
  cases: { id: string; category: string; kind: string; response: string; citations: number; leakage: number; judged?: unknown; turns?: unknown; error?: string }[];
}

export function buildGateReport(input: {
  mode: "release" | "deterministic";
  commit: string;
  run: EvalRunResult;
  preflight: PreflightReport | null;
  ui: UiGateEvidence;
  dataset: GateReport["dataset"];
  models: Record<string, string>;
  responseLength?: ResponseLengthMetric | undefined;
}): GateReport {
  const failures: string[] = [];
  const { run } = input;

  const metricFailures = run.metrics.filter((m) => m.status === "fail");
  for (const m of metricFailures) failures.push(`${m.name}=${m.value} failed (cases: ${m.failing_cases.slice(0, 20).join(", ") || "n/a"})`);
  if (run.errored.length) failures.push(`errored cases: ${run.errored.join(", ")}`);
  const unavailable = run.metrics.filter((m) => m.status === "unavailable");
  const evalStatus: CriterionStatus =
    metricFailures.length || run.errored.length ? "fail" : unavailable.length ? "unavailable" : "pass";

  if (input.preflight && !input.preflight.passed) {
    for (const c of input.preflight.checks.filter((x) => x.status !== "pass")) failures.push(`preflight ${c.id} ${c.status}: ${c.detail}`);
  }

  const uploadFromRun = run.upload.passed;
  const ui1 = input.ui.gate1_upload_schema;
  const gate1: CriterionStatus = !uploadFromRun || ui1?.status === "fail" ? "fail" : ui1?.status === "pass" ? "pass" : "pending";
  if (!uploadFromRun) failures.push("corpus ingestion produced invalid or missing C-01 chunks");
  if (ui1?.status === "fail") failures.push(`UI upload/schema check failed: ${ui1.detail}`);
  const ui3 = input.ui.gate3_citation_navigation;
  const gate3: CriterionStatus = ui3 ? ui3.status : "pending";
  if (ui3?.status === "fail") failures.push(`citation navigation failed: ${ui3.detail}`);

  const preflightOk = input.mode === "deterministic" || (input.preflight?.passed ?? false);
  let state: GateState = "GatePending";
  if (failures.length > 0) state = "GateFailed";
  else if (input.mode === "release" && evalStatus === "pass" && gate1 === "pass" && gate3 === "pass" && preflightOk) state = "GatePassed";

  return {
    schema: "everlast.gate-v1-report/1",
    mode: input.mode,
    state,
    commit: input.commit,
    timestamp: new Date().toISOString(),
    dataset: input.dataset,
    models: input.models,
    criteria: {
      gate1_upload_schema: { status: gate1, detail: `${run.upload.documents.length} corpus documents ingested; UI evidence: ${ui1 ? ui1.detail : "missing"}` },
      gate2_evaluation: { status: evalStatus, metrics: run.metrics, errored_cases: run.errored },
      gate3_citation_navigation: { status: gate3, detail: ui3?.detail ?? "missing UI evidence (run pnpm test:e2e)" },
    },
    security_preflight: input.preflight,
    ...(input.responseLength ? { release_metrics: { response_length: input.responseLength } } : {}),
    failures,
    cases: run.cases.map((c) => ({
      id: c.id,
      category: c.category,
      kind: c.kind,
      response: c.response.slice(0, 500),
      citations: c.citations.length,
      leakage: c.leakage.retrieved + c.leakage.prompt + c.leakage.response,
      ...(c.judged ? { judged: c.judged } : {}),
      turns: c.turns.map((t) => ({ kind: t.result.kind, content: t.result.content.slice(0, 600), history_turns: t.modelInput?.history.length ?? 0, retrieved: t.retrieved.length })),
      ...(c.error ? { error: c.error } : {}),
    })),
  };
}

export function renderMarkdown(report: GateReport): string {
  const lines = [
    `# Gate v1.0 evaluation report (${report.mode})`,
    "",
    `- **State:** ${report.state}`,
    `- **Commit:** ${report.commit}`,
    `- **Timestamp:** ${report.timestamp}`,
    `- **Dataset:** ${report.dataset.version} (${report.dataset.hash.slice(0, 12)}), counts ${JSON.stringify(report.dataset.counts)}`,
    `- **Judged sample:** ${report.dataset.sample ? `${report.dataset.sample.size} cases (${report.dataset.sample.method}): ${report.dataset.sample.case_ids.join(", ")}` : "full dataset"}`,
    `- **Models:** ${Object.entries(report.models).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "| Criterion | Status | Detail |",
    "| :-- | :-- | :-- |",
    `| #1 Upload → valid C-01 | ${report.criteria.gate1_upload_schema.status} | ${report.criteria.gate1_upload_schema.detail} |`,
    `| #2 NFR-EVAL-01..04 | ${report.criteria.gate2_evaluation.status} | see metrics |`,
    `| #3 Citation navigation | ${report.criteria.gate3_citation_navigation.status} | ${report.criteria.gate3_citation_navigation.detail} |`,
    "",
    "| Metric | Value | Status | Numerator/Denominator | Failing cases |",
    "| :-- | :-- | :-- | :-- | :-- |",
    ...report.criteria.gate2_evaluation.metrics.map(
      (m) => `| ${m.name} | ${m.value ?? "—"} | ${m.status} | ${m.numerator ?? "—"}/${m.denominator ?? "—"} | ${m.failing_cases.slice(0, 12).join(", ") || m.detail || ""} |`
    ),
  ];
  if (report.security_preflight) {
    lines.push("", "## NFR-SEC-01 preflight", "", "| Check | Status | Detail |", "| :-- | :-- | :-- |");
    for (const c of report.security_preflight.checks) lines.push(`| ${c.id} ${c.description} | ${c.status} | ${c.detail} |`);
  }
  const length = report.release_metrics?.response_length;
  if (length) {
    const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
    lines.push(
      "",
      "## FR-GC-07 response length (v2.0 release metric)",
      "",
      `- **Status:** ${length.status}${length.detail ? ` (${length.detail})` : ""}`,
      `- **Shorter / Default:** ${pct(length.shorter_ratio)} (≤ 50 %) · **Longer / Default:** ${pct(length.longer_ratio)} (≥ 150 %)`,
      `- **Sample case IDs:** ${length.case_ids.join(", ") || "—"}`,
      `- **Excluded (Default refusal):** ${length.excluded_case_ids?.join(", ") || "—"}`,
      `- **Generation parameters:** ${JSON.stringify(length.generation_parameters)}`
    );
  }
  if (report.failures.length) lines.push("", "## Failures", "", ...report.failures.map((f) => `- ${f}`));
  return `${lines.join("\n")}\n`;
}

export async function writeGateReport(report: GateReport, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const base = report.mode === "release" ? "eval-report-v1" : "eval-report-v1.deterministic";
  await writeFile(`${outDir}/${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${outDir}/${base}.md`, renderMarkdown(report));
  const audit = `${outDir}/gate-audit.jsonl`;
  await mkdir(dirname(audit), { recursive: true });
  await appendFile(
    audit,
    `${JSON.stringify({ at: report.timestamp, commit: report.commit, mode: report.mode, state: report.state, metrics: Object.fromEntries(report.criteria.gate2_evaluation.metrics.map((m) => [m.name, m.value])), failures: report.failures.length })}\n`
  );
}
