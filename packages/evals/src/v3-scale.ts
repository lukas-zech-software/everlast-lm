import type { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  BenchmarkPrivateEvidenceSchema,
  classifyReadiness,
  type PrivateClockCalibrationSchema,
  type BenchmarkObservation,
  type BenchmarkPrivateEvidence,
} from "@everlast/contracts";
import { loadScaleFixture, type ScaleFixture } from "./v3-scale-fixture.ts";
import { collectFreshFinal, type FinalReceipt } from "./v3-scale-client.ts";
import { buildScaleBenchmarkReport, type ScaleBenchmarkReport } from "./report.ts";

type Calibration = Readonly<z.infer<typeof PrivateClockCalibrationSchema>>;
export interface ScaleBenchmarkOptions {
  baseUrl: string;
  token: string;
  notebookId: string;
  profile?: "core" | "concurrency";
  concurrencyNotebookId?: string;
  concurrencyToken?: string;
  concurrencyFixture?: ScaleFixture;
  clock?: () => number;
  epochClock?: () => number;
  clockUncertaintyMs?: number;
  timeoutMs?: number;
  clockSession?: {
    calibration: Calibration;
    assertClockCurrent: (calibration: Calibration, instanceBootId?: string) => void;
  };
  /** Private channel provisioned separately by the operator. No public telemetry endpoint. */
  evidence?: (request: { requestId: string; notebookId: string }) => Promise<unknown>;
}
export function correlateScaleEvidence(
  raw: unknown,
  fixture: ScaleFixture,
  input: { requestId: string; notebookId: string; epochMs: number; uncertainty: number },
): {
  evidence: BenchmarkPrivateEvidence | null;
  cohort: BenchmarkObservation["cohort"];
  error?: string;
} {
  const parsed = BenchmarkPrivateEvidenceSchema.safeParse(raw);
  if (!parsed.success)
    return {
      evidence: null,
      cohort: "invalid_environment",
      error: "Missing/malformed private serving evidence",
    };
  const e = parsed.data;
  const s = e.scope;
  const expected = [...fixture.active_source_ids].sort().join(",");
  if (
    !s ||
    e.request_id !== input.requestId ||
    e.notebook_id !== input.notebookId ||
    e.fixture_hash !== fixture.fixture_hash ||
    s.notebook_id !== input.notebookId ||
    s.sources.map((p) => p.source_id).join(",") !== expected ||
    e.instance_boot_id !== e.readiness.instance_boot_id ||
    e.revision !== e.readiness.revision
  ) {
    return {
      evidence: null,
      cohort: "invalid_environment",
      error: "Private evidence request/fixture/scope/serving mismatch",
    };
  }
  if (
    s.token_counting_qualification !== "enterprise-eu" ||
    fixture.tokenizer_qualification !== `${s.token_counting_model}:${s.token_counting_version}` ||
    fixture.runtime_qualification !== e.revision
  )
    return {
      evidence: e,
      cohort: "invalid_environment",
      error: "Original-only tokenizer/model or candidate revision qualification mismatch",
    };
  if (
    !fixture.source_snapshot ||
    !fixture.scope_manifest_hash ||
    s.manifest_hash !== fixture.scope_manifest_hash ||
    JSON.stringify(s.sources) !== JSON.stringify(fixture.source_snapshot)
  )
    return {
      evidence: e,
      cohort: "invalid_environment",
      error: "Frozen original ledger/revision snapshot unavailable or mismatched",
    };
  const cohort = classifyReadiness(e.readiness, {
    instance_boot_id: e.instance_boot_id,
    revision: e.revision,
    client_submission_epoch_ms: input.epochMs,
    clock_uncertainty_ms: input.uncertainty,
  });
  return {
    evidence: e,
    cohort,
    ...(cohort === "invalid_environment"
      ? { error: "Dependency readiness or clock correlation unavailable" }
      : {}),
  };
}
interface ScaleSubmissionTarget {
  notebookId: string;
  token: string;
  fixture: ScaleFixture;
}

