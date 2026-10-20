import { performance } from "node:perf_hooks";
import {
  InvalidScopeError,
  REQUIRED_REPORT_SECTIONS,
  SourceSnapshotInvalidError,
  StudioPluginRegistry,
  type ReportTemplateType,
  type SourceRevisionPair,
  type StudioJobStatus,
  type StudioReportPayload,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { StudioJobRunner, validateReportPayload } from "@everlast/worker/studio/runner";
import { ReportGeneratorPlugin } from "@everlast/worker/studio/reports/plugin";
import { DeterministicReportModel } from "@everlast/worker/studio/reports/deterministic-model";
import type { ReportModelClient } from "@everlast/worker/studio/reports/model";

/**
 * Gate v2.0 #3 (SRS §5.4, FR-ST-10, FR-017, SC-001, NFR-EVAL-02/04): all four standard report templates run
 * through the runtime path (StudioJobRunner → ReportGeneratorPlugin → validateReportPayload) on the declared
 * two-source fixture (dated historical events + technical definitions). A third, unselected source must never
 * leak. `eval:deterministic` runs it on every PR with the deterministic report model; the release run uses the
 * Vertex AI Flash adapter (`europe-west4`, keyless ADC) and is UNAVAILABLE without Vertex configuration.
 */

export const STUDIO_GATE_TEMPLATES: ReportTemplateType[] = ["briefing_doc", "study_guide", "faq", "timeline"];
export const STUDIO_GATE_P95_MS = 25_000;

const NB = "11111111-1111-4111-8111-111111111111";
const OWNER = "studio-gate-owner";
const HISTORY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNSELECTED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** A term only the unselected source contains (leakage probe, NFR-EVAL-04). */
const LEAK_TERM = "Zorblax";

const chunk = (n: number, source_id: string, text: string): UnifiedDocumentChunk => ({
  chunk_id: `01890000-0000-7000-8000-${String(n).padStart(12, "0")}`,
  source_id,
  revision: 1,
  locator: { page_number: 1, start_offset: 0, end_offset: text.length },
  token_count: Math.ceil(text.length / 4),
  text,
});

/** Declared Gate v2.0 #3 fixture: two selected sources (dated events, definitions) and one unselected source. */
export function studioGateFixture() {
  const selected = [
    chunk(1, HISTORY, "The Treaty of Westphalia was signed in 1648 by Count Maximilian von Trauttmansdorff and Axel Oxenstierna. It ended the Thirty Years War."),
    chunk(2, HISTORY, "In 1815 the Congress of Vienna reorganised Europe under Klemens von Metternich. The settlement lasted for decades."),
    chunk(3, TECH, "A hash function is a function that maps data of arbitrary size to fixed-size values. Hash functions are used in data indexing."),
    chunk(4, TECH, "Blockchain means a distributed ledger of linked blocks. Satoshi Nakamoto described Bitcoin in 2008."),
  ];
  const unselected = [chunk(5, UNSELECTED, `The ${LEAK_TERM} Protocol was invented in 1999 by Quentin ${LEAK_TERM}.`)];
  const snapshot: SourceRevisionPair[] = [HISTORY, TECH].map((source_id) => ({ source_id, revision: 1 }));
  return { chunks: selected, all: [...selected, ...unselected], snapshot };
}

export interface StudioGateCase {
  subtype: ReportTemplateType;
  status: StudioJobStatus;
  duration_ms: number;
  missing_sections: string[];
  /** First validation problem (required sections, per-sentence citations, scope), or null. */
  problem: string | null;
  citations: number;
  precise_citations: number;
  leaked: number;
  payload: StudioReportPayload | null;
}

export interface StudioGateResult {
  model: string;
  cases: StudioGateCase[];
  validity_rate: number;
  citation_precision: number;
  leakage: number;
  p95_ms: number;
  passed: boolean;
  fixture: ReturnType<typeof studioGateFixture>;
}

const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
};

