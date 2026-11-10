import { CodeExecutionRuntimeConfigSchema, CodeExecutionPrivateMeasurementSchema, CodeExecutionTraceSchema, type CodeExecutionPrivateMeasurement, type CodeExecutionTrace } from "@everlast/contracts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { COHORT_NAMES, evaluateCodeExecutionBenchmark, validateCodeExecutionPlan, type CodeExecutionBenchmarkObservation, type CohortName, type CodeExecutionBenchmarkPlan } from "./code-execution-performance.ts";

/** [010-code-execution-sandbox] T063 — FR-GC-08, NFR-PERF-01, CC-09. */
const ActorSchema = z.object({
  owner_id: z.string().uuid(), notebook_id: z.string().uuid(),
  source_snapshot: z.array(z.object({ source_id: z.string().uuid(), revision: z.number().int().positive() }).strict()).min(1).max(300),
  expected_citation_chunk_ids: z.array(z.string().uuid()).min(1).max(200),
  credential_env: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
}).strict();
const CalibrationSchema = z.object({
  offset_ms: z.number().finite(), uncertainty_ms: z.number().finite().min(0).max(1000),
  measured_at_ms: z.number().finite().nonnegative(), expires_at_ms: z.number().finite().nonnegative(),
  measurement_id: z.string().min(1).max(200),
}).strict();
export const CodeExecutionCollectionManifestSchema = z.object({
  actors: z.tuple([ActorSchema, ActorSchema]), api_base_url:z.string().url(), candidate_commit:z.string().regex(/^[0-9a-f]{40}$/), serving_revision: z.string().min(1).max(200),
  classification_basis: z.enum(["application-serving-readiness", "managed-runtime-readiness"]),
  qualification_sha256: z.string().regex(/^[0-9a-f]{64}$/), runtime_config_sha256:z.string().regex(/^[0-9a-f]{64}$/),
  clock_calibration: CalibrationSchema, clock_calibration_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  expected_result: z.string().min(1).max(64), max_total_requests: z.number().int().min(80).max(2000),
}).strict();
export type CollectionActor = z.infer<typeof ActorSchema>;
export type CollectionManifest = z.infer<typeof CodeExecutionCollectionManifestSchema>;
export interface CollectionSubmission { request_id: string; actor: CollectionActor; question: string; submitted_at_ms: number }
export interface ExecutionReceipt {
  terminal: "final" | "error" | "replayed" | "missing";
  client_running_ms: number | null; client_final_ms: number | null;
  running_execution_id: string | null; trace: CodeExecutionTrace | null; cited_chunk_ids: string[];
}
export interface CollectionPorts {
  submit(input: CollectionSubmission, signal: AbortSignal): Promise<ExecutionReceipt>;
  measurement(requestId: string, signal: AbortSignal): Promise<unknown>;
  now?: () => number; requestId?: () => string; deadlineMs?: number;
}
type Diagnostic = "evidence_unavailable" | "evidence_mismatch" | "classification_mismatch" | "receipt_invalid" | "identity_reused" | "deadline";
export interface CollectedAttempt {
  request_id: string; cohort: CohortName; sampleIndex: number; owner_id: string; notebook_id: string;
  submitted_at_ms: number; client_running_ms: number | null; client_final_ms: number | null;
  diagnostic: Diagnostic | null; measurement: CodeExecutionPrivateMeasurement | null;
}
export interface CodeExecutionCollectionResult {
  status: "PASS" | "FAIL" | "UNAVAILABLE"; attempts: CollectedAttempt[];
  observations: CodeExecutionBenchmarkObservation[]; problems: string[];
  provenance: { plan_sha256: string; manifest_sha256: string; qualification_sha256: string; runtime_config_sha256:string; clock_calibration: CollectionManifest["clock_calibration"]; clock_calibration_sha256: string };
  report: ReturnType<typeof evaluateCodeExecutionBenchmark>;
}
export const collectionDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function codeExecutionRuntimeConfigDigest(engine:string):string {
  return collectionDigest(CodeExecutionRuntimeConfigSchema.parse({reasoning_engine:engine,region:"europe-west4",vcpu:2,memory_gb:1.5,network:"none",file_io_mb:100,deadline_ms:15000}));
}
const sameSet = (a: string[], b: string[]) => a.length === new Set(a).size && b.length === new Set(b).size && a.length === b.length && a.every(v => b.includes(v));
const snapshotKey = (s: CollectionActor["source_snapshot"]) => s.map(p => p.source_id + ":" + p.revision).sort();
const attemptSummary = (t: CodeExecutionTrace) => t.attempts.map(a => ({ attempt_id: a.attempt_id, ordinal: a.ordinal, started_at: a.started_at, ended_at: a.ended_at, terminal_reason: a.terminal_reason }));
const emptyReceipt = (): ExecutionReceipt => ({ terminal: "error", client_running_ms: null, client_final_ms: null, running_execution_id: null, trace: null, cited_chunk_ids: [] });

