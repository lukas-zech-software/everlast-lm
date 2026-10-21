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

const HISTORY_TEXTS = [
  "The Peace of Westphalia was signed in 1648 by Count Maximilian von Trauttmansdorff and Axel Oxenstierna. It ended the Thirty Years War. Historians often describe the settlement as the origin of the modern state system.",
  "Sovereignty is the principle that each state has exclusive authority over its own territory. The Westphalian treaties applied this principle to the princes of the Holy Roman Empire. Rulers could choose the official religion of their own lands.",
  "The Treaty of Utrecht was concluded in 1713 and ended the War of the Spanish Succession. Philip V kept the Spanish throne but renounced any claim to the French crown. Great Britain gained Gibraltar under the treaty.",
  "The balance of power is a policy in which states form alliances so that no single state dominates the others. British diplomats followed this policy throughout the eighteenth century. It shaped the coalitions against France after 1792.",
  "In 1815 the Congress of Vienna reorganised Europe under Klemens von Metternich. Representatives of Austria, Prussia, Russia and Great Britain redrew the borders of the continent. The settlement lasted for decades.",
  "The Concert of Europe refers to the system of regular conferences among the great powers after 1815. Its members met to settle disputes before they turned into wars. The system weakened after the revolutions of 1848.",
  "Otto von Bismarck became Minister President of Prussia in 1862. He unified Germany through three short wars and proclaimed the German Empire in 1871. The proclamation took place in the Hall of Mirrors at Versailles.",
  "The Congress of Berlin met in 1878 under the chairmanship of Otto von Bismarck. It revised the Treaty of San Stefano after the Russo-Turkish War. Serbia, Montenegro and Romania were recognised as independent states.",
  "An entente is an informal understanding between states that falls short of a binding alliance. The Entente Cordiale between France and Great Britain was signed in 1904. It settled colonial disputes between the two countries.",
  "The Treaty of Versailles was signed in 1919 after the First World War. Georges Clemenceau, David Lloyd George and Woodrow Wilson led the negotiations. The treaty also created the League of Nations.",
];

const TECH_TEXTS = [
  "A hash function is a function that maps data of arbitrary size to fixed-size values. Hash functions are used in data indexing. A good hash function spreads its inputs evenly across the output range.",
  "A cryptographic hash function is a hash function for which finding two inputs with the same output is computationally infeasible. The SHA-256 function was published by the National Institute of Standards and Technology in 2001. It produces a 256-bit digest.",
  "Public-key cryptography means a method of encryption that uses a pair of related keys. Whitfield Diffie and Martin Hellman described the key exchange idea in 1976. The public key can be shared openly while the private key stays secret.",
  "The RSA algorithm was published in 1977 by Ron Rivest, Adi Shamir and Leonard Adleman. Its security rests on the difficulty of factoring large numbers. RSA is used for both encryption and digital signatures.",
  "A digital signature is a value computed with a private key that lets anyone holding the public key verify the origin of a message. A valid signature shows that the message was not changed after signing. Signatures are central to software updates and certificates.",
  "A Merkle tree is a tree in which every leaf holds the hash of a data block and every inner node holds the hash of its children. Ralph Merkle patented the structure in 1979. It allows efficient verification of large data sets.",
  "Blockchain means a distributed ledger of linked blocks. Each block stores the hash of the previous block, so changing one block breaks every later link. Satoshi Nakamoto described Bitcoin in 2008.",
  "Proof of work refers to a consensus method in which participants must solve a costly computational puzzle before adding a block. The Bitcoin network started using proof of work in 2009. The method consumes a large amount of electricity.",
  "A smart contract is a program stored on a blockchain that runs automatically when its conditions are met. Vitalik Buterin proposed the Ethereum platform for smart contracts in 2013. The Ethereum network launched in 2015.",
  "Proof of stake is a consensus method in which validators lock up tokens as collateral instead of solving puzzles. Ethereum switched from proof of work to proof of stake in 2022. The change reduced the network's energy use substantially.",
];

/**
 * Declared Gate v2.0 #3 fixture: two selected sources with enough dated events, actors and technical definitions
 * for every required section of all four templates (incl. Study Guide topic review, short-answer questions, answer
 * key, essay questions and glossary), plus one unselected source carrying `LEAK_TERM`. Revised 2026-10-20 after
 * the first live run refused the Study Guide on the earlier 4-chunk fixture (correct refusal: never pad).
 */
export function studioGateFixture() {
  const selected = [
    ...HISTORY_TEXTS.map((text, i) => chunk(i + 1, HISTORY, text)),
    ...TECH_TEXTS.map((text, i) => chunk(HISTORY_TEXTS.length + i + 1, TECH, text)),
  ];
  const base = selected.length;
  const unselected = [
    chunk(base + 1, UNSELECTED, `The ${LEAK_TERM} Protocol was invented in 1999 by Quentin ${LEAK_TERM}.`),
    chunk(base + 2, UNSELECTED, `A ${LEAK_TERM} key is a credential that only the ${LEAK_TERM} Protocol accepts.`),
  ];
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