export async function runStudioReportsGate(options: { model?: ReportModelClient; modelId?: string } = {}): Promise<StudioGateResult> {
  const fixture = studioGateFixture();
  const repo = new InMemoryStudioArtifactRepository();
  const registry = new StudioPluginRegistry();
  registry.register(new ReportGeneratorPlugin(options.model ?? new DeterministicReportModel()));
  const revisions = new Map([[HISTORY, 1], [TECH, 1], [UNSELECTED, 1]]);
  const runner = new StudioJobRunner({
    repo,
    registry,
    // C-02: only chunks of the requested sources leave the provider.
    scopedContext: { getScopedContext: async (_nb, ids) => fixture.all.filter((c) => ids.includes(c.source_id)) },
    access: {
      async verifySnapshot(owner, nb, snapshot) {
        if (owner !== OWNER || nb !== NB) throw new InvalidScopeError("not authorized");
        for (const p of snapshot) if (revisions.get(p.source_id) !== p.revision) throw new SourceSnapshotInvalidError("source changed");
      },
    },
  });
  const inScope = new Set(fixture.chunks.map((c) => c.chunk_id));
  const cases: StudioGateCase[] = [];
  for (const subtype of STUDIO_GATE_TEMPLATES) {
    const queued = await repo.createQueued({ notebook_id: NB, owner_id: OWNER, subtype, title: subtype, params_json: {}, snapshot: fixture.snapshot, output_language: "en-US" });
    const started = performance.now();
    const done = await runner.run(queued.id);
    const duration_ms = performance.now() - started;
    const payload = done.payload_json;
    const keys = new Set(payload?.sections.map((x) => x.key) ?? []);
    const citations = payload?.citations ?? [];
    cases.push({
      subtype,
      status: done.status,
      duration_ms,
      missing_sections: REQUIRED_REPORT_SECTIONS[subtype].filter((key) => !keys.has(key)),
      problem: payload ? validateReportPayload(payload, fixture.chunks, fixture.snapshot, subtype) : (done.failure?.message ?? "not completed"),
      citations: citations.length,
      precise_citations: citations.filter((c) => inScope.has(c.chunk_id)).length,
      leaked: citations.filter((c) => c.source_id === UNSELECTED).length + (payload?.content_md.includes(LEAK_TERM) ? 1 : 0),
      payload,
    });
  }
  const valid = cases.filter((c) => c.status === "Completed" && c.problem === null && c.missing_sections.length === 0).length;
  const total = cases.reduce((n, c) => n + c.citations, 0);
  const precise = cases.reduce((n, c) => n + c.precise_citations, 0);
  const result = {
    model: options.modelId ?? "deterministic-report-model (test double)",
    cases,
    validity_rate: valid / cases.length,
    citation_precision: total === 0 ? 0 : precise / total,
    leakage: cases.reduce((n, c) => n + c.leaked, 0),
    p95_ms: p95(cases.map((c) => c.duration_ms)),
    fixture,
  };
  return { ...result, passed: result.validity_rate === 1 && result.citation_precision === 1 && result.leakage === 0 && result.p95_ms <= STUDIO_GATE_P95_MS };
}

export type StudioReleaseGateResult = { status: "unavailable"; reason: string } | { status: "ran"; result: StudioGateResult };

/** Release variant with the Vertex AI Flash report adapter; never reports a pass it did not run. */
export async function runStudioReportsReleaseGate(env: NodeJS.ProcessEnv): Promise<StudioReleaseGateResult> {
  const { createVertexReportModelFromEnv, REPORT_MODEL } = await import("@everlast/worker/studio/reports/vertex-model");
  const model = createVertexReportModelFromEnv(env);
  if (!model) return { status: "unavailable", reason: "Vertex AI is not configured (VERTEX_PROJECT / GCP_PROJECT_ID unset)" };
  return { status: "ran", result: await runStudioReportsGate({ model, modelId: `vertex:${env.VERTEX_LOCATION ?? "europe-west4"}:${env.REPORT_MODEL ?? REPORT_MODEL}` }) };
}

export function renderStudioGate(result: StudioGateResult): string[] {
  return [
    `Gate v2.0 #3 Studio reports (${result.model}): ${result.passed ? "PASS" : "FAIL"}`,
    `  validity ${(result.validity_rate * 100).toFixed(0)} % (${result.cases.filter((c) => c.problem === null).length}/${result.cases.length}), citation precision ${result.citation_precision.toFixed(3)}, leakage ${result.leakage}, P95 ${result.p95_ms.toFixed(1)} ms (≤ ${STUDIO_GATE_P95_MS} ms)`,
    ...result.cases.filter((c) => c.problem !== null || c.status !== "Completed").map((c) => `  ${c.subtype}: ${c.status} — ${c.problem}`),
  ];
}
