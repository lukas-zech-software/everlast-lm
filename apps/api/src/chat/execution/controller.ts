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
import {
  OutputError,
  validateChartFiles,
  validateComputedResults,
  type ValidChart,
} from "./output.ts";
import {
  EXECUTION_DEADLINE_MS,
  REQUIRED_LIBRARIES,
  runAttempt,
  SANDBOX_PROFILE,
  type AttemptOutcome,
  type SandboxHandle,
  type SandboxRuntime,
} from "./runtime.ts";

/**
 * Deterministic execution controller (FR-GC-08, FR-GC-06, C-02; specs/010 T019/T028).
 * The model decides THAT something is computed and writes the code; this controller alone owns admission, the
 * immutable manifest, the attempt budget (one correction retry, only after a first-attempt Python exception),
 * deadlines, sandbox cleanup and which outputs may be published. Every durable write carries the execution lease,
 * so Clear chat, reconciliation or a newer epoch fence out a late controller.
 */

export const MAX_ATTEMPTS = 2;

export interface CodeExecutionDeps {
  evidenceIdentity?:
    | { instance_boot_id: string; candidate_commit: string; runtime_config_sha256: string }
    | undefined;
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
  onTiming?: (event: {
    phase: "sandbox_created_at" | "execution_completed_at" | "running_code_at";
    at: string;
    attempt_id: string;
    ordinal: 1 | 2;
  }) => void;
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

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

interface RunContext {
  executionId: string;
  leaseToken: string;
  lease: { leaseMs?: number };
  attempts: CodeExecutionAttempt[];
  input: ControllerInput;
  trace: (
    state: CodeExecutionTrace["state"],
    extra?: Partial<CodeExecutionTrace>,
  ) => CodeExecutionTrace;
  terminal: (failure: CodeExecutionFailureCode) => ControllerResult;
}

function buildAttemptRecord(
  attemptId: string,
  ordinal: 1 | 2,
  code: string,
  outcome: AttemptOutcome,
): CodeExecutionAttempt {
  return {
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
}

export class CodeExecutionController {
  private readonly deps: CodeExecutionDeps;

  constructor(deps: CodeExecutionDeps) {
    this.deps = deps;
  }

  private async persistChartCandidate(
    ctx: RunContext,
    attemptId: string,
    chart: ValidChart,
  ): Promise<string> {
    const artifactId = randomUUID();
    const key = `${notebookObjectPrefix(ctx.input.thread.notebook_id)}chat-charts/${artifactId}/${chart.name}`;
    const meta = await this.deps.storage.write(key, chart.content, chart.mimeType);
    try {
      await insertChartCandidate(this.deps.pool, {
        artifact_id: artifactId,
        execution_id: ctx.executionId,
        attempt_id: attemptId,
        message_id: null,
        notebook_id: ctx.input.thread.notebook_id,
        user_id: ctx.input.thread.user_id,
        object_key: key,
        object_generation: meta.generation,
        mime_type: chart.mimeType,
        digest: createHash("sha256").update(chart.content).digest("hex"),
        byte_size: chart.content.length,
        source_snapshot: ctx.input.snapshot,
        citation_chunk_ids: [...ctx.input.manifest.supportingChunkIds],
        state: "candidate",
      });
    } catch (err) {
      // The object has no row yet, so no reconciler can find it: remove it now (PR #159 review, FR-010).
      await this.deps.storage.deleteVersion(key, meta.generation).catch(() => undefined);
      // A missing execution row means Clear chat fenced this run (FK violation): report cancellation.
      if ((err as { code?: string }).code === "23503") {
        throw new ExecutionFencedError();
      }
      throw err;
    }
    return artifactId;
  }

  private async finalizeCompletedAttempt(
    ctx: RunContext,
    attemptId: string,
    record: CodeExecutionAttempt,
    outcome: Extract<AttemptOutcome, { kind: "completed" }>,
  ): Promise<ControllerResult> {
    try {
      const results = validateComputedResults(
        outcome.results,
        ctx.input.manifest.supportingChunkIds,
      );
      const charts = validateChartFiles(outcome.files);
      const artifactIds: string[] = [];
      for (const chart of charts) {
        artifactIds.push(await this.persistChartCandidate(ctx, attemptId, chart));
      }
      record.artifacts = artifactIds.map((id) =>
        chartUrl(ctx.input.thread.notebook_id, ctx.input.messageId, id),
      );
      ctx.attempts.push(record);
      return {
        executionId: ctx.executionId,
        leaseToken: ctx.leaseToken,
        results,
        publishArtifactIds: artifactIds,
        trace: ctx.trace("Succeeded", {
          final_attempt_id: attemptId,
          published_artifact_ids: artifactIds,
          computed_results: results,
        }),
      };
    } catch (err) {
      if (!(err instanceof OutputError)) {
        throw err;
      }
      // Invalid or unsafe outputs are terminal (no retry) and never published.
      record.terminal_reason = err.failureCode;
      ctx.attempts.push(record);
      return ctx.terminal(err.failureCode);
    }
  }

  private async executeAttempt(
    ctx: RunContext,
    attemptId: string,
    ordinal: 1 | 2,
    code: string,
  ): Promise<AttemptOutcome> {
    const { pool } = this.deps;
    const startedAt = now();
    await registerSandbox(pool, {
      attemptId,
      executionId: ctx.executionId,
      notebookId: ctx.input.thread.notebook_id,
    });
    let profileObservation: SandboxHandle["profileObservation"];
    return runAttempt({
      runtime: this.deps.runtime,
      onBoundary: (event) => {
        try {
          ctx.input.onTiming?.({ ...event, attempt_id: attemptId, ordinal });
        } catch {
          /* Private evidence unavailable. */
        }
      },
      attemptId,
      code,
      files: [...ctx.input.manifest.files],
      signal: ctx.input.signal,
      ...(this.deps.deadlineMs ? { deadlineMs: this.deps.deadlineMs } : {}),
      onCreated: async (handle) => {
        await markSandboxActive(pool, attemptId, handle.name);
        if (this.deps.evidenceIdentity) {
          profileObservation = handle.profileObservation;
        }
      },
      onRunning: async () => {
        const running: CodeExecutionAttempt = {
          attempt_id: attemptId,
          ordinal,
          code,
          stdout: "",
          stderr: "",
          exit_code: null,
          started_at: startedAt,
          ended_at: null,
          terminal_reason: null,
          artifacts: [],
        };
        await recordCodeExecutionProgress(pool, ctx.executionId, ctx.leaseToken, {
          ...ctx.lease,
          state: "SandboxRunning",
          attemptOrdinal: ordinal,
          ...(profileObservation
            ? { runtimeMetadata: { profile_observation: profileObservation } }
            : {}),
          trace: { ...ctx.trace("SandboxRunning"), attempts: [...ctx.attempts, running] },
        });
        try {
          ctx.input.onTiming?.({
            phase: "running_code_at",
            at: now(),
            attempt_id: attemptId,
            ordinal,
          });
        } catch {
          /* Private evidence unavailable. */
        }
        ctx.input.onStatus({
          type: "status",
          phase: "running_code",
          execution_id: ctx.executionId,
          attempt: ordinal,
        });
      },
      onDestroyed: async ({ destroyed }) => {
        if (destroyed) {
          await markSandboxDestroyed(pool, attemptId);
        } else {
          await markSandboxDestroyPending(pool, attemptId, "DeleteFailed");
        }
      },
    });
  }

  private async requestCodeCorrection(
    ctx: RunContext,
    record: CodeExecutionAttempt,
    correct: NonNullable<ControllerInput["correct"]>,
  ): Promise<{ ok: true; code: string } | { ok: false; result: ControllerResult }> {
    // Exactly one correction: same immutable manifest, same limits, fresh sandbox.
    await recordCodeExecutionProgress(this.deps.pool, ctx.executionId, ctx.leaseToken, {
      ...ctx.lease,
      state: "CodeGenerating",
      trace: ctx.trace("CodeGenerating"),
    });
    try {
      const code = await correct({
        question: ctx.input.question,
        intent: ctx.input.intent,
        values: ctx.input.manifest.values.map((v) => ({ ...v })),
        failedCode: record.code,
        stderr: record.stderr,
        signal: ctx.input.signal,
      });
      return { ok: true, code };
    } catch {
      return {
        ok: false,
        result: ctx.terminal(
          isAborted(ctx.input.signal) ? "GenerationCancelled" : "PythonException",
        ),
      };
    }
  }

  private createRunContext(
    executionId: string,
    leaseToken: string,
    input: ControllerInput,
  ): RunContext {
    const lease = this.deps.leaseMs ? { leaseMs: this.deps.leaseMs } : {};
    const attempts: CodeExecutionAttempt[] = [];
    const trace = (
      state: CodeExecutionTrace["state"],
      extra: Partial<CodeExecutionTrace> = {},
    ): CodeExecutionTrace => ({
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
    const terminal = (failure: CodeExecutionFailureCode): ControllerResult => ({
      executionId,
      leaseToken,
      results: [],
      publishArtifactIds: [],
      trace: trace(failure === "ExecutionTimeout" ? "TimedOut" : "Failed", {
        failure_code: failure,
        final_attempt_id: attempts.at(-1)?.attempt_id ?? null,
      }),
    });
    return { executionId, leaseToken, lease, attempts, input, trace, terminal };
  }

  private startLeaseHeartbeat(executionId: string, leaseToken: string): () => void {
    // Heartbeat: the correction call and sandbox creation can outlast one lease period between progress writes,
    // so the lease is renewed independently until this run returns (PR #159 review, FR-006/FR-007).
    const leaseMs = this.deps.leaseMs ?? EXECUTION_LEASE_MS;
    const heartbeat = setInterval(
      () => {
        void renewCodeExecutionLease(this.deps.pool, executionId, leaseToken, leaseMs).catch(
          () => undefined,
        );
      },
      Math.max(10, Math.floor(leaseMs / 3)),
    );
    heartbeat.unref();
    return () => clearInterval(heartbeat);
  }

  private async executeWithRetries(ctx: RunContext): Promise<ControllerResult> {
    let code = ctx.input.code;
    for (const ordinal of [1, 2] as const) {
      if (isAborted(ctx.input.signal)) {
        return ctx.terminal("GenerationCancelled");
      }
      const attemptId = randomUUID();
      const outcome = await this.executeAttempt(ctx, attemptId, ordinal, code);
      if (outcome.kind === "failed" && !outcome.submitted) {
        // Nothing reached the provider in this attempt: no fabricated attempt, exit code or output.
        return ctx.terminal(outcome.failureCode);
      }
      const record = buildAttemptRecord(attemptId, ordinal, code, outcome);
      if (outcome.kind === "completed") {
        return await this.finalizeCompletedAttempt(ctx, attemptId, record, outcome);
      }
      ctx.attempts.push(record);
      if (!isRetryableFailure(outcome.failureCode, ordinal) || !ctx.input.correct) {
        return ctx.terminal(outcome.failureCode);
      }
      const corrected = await this.requestCodeCorrection(ctx, record, ctx.input.correct);
      if (!corrected.ok) {
        return corrected.result;
      }
      code = corrected.code;
    }
    return ctx.terminal("PythonException");
  }

  /** Admission happens first; an overlapping execution for this user/notebook is rejected (409). */
  async run(input: ControllerInput): Promise<ControllerResult> {
    const { pool } = this.deps;
    const { executionId, leaseToken } = await admitCodeExecution(pool, {
      thread: input.thread,
      requestId: input.requestId,
      snapshot: input.snapshot,
      ...(this.deps.leaseMs ? { leaseMs: this.deps.leaseMs } : {}),
    });
    const ctx = this.createRunContext(executionId, leaseToken, input);

    await recordCodeExecutionProgress(pool, executionId, leaseToken, {
      ...ctx.lease,
      state: "CodeGenerating",
      runtimeMetadata: {
        ...this.deps.evidenceIdentity,
        runtime: this.deps.runtime.id,
        profile: SANDBOX_PROFILE,
        libraries: REQUIRED_LIBRARIES,
        deadline_ms: this.deps.deadlineMs ?? EXECUTION_DEADLINE_MS,
        manifest_digest: input.manifest.entries[0]?.digest,
      },
    });

    const stopHeartbeat = this.startLeaseHeartbeat(executionId, leaseToken);
    try {
      return await this.executeWithRetries(ctx);
    } catch (err) {
      // Release the active execution lease on unexpected errors (e.g. storage write failure or Clear chat race)
      // so the notebook is not locked in CodeGenerating/SandboxRunning until lease expiry.
      const failure: CodeExecutionFailureCode = isAborted(input.signal)
        ? "GenerationCancelled"
        : "ProviderUnavailable";
      await this.abandon(ctx.terminal(failure), failure);
      throw err;
    } finally {
      stopHeartbeat();
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
    await finishCodeExecution(this.deps.pool, result.executionId, result.leaseToken, {
      state: trace.state as "Failed" | "TimedOut",
      failureCode: failure,
      trace,
    }).catch(() => undefined);
  }
}