interface ScaleBenchmarkRuntimeConfig {
  primaryTarget: ScaleSubmissionTarget;
  concurrencyTarget: ScaleSubmissionTarget | null;
  clock: () => number;
  epochClock: () => number;
  timeoutMs: number;
  uncertainty: number;
}

function assertDistinctConcurrencyFixture(
  validatedFixture: ScaleFixture,
  concurrencyFixture: ScaleFixture,
): ScaleFixture {
  const otherFixture = loadScaleFixture(concurrencyFixture);
  if (
    otherFixture.active_source_ids.some((id) => validatedFixture.active_source_ids.includes(id))
  ) {
    throw new Error("UNAVAILABLE: concurrency scopes must be Owner-isolated");
  }
  return otherFixture;
}

function resolveConcurrencyTarget(
  validatedFixture: ScaleFixture,
  options: ScaleBenchmarkOptions,
): ScaleSubmissionTarget | null {
  if (options.profile !== "concurrency") {
    if (options.concurrencyFixture) {
      assertDistinctConcurrencyFixture(validatedFixture, options.concurrencyFixture);
    }
    return null;
  }
  if (
    !options.concurrencyNotebookId ||
    options.concurrencyNotebookId === options.notebookId ||
    !options.concurrencyToken ||
    options.concurrencyToken === options.token ||
    !options.concurrencyFixture
  ) {
    throw new Error(
      "UNAVAILABLE: concurrency requires distinct Owner notebooks, credentials and fixtures",
    );
  }
  return {
    notebookId: options.concurrencyNotebookId,
    token: options.concurrencyToken,
    fixture: assertDistinctConcurrencyFixture(validatedFixture, options.concurrencyFixture),
  };
}

function validateScaleBenchmarkConfig(
  fixtureInput: ScaleFixture,
  options: ScaleBenchmarkOptions,
): ScaleBenchmarkRuntimeConfig {
  const validatedFixture = loadScaleFixture(fixtureInput);
  if (options.profile && !["core", "concurrency"].includes(options.profile)) {
    throw new Error("Invalid benchmark profile");
  }
  const concurrencyTarget = resolveConcurrencyTarget(validatedFixture, options);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("Invalid benchmark request timeout");
  }
  const uncertainty =
    options.clockSession?.calibration.uncertainty_ms ?? options.clockUncertaintyMs ?? NaN;
  return {
    primaryTarget: {
      notebookId: options.notebookId,
      token: options.token,
      fixture: validatedFixture,
    },
    concurrencyTarget,
    clock: options.clock ?? (() => performance.now()),
    epochClock: options.epochClock ?? Date.now,
    timeoutMs,
    uncertainty,
  };
}

function computeAnswerLeakageCount(receipt: FinalReceipt, forbiddenFact: string): number | null {
  if (receipt.terminal_status === "error") {
    return null;
  }
  return receipt.answer.includes(forbiddenFact) ? 1 : 0;
}

async function executeScaleHttpTurn(options: {
  baseUrl: string;
  target: ScaleSubmissionTarget;
  requestId: string;
  submissionMs: number;
  clock: () => number;
  timeoutMs: number;
}): Promise<{ receipt: FinalReceipt; failure?: string }> {
  const { baseUrl, target, requestId, submissionMs, clock, timeoutMs } = options;
  const fallbackReceipt: FinalReceipt = {
    terminal_status: "error",
    client_first_validated_answer_ms: null,
    latency_ms: null,
    answer: "",
    cited_chunk_ids: [],
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const requestDeadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Benchmark request timeout"));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetch(`${baseUrl}/api/notebooks/${target.notebookId}/chat/turns`, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: "What must the reactor coolant pressure be?",
          active_source_ids: target.fixture.active_source_ids,
          request_id: requestId,
        }),
      }),
      requestDeadline,
    ]);
    const receipt = await Promise.race([
      collectFreshFinal(response, submissionMs, clock, { timeoutMs }),
      requestDeadline,
    ]);
    return { receipt };
  } catch {
    return {
      receipt: fallbackReceipt,
      failure: controller.signal.aborted
        ? "Request timeout/cancelled"
        : "Request/transport failure",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPrivateScaleEvidence(
  evidenceFn: ScaleBenchmarkOptions["evidence"],
  requestId: string,
  notebookId: string,
  timeoutMs: number,
): Promise<{ raw: unknown; failure?: string }> {
  let evidenceTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      evidenceFn?.({ requestId, notebookId }),
      new Promise<never>((_, reject) => {
        evidenceTimer = setTimeout(() => reject(new Error("Private evidence timeout")), timeoutMs);
      }),
    ]);
    return { raw };
  } catch {
    return { raw: undefined, failure: "Private evidence collection failed" };
  } finally {
    clearTimeout(evidenceTimer);
  }
}

