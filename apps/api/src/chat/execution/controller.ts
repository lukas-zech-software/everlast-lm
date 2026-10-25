import { createHash, randomUUID } from "node:crypto";
import {
  chartUrl,
  isRetryableFailure,
  type CodeExecutionAttempt,
  type CodeExecutionFailureCode,
  type CodeExecutionTrace,
  type ComputedResult,
} from "@everlast/contracts";
import {
  admitCodeExecution,
  finishCodeExecution,
  insertChartCandidate,
  markSandboxActive,
  markSandboxDestroyed,
  markSandboxDestroyPending,
  notebookObjectPrefix,
  EXECUTION_LEASE_MS,
  ExecutionFencedError,
  recordCodeExecutionProgress,
  registerSandbox,
  renewCodeExecutionLease,
  type ChatThreadRecord,
  type Pool,
} from "@everlast/db";
import type { ObjectStorage } from "@everlast/cloud";
import type { SourceRevisionPair } from "@everlast/contracts";
import type { CodeCorrectionInput } from "../model.ts";
import type { InputManifest } from "./manifest.ts";
import { OutputError, validateChartFiles, validateComputedResults } from "./output.ts";
import { EXECUTION_DEADLINE_MS, REQUIRED_LIBRARIES, runAttempt, SANDBOX_PROFILE, type AttemptOutcome, type SandboxRuntime } from "./runtime.ts";

/**
 * Deterministic execution controller (FR-GC-08, FR-GC-06, C-02; specs/010 T019/T028).
 * The model decides THAT something is computed and writes the code; this controller alone owns admission, the
 * immutable manifest, the attempt budget (one correction retry, only after a first-attempt Python exception),
 * deadlines, sandbox cleanup and which outputs may be published. Every durable write carries the execution lease,
 * so Clear chat, reconciliation or a newer epoch fence out a late controller.
 */

export const MAX_ATTEMPTS = 2;

export interface CodeExecutionDeps {
  pool: Pool;
  runtime: SandboxRuntime;
  storage: ObjectStorage;
  deadlineMs?: number;
  /** Execution lease; defaults to EXECUTION_LEASE_MS (tests shorten it). */
  leaseMs?: number;
}

export interface ExecutionStatus {
  type: "status";
  phase: "running_code";
  execution_id: string;
  attempt: number;
}

export interface ControllerInput {
  thread: ChatThreadRecord;
  requestId: string;
  snapshot: SourceRevisionPair[];
  question: string;
  intent: string;
  code: string;
  manifest: InputManifest;
  /** Pre-assigned assistant message ID (embedded in chart URLs). */
  messageId: string;
  correct?: ((input: CodeCorrectionInput) => Promise<string>) | undefined;
  signal: AbortSignal;
  onStatus: (status: ExecutionStatus) => void;
}

export interface ControllerResult {
  executionId: string;
  leaseToken: string;
  trace: CodeExecutionTrace;
  results: ComputedResult[];
  publishArtifactIds: string[];
}

const now = () => new Date().toISOString();

export class CodeExecutionController {
  private readonly deps: CodeExecutionDeps;

  constructor(deps: CodeExecutionDeps) {
    this.deps = deps;
  }

