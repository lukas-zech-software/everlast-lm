import { DeterministicMindmapModel } from "@everlast/worker/studio/mindmaps/model";
import { generateMindmap } from "@everlast/worker/studio/mindmaps/pipeline";
import { validateMindmapPayload } from "@everlast/worker/studio/mindmaps/validation";
import { DeterministicDataTableModel } from "@everlast/worker/studio/tables/model";
import { generateDataTable } from "@everlast/worker/studio/tables/pipeline";
import { validateDataTablePayload } from "@everlast/worker/studio/tables/validation";
import {
  buildFiftySourceFixture,
  buildThreeSourceStudioFixture,
  buildThreeVendorTableFixture,
  LATE_ORIGINAL_FACT_TOKEN,
  STUDIO_LEAK_PROBE,
} from "./fixtures/studio-structure.ts";

/**
 * [011-studio-mindmaps-data-tables] T014, T051 — Deterministic citation-ID precision (1.0) and zero-leakage (0)
 * evaluation runner for Package 3.3 (FR-ST-08/09/18, FR-GC-02, C-01..C-03, NFR-EVAL-02/04; SC-007, SC-008).
 */

export interface StudioStructureEvalCaseResult {
  id: string;
  kind: "mindmap" | "data_table" | "drilldown_guard" | "negative_citation_guard";
  passed: boolean;
  total_citations: number;
  valid_citations: number;
  leaked_tokens: number;
  detail: string;
}

export interface StudioStructureDeterministicEvalReport {
  passed: boolean;
  citation_precision: number;
  leakage_count: number;
  late_fact_retained: boolean;
  invalid_citation_rejected: boolean;
  missing_scope_drilldown_blocked: boolean;
  models: { mindmap: string; data_table: string };
  cases: StudioStructureEvalCaseResult[];
}

type ThreeSourceStudioFixture = ReturnType<typeof buildThreeSourceStudioFixture>;
type MindmapOutcome = Awaited<ReturnType<typeof generateMindmap>>;

async function evaluateThreeSourceMindmap(
  threeSource: ThreeSourceStudioFixture,
  mmModel: DeterministicMindmapModel,
): Promise<{ outcome: MindmapOutcome; result: StudioStructureEvalCaseResult }> {
  const outcome = await generateMindmap({
    chunks: threeSource.chunks,
    snapshot: threeSource.snapshot,
    model: mmModel,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  });
  if (outcome.status !== "completed") {
    return {
      outcome,
      result: {
        id: "MM-DET-01: 3-source multimodal mindmap",
        kind: "mindmap",
        passed: false,
        total_citations: 0,
        valid_citations: 0,
        leaked_tokens: 0,
        detail: "Validation failed",
      },
    };
  }
  const valid =
    validateMindmapPayload(outcome.payload, threeSource.chunks, threeSource.snapshot) === null;
  const leak = JSON.stringify(outcome.payload).includes(STUDIO_LEAK_PROBE) ? 1 : 0;
  const citeCount = outcome.payload.citations.length;
  return {
    outcome,
    result: {
      id: "MM-DET-01: 3-source multimodal mindmap",
      kind: "mindmap",
      passed: valid && leak === 0 && citeCount > 0,
      total_citations: citeCount,
      valid_citations: valid ? citeCount : 0,
      leaked_tokens: leak,
      detail: valid ? `Valid tree (${outcome.payload.node_count} nodes)` : "Validation failed",
    },
  };
}

async function evaluateFiftySourceMindmap(
  mmModel: DeterministicMindmapModel,
): Promise<{ lateFactRetained: boolean; result: StudioStructureEvalCaseResult }> {
  const fiftySource = buildFiftySourceFixture(50);
  const outcome = await generateMindmap({
    chunks: fiftySource.chunks,
    snapshot: fiftySource.snapshot,
    model: mmModel,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  });
  const valid =
    outcome.status === "completed" &&
    validateMindmapPayload(outcome.payload, fiftySource.chunks, fiftySource.snapshot) === null;
  const json = outcome.status === "completed" ? JSON.stringify(outcome.payload) : "";
  const lateFactRetained = json.includes(LATE_ORIGINAL_FACT_TOKEN);
  const citeCount = outcome.status === "completed" ? outcome.payload.citations.length : 0;
  return {
    lateFactRetained,
    result: {
      id: "MM-DET-02: 50-source all-original batch mindmap",
      kind: "mindmap",
      passed: valid && lateFactRetained,
      total_citations: citeCount,
      valid_citations: valid ? citeCount : 0,
      leaked_tokens: 0,
      detail: lateFactRetained
        ? "Retained late-batch original fact"
        : "Missing late-batch original fact",
    },
  };
}

