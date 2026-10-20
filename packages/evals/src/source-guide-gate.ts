import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { resetPackageV22Store } from "@everlast/db";
import { generateSourceGuide, type PackageV22SourceReader, type ScopedSourceMaterial, type StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { buildCorpus } from "./corpus.ts";

/**
 * Gate v2.0 #1 (SRS §5.4, FR-SI-02, FR-018): every successfully ingested source gets its Source Guide
 * asynchronously in < 10 s P95 from `Ready`. Release-only: runs the real Vertex AI Flash-Lite client
 * (`europe-west4`, keyless ADC) over the ten golden-corpus documents in two output languages (20 samples).
 *
 * Latency from `Ready` = Ready-watcher dispatch delay + generation. The watcher polls every
 * `V2_READY_WATCH_MS` (default 1,000 ms, D16), so the worst-case dispatch delay is added to every sample
 * instead of measuring it; generation goes through `generateSourceGuide`, the same path the watcher calls,
 * including C-02 reads (in-memory reader here), validation of supporting chunk IDs and retries.
 */

export const SOURCE_GUIDE_GATE_P95_MS = 10_000;
export const SOURCE_GUIDE_GATE_LANGUAGES = ["en-US", "de-DE"] as const;

const NOTEBOOK = "22222222-2222-4222-8222-222222222222";
const OWNER = "source-guide-gate-owner";

/** Deterministic UUID (v4 layout) from a label, so fixture IDs are stable between runs. */
function uuidFrom(label: string): string {
  const h = createHash("sha256").update(label).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function sourceGuideGateFixture(): ScopedSourceMaterial[] {
  return buildCorpus().map((doc) => {
    const source_id = uuidFrom(`source:${doc.key}`);
    const chunks = doc.pages.map((text, i) => ({ chunk_id: uuidFrom(`chunk:${doc.key}:${i}`), text, source_id, revision: 1 }));
    return { source_id, revision: 1, title: doc.title, word_count: chunks.reduce((n, c) => n + words(c.text), 0), chunks };
  });
}

export interface SourceGuideGateCase {
  source_title: string;
  output_language: string;
  status: string;
  generation_ms: number;
  from_ready_ms: number;
  summary_words: number;
  key_topics: number;
  supported: boolean;
  problem: string | null;
}

export interface SourceGuideGateResult {
  model: string;
  dispatch_delay_ms: number;
  cases: SourceGuideGateCase[];
  ready_rate: number;
  p95_from_ready_ms: number;
  passed: boolean;
}

const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
};

export async function runSourceGuideGate(options: { model: StructuredGenerationClient; modelId: string; dispatchDelayMs: number }): Promise<SourceGuideGateResult> {
  const sources = sourceGuideGateFixture();
  const reader: PackageV22SourceReader = {
    // C-02 singleton scope: only the requested revision of the requested source is returned.
    async readReadySources(request) {
      return sources.filter((s) => request.source_revisions.some((p) => p.source_id === s.source_id && p.revision === s.revision));
    },
  };
  resetPackageV22Store();
  const cases: SourceGuideGateCase[] = [];
  for (const output_language of SOURCE_GUIDE_GATE_LANGUAGES) {
    for (const source of sources) {
      const started = performance.now();
      let guide: Awaited<ReturnType<typeof generateSourceGuide>> | null = null;
      let thrown: string | null = null;
      try {
        guide = await generateSourceGuide({
          notebook_id: NOTEBOOK, user_id: OWNER, source_id: source.source_id, revision: source.revision, output_language,
          ready_at: new Date().toISOString(), reader, model: options.model,
        });
      } catch (error) {
        // Our own validation / StructuredGenerationError messages only; upstream text is never in them.
        thrown = `${(error as Error).name}: ${(error as Error).message}`.slice(0, 200);
      }
      const generation_ms = performance.now() - started;
      const inSource = new Set(source.chunks.map((c) => c.chunk_id));
      const supported = !!guide && guide.supporting_chunk_ids.length > 0 && guide.supporting_chunk_ids.every((id) => inSource.has(id));
      cases.push({
        source_title: source.title,
        output_language,
        status: guide?.status ?? "GuideFailed",
        generation_ms,
        from_ready_ms: generation_ms + options.dispatchDelayMs,
        summary_words: guide ? words(guide.summary_md) : 0,
        key_topics: guide?.key_topics.length ?? 0,
        supported,
        problem: thrown ?? (guide!.status !== "GuideReady" ? (guide!.error ?? guide!.status) : supported ? null : "supporting chunk IDs outside the source"),
      });
    }
  }
  const ready = cases.filter((c) => c.problem === null).length;
  const result = {
    model: options.modelId,
    dispatch_delay_ms: options.dispatchDelayMs,
    cases,
    ready_rate: ready / cases.length,
    p95_from_ready_ms: p95(cases.map((c) => c.from_ready_ms)),
  };
  return { ...result, passed: result.ready_rate === 1 && result.p95_from_ready_ms < SOURCE_GUIDE_GATE_P95_MS };
}

export type SourceGuideReleaseGateResult = { status: "unavailable"; reason: string } | { status: "ran"; result: SourceGuideGateResult };

/** Release variant with the Vertex AI Flash-Lite client; never reports a pass it did not run. */
export async function runSourceGuideReleaseGate(env: NodeJS.ProcessEnv): Promise<SourceGuideReleaseGateResult> {
  const { createVertexStructuredGenerationFromEnv } = await import("@everlast/worker/package-v2-2-gemini");
  const model = createVertexStructuredGenerationFromEnv(env);
  if (!model) return { status: "unavailable", reason: "Vertex AI is not configured (VERTEX_PROJECT / GCP_PROJECT_ID unset)" };
  const location = env.VERTEX_LOCATION ?? "europe-west4";
  return {
    status: "ran",
    result: await runSourceGuideGate({ model, modelId: `vertex:${location}:${env.STRUCTURED_MODEL ?? "gemini-2.5-flash-lite"}`, dispatchDelayMs: Number(env.V2_READY_WATCH_MS ?? 1_000) }),
  };
}

export function renderSourceGuideGate(result: SourceGuideGateResult): string[] {
  const generation = result.cases.map((c) => c.generation_ms);
  return [
    `Gate v2.0 #1 Source Guide (${result.model}): ${result.passed ? "PASS" : "FAIL"}`,
    `  GuideReady ${(result.ready_rate * 100).toFixed(0)} % (${result.cases.filter((c) => c.problem === null).length}/${result.cases.length}), P95 from Ready ${result.p95_from_ready_ms.toFixed(0)} ms (< ${SOURCE_GUIDE_GATE_P95_MS} ms; generation P95 ${p95(generation).toFixed(0)} ms + watcher dispatch ≤ ${result.dispatch_delay_ms} ms)`,
    `  summary words ${Math.min(...result.cases.map((c) => c.summary_words))}–${Math.max(...result.cases.map((c) => c.summary_words))}, key topics ${Math.min(...result.cases.map((c) => c.key_topics))}–${Math.max(...result.cases.map((c) => c.key_topics))}`,
    ...result.cases.filter((c) => c.problem !== null).map((c) => `  ${c.source_title} [${c.output_language}]: ${c.problem}`),
  ];
}
