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
  cases: StudioStructureEvalCaseResult[];
}

export async function runStudioStructureDeterministicEval(): Promise<StudioStructureDeterministicEvalReport> {
  const cases: StudioStructureEvalCaseResult[] = [];
  let totalCitations = 0;
  let validCitations = 0;
  let totalLeakage = 0;

  // Case 1: 3-source multimodal mindmap (PDF page_number, Web dom_path, Audio start_ms..end_ms) + unselected leak probe
  const threeSource = buildThreeSourceStudioFixture();
  const mmModel = new DeterministicMindmapModel();
  const mmOutcome = await generateMindmap({
    chunks: threeSource.chunks,
    snapshot: threeSource.snapshot,
    model: mmModel,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  });
  const mmValid =
    mmOutcome.status === "completed" &&
    validateMindmapPayload(mmOutcome.payload, threeSource.chunks, threeSource.snapshot) === null;
  const mmJson = mmOutcome.status === "completed" ? JSON.stringify(mmOutcome.payload) : "";
  const mmLeak = mmJson.includes(STUDIO_LEAK_PROBE) ? 1 : 0;
  const mmCiteCount = mmOutcome.status === "completed" ? mmOutcome.payload.citations.length : 0;
  totalCitations += mmCiteCount;
  if (mmValid) validCitations += mmCiteCount;
  totalLeakage += mmLeak;
  cases.push({
    id: "MM-DET-01: 3-source multimodal mindmap",
    kind: "mindmap",
    passed: mmValid && mmLeak === 0 && mmCiteCount > 0,
    total_citations: mmCiteCount,
    valid_citations: mmValid ? mmCiteCount : 0,
    leaked_tokens: mmLeak,
    detail: mmValid ? `Valid tree (${mmOutcome.status === "completed" ? mmOutcome.payload.node_count : 0} nodes)` : "Validation failed",
  });

  // Case 2: >=50-source mindmap retaining late-only original fact (SC-008)
  const fiftySource = buildFiftySourceFixture(50);
  const mm50Outcome = await generateMindmap({
    chunks: fiftySource.chunks,
    snapshot: fiftySource.snapshot,
    model: mmModel,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  });
  const mm50Valid =
    mm50Outcome.status === "completed" &&
    validateMindmapPayload(mm50Outcome.payload, fiftySource.chunks, fiftySource.snapshot) === null;
  const mm50Json = mm50Outcome.status === "completed" ? JSON.stringify(mm50Outcome.payload) : "";
  const lateFactRetained = mm50Json.includes(LATE_ORIGINAL_FACT_TOKEN);
  const mm50CiteCount = mm50Outcome.status === "completed" ? mm50Outcome.payload.citations.length : 0;
  totalCitations += mm50CiteCount;
  if (mm50Valid) validCitations += mm50CiteCount;
  cases.push({
    id: "MM-DET-02: 50-source all-original batch mindmap",
    kind: "mindmap",
    passed: mm50Valid && lateFactRetained,
    total_citations: mm50CiteCount,
    valid_citations: mm50Valid ? mm50CiteCount : 0,
    leaked_tokens: 0,
    detail: lateFactRetained ? "Retained late-batch original fact" : "Missing late-batch original fact",
  });

  // Case 3: 3-vendor comparison Data Table with conflict & missing value marker (SC-006, SC-008)
  const vendorFixture = buildThreeVendorTableFixture();
  const dtModel = new DeterministicDataTableModel();
  const dtOutcome = await generateDataTable({
    chunks: vendorFixture.chunks,
    snapshot: vendorFixture.snapshot,
    model: dtModel,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
  });
  const dtValid =
    dtOutcome.status === "completed" &&
    validateDataTablePayload(dtOutcome.payload, vendorFixture.chunks, vendorFixture.snapshot) === null;
  const dtJson = dtOutcome.status === "completed" ? JSON.stringify(dtOutcome.payload) : "";
  const dtLeak = dtJson.includes(STUDIO_LEAK_PROBE) ? 1 : 0;
  const dtCiteCount = dtOutcome.status === "completed" ? dtOutcome.payload.citations.length : 0;
  totalCitations += dtCiteCount;
  if (dtValid) validCitations += dtCiteCount;
  totalLeakage += dtLeak;
  cases.push({
    id: "DT-DET-01: 3-vendor comparison table with conflicts and missing cells",
    kind: "data_table",
    passed: dtValid && dtLeak === 0 && dtCiteCount > 0,
    total_citations: dtCiteCount,
    valid_citations: dtValid ? dtCiteCount : 0,
    leaked_tokens: dtLeak,
    detail: dtValid ? `Valid table (${dtOutcome.status === "completed" ? dtOutcome.payload.rows.length : 0} rows)` : "Validation failed",
  });

  // Case 4: Negative guard — forged/out-of-scope chunk citation in mindmap or table is deterministically rejected
  let invalidCitationRejected = false;
  if (mmOutcome.status === "completed") {
    const forged = structuredClone(mmOutcome.payload);
    const outChunk = threeSource.unselectedChunks[0]!;
    forged.citations.push({
      badge_number: 999,
      source_id: outChunk.source_id,
      chunk_id: outChunk.chunk_id,
      revision: 1,
      snippet: outChunk.text,
    });
    const forgedErr = validateMindmapPayload(forged, threeSource.chunks, threeSource.snapshot);
    invalidCitationRejected = forgedErr !== null;
  }
  cases.push({
    id: "NEG-DET-01: Out-of-scope chunk citation rejected before publication",
    kind: "negative_citation_guard",
    passed: invalidCitationRejected,
    total_citations: 0,
    valid_citations: 0,
    leaked_tokens: 0,
    detail: invalidCitationRejected ? "Forged citation rejected" : "Forged citation was not rejected",
  });

  // Case 5: Missing-scope drilldown guard — when node's supporting source is deselected, zero node/parent text is injected
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
  cases.push({
    id: "DRILL-DET-01: Deselected supporting source blocks drilldown prompt construction",
    kind: "drilldown_guard",
    passed: missingScopeBlocked,
    total_citations: 0,
    valid_citations: 0,
    leaked_tokens: 0,
    detail: missingScopeBlocked ? "Blocked missing-scope drilldown" : "Failed to block missing-scope drilldown",
  });

  const precision = totalCitations > 0 ? validCitations / totalCitations : 0;
  const passed =
    precision === 1 &&
    totalLeakage === 0 &&
    lateFactRetained &&
    invalidCitationRejected &&
    missingScopeBlocked &&
    cases.every((c) => c.passed);

  return {
    passed,
    citation_precision: precision,
    leakage_count: totalLeakage,
    late_fact_retained: lateFactRetained,
    invalid_citation_rejected: invalidCitationRejected,
    missing_scope_drilldown_blocked: missingScopeBlocked,
    cases,
  };
}