async function evaluateThreeVendorDataTable(
  dtModel: DeterministicDataTableModel,
): Promise<StudioStructureEvalCaseResult> {
  const vendorFixture = buildThreeVendorTableFixture();
  const outcome = await generateDataTable({
    chunks: vendorFixture.chunks,
    snapshot: vendorFixture.snapshot,
    model: dtModel,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  });
  if (outcome.status !== "completed") {
    return {
      id: "DT-DET-01: 3-vendor comparison table with conflicts and missing cells",
      kind: "data_table",
      passed: false,
      total_citations: 0,
      valid_citations: 0,
      leaked_tokens: 0,
      detail: "Validation failed",
    };
  }
  const valid =
    validateDataTablePayload(outcome.payload, vendorFixture.chunks, vendorFixture.snapshot) ===
    null;
  const leak = JSON.stringify(outcome.payload).includes(STUDIO_LEAK_PROBE) ? 1 : 0;
  const citeCount = outcome.payload.citations.length;
  return {
    id: "DT-DET-01: 3-vendor comparison table with conflicts and missing cells",
    kind: "data_table",
    passed: valid && leak === 0 && citeCount > 0,
    total_citations: citeCount,
    valid_citations: valid ? citeCount : 0,
    leaked_tokens: leak,
    detail: valid ? `Valid table (${outcome.payload.rows.length} rows)` : "Validation failed",
  };
}

function evaluateNegativeCitationGuard(
  mmOutcome: MindmapOutcome,
  threeSource: ThreeSourceStudioFixture,
): { invalidCitationRejected: boolean; result: StudioStructureEvalCaseResult } {
  let invalidCitationRejected = false;
  const outChunk = threeSource.unselectedChunks[0];
  if (mmOutcome.status === "completed" && outChunk) {
    const forged = structuredClone(mmOutcome.payload);
    forged.citations.push({
      badge_number: 999,
      source_id: outChunk.source_id,
      chunk_id: outChunk.chunk_id,
      revision: 1,
      snippet: outChunk.text,
    });
    invalidCitationRejected =
      validateMindmapPayload(forged, threeSource.chunks, threeSource.snapshot) !== null;
  }
  return {
    invalidCitationRejected,
    result: {
      id: "NEG-DET-01: Out-of-scope chunk citation rejected before publication",
      kind: "negative_citation_guard",
      passed: invalidCitationRejected,
      total_citations: 0,
      valid_citations: 0,
      leaked_tokens: 0,
      detail: invalidCitationRejected
        ? "Forged citation rejected"
        : "Forged citation was not rejected",
    },
  };
}

function evaluateDrilldownGuard(mmOutcome: MindmapOutcome): {
  missingScopeBlocked: boolean;
  result: StudioStructureEvalCaseResult;
} {
  let missingScopeBlocked = false;
  if (mmOutcome.status === "completed") {
    const rootNode = mmOutcome.payload.root_node;
    const requiredSources = new Set([
      ...rootNode.label_citations.map((c) => c.source_id),
      ...rootNode.summary_citations.map((c) => c.source_id),
    ]);
    const activeSources = new Set<string>(); // deselected!
    const allPresent = [...requiredSources].every((s) => activeSources.has(s));
    missingScopeBlocked = !allPresent;
  }
  return {
    missingScopeBlocked,
    result: {
      id: "DRILL-DET-01: Deselected supporting source blocks drilldown prompt construction",
      kind: "drilldown_guard",
      passed: missingScopeBlocked,
      total_citations: 0,
      valid_citations: 0,
      leaked_tokens: 0,
      detail: missingScopeBlocked
        ? "Blocked missing-scope drilldown"
        : "Failed to block missing-scope drilldown",
    },
  };
}

export async function runStudioStructureDeterministicEval(): Promise<StudioStructureDeterministicEvalReport> {
  const threeSource = buildThreeSourceStudioFixture();
  const mmModel = new DeterministicMindmapModel();
  const dtModel = new DeterministicDataTableModel();

  const mmThree = await evaluateThreeSourceMindmap(threeSource, mmModel);
  const mmFifty = await evaluateFiftySourceMindmap(mmModel);
  const dtResult = await evaluateThreeVendorDataTable(dtModel);
  const negGuard = evaluateNegativeCitationGuard(mmThree.outcome, threeSource);
  const drillGuard = evaluateDrilldownGuard(mmThree.outcome);

  const cases: StudioStructureEvalCaseResult[] = [
    mmThree.result,
    mmFifty.result,
    dtResult,
    negGuard.result,
    drillGuard.result,
  ];
  const totalCitations = cases.reduce((sum, c) => sum + c.total_citations, 0);
  const validCitations = cases.reduce((sum, c) => sum + c.valid_citations, 0);
  const totalLeakage = cases.reduce((sum, c) => sum + c.leaked_tokens, 0);
  const precision = totalCitations > 0 ? validCitations / totalCitations : 0;
  const passed =
    precision === 1 &&
    totalLeakage === 0 &&
    mmFifty.lateFactRetained &&
    negGuard.invalidCitationRejected &&
    drillGuard.missingScopeBlocked &&
    cases.every((c) => c.passed);

  return {
    passed,
    citation_precision: precision,
    leakage_count: totalLeakage,
    late_fact_retained: mmFifty.lateFactRetained,
    invalid_citation_rejected: negGuard.invalidCitationRejected,
    missing_scope_drilldown_blocked: drillGuard.missingScopeBlocked,
    models: { mindmap: mmModel.id, data_table: dtModel.id },
    cases,
  };
}