/** A port ignoring AbortSignal still cannot hold the collector open past its deadline. */
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let listener!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(new Error("Collection deadline"));
    if (signal.aborted) listener(); else signal.addEventListener("abort", listener, { once: true });
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener("abort", listener); }
}

export async function collectCodeExecutionCohorts(plan: CodeExecutionBenchmarkPlan, input: CollectionManifest, ports: CollectionPorts): Promise<CodeExecutionCollectionResult> {
  validateCodeExecutionPlan(plan);
  const manifest = CodeExecutionCollectionManifestSchema.parse(input);
  const [a, b] = manifest.actors, clock = manifest.clock_calibration;
  if (a.owner_id === b.owner_id || a.notebook_id === b.notebook_id) throw new Error("Collection needs two distinct Owner notebooks");
  if (collectionDigest(clock) !== manifest.clock_calibration_sha256 || clock.measured_at_ms > Date.parse(plan.declaredAt) || clock.expires_at_ms <= Date.parse(plan.declaredAt)) throw new Error("Invalid frozen clock calibration");
  for (const actor of manifest.actors) if (new Set(actor.source_snapshot.map(s => s.source_id)).size !== actor.source_snapshot.length || new Set(actor.expected_citation_chunk_ids).size !== actor.expected_citation_chunk_ids.length) throw new Error("Duplicate fixture scope");
  const total = COHORT_NAMES.reduce((n, c) => n + plan.cohorts[c].repetitions, 0);
  if (total > manifest.max_total_requests) throw new Error("Declared cohorts exceed the approved request bound");
  const deadline = ports.deadlineMs ?? 120_000;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 120_000) throw new Error("Invalid collection deadline");
  const attempts: CollectedAttempt[] = [], observations: CodeExecutionBenchmarkObservation[] = [], problems: string[] = [];
  const requests = new Set<string>(), executions = new Set<string>(), attemptIds = new Set<string>();
  const now = ports.now ?? Date.now;
  async function sample(cohort: CohortName, sampleIndex: number, actor: CollectionActor) {
    const request_id = (ports.requestId ?? randomUUID)();
    if (requests.has(request_id)) { problems.push("request_identity_reused"); return; }
    requests.add(request_id);
    const submitted_at_ms = now(), mappedSubmission = submitted_at_ms + clock.offset_ms;
    if (!Number.isFinite(submitted_at_ms) || submitted_at_ms < Date.parse(plan.declaredAt) || submitted_at_ms < clock.measured_at_ms || submitted_at_ms > clock.expires_at_ms) { problems.push("clock_outside_declared_window"); return; }
    const record: CollectedAttempt = { request_id, cohort, sampleIndex, owner_id: actor.owner_id, notebook_id: actor.notebook_id, submitted_at_ms, client_running_ms: null, client_final_ms: null, diagnostic: null, measurement: null };
    attempts.push(record);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadline);
    try {
      let receipt = emptyReceipt();
      try { receipt = await bounded(ports.submit({ request_id, actor, question: plan.fixture.question, submitted_at_ms }, controller.signal), controller.signal); }
      catch { if (controller.signal.aborted) { record.diagnostic = "deadline"; return; } }
      record.client_running_ms = receipt.client_running_ms; record.client_final_ms = receipt.client_final_ms;
      let raw: unknown;
      try { raw = await bounded(ports.measurement(request_id, controller.signal), controller.signal); }
      catch { record.diagnostic = controller.signal.aborted ? "deadline" : "evidence_unavailable"; return; }
      const parsed = CodeExecutionPrivateMeasurementSchema.safeParse(raw);
      if (!parsed.success) { record.diagnostic = "evidence_unavailable"; return; }
      const e = parsed.data; record.measurement = e;
      if (e.request_id !== request_id || e.owner_id !== actor.owner_id || e.notebook_id !== actor.notebook_id || e.fixture_sha256 !== plan.fixture.sha256 || e.serving_revision !== manifest.serving_revision || e.candidate_commit !== manifest.candidate_commit || e.classification_basis !== manifest.classification_basis || e.qualification_sha256 !== manifest.qualification_sha256 || e.runtime_config_sha256 !== manifest.runtime_config_sha256 || e.clock_calibration_sha256 !== manifest.clock_calibration_sha256 || !sameSet(snapshotKey(e.source_snapshot), snapshotKey(actor.source_snapshot))) { record.diagnostic = "evidence_mismatch"; return; }
      if(e.qualified_at_ms < e.ready_at_ms){record.diagnostic="evidence_mismatch";return;}
      const u = clock.uncertainty_ms;
      const classification = e.ready_at_ms < mappedSubmission - u && e.qualified_at_ms < mappedSubmission - u ? "warm" : e.ready_at_ms > mappedSubmission + u && e.qualified_at_ms >= e.ready_at_ms ? "cold" : "unknown";
      if (classification === "unknown" || (classification === "warm") !== plan.cohorts[cohort].warm) { record.diagnostic = "classification_mismatch"; return; }
      const ids = e.attempts.map(t => t.attempt_id);
      if ((e.execution_id !== null && executions.has(e.execution_id)) || ids.some(id => attemptIds.has(id)) || new Set(ids).size !== ids.length) { record.diagnostic = "identity_reused"; return; }
      if (e.execution_id !== null) executions.add(e.execution_id);
      ids.forEach(id => attemptIds.add(id));
      const first = e.attempts[0], last = e.attempts.at(-1);
      if (e.attempts.some((t, i) => t.ordinal !== i + 1 || (t.ended_at !== null && Date.parse(t.ended_at) < Date.parse(t.started_at)) || (i > 0 && e.attempts[i-1]?.ended_at !== null && Date.parse(t.started_at) < Date.parse(e.attempts[i-1]!.ended_at!))) || (e.attempts.length === 2 && first?.terminal_reason !== "PythonException") || (first && e.sandbox_created_at!==null && Date.parse(e.sandbox_created_at) < Date.parse(first.started_at)) || (last && e.execution_completed_at!==null && (last.ended_at === null || Date.parse(e.execution_completed_at) > Date.parse(last.ended_at) || Date.parse(e.execution_completed_at) < Date.parse(last.started_at))) || (e.sandbox_created_at !== null && (Date.parse(e.sandbox_created_at) < e.ready_at_ms || Date.parse(e.sandbox_created_at) < e.qualified_at_ms)) || (e.attempts.length > 0 && (e.execution_id === null || e.trace_sha256 === null))) { record.diagnostic = "evidence_mismatch"; return; }
      const trace = CodeExecutionTraceSchema.safeParse(receipt.trace);
      if (trace.success && (collectionDigest(trace.data) !== e.trace_sha256 || trace.data.execution_id !== e.execution_id || trace.data.state !== e.execution_state || trace.data.failure_code !== e.failure_code || JSON.stringify(attemptSummary(trace.data)) !== JSON.stringify(e.attempts))) { record.diagnostic = "evidence_mismatch"; return; }
      if (receipt.running_execution_id !== null && receipt.running_execution_id !== e.execution_id) { record.diagnostic = "receipt_invalid"; return; }
      let outcome: CodeExecutionBenchmarkObservation["outcome"];
      if (e.execution_state === "Succeeded") {
        if (receipt.terminal !== "final" || receipt.running_execution_id !== e.execution_id || !trace.success || trace.data.state !== "Succeeded" || e.failure_code !== null || receipt.client_running_ms === null || !Number.isFinite(receipt.client_running_ms) || receipt.client_running_ms < 0 || receipt.client_final_ms === null || !Number.isFinite(receipt.client_final_ms) || receipt.client_final_ms < receipt.client_running_ms) { record.diagnostic = "receipt_invalid"; return; }
        const correct = trace.data.computed_results.some(r => r.value === manifest.expected_result) && trace.data.computed_results.every(r => r.citations.every(c => actor.expected_citation_chunk_ids.includes(c))) && sameSet(receipt.cited_chunk_ids, actor.expected_citation_chunk_ids);
        outcome = correct ? "succeeded" : "failed";
      } else {
        if (e.failure_code === null || (e.execution_state === "TimedOut" && e.failure_code !== "ExecutionTimeout")) { record.diagnostic = "evidence_mismatch"; return; }
        outcome = e.execution_state === "TimedOut" ? "timed_out" : "failed";
      }
      const clientTime=(value:string|null)=>value===null?null:new Date(Date.parse(value)-clock.offset_ms).toISOString();
      const observation: CodeExecutionBenchmarkObservation = {
        cohort, sampleIndex, submittedAt: new Date(submitted_at_ms).toISOString(), runningCodeAt: clientTime(e.running_code_at),
        sandboxCreatedAt: clientTime(e.sandbox_created_at), executionCompletedAt: clientTime(e.execution_completed_at), answerPublishedAt: clientTime(e.answer_published_at),
        outcome, attempts: e.attempts.length, retryEndToEndMs: e.attempts.length === 2 && first && last?.ended_at ? Date.parse(last.ended_at) - Date.parse(first.started_at) : null,
        ...(receipt.client_running_ms === null ? {} : { clientRunningCodeMs: receipt.client_running_ms }),
      };
      try { evaluateCodeExecutionBenchmark(plan, [observation]); } catch { record.diagnostic = "evidence_mismatch"; return; }
      observations.push(observation);
    } finally { clearTimeout(timer); }
  }
  collection: for (const cohort of COHORT_NAMES) {
    const declaration = plan.cohorts[cohort];
    for (let i = 1; i <= declaration.repetitions; i += declaration.concurrency) {
      await Promise.all(Array.from({ length: Math.min(declaration.concurrency, declaration.repetitions - i + 1) }, (_, n) => sample(cohort, i + n, manifest.actors[n] ?? a)));
      if (problems.length || attempts.some(r => r.diagnostic !== null)) break collection;
    }
  }
  attempts.sort((x, y) => COHORT_NAMES.indexOf(x.cohort) - COHORT_NAMES.indexOf(y.cohort) || x.sampleIndex - y.sampleIndex);
  observations.sort((x, y) => COHORT_NAMES.indexOf(x.cohort) - COHORT_NAMES.indexOf(y.cohort) || x.sampleIndex - y.sampleIndex);
  const report = evaluateCodeExecutionBenchmark(plan, observations);
  return { status: problems.length || attempts.some(r => r.diagnostic !== null) ? "UNAVAILABLE" : report.status, attempts, observations, problems,
    provenance: { plan_sha256: collectionDigest(plan), manifest_sha256: collectionDigest(manifest), qualification_sha256: manifest.qualification_sha256, runtime_config_sha256:manifest.runtime_config_sha256, clock_calibration: clock, clock_calibration_sha256: manifest.clock_calibration_sha256 }, report };
}
