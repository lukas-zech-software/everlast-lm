import { BenchmarkObservationSchema, type BenchmarkObservation } from "@everlast/contracts";

export type ScaleLatencyResultStatus = "PASS" | "FAIL" | "UNAVAILABLE";

export interface ScaleLatencyAggregate {
  result: ScaleLatencyResultStatus;
  p95_ms: number | null;
  percentile_method: "nearest_rank";
  p95_rank: number;
  warm_count: number;
  wake_count: number;
  attempt_count: number;
  observations: BenchmarkObservation[];
  wake_latencies_ms: Array<number | null>;
  budget_ms: number;
}

export interface ScaleConcurrencyAggregate {
  result: ScaleLatencyResultStatus;
  p95_ms: number | null;
  percentile_method: "nearest_rank";
  p95_rank: number;
  count: number;
  observations: BenchmarkObservation[];
}

function classifyScaleLatencyResult(
  validWarmFailure: boolean,
  unavailable: boolean,
  failed: boolean,
  p95Value: number,
): ScaleLatencyResultStatus {
  if (validWarmFailure) {
    return "FAIL";
  }
  if (unavailable) {
    return "UNAVAILABLE";
  }
  if (failed || p95Value > 10000) {
    return "FAIL";
  }
  return "PASS";
}

function classifyConcurrencyResult(
  unavailable: boolean,
  failed: boolean,
): ScaleLatencyResultStatus {
  if (unavailable) {
    return "UNAVAILABLE";
  }
  return failed ? "FAIL" : "PASS";
}

/** NFR-PERF-01 / D17: never select or reclassify observations based on observed latency. */
export function aggregateScaleLatency(
  input: readonly BenchmarkObservation[],
): ScaleLatencyAggregate {
  const observations = input.map((o) => BenchmarkObservationSchema.parse(o));
  const warm = observations.filter((o) => o.cohort === "warm");
  const wake = observations.filter((o) => o.cohort === "wake");
  const unavailable =
    observations.length > 40 ||
    warm.length !== 20 ||
    observations.some(
      (o) =>
        o.cohort === "invalid_environment" ||
        o.active_token_total === null ||
        o.prompt_leakage_count === null ||
        o.answer_leakage_count === null,
    ) ||
    new Set(observations.map((o) => o.request_id)).size !== observations.length ||
    new Set(observations.map((o) => o.run_id)).size !== observations.length ||
    new Set(observations.map((o) => o.manifest_hash)).size !== 1;
  const failed = warm.some(
    (o) =>
      o.terminal_status !== "answer" ||
      o.replayed ||
      o.latency_ms === null ||
      !o.needle_correct ||
      !o.cited_chunk_ids.length ||
      (o.active_token_total ?? 0) < 105000 ||
      o.prompt_leakage_count !== 0 ||
      o.answer_leakage_count !== 0,
  );
  const sorted = warm.map((o) => o.latency_ms ?? Infinity).sort((a, b) => a - b);
  const value = sorted[18] ?? Infinity;
  const validWarmFailure = warm.some((o) => o.terminal_status !== "answer" || o.replayed);
  const result = classifyScaleLatencyResult(validWarmFailure, unavailable, failed, value);
  return {
    result,
    p95_ms: result === "PASS" && Number.isFinite(value) ? value : null,
    percentile_method: "nearest_rank" as const,
    p95_rank: 19,
    warm_count: warm.length,
    wake_count: wake.length,
    attempt_count: observations.length,
    observations,
    wake_latencies_ms: wake.map((o) => o.latency_ms),
    budget_ms: 10000,
  };
}

/** NFR-PERF-01: separate 20 request concurrency 2 diagnostic over two Owner-isolated notebooks. */
export function aggregateScaleConcurrency(
  input: readonly BenchmarkObservation[],
): ScaleConcurrencyAggregate {
  const observations = input.map((o) => BenchmarkObservationSchema.parse(o));
  const unavailable =
    observations.length !== 20 ||
    observations.some(
      (o) =>
        o.cohort === "invalid_environment" ||
        o.active_token_total === null ||
        o.prompt_leakage_count === null ||
        o.answer_leakage_count === null,
    ) ||
    new Set(observations.map((o) => o.request_id)).size !== observations.length ||
    new Set(observations.map((o) => o.run_id)).size !== observations.length;
  const failed = observations.some(
    (o) =>
      o.terminal_status !== "answer" ||
      o.replayed ||
      o.latency_ms === null ||
      !o.needle_correct ||
      !o.cited_chunk_ids.length ||
      (o.active_token_total ?? 0) < 105000 ||
      o.prompt_leakage_count !== 0 ||
      o.answer_leakage_count !== 0,
  );
  const sorted = observations.map((o) => o.latency_ms ?? Infinity).sort((a, b) => a - b);
  const value = sorted[18] ?? Infinity;
  const result = classifyConcurrencyResult(unavailable, failed);
  return {
    result,
    p95_ms: result === "PASS" && Number.isFinite(value) ? value : null,
    percentile_method: "nearest_rank" as const,
    p95_rank: 19,
    count: observations.length,
    observations,
  };
}