  /** Admission happens first; an overlapping execution for this user/notebook is rejected (409). */
  async run(input: ControllerInput): Promise<ControllerResult> {
    const { pool } = this.deps;
    const { executionId, leaseToken } = await admitCodeExecution(pool, { thread: input.thread, requestId: input.requestId, snapshot: input.snapshot, ...(this.deps.leaseMs ? { leaseMs: this.deps.leaseMs } : {}) });
    const lease = this.deps.leaseMs ? { leaseMs: this.deps.leaseMs } : {};
    const attempts: CodeExecutionAttempt[] = [];
    const trace = (state: CodeExecutionTrace["state"], extra: Partial<CodeExecutionTrace> = {}): CodeExecutionTrace => ({
      schema_version: 1,
      execution_id: executionId,
      state,
      attempts: attempts.map((a) => ({ ...a })),
      final_attempt_id: null,
      published_artifact_ids: [],
      failure_code: null,
      computed_results: [],
      ...extra,
    });
    const terminal = (failure: CodeExecutionFailureCode): ControllerResult => {
      const state = failure === "ExecutionTimeout" ? "TimedOut" : "Failed";
      return { executionId, leaseToken, results: [], publishArtifactIds: [], trace: trace(state, { failure_code: failure, final_attempt_id: attempts.at(-1)?.attempt_id ?? null }) };
    };
    await recordCodeExecutionProgress(pool, executionId, leaseToken, { ...lease,
      state: "CodeGenerating",
      runtimeMetadata: { runtime: this.deps.runtime.id, profile: SANDBOX_PROFILE, libraries: REQUIRED_LIBRARIES, deadline_ms: this.deps.deadlineMs ?? EXECUTION_DEADLINE_MS, manifest_digest: input.manifest.entries[0]?.digest },
    });

    // Heartbeat: the correction call and sandbox creation can outlast one lease period between progress writes,
    // so the lease is renewed independently until this run returns (PR #159 review, FR-006/FR-007).
    const leaseMs = this.deps.leaseMs ?? EXECUTION_LEASE_MS;
    const heartbeat = setInterval(() => {
      void renewCodeExecutionLease(pool, executionId, leaseToken, leaseMs).catch(() => undefined);
    }, Math.max(10, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();

    let code = input.code;
    try {
      for (let ordinal = 1 as 1 | 2; ordinal <= MAX_ATTEMPTS; ordinal = (ordinal + 1) as 1 | 2) {
        if (input.signal.aborted) return terminal("GenerationCancelled");
        const attemptId = randomUUID();
        const startedAt = now();
        await registerSandbox(pool, { attemptId, executionId, notebookId: input.thread.notebook_id });
        const outcome: AttemptOutcome = await runAttempt({
          runtime: this.deps.runtime,
          attemptId,
          code,
          files: [...input.manifest.files],
          signal: input.signal,
          ...(this.deps.deadlineMs ? { deadlineMs: this.deps.deadlineMs } : {}),
          onCreated: (handle) => markSandboxActive(pool, attemptId, handle.name),
          onRunning: async () => {
            const running: CodeExecutionAttempt = { attempt_id: attemptId, ordinal, code, stdout: "", stderr: "", exit_code: null, started_at: startedAt, ended_at: null, terminal_reason: null, artifacts: [] };
            await recordCodeExecutionProgress(pool, executionId, leaseToken, { ...lease, state: "SandboxRunning", attemptOrdinal: ordinal, trace: { ...trace("SandboxRunning"), attempts: [...attempts, running] } });
            input.onStatus({ type: "status", phase: "running_code", execution_id: executionId, attempt: ordinal });
          },
          onDestroyed: async ({ destroyed }) => {
            if (destroyed) await markSandboxDestroyed(pool, attemptId);
            else await markSandboxDestroyPending(pool, attemptId, "DeleteFailed");
          },
        });

        if (outcome.kind === "failed" && !outcome.submitted) {
          // Nothing reached the provider in this attempt: no fabricated attempt, exit code or output.
          return terminal(outcome.failureCode);
        }
        const record: CodeExecutionAttempt = {
          attempt_id: attemptId,
          ordinal,
          code,
          stdout: outcome.stdout,
          stderr: outcome.stderr,
          exit_code: outcome.exitCode,
          started_at: outcome.startedAt,
          ended_at: outcome.endedAt,
          terminal_reason: outcome.kind === "completed" ? "Succeeded" : outcome.failureCode,
          artifacts: [],
        };

        if (outcome.kind === "completed") {
          try {
            const results = validateComputedResults(outcome.results, input.manifest.supportingChunkIds);
            const charts = validateChartFiles(outcome.files);
            const artifactIds: string[] = [];
            for (const chart of charts) {
              const artifactId = randomUUID();
              const key = `${notebookObjectPrefix(input.thread.notebook_id)}chat-charts/${artifactId}/${chart.name}`;
              const meta = await this.deps.storage.write(key, chart.content, chart.mimeType);
              try {
                await insertChartCandidate(pool, {
                  artifact_id: artifactId,
                  execution_id: executionId,
                  attempt_id: attemptId,
                  message_id: null,
                  notebook_id: input.thread.notebook_id,
                  user_id: input.thread.user_id,
                  object_key: key,
                  object_generation: meta.generation,
                  mime_type: chart.mimeType,
                  digest: createHash("sha256").update(chart.content).digest("hex"),
                  byte_size: chart.content.length,
                  source_snapshot: input.snapshot,
                  citation_chunk_ids: [...input.manifest.supportingChunkIds],
                  state: "candidate",
                });
              } catch (err) {
                // The object has no row yet, so no reconciler can find it: remove it now (PR #159 review, FR-010).
                await this.deps.storage.deleteVersion(key, meta.generation).catch(() => undefined);
                // A missing execution row means Clear chat fenced this run (FK violation): report cancellation.
                if ((err as { code?: string }).code === "23503") throw new ExecutionFencedError();
                throw err;
              }
              artifactIds.push(artifactId);
            }
            record.artifacts = artifactIds.map((id) => chartUrl(input.thread.notebook_id, input.messageId, id));
            attempts.push(record);
            return {
              executionId,
              leaseToken,
              results,
              publishArtifactIds: artifactIds,
              trace: trace("Succeeded", { final_attempt_id: attemptId, published_artifact_ids: artifactIds, computed_results: results }),
            };
          } catch (err) {
            if (!(err instanceof OutputError)) throw err;
            // Invalid or unsafe outputs are terminal (no retry) and never published.
            record.terminal_reason = err.failureCode;
            attempts.push(record);
            return terminal(err.failureCode);
          }
        }

        attempts.push(record);
        if (!isRetryableFailure(outcome.failureCode, ordinal) || !input.correct) return terminal(outcome.failureCode);
        // Exactly one correction: same immutable manifest, same limits, fresh sandbox.
        await recordCodeExecutionProgress(pool, executionId, leaseToken, { ...lease, state: "CodeGenerating", trace: trace("CodeGenerating") });
        try {
          code = await input.correct({
            question: input.question,
            intent: input.intent,
            values: input.manifest.values.map((v) => ({ ...v })),
            failedCode: record.code,
            stderr: record.stderr,
            signal: input.signal,
          });
        } catch {
          if (input.signal.aborted) return terminal("GenerationCancelled");
          return terminal("PythonException");
        }
      }
      return terminal("PythonException");
    } catch (err) {
      // Release the active execution lease on unexpected errors (e.g. storage write failure or Clear chat race)
      // so the notebook is not locked in CodeGenerating/SandboxRunning until lease expiry.
      const failure: CodeExecutionFailureCode = input.signal.aborted ? "GenerationCancelled" : "ProviderUnavailable";
      await this.abandon(terminal(failure), failure);
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Unpublished terminal outcome (e.g. publication refused): end the execution under its lease. */
  async abandon(result: ControllerResult, failure: CodeExecutionFailureCode): Promise<void> {
    const trace: CodeExecutionTrace = {
      ...result.trace,
      state: failure === "ExecutionTimeout" ? "TimedOut" : "Failed",
      final_attempt_id: result.trace.attempts.at(-1)?.attempt_id ?? null,
      published_artifact_ids: [],
      failure_code: failure,
      computed_results: [],
      attempts: result.trace.attempts.map((a) => ({ ...a, artifacts: [] })),
    };
    await finishCodeExecution(this.deps.pool, result.executionId, result.leaseToken, { state: trace.state as "Failed" | "TimedOut", failureCode: failure, trace }).catch(() => undefined);
  }
}
