import {
  CodeExecutionRuntimeConfigSchema,
  CodeExecutionPrivateMeasurementSchema,
  CodeExecutionTraceSchema,
  type CodeExecutionPrivateMeasurement,
  type CodeExecutionTrace,
} from "@everlast/contracts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  COHORT_NAMES,
  evaluateCodeExecutionBenchmark,
  validateCodeExecutionPlan,
  type CodeExecutionBenchmarkObservation,
  type CohortName,
  type CodeExecutionBenchmarkPlan,
} from "./code-execution-performance.ts";

/** [010-code-execution-sandbox] T063 — FR-GC-08, NFR-PERF-01, CC-09. */
const ActorSchema = z
  .object({
    owner_id: z.uuid(),
    notebook_id: z.uuid(),
    source_snapshot: z
      .array(z.object({ source_id: z.uuid(), revision: z.number().int().positive() }).strict())
      .min(1)
      .max(300),
    expected_citation_chunk_ids: z.array(z.uuid()).min(1).max(200),
    credential_env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]+$/)
      .optional(),
  })
  .strict();
const CalibrationSchema = z
  .object({
    offset_ms: z.number(),
    uncertainty_ms: z.number().min(0).max(1000),
    measured_at_ms: z.number().nonnegative(),
    expires_at_ms: z.number().nonnegative(),
    measurement_id: z.string().min(1).max(200),
  })
  .strict();
export const CodeExecutionCollectionManifestSchema = z
  .object({
    actors: z.tuple([ActorSchema, ActorSchema]),
    api_base_url: z.url(),
    candidate_commit: z.string().regex(/^[0-9a-f]{40}$/),
    serving_revision: z.string().min(1).max(200),
    classification_basis: z.enum(["application-serving-readiness", "managed-runtime-readiness"]),
    qualification_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    runtime_config_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    clock_calibration: CalibrationSchema,
    clock_calibration_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    expected_result: z.string().min(1).max(64),
    max_total_requests: z.number().int().min(80).max(2000),
  })
  .strict();
export type CollectionActor = z.infer<typeof ActorSchema>;
export type CollectionManifest = z.infer<typeof CodeExecutionCollectionManifestSchema>;
export interface CollectionSubmission {
  request_id: string;
  actor: CollectionActor;
  question: string;
  submitted_at_ms: number;
}
const ExecutionReceiptSchema = z
  .object({
    terminal: z.enum(["final", "error", "replayed", "missing"]),
    client_running_ms: z.number().nonnegative().nullable(),
    client_final_ms: z.number().nonnegative().nullable(),
    running_execution_id: z.uuid().nullable(),
    trace: CodeExecutionTraceSchema.nullable(),
    cited_chunk_ids: z.array(z.uuid()).max(200),
  })
  .strict()
  .refine(
    (receipt) =>
      receipt.client_running_ms === null ||
      receipt.client_final_ms === null ||
      receipt.client_running_ms <= receipt.client_final_ms,
  );
export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

export interface CollectionPorts {
  submit: (input: CollectionSubmission, signal: AbortSignal) => Promise<ExecutionReceipt>;
  measurement: (requestId: string, signal: AbortSignal) => Promise<unknown>;
  /** T075: throw if the exact calibration or acquisition-to-collection continuity is invalid. */
  assertClockCurrent?: (
    calibration: Readonly<CollectionManifest["clock_calibration"]>,
    instanceBootId?: string,
  ) => void;
  now?: () => number;
  requestId?: () => string;
  deadlineMs?: number;
}
type Diagnostic =
  | "evidence_unavailable"
  | "evidence_mismatch"
  | "classification_mismatch"
  | "receipt_invalid"
  | "identity_reused"
  | "clock_invalid"
  | "deadline";
