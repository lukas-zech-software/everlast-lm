/**
 * 30-minute audio transcription benchmark (FR-SI-01, SC-002; specs/009 T028/T032).
 *
 * Clock: from the event "uploaded audio accepted for transcription" to "complete timestamped transcript available".
 * Queue waiting, preprocessing, provider wait and transcript assembly are inside; upload and later indexing are not.
 * The plan (fixture, N ≥ 20, provider/region, environment, concurrency) is declared before measuring. Every accepted
 * attempt stays in the sample; failed or unfinished attempts count as +∞. The P95 is nearest-rank over the full
 * sample. Warm/cold context is recorded but never used to exempt or reclassify an attempt. Target: ≤ 45,000 ms.
 */

export const AUDIO_P95_TARGET_MS = 45_000;
export const MIN_REPETITIONS = 20;
export const FIXTURE_DURATION_MS = 1_800_000;

export interface BenchmarkPlan {
  fixture: { name: string; durationMs: number; sha256: string; codec: string; languageCode: string; bytes: number };
  repetitions: number;
  provider: { service: string; model: string; region: string };
  environment: string;
  concurrency: number;
  declaredAt: string;
}

export interface BenchmarkObservation {
  attempt: number;
  uploadCompletedAt: string;
  acceptedAt: string;
  transcriptAvailableAt: string | null;
  indexedAt: string | null;
  outcome: "completed" | "failed" | "unfinished";
  warm: boolean;
}

export interface BenchmarkResult {
  plan: BenchmarkPlan;
  samplesMs: number[];
  p95Ms: number;
  targetMs: number;
  pass: boolean;
  failures: { attempt: number; outcome: string }[];
  observations: BenchmarkObservation[];
}

export function validatePlan(plan: BenchmarkPlan): true {
  if (!Number.isInteger(plan.repetitions) || plan.repetitions < MIN_REPETITIONS) throw new Error(`The plan must predeclare at least ${MIN_REPETITIONS} repetitions`);
  if (plan.fixture.durationMs !== FIXTURE_DURATION_MS) throw new Error("The benchmark requires the declared 30-minute fixture");
  if (!/^[0-9a-f]{64}$/.test(plan.fixture.sha256)) throw new Error("The fixture SHA-256 must be declared");
  if (!plan.provider.region || !plan.provider.model || !plan.provider.service) throw new Error("Provider service, model and region must be declared");
  if (!plan.environment || !Number.isInteger(plan.concurrency) || plan.concurrency < 1) throw new Error("Environment and concurrency must be declared");
  return true;
}

export function nearestRankP95(samples: number[]): number {
  if (samples.length === 0) throw new Error("No samples");
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

export function evaluateBenchmark(plan: BenchmarkPlan, observations: BenchmarkObservation[]): BenchmarkResult {
  validatePlan(plan);
  if (observations.length !== plan.repetitions) throw new Error(`Expected exactly the ${plan.repetitions} predeclared attempts, got ${observations.length}`);
  const samplesMs = observations.map((o) => {
    if (o.outcome !== "completed" || !o.transcriptAvailableAt) return Infinity;
    return Date.parse(o.transcriptAvailableAt) - Date.parse(o.acceptedAt);
  });
  const p95Ms = nearestRankP95(samplesMs);
  return {
    plan,
    samplesMs,
    p95Ms,
    targetMs: AUDIO_P95_TARGET_MS,
    pass: p95Ms <= AUDIO_P95_TARGET_MS,
    failures: observations.filter((o) => o.outcome !== "completed" || !o.transcriptAvailableAt).map((o) => ({ attempt: o.attempt, outcome: o.outcome })),
    observations,
  };
}