function extractEvidenceFields(e: BenchmarkPrivateEvidence | null): {
  instance_boot_id: string | null;
  active_token_total: number | null;
  prompt_leakage_count: number | null;
  scopeMetadata:
    | { principal_subject: string; scope_manifest_hash: string; revision: string }
    | Record<string, never>;
} {
  if (!e) {
    return {
      instance_boot_id: null,
      active_token_total: null,
      prompt_leakage_count: null,
      scopeMetadata: {},
    };
  }
  return {
    instance_boot_id: e.instance_boot_id,
    active_token_total: e.scope?.source_token_total ?? null,
    prompt_leakage_count: e.prompt_leakage_count,
    scopeMetadata: e.scope
      ? {
          principal_subject: e.scope.principal_subject,
          scope_manifest_hash: e.scope.manifest_hash,
          revision: e.revision,
        }
      : {},
  };
}

function buildScaleObservation(input: {
  runId: string;
  requestId: string;
  target: ScaleSubmissionTarget;
  submissionMs: number;
  completionMs: number;
  epochMs: number;
  uncertainty: number;
  receipt: FinalReceipt;
  evidence: BenchmarkPrivateEvidence | null;
  cohort: BenchmarkObservation["cohort"];
  clockValid: boolean;
  failure?: string | undefined;
  correlationError?: string | undefined;
}): BenchmarkObservation {
  const {
    runId,
    requestId,
    target,
    submissionMs,
    completionMs,
    epochMs,
    uncertainty,
    receipt,
    evidence: e,
    cohort,
    clockValid,
    failure,
    correlationError,
  } = input;
  const terminalMatches =
    receipt.terminal_status === "error" || !e || e.terminal_status === receipt.terminal_status;
  const answer = receipt.terminal_status === "answer";
  const evidenceError =
    failure ?? correlationError ?? (terminalMatches ? undefined : "Terminal status mismatch");
  const evidenceFields = extractEvidenceFields(e);
  return {
    run_id: runId,
    request_id: requestId,
    manifest_hash: target.fixture.fixture_hash,
    cohort: terminalMatches && clockValid ? cohort : "invalid_environment",
    instance_boot_id: evidenceFields.instance_boot_id,
    replayed: receipt.terminal_status === "replayed",
    client_submission_monotonic_ms: submissionMs,
    client_first_validated_answer_ms: answer ? receipt.client_first_validated_answer_ms : null,
    latency_ms: answer ? receipt.latency_ms : null,
    terminal_status: receipt.terminal_status,
    active_token_total: evidenceFields.active_token_total,
    cited_chunk_ids: receipt.cited_chunk_ids,
    needle_correct:
      answer &&
      receipt.answer.includes(target.fixture.expected_fact) &&
      receipt.cited_chunk_ids.includes(target.fixture.needle_chunk_id),
    prompt_leakage_count: evidenceFields.prompt_leakage_count,
    answer_leakage_count: computeAnswerLeakageCount(receipt, target.fixture.forbidden_fact),
    client_completion_monotonic_ms: completionMs,
    client_submission_epoch_ms: epochMs,
    clock_uncertainty_ms: Number.isFinite(uncertainty) ? uncertainty : null,
    notebook_id: target.notebookId,
    ...evidenceFields.scopeMetadata,
    ...(evidenceError ? { evidence_error: evidenceError } : {}),
  };
}