export interface CollectedAttempt {
  request_id: string;
  cohort: CohortName;
  sampleIndex: number;
  owner_id: string;
  notebook_id: string;
  submitted_at_ms: number;
  client_running_ms: number | null;
  client_final_ms: number | null;
  diagnostic: Diagnostic | null;
  measurement: CodeExecutionPrivateMeasurement | null;
}
export interface CodeExecutionCollectionResult {
  status: "PASS" | "FAIL" | "UNAVAILABLE";
  attempts: CollectedAttempt[];
  observations: CodeExecutionBenchmarkObservation[];
  problems: string[];
  provenance: {
    plan_sha256: string;
    manifest_sha256: string;
    qualification_sha256: string;
    runtime_config_sha256: string;
    clock_calibration: CollectionManifest["clock_calibration"];
    clock_calibration_sha256: string;
  };
  report: ReturnType<typeof evaluateCodeExecutionBenchmark>;
}
export const collectionDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function codeExecutionRuntimeConfigDigest(engine: string): string {
  return collectionDigest(
    CodeExecutionRuntimeConfigSchema.parse({
      reasoning_engine: engine,
      region: "europe-west4",
      vcpu: 2,
      memory_gb: 1.5,
      network: "none",
      file_io_mb: 100,
      deadline_ms: 15000,
    }),
  );
}
const sameSet = (a: string[], b: string[]) =>
  a.length === new Set(a).size &&
  b.length === new Set(b).size &&
  a.length === b.length &&
  a.every((v) => b.includes(v));
const snapshotKey = (s: CollectionActor["source_snapshot"]) =>
  s.map((p) => `${p.source_id}:${p.revision}`).sort();
const attemptSummary = (t: CodeExecutionTrace) =>
  t.attempts.map((a) => ({
    attempt_id: a.attempt_id,
    ordinal: a.ordinal,
    started_at: a.started_at,
    ended_at: a.ended_at,
    terminal_reason: a.terminal_reason,
  }));
const emptyReceipt = (): ExecutionReceipt => ({
  terminal: "error",
  client_running_ms: null,
  client_final_ms: null,
  running_execution_id: null,
  trace: null,
  cited_chunk_ids: [],
});

/** A port ignoring AbortSignal still cannot hold the collector open past its deadline. */
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let listener!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(new Error("Collection deadline"));
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

interface CollectionClockWindow {
  clock: CollectionManifest["clock_calibration"];
  declaredAt: number;
  clientExpiry: number;
  serverExpiry: number;
}

function validateCollectionInputs(
  plan: CodeExecutionBenchmarkPlan,
  manifest: CollectionManifest,
  deadline: number,
): CollectionClockWindow {
  const [a, b] = manifest.actors;
  const clock = manifest.clock_calibration;
  const declaredAt = Date.parse(plan.declaredAt);
  const clientExpiry = clock.expires_at_ms - clock.uncertainty_ms;
  const serverExpiry = clientExpiry + clock.offset_ms;
  if (a.owner_id === b.owner_id || a.notebook_id === b.notebook_id) {
    throw new Error("Collection needs two distinct Owner notebooks");
  }
  if (
    collectionDigest(clock) !== manifest.clock_calibration_sha256 ||
    clock.measured_at_ms > declaredAt ||
    clientExpiry <= declaredAt ||
    !Number.isFinite(serverExpiry)
  ) {
    throw new Error("Invalid frozen clock calibration");
  }
  for (const actor of manifest.actors) {
    const uniqueSources = new Set(actor.source_snapshot.map((s) => s.source_id)).size;
    const uniqueCitations = new Set(actor.expected_citation_chunk_ids).size;
    if (
      uniqueSources !== actor.source_snapshot.length ||
      uniqueCitations !== actor.expected_citation_chunk_ids.length
    ) {
      throw new Error("Duplicate fixture scope");
    }
  }
  const total = COHORT_NAMES.reduce((n, c) => n + plan.cohorts[c].repetitions, 0);
  if (total > manifest.max_total_requests) {
    throw new Error("Declared cohorts exceed the approved request bound");
  }
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 120_000) {
    throw new Error("Invalid collection deadline");
  }
  return { clock, declaredAt, clientExpiry, serverExpiry };
}

function isOutsideServerWindow(at: string | null, serverExpiry: number): boolean {
  if (at === null) {
    return false;
  }
  const ms = Date.parse(at);
  return !Number.isFinite(ms) || ms >= serverExpiry;
}

