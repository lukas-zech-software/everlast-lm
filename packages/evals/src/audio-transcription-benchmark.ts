/**
 * 30-minute audio transcription benchmark (FR-SI-01, SC-002; specs/009 T028/T032).
 *
 * Clock: from the event "uploaded audio accepted for transcription" to "complete timestamped transcript available".
 * Queue waiting, preprocessing, provider wait and transcript assembly are inside; upload and later indexing are not.
 * The plan (fixture, N ≥ 20, provider/region, environment, concurrency) is declared before measuring. Every accepted
 * attempt stays in the sample; failed or unfinished attempts count as +∞. The P95 is nearest-rank over the full
 * sample. Warm/cold context is recorded but never used to exempt or reclassify an attempt. Target: ≤ 45,000 ms.
 */

export const AUDIO_P95_TARGET_MS = 120_000;
export const MIN_REPETITIONS = 5;
export const FIXTURE_DURATION_MS = 300_000;

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
  error?: string;
  cleanup?: "completed" | "failed";
  upload_ms?: number;
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
  if (plan.fixture.durationMs !== FIXTURE_DURATION_MS && plan.fixture.durationMs !== 1_800_000) throw new Error("The benchmark requires the declared 5-minute or 30-minute fixture");
  if (!/^[0-9a-f]{64}$/.test(plan.fixture.sha256)) throw new Error("The fixture SHA-256 must be declared");
  if (!plan.provider.region || !plan.provider.model || !plan.provider.service) throw new Error("Provider service, model and region must be declared");
  if (!plan.environment || !Number.isInteger(plan.concurrency) || plan.concurrency < 1) throw new Error("Environment and concurrency must be declared");
  if (!plan.fixture.name || !plan.fixture.codec || !plan.fixture.languageCode || !Number.isSafeInteger(plan.fixture.bytes) || plan.fixture.bytes <= 0) throw new Error("Fixture name, codec, language and positive byte size must be declared");
  if (!Number.isFinite(Date.parse(plan.declaredAt))) throw new Error("A valid declaredAt timestamp is required");
  return true;
}

/** The implemented collector is serial FLAC; reject unsupported plans before any cloud I/O (FR-SI-01, SC-002). */
export function validateExecutionPlan(plan: BenchmarkPlan, runtime: { region: string; model: string; languageCodes: string[] }): true {
  validatePlan(plan);
  if (plan.concurrency !== 1) throw new Error("The serial audio collector supports concurrency 1 only");
  if (plan.fixture.codec.toLowerCase() !== "flac") throw new Error("The audio collector requires a FLAC fixture");
  if (plan.provider.service !== "speech.googleapis.com/v2") throw new Error("Declared service does not match Speech V2");
  if (plan.provider.model !== runtime.model) throw new Error("Declared model does not match the execution model");
  if (plan.provider.region !== runtime.region) throw new Error("Declared region does not match the execution region");
  if (runtime.languageCodes.length !== 1 || runtime.languageCodes[0] !== plan.fixture.languageCode) throw new Error("Declared language does not match the execution language");
  return true;
}

export interface AudioBenchmarkDriver<T> {
  upload(attempt: number): Promise<T>;
  transcribe(object: T): Promise<void>;
  cleanup(object: T): Promise<void>;
  checkpoint(observations: BenchmarkObservation[]): void;
}

/** Persist acceptance before transcription so provider errors/interruption cannot hide accepted attempts (SC-002). */
export async function collectAudioBenchmark<T>(plan: BenchmarkPlan, driver: AudioBenchmarkDriver<T>): Promise<BenchmarkObservation[]> {
  validatePlan(plan);
  if (plan.concurrency !== 1) throw new Error("The serial audio collector supports concurrency 1 only");
  const observations: BenchmarkObservation[] = [];
  for (let attempt = 1; attempt <= plan.repetitions; attempt++) {
    const uploadStarted = Date.now();
    const object = await driver.upload(attempt);
    const uploadCompletedAt = new Date().toISOString();
    const observation: BenchmarkObservation = { attempt, uploadCompletedAt, acceptedAt: new Date().toISOString(), transcriptAvailableAt: null, indexedAt: null, outcome: "unfinished", warm: attempt > 1, upload_ms: Date.parse(uploadCompletedAt) - uploadStarted };
    observations.push(observation);
    driver.checkpoint(observations);
    try {
      await driver.transcribe(object);
      observation.transcriptAvailableAt = new Date().toISOString();
      observation.outcome = "completed";
    } catch (err) {
      observation.outcome = "failed";
      observation.error = err instanceof Error ? err.name : "Error";
    } finally {
      // Checkpoint the transcript boundary before cleanup: deletion time is not ASR latency.
      driver.checkpoint(observations);
      try {
        await driver.cleanup(object);
        observation.cleanup = "completed";
      } catch {
        observation.cleanup = "failed";
      }
      driver.checkpoint(observations);
    }
  }
  return observations;
}

export function nearestRankP95(samples: number[]): number {
  if (samples.length === 0) throw new Error("No samples");
  if (samples.some((value) => Number.isNaN(value) || value < 0)) throw new Error("Invalid latency sample");
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

export function evaluateBenchmark(plan: BenchmarkPlan, observations: BenchmarkObservation[]): BenchmarkResult {
  validatePlan(plan);
  if (observations.length !== plan.repetitions) throw new Error(`Expected exactly the ${plan.repetitions} predeclared attempts, got ${observations.length}`);
  const identities = new Set<number>();
  const declaredAt = Date.parse(plan.declaredAt);
  const clock = (value: string): number => {
    if (typeof value !== "string") throw new Error("Invalid observation timestamp");
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new Error("Invalid observation timestamp");
    return time;
  };
  for (const o of observations) {
    if (!Number.isInteger(o.attempt) || o.attempt < 1 || o.attempt > plan.repetitions || identities.has(o.attempt)) throw new Error("Expected unique predeclared attempt identities 1..N");
    identities.add(o.attempt);
    const accepted = clock(o.acceptedAt);
    if (declaredAt > accepted) throw new Error("The plan must be declared before acceptance");
    if (clock(o.uploadCompletedAt) > accepted) throw new Error("Upload clock must precede acceptance");
    if (o.transcriptAvailableAt !== null && clock(o.transcriptAvailableAt) < accepted) throw new Error("Transcript clock must follow acceptance");
    if (o.indexedAt !== null && (o.transcriptAvailableAt === null || clock(o.indexedAt) < clock(o.transcriptAvailableAt))) throw new Error("Index clock must follow transcript availability");
  }
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
