import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUDIO_P95_TARGET_MS,
  evaluateBenchmark,
  nearestRankP95,
  validatePlan,
  validateExecutionPlan,
  collectAudioBenchmark,
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

// [009-multimodal-ingestion-sync] T057 — FR-SI-01 / SC-002: evidence must describe the actual declared run.
describe("benchmark evidence integrity (FR-SI-01, SC-002)", () => {
  it("rejects duplicate, out-of-range and missing attempt identities", () => {
    const duplicate = obs(20, () => 1000);
    duplicate[19]!.attempt = 1;
    expect(() => evaluateBenchmark(plan, duplicate)).toThrow(/attempt/i);
    const outside = obs(20, () => 1000);
    outside[19]!.attempt = 21;
    expect(() => evaluateBenchmark(plan, outside)).toThrow(/attempt/i);
  });

  it("rejects invalid, reversed and post-hoc clocks rather than passing negative latency", () => {
    for (const patch of [
      { acceptedAt: "invalid" },
      { transcriptAvailableAt: "2026-10-23T08:59:59.000Z" },
      { uploadCompletedAt: "2026-10-23T09:00:01.000Z" },
      { indexedAt: "2026-10-23T09:00:00.000Z" },
    ]) {
      const samples = obs(20, () => 1000);
      Object.assign(samples[0]!, patch);
      expect(() => evaluateBenchmark(plan, samples)).toThrow(/time|clock/i);
    }
    expect(() => validatePlan({ ...plan, declaredAt: "invalid" })).toThrow(/declared/i);
    expect(() => evaluateBenchmark({ ...plan, declaredAt: "2026-10-23T09:00:00.001Z" }, obs(20, () => 1000))).toThrow(/declared/i);
  });

  it("rejects unsupported or mismatching live execution settings before calls", () => {
    const runtime = { region: "europe-west4", model: "chirp_2", languageCodes: ["en-US"] };
    expect(validateExecutionPlan(plan, runtime)).toBe(true);
    expect(() => validateExecutionPlan({ ...plan, concurrency: 2 }, runtime)).toThrow(/serial|concurrency/i);
    expect(() => validateExecutionPlan(plan, { ...runtime, region: "europe-west1" })).toThrow(/region/i);
    expect(() => validateExecutionPlan(plan, { ...runtime, languageCodes: ["auto"] })).toThrow(/language/i);
    expect(() => validateExecutionPlan({ ...plan, fixture: { ...plan.fixture, codec: "mp3" } }, runtime)).toThrow(/FLAC/i);
    expect(() => validateExecutionPlan({ ...plan, provider: { ...plan.provider, model: "other" } }, runtime)).toThrow(/model/i);
    expect(() => validateExecutionPlan({ ...plan, provider: { ...plan.provider, service: "other" } }, runtime)).toThrow(/service/i);
  });

  it("checkpoints unfinished acceptance before provider work and retains failures plus cleanup errors", async () => {
    const checkpoints: BenchmarkObservation[][] = [];
    let calls = 0;
    const observations = await collectAudioBenchmark(plan, {
      upload: async (attempt) => attempt,
      transcribe: async () => {
        calls++;
        expect(checkpoints.at(-1)?.at(-1)?.outcome).toBe("unfinished");
        if (calls <= 2) throw new Error("provider failure");
      },
      cleanup: async () => { throw new Error("cleanup failure"); },
      checkpoint: (items) => checkpoints.push(structuredClone(items)),
    });
    expect(observations).toHaveLength(20);
    expect(observations.slice(0, 2).every((item) => item.outcome === "failed" && item.error === "Error")).toBe(true);
    expect(observations.every((item) => item.cleanup === "failed")).toBe(true);
    expect(evaluateBenchmark(plan, observations).pass).toBe(false);
  });
});

// [009-multimodal-ingestion-sync] T067 — FR-SI-01 / SC-002: a matching digest
// cannot turn a shorter or mislabeled file into the frozen 30-minute fixture.
describe("audio fixture preflight (FR-SI-01, SC-002)", () => {
  const runner = fileURLToPath(new URL("../../../scripts/eval-v3-audio.mjs", import.meta.url));

  function streamInfoFixture(seconds: number): Buffer {
    // Native FLAC header with a single STREAMINFO block. The fixture isolates
    // the metadata check and is not intended for audio decoding.
    const header = Buffer.alloc(43);
    header.write("fLaC");
    header[4] = 0x80;
    header.writeUIntBE(34, 5, 3);
    const sampleRate = 16_000;
    const sixteenBitMono = 15n << 36n;
    header.writeBigUInt64BE((BigInt(sampleRate) << 44n) | sixteenBitMono | BigInt(sampleRate * seconds), 18);
    return header;
  }

  function preflight(bytes: Buffer, overrides: Partial<BenchmarkPlan> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "everlast-audio-preflight-"));
    try {
      const fixture = join(dir, "fixture.flac");
      const declaration = join(dir, "plan.json");
      writeFileSync(fixture, bytes);
      writeFileSync(declaration, JSON.stringify({
        ...plan,
        fixture: { ...plan.fixture, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length },
        ...overrides,
      }));
      return spawnSync(process.execPath, [runner, "--plan", declaration, "--fixture", fixture, "--validate-only"], {
        encoding: "utf8",
        timeout: 10_000,
        env: { PATH: process.env.PATH, SPEECH_LOCATION: "" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("rejects matching shorter audio and matching non-FLAC bytes", () => {
    const short = preflight(streamInfoFixture(60));
    expect(short.status).toBe(2);
    expect(short.stderr).toMatch(/duration.*30 minutes/i);
    const wrongFormat = preflight(Buffer.from("not an audio fixture"));
    expect(wrongFormat.status).toBe(2);
    expect(wrongFormat.stderr).toMatch(/FLAC STREAMINFO/);
  });

  it("validates 30-minute metadata offline and rejects unsupported cohort settings", () => {
    const bytes = streamInfoFixture(1800);
    const result = preflight(bytes);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "VALIDATED", repetitions: 20, duration_ms: 1_800_000 });

    const badConcurrency = preflight(bytes, { concurrency: 2 });
    expect(badConcurrency.status).toBe(2);
    expect(badConcurrency.stderr).toMatch(/serial.*concurrency 1/i);
  });
});