function hasValidMeasurementClock(
  measurement: CodeExecutionPrivateMeasurement,
  record: CollectedAttempt,
  submittedAtMs: number,
  window: CollectionClockWindow,
  readCurrentClock: (earliest: number, instanceBootId?: string) => number | null,
): boolean {
  if (readCurrentClock(submittedAtMs, measurement.instance_boot_id) === null) {
    return false;
  }
  const boundaries = [
    measurement.sandbox_created_at,
    measurement.running_code_at,
    measurement.execution_completed_at,
    measurement.answer_published_at,
    ...measurement.attempts.flatMap((attempt) => [attempt.started_at, attempt.ended_at]),
  ];
  if (boundaries.some((at) => isOutsideServerWindow(at, window.serverExpiry))) {
    return false;
  }
  return ![record.client_running_ms, record.client_final_ms].some(
    (elapsed) => elapsed !== null && submittedAtMs + elapsed >= window.clientExpiry,
  );
}

function matchesMeasurementProvenance(
  measurement: CodeExecutionPrivateMeasurement,
  requestId: string,
  actor: CollectionActor,
  plan: CodeExecutionBenchmarkPlan,
  manifest: CollectionManifest,
): boolean {
  return (
    measurement.request_id === requestId &&
    measurement.owner_id === actor.owner_id &&
    measurement.notebook_id === actor.notebook_id &&
    measurement.fixture_sha256 === plan.fixture.sha256 &&
    measurement.serving_revision === manifest.serving_revision &&
    measurement.candidate_commit === manifest.candidate_commit &&
    measurement.classification_basis === manifest.classification_basis &&
    measurement.qualification_sha256 === manifest.qualification_sha256 &&
    measurement.runtime_config_sha256 === manifest.runtime_config_sha256 &&
    measurement.clock_calibration_sha256 === manifest.clock_calibration_sha256 &&
    sameSet(snapshotKey(measurement.source_snapshot), snapshotKey(actor.source_snapshot)) &&
    measurement.qualified_at_ms >= measurement.ready_at_ms
  );
}

function classifyWarmCold(
  measurement: CodeExecutionPrivateMeasurement,
  mappedSubmission: number,
  uncertaintyMs: number,
): "warm" | "cold" | "unknown" {
  if (
    measurement.ready_at_ms < mappedSubmission - uncertaintyMs &&
    measurement.qualified_at_ms < mappedSubmission - uncertaintyMs
  ) {
    return "warm";
  }
  if (
    measurement.ready_at_ms > mappedSubmission + uncertaintyMs &&
    measurement.qualified_at_ms >= measurement.ready_at_ms
  ) {
    return "cold";
  }
  return "unknown";
}

function hasInvalidAttemptOrder(attempts: CodeExecutionPrivateMeasurement["attempts"]): boolean {
  for (let i = 0; i < attempts.length; i++) {
    const current = attempts[i];
    if (current?.ordinal !== i + 1) {
      return true;
    }
    if (
      current.ended_at !== null &&
      Date.parse(current.ended_at) < Date.parse(current.started_at)
    ) {
      return true;
    }
    const previousEndedAt = i > 0 ? attempts[i - 1]?.ended_at : null;
    if (
      previousEndedAt !== null &&
      previousEndedAt !== undefined &&
      Date.parse(current.started_at) < Date.parse(previousEndedAt)
    ) {
      return true;
    }
  }
  return false;
}

function hasValidAttemptChronology(measurement: CodeExecutionPrivateMeasurement): boolean {
  if (hasInvalidAttemptOrder(measurement.attempts)) {
    return false;
  }
  const first = measurement.attempts[0];
  const last = measurement.attempts.at(-1);
  if (measurement.attempts.length === 2 && first?.terminal_reason !== "PythonException") {
    return false;
  }
  if (
    first &&
    measurement.sandbox_created_at !== null &&
    Date.parse(measurement.sandbox_created_at) < Date.parse(first.started_at)
  ) {
    return false;
  }
  if (
    last &&
    measurement.execution_completed_at !== null &&
    (last.ended_at === null ||
      Date.parse(measurement.execution_completed_at) > Date.parse(last.ended_at) ||
      Date.parse(measurement.execution_completed_at) < Date.parse(last.started_at))
  ) {
    return false;
  }
  if (
    measurement.sandbox_created_at !== null &&
    (Date.parse(measurement.sandbox_created_at) < measurement.ready_at_ms ||
      Date.parse(measurement.sandbox_created_at) < measurement.qualified_at_ms)
  ) {
    return false;
  }
  return !(
    measurement.attempts.length > 0 &&
    (measurement.execution_id === null || measurement.trace_sha256 === null)
  );
}

