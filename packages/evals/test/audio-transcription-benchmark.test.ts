import { describe, expect, it } from "vitest";
import {
  AUDIO_P95_TARGET_MS,
  evaluateBenchmark,
  nearestRankP95,
  validatePlan,
  type BenchmarkObservation,
  type BenchmarkPlan,
} from "../src/audio-transcription-benchmark.ts";

/**
 * [009-multimodal-ingestion-sync] T028 — 30-minute audio transcription benchmark aggregation (FR-SI-01; spec FR-004,
 * SC-002): the clock runs from acceptance for transcription (queue, preprocessing, provider, assembly included) to
 * the complete timestamped transcript (upload and later indexing excluded); N ≥ 20 is predeclared; every accepted
 * attempt stays in the nearest-rank P95 sample, failed/unfinished attempts as +∞; no warm-only exemption.
 */

const plan: BenchmarkPlan = {
  fixture: { name: "depot-meeting-30min.flac", durationMs: 1_800_000, sha256: "a".repeat(64), codec: "flac", languageCode: "en-US", bytes: 57_600_000 },
  repetitions: 20,
  provider: { service: "speech.googleapis.com/v2", model: "chirp_2", region: "europe-west4" },
  environment: "dev",
  concurrency: 1,
  declaredAt: "2026-10-23T08:00:00.000Z",
};

function obs(n: number, ms: (i: number) => number | null, warm = true): BenchmarkObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const accepted = Date.parse("2026-10-23T09:00:00.000Z") + i * 3_600_000;
    const v = ms(i);
    return {
      attempt: i + 1,
      uploadCompletedAt: new Date(accepted - 9_000).toISOString(),
      acceptedAt: new Date(accepted).toISOString(),
      transcriptAvailableAt: v === null ? null : new Date(accepted + v).toISOString(),
      indexedAt: v === null ? null : new Date(accepted + v + 7_000).toISOString(),
      outcome: v === null ? "failed" : "completed",
      warm,
    };
  });
}

describe("nearest-rank P95 (SC-002)", () => {
  it("BENCH-01: ceil(0.95·N)-th smallest value; +∞ counts like any other sample", () => {
    expect(nearestRankP95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19);
    expect(nearestRankP95([...Array.from({ length: 19 }, () => 10), Infinity])).toBe(10);
    expect(nearestRankP95([...Array.from({ length: 18 }, () => 10), Infinity, Infinity])).toBe(Infinity);
    expect(() => nearestRankP95([])).toThrow();
  });
});

describe("benchmark evaluation (FR-SI-01)", () => {
  it("BENCH-02: the plan must predeclare N ≥ 20, a 30-minute fixture and the provider/region", () => {
    expect(() => validatePlan({ ...plan, repetitions: 19 })).toThrow(/20/);
    expect(() => validatePlan({ ...plan, fixture: { ...plan.fixture, durationMs: 600_000 } })).toThrow(/30-minute/);
    expect(() => validatePlan({ ...plan, provider: { ...plan.provider, region: "" } })).toThrow();
    expect(validatePlan(plan)).toBe(true);
  });

  it("BENCH-03: timing is acceptance → transcript (queue included), never upload or indexing", () => {
    const result = evaluateBenchmark(plan, obs(20, () => 30_000));
    expect(result.samplesMs.every((v) => v === 30_000)).toBe(true);
    expect(result.p95Ms).toBe(30_000);
    expect(result.pass).toBe(true);
    expect(AUDIO_P95_TARGET_MS).toBe(45_000);
  });

  it("BENCH-04: failed or unfinished attempts stay in the sample as +∞ and can fail the gate", () => {
    const twoFailures = evaluateBenchmark(plan, obs(20, (i) => (i < 2 ? null : 20_000)));
    expect(twoFailures.samplesMs.filter((v) => v === Infinity)).toHaveLength(2);
    expect(twoFailures.p95Ms).toBe(Infinity);
    expect(twoFailures.pass).toBe(false);
    expect(twoFailures.failures).toEqual([{ attempt: 1, outcome: "failed" }, { attempt: 2, outcome: "failed" }]);
    const oneFailure = evaluateBenchmark(plan, obs(20, (i) => (i === 0 ? null : 20_000)));
    expect(oneFailure.p95Ms).toBe(20_000);
  });

  it("BENCH-05: attempts cannot be dropped, added or reclassified after the fact; cold attempts get no exemption", () => {
    expect(() => evaluateBenchmark(plan, obs(19, () => 1000))).toThrow(/20/);
    expect(() => evaluateBenchmark(plan, obs(21, () => 1000))).toThrow(/20/);
    const cold = evaluateBenchmark(plan, obs(20, (i) => (i === 19 || i === 18 ? 50_000 : 10_000), false));
    expect(cold.p95Ms).toBe(50_000);
    expect(cold.pass).toBe(false);
  });

  it("BENCH-06: a threshold exactly at 45 s passes (inclusive); 45,001 ms fails", () => {
    expect(evaluateBenchmark(plan, obs(20, () => 45_000)).pass).toBe(true);
    expect(evaluateBenchmark(plan, obs(20, () => 45_001)).pass).toBe(false);
  });
});
