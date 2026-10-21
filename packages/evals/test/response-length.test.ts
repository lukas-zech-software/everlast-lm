import { describe, expect, it, vi } from "vitest";
import { buildGoldenDataset, releaseSample, RELEASE_SAMPLE_SIZE } from "../src/dataset.ts";
import {
  computeResponseLengthMetric,
  countResponseTokens,
  RESPONSE_LENGTH_GENERATION_PARAMETERS,
  responseLengthEligible,
  runResponseLengthEval,
} from "../src/response-length.ts";

/**
 * FR-GC-07 / FR-012 response-length release metric, measured once per release gate on the fixed stratified
 * 50-case sample (Constitution v2.0.0): on cases whose sources support a longer answer, Shorter averages <= 50 %
 * and Longer >= 150 % of the Default answer token count for the same question. UNAVAILABLE, never pass, without
 * the judged runner.
 */

const sample = releaseSample(buildGoldenDataset(), RELEASE_SAMPLE_SIZE);

describe("response-length release metric (FR-GC-07, FR-012)", () => {
  it("uses only answerable synthesis cases of the fixed 50-case release sample", () => {
    const eligible = responseLengthEligible(sample);
    expect(sample).toHaveLength(50);
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((c) => c.answerable && c.category === "synthesis")).toBe(true);
    expect(eligible.map((c) => c.id)).toEqual(sample.filter((c) => c.answerable && c.category === "synthesis").map((c) => c.id));
  });

  it("counts word tokens of the answer, ignoring citation badges", () => {
    expect(countResponseTokens("Port 8080 requires mTLS [1]. Always [2][3].")).toBe(5);
    expect(countResponseTokens("")).toBe(0);
  });

  it("passes when Shorter averages <= 50 % and Longer >= 150 % of Default, and fails otherwise", () => {
    const pass = computeResponseLengthMetric([
      { case_id: "SYN-001", default_tokens: 100, shorter_tokens: 40, longer_tokens: 160 },
      { case_id: "SYN-002", default_tokens: 50, shorter_tokens: 30, longer_tokens: 70 },
    ]);
    expect(pass).toMatchObject({ status: "pass", passed: true, case_ids: ["SYN-001", "SYN-002"] });
    expect(pass.shorter_ratio).toBeCloseTo(0.5);
    expect(pass.longer_ratio).toBeCloseTo(1.5);
    const fail = computeResponseLengthMetric([{ case_id: "SYN-003", default_tokens: 100, shorter_tokens: 60, longer_tokens: 200 }]);
    expect(fail).toMatchObject({ status: "fail", passed: false });
    expect(computeResponseLengthMetric([{ case_id: "SYN-004", default_tokens: 0, shorter_tokens: 0, longer_tokens: 0 }])).toMatchObject({ status: "fail", passed: false });
    expect(computeResponseLengthMetric([])).toMatchObject({ status: "fail", passed: false });
  });

  it("excludes cases whose Default answer is a refusal, records them, and fails closed when none remain (FR-GC-07 card; live Gate v2.0, 2026-10-20)", async () => {
    const eligible = responseLengthEligible(sample);
    expect(eligible.length).toBeGreaterThan(1);
    const refused = eligible[0]!.id;
    const answer = vi.fn(async (c: { id: string }, length: "default" | "shorter" | "longer") =>
      c.id === refused && length === "default" ? null : "word ".repeat(length === "default" ? 20 : length === "shorter" ? 8 : 40));
    const metric = await runResponseLengthEval({ answer }, sample);
    expect(metric).toMatchObject({ status: "pass", passed: true, excluded_case_ids: [refused] });
    expect(metric.case_ids).toEqual(eligible.slice(1).map((c) => c.id));
    // No Shorter/Longer calls for an excluded case.
    expect(answer).toHaveBeenCalledTimes(1 + (eligible.length - 1) * 3);

    const allRefused = await runResponseLengthEval({ answer: async () => null }, sample);
    expect(allRefused).toMatchObject({ status: "fail", passed: false, case_ids: [], excluded_case_ids: eligible.map((c) => c.id) });
    expect(allRefused.detail).toMatch(/no eligible case/i);
  });

  it("fails closed when Shorter or Longer refuses a case whose Default answered (a length preference never changes grounding)", async () => {
    const metric = await runResponseLengthEval({ answer: async (_c, length) => (length === "longer" ? null : "word ".repeat(length === "default" ? 20 : 8)) }, sample);
    expect(metric).toMatchObject({ status: "fail", passed: false });
    expect(metric.detail).toMatch(/refus/i);
    expect(computeResponseLengthMetric([{ case_id: "SYN-009", default_tokens: 20, shorter_tokens: 0, longer_tokens: 40, shorter_refused: true }])).toMatchObject({ status: "fail", passed: false });
  });

  it("reports UNAVAILABLE rather than pass when the judged runner or model is not configured", async () => {
    const metric = await runResponseLengthEval(null, sample);
    expect(metric).toMatchObject({ status: "unavailable", passed: false, shorter_ratio: null, longer_ratio: null });
    expect(metric.detail).toMatch(/UNAVAILABLE/);
  });

  it("runs Default, Shorter and Longer for each eligible case and records sample IDs and generation parameters", async () => {
    const answer = vi.fn(async (_c: unknown, length: "default" | "shorter" | "longer") => "word ".repeat(length === "default" ? 20 : length === "shorter" ? 8 : 40));
    const metric = await runResponseLengthEval({ answer }, sample);
    const eligible = responseLengthEligible(sample);
    expect(answer).toHaveBeenCalledTimes(eligible.length * 3);
    expect(metric).toMatchObject({ status: "pass", case_ids: eligible.map((c) => c.id), generation_parameters: RESPONSE_LENGTH_GENERATION_PARAMETERS });
    expect(metric.samples).toHaveLength(eligible.length);
  });
});