function matchesReceiptTrace(
  trace: CodeExecutionTrace | null,
  measurement: CodeExecutionPrivateMeasurement,
): boolean {
  if (!trace) {
    return true;
  }
  return (
    collectionDigest(trace) === measurement.trace_sha256 &&
    trace.execution_id === measurement.execution_id &&
    trace.state === measurement.execution_state &&
    trace.failure_code === measurement.failure_code &&
    JSON.stringify(attemptSummary(trace)) === JSON.stringify(measurement.attempts)
  );
}

function resolveExecutionOutcome(
  measurement: CodeExecutionPrivateMeasurement,
  receipt: ExecutionReceipt,
  actor: CollectionActor,
  expectedResult: string,
): { outcome: CodeExecutionBenchmarkObservation["outcome"] } | { diagnostic: Diagnostic } {
  if (measurement.execution_state === "Succeeded") {
    const trace = receipt.trace;
    if (
      receipt.terminal !== "final" ||
      receipt.running_execution_id !== measurement.execution_id ||
      trace?.state !== "Succeeded" ||
      measurement.failure_code !== null ||
      receipt.client_running_ms === null ||
      receipt.client_final_ms === null
    ) {
      return { diagnostic: "receipt_invalid" };
    }
    const correct =
      trace.computed_results.some((r) => r.value === expectedResult) &&
      trace.computed_results.every((r) =>
        r.citations.every((c) => actor.expected_citation_chunk_ids.includes(c)),
      ) &&
      sameSet(receipt.cited_chunk_ids, actor.expected_citation_chunk_ids);
    return { outcome: correct ? "succeeded" : "failed" };
  }
  if (
    measurement.failure_code === null ||
    (measurement.execution_state === "TimedOut" && measurement.failure_code !== "ExecutionTimeout")
  ) {
    return { diagnostic: "evidence_mismatch" };
  }
  return { outcome: measurement.execution_state === "TimedOut" ? "timed_out" : "failed" };
}

function buildObservationFromMeasurement(input: {
  cohort: CohortName;
  sampleIndex: number;
  submittedAtMs: number;
  measurement: CodeExecutionPrivateMeasurement;
  receipt: ExecutionReceipt;
  outcome: CodeExecutionBenchmarkObservation["outcome"];
  offsetMs: number;
}): CodeExecutionBenchmarkObservation {
  const { cohort, sampleIndex, submittedAtMs, measurement, receipt, outcome, offsetMs } = input;
  const clientTime = (value: string | null): string | null =>
    value === null ? null : new Date(Date.parse(value) - offsetMs).toISOString();
  const first = measurement.attempts[0];
  const last = measurement.attempts.at(-1);
  return {
    cohort,
    sampleIndex,
    submittedAt: new Date(submittedAtMs).toISOString(),
    runningCodeAt: clientTime(measurement.running_code_at),
    sandboxCreatedAt: clientTime(measurement.sandbox_created_at),
    executionCompletedAt: clientTime(measurement.execution_completed_at),
    answerPublishedAt: clientTime(measurement.answer_published_at),
    outcome,
    attempts: measurement.attempts.length,
    retryEndToEndMs:
      measurement.attempts.length === 2 && first && last?.ended_at
        ? Date.parse(last.ended_at) - Date.parse(first.started_at)
        : null,
    ...(receipt.client_running_ms === null
      ? {}
      : { clientRunningCodeMs: receipt.client_running_ms }),
  };
}