async function submitScaleObservation(context: {
  options: ScaleBenchmarkOptions;
  config: ScaleBenchmarkRuntimeConfig;
  target: ScaleSubmissionTarget;
  clockIsCurrent: (boot?: string) => boolean;
}): Promise<BenchmarkObservation | null> {
  const { options, config, target, clockIsCurrent } = context;
  if (!clockIsCurrent()) {
    return null;
  }
  const requestId = randomUUID();
  const runId = randomUUID();
  const epochMs = config.epochClock();
  const submissionMs = config.clock();
  const turn = await executeScaleHttpTurn({
    baseUrl: options.baseUrl,
    target,
    requestId,
    submissionMs,
    clock: config.clock,
    timeoutMs: config.timeoutMs,
  });
  const privateResult = await fetchPrivateScaleEvidence(
    options.evidence,
    requestId,
    target.notebookId,
    config.timeoutMs,
  );
  const mappedEpoch = epochMs + (options.clockSession?.calibration.offset_ms ?? 0);
  const correlated = correlateScaleEvidence(privateResult.raw, target.fixture, {
    requestId,
    notebookId: target.notebookId,
    epochMs: mappedEpoch,
    uncertainty: config.uncertainty,
  });
  const clockValid = clockIsCurrent(correlated.evidence?.instance_boot_id);
  const failure = clockValid
    ? (privateResult.failure ?? turn.failure)
    : "Private clock continuity unavailable";
  return buildScaleObservation({
    runId,
    requestId,
    target,
    submissionMs,
    completionMs: config.clock(),
    epochMs,
    uncertainty: config.uncertainty,
    receipt: turn.receipt,
    evidence: correlated.evidence,
    cohort: correlated.cohort,
    clockValid,
    failure,
    correlationError: correlated.error,
  });
}

/** NFR-PERF-01: exactly twenty eligible warm submissions, including failures, never twenty selected successes. */
export async function runScaleBenchmark(
  fixture: ScaleFixture,
  options: ScaleBenchmarkOptions,
): Promise<ScaleBenchmarkReport> {
  const config = validateScaleBenchmarkConfig(fixture, options);
  const clockState = { invalid: false };
  const clockIsCurrent = (boot?: string): boolean => {
    if (clockState.invalid) {
      return false;
    }
    try {
      options.clockSession?.assertClockCurrent(options.clockSession.calibration, boot);
      return true;
    } catch {
      clockState.invalid = true;
      return false;
    }
  };

  const coreObservations: BenchmarkObservation[] = [];
  const { primaryTarget, concurrencyTarget } = config;
  let warm = 0;
  for (
    let attempt = 0;
    attempt < primaryTarget.fixture.max_attempts && warm < primaryTarget.fixture.sample_count;
    attempt++
  ) {
    const row = await submitScaleObservation({
      options,
      config,
      target: primaryTarget,
      clockIsCurrent,
    });
    if (!row) {
      break;
    }
    coreObservations.push(row);
    if (row.cohort === "warm") {
      warm++;
    }
  }

  let concurrencyObservations: BenchmarkObservation[] | undefined;
  if (concurrencyTarget) {
    concurrencyObservations = [];
    for (let pair = 0; pair < 10 && !clockState.invalid; pair++) {
      const id = randomUUID();
      const rows = await Promise.all([
        submitScaleObservation({ options, config, target: primaryTarget, clockIsCurrent }),
        submitScaleObservation({ options, config, target: concurrencyTarget, clockIsCurrent }),
      ]);
      concurrencyObservations.push(
        ...rows.filter((row) => row !== null).map((row) => ({ ...row, diagnostic_pair_id: id })),
      );
    }
    const owners = new Set(concurrencyObservations.map((o) => o.principal_subject));
    if (owners.size !== 2 || owners.has(undefined)) {
      for (const row of concurrencyObservations) {
        row.cohort = "invalid_environment";
        row.evidence_error = "Two distinct Owner principals not proven";
      }
    }
  }

  return buildScaleBenchmarkReport({
    evidence_kind: "ordinary-api-collected",
    benchmark_id: `scale-${randomUUID()}`,
    manifest_hash: primaryTarget.fixture.fixture_hash,
    coreObservations,
    concurrencyObservations,
  });
}