function registerExecutionIdentities(
  measurement: CodeExecutionPrivateMeasurement,
  executions: Set<string>,
  attemptIds: Set<string>,
): boolean {
  const ids = measurement.attempts.map((t) => t.attempt_id);
  if (
    (measurement.execution_id !== null && executions.has(measurement.execution_id)) ||
    ids.some((id) => attemptIds.has(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return false;
  }
  if (measurement.execution_id !== null) {
    executions.add(measurement.execution_id);
  }
  for (const id of ids) {
    attemptIds.add(id);
  }
  return true;
}

function validateAndRecordObservation(context: {
  cohort: CohortName;
  sampleIndex: number;
  requestId: string;
  submittedAtMs: number;
  actor: CollectionActor;
  record: CollectedAttempt;
  receipt: ExecutionReceipt;
  measurement: CodeExecutionPrivateMeasurement;
  plan: CodeExecutionBenchmarkPlan;
  manifest: CollectionManifest;
  clockWindow: CollectionClockWindow;
  executions: Set<string>;
  attemptIds: Set<string>;
  observations: CodeExecutionBenchmarkObservation[];
}): void {
  const {
    cohort,
    sampleIndex,
    requestId,
    submittedAtMs,
    actor,
    record,
    receipt,
    measurement,
    plan,
    manifest,
    clockWindow,
    executions,
    attemptIds,
    observations,
  } = context;
  if (!matchesMeasurementProvenance(measurement, requestId, actor, plan, manifest)) {
    record.diagnostic = "evidence_mismatch";
    return;
  }
  const mappedSubmission = submittedAtMs + clockWindow.clock.offset_ms;
  const classification = classifyWarmCold(
    measurement,
    mappedSubmission,
    clockWindow.clock.uncertainty_ms,
  );
  if (classification === "unknown" || (classification === "warm") !== plan.cohorts[cohort].warm) {
    record.diagnostic = "classification_mismatch";
    return;
  }
  if (!registerExecutionIdentities(measurement, executions, attemptIds)) {
    record.diagnostic = "identity_reused";
    return;
  }
  if (!hasValidAttemptChronology(measurement) || !matchesReceiptTrace(receipt.trace, measurement)) {
    record.diagnostic = "evidence_mismatch";
    return;
  }
  if (
    receipt.running_execution_id !== null &&
    receipt.running_execution_id !== measurement.execution_id
  ) {
    record.diagnostic = "receipt_invalid";
    return;
  }
  const resolved = resolveExecutionOutcome(measurement, receipt, actor, manifest.expected_result);
  if ("diagnostic" in resolved) {
    record.diagnostic = resolved.diagnostic;
    return;
  }
  try {
    const observation = buildObservationFromMeasurement({
      cohort,
      sampleIndex,
      submittedAtMs,
      measurement,
      receipt,
      outcome: resolved.outcome,
      offsetMs: clockWindow.clock.offset_ms,
    });
    evaluateCodeExecutionBenchmark(plan, [observation]);
    observations.push(observation);
  } catch {
    record.diagnostic = "evidence_mismatch";
  }
}

export async function collectCodeExecutionCohorts(
  plan: CodeExecutionBenchmarkPlan,
  input: CollectionManifest,
  ports: CollectionPorts,
): Promise<CodeExecutionCollectionResult> {
  validateCodeExecutionPlan(plan);
  const manifest = CodeExecutionCollectionManifestSchema.parse(input);
  const deadline = ports.deadlineMs ?? 120_000;
  const clockWindow = validateCollectionInputs(plan, manifest, deadline);
  const [firstActor] = manifest.actors;
  const attempts: CollectedAttempt[] = [];
  const observations: CodeExecutionBenchmarkObservation[] = [];
  const problems: string[] = [];
  const requests = new Set<string>();
  const executions = new Set<string>();
  const attemptIds = new Set<string>();
  const now = ports.now ?? Date.now;

  function readCurrentClock(earliest: number, instanceBootId?: string): number | null {
    try {
      ports.assertClockCurrent?.(clockWindow.clock, instanceBootId);
      const value = now();
      return Number.isFinite(new Date(value).getTime()) &&
        value >= earliest &&
        value < clockWindow.clientExpiry
        ? value
        : null;
    } catch {
      return null;
    }
  }

  async function sample(
    cohort: CohortName,
    sampleIndex: number,
    actor: CollectionActor,
  ): Promise<void> {
    const request_id = (ports.requestId ?? randomUUID)();
    if (requests.has(request_id)) {
      problems.push("request_identity_reused");
      return;
    }
    requests.add(request_id);
    const submitted_at_ms = readCurrentClock(clockWindow.declaredAt);
    if (submitted_at_ms === null) {
      problems.push("clock_outside_declared_window");
      return;
    }
    const record: CollectedAttempt = {
      request_id,
      cohort,
      sampleIndex,
      owner_id: actor.owner_id,
      notebook_id: actor.notebook_id,
      submitted_at_ms,
      client_running_ms: null,
      client_final_ms: null,
      diagnostic: null,
      measurement: null,
    };
    attempts.push(record);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      let rawReceipt: unknown = emptyReceipt();
      try {
        rawReceipt = await bounded(
          ports.submit(
            { request_id, actor, question: plan.fixture.question, submitted_at_ms },
            controller.signal,
          ),
          controller.signal,
        );
      } catch {
        if (controller.signal.aborted) {
          record.diagnostic = "deadline";
          return;
        }
      }
      const receiptResult = ExecutionReceiptSchema.safeParse(rawReceipt);
      if (receiptResult.success) {
        record.client_running_ms = receiptResult.data.client_running_ms;
        record.client_final_ms = receiptResult.data.client_final_ms;
      }
      let raw: unknown;
      try {
        raw = await bounded(ports.measurement(request_id, controller.signal), controller.signal);
      } catch {
        record.diagnostic = controller.signal.aborted ? "deadline" : "evidence_unavailable";
        return;
      }
      const parsed = CodeExecutionPrivateMeasurementSchema.safeParse(raw);
      if (!parsed.success) {
        record.diagnostic = "evidence_unavailable";
        return;
      }
      record.measurement = parsed.data;
      if (
        !hasValidMeasurementClock(
          parsed.data,
          record,
          submitted_at_ms,
          clockWindow,
          readCurrentClock,
        )
      ) {
        record.diagnostic = "clock_invalid";
        return;
      }
      if (!receiptResult.success) {
        record.diagnostic = "receipt_invalid";
        return;
      }
      validateAndRecordObservation({
        cohort,
        sampleIndex,
        requestId: request_id,
        submittedAtMs: submitted_at_ms,
        actor,
        record,
        receipt: receiptResult.data,
        measurement: parsed.data,
        plan,
        manifest,
        clockWindow,
        executions,
        attemptIds,
        observations,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  collection: for (const cohort of COHORT_NAMES) {
    const declaration = plan.cohorts[cohort];
    for (let i = 1; i <= declaration.repetitions; i += declaration.concurrency) {
      await Promise.all(
        Array.from(
          { length: Math.min(declaration.concurrency, declaration.repetitions - i + 1) },
          (_, n) => sample(cohort, i + n, manifest.actors[n] ?? firstActor),
        ),
      );
      if (problems.length || attempts.some((r) => r.diagnostic !== null)) {
        break collection;
      }
    }
  }
  attempts.sort(
    (x, y) =>
      COHORT_NAMES.indexOf(x.cohort) - COHORT_NAMES.indexOf(y.cohort) ||
      x.sampleIndex - y.sampleIndex,
  );
  observations.sort(
    (x, y) =>
      COHORT_NAMES.indexOf(x.cohort) - COHORT_NAMES.indexOf(y.cohort) ||
      x.sampleIndex - y.sampleIndex,
  );
  const report = evaluateCodeExecutionBenchmark(plan, observations);
  return {
    status:
      problems.length || attempts.some((r) => r.diagnostic !== null)
        ? "UNAVAILABLE"
        : report.status,
    attempts,
    observations,
    problems,
    provenance: {
      plan_sha256: collectionDigest(plan),
      manifest_sha256: collectionDigest(manifest),
      qualification_sha256: manifest.qualification_sha256,
      runtime_config_sha256: manifest.runtime_config_sha256,
      clock_calibration: clockWindow.clock,
      clock_calibration_sha256: manifest.clock_calibration_sha256,
    },
    report,
  };
}
