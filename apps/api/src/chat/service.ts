import type { PrivateBenchmarkRecorder } from "../observability/benchmark.ts";
import { createHash, randomUUID } from "node:crypto";
import { AppError, isTurnProvenanceEligible, type SourceGuide } from "@everlast/contracts";
import {
  findTurnByRequest,
  getCodeExecution,
  getOrCreateThread,
  listThreadMessages,
  projectVisibleMessages,
  publishTurn,
  type Pool,
  type StoredMessage,
  type VisibleMessage,
} from "@everlast/db";
import type { Embedder, ObjectStorage } from "@everlast/cloud";
import { RequestScopedContextProvider } from "../services/source-context.ts";
import { classifyQuery, planChatContext } from "./context-plan.ts";
import type { HistoryTurn, ResponsePreferences } from "./prompt.ts";
import {
  ModelUnavailableError,
  UnverifiableDraftError,
  type GroundedModel,
  type GroundedModelInput,
} from "./model.ts";
import type { GroundedDraft } from "./draft.ts";
import {
  composeComputedAnswer,
  computationFailureMessage,
  REFUSAL_INSUFFICIENT_VALUES,
  REFUSAL_TOO_LARGE_FOR_COMPLETE_DATA,
  REFUSAL_UNVERIFIED,
  stripBadges,
  verifyDraft,
  type VerificationResult,
} from "./verifier.ts";
import {
  buildInputManifest,
  evidencePlan,
  ManifestError,
  MAX_COMPUTE_CHUNKS,
  type InputManifest,
} from "./execution/manifest.ts";
import {
  CodeExecutionController,
  type ControllerResult,
  type ExecutionStatus,
} from "./execution/controller.ts";
import type { SandboxRuntime } from "./execution/runtime.ts";

/**
 * Grounded chat turn (FR-GC-01, FR-GC-02, FR-GC-06, C-02, D13).
 * submission snapshot → C-02 retrieval → provenance-eligible history → buffered model draft → deterministic
 * verification → fenced atomic publication. No source content reaches the client before verification.
 */

export const GENERATION_ERROR_MESSAGE =
  "An error occurred while generating the response. Please try again.";
export const MAX_MESSAGE_CODE_POINTS = 10_000;
export const HISTORY_TURN_LIMIT = 10;

export interface TurnRequest {
  ownerId: string;
  notebookId: string;
  message: unknown;
  activeSourceIds: unknown;
  requestId: string;
  /** First supported locale from Accept-Language (FR-UI-02 output-language fallback). */
  browserLocale?: string | undefined;
}

export type TurnEvent =
  | { type: "status"; phase: "retrieving" | "generating" | "verifying" }
  /** FR-GC-08 FR-004: truthful progress once code is actually submitted; no numbers, code or output. */
  | ExecutionStatus
  | { type: "final"; messages: VisibleMessage[]; replayed: boolean };

/** Evaluation hook (NFR-EVAL-01..04): exposes exactly what was retrieved and sent to the model per turn. */
export interface TurnObservation {
  requestId: string;
  snapshot: Array<{ source_id: string; revision: number }>;
  retrieved: Array<{ chunk_id: string; source_id: string; revision: number; text: string }>;
  modelInput: GroundedModelInput | null;
  draft: GroundedDraft | null;
  result: VerificationResult;
}

export interface ChatServiceDeps {
  pool: Pool;
  embedder: Embedder;
  model: GroundedModel;
  retrievalLimit?: number;
  /** NFR-PERF-01: private, explicitly approved synthetic observations only. */
  benchmark?: PrivateBenchmarkRecorder | undefined;
  observer?: (observation: TurnObservation) => void;
  /** FR-GC-08 managed sandbox (specs/010); absent → computations fail safely with 503, nothing is pretended. */
  codeExecution?:
    | { runtime: SandboxRuntime; storage: ObjectStorage; deadlineMs?: number; leaseMs?: number }
    | undefined;
  /** Release v2 response preferences of the caller (style, length, languages). */
  resolvePreferences?: (
    ownerId: string,
    notebookId: string,
    browserLocale?: string,
  ) => Promise<ResponsePreferences>;
}

function countCodePoints(text: string): number {
  let count = 0;
  for (const _cp of text) {
    count += 1;
  }
  return count;
}

/** Message length rule: 1–10,000 Unicode code points after outer trim, never truncated (FR-GC-01). */
export function normalizeMessage(message: unknown): string {
  if (typeof message !== "string") {
    throw new AppError("ValidationFailed", 422, "message must be a string");
  }
  const trimmed = message.trim();
  const length = countCodePoints(trimmed);
  if (length < 1 || length > MAX_MESSAGE_CODE_POINTS) {
    throw new AppError(
      "ValidationFailed",
      422,
      "message must be 1–10,000 Unicode code points after trimming",
    );
  }
  return trimmed;
}

/**
 * Eligible history (FR-GC-01, NFR-EVAL-04): a turn is included only if its complete provenance is a subset of
 * the current snapshot. Missing provenance excludes the turn. Question and answer are kept or dropped together.
 */
export function selectEligibleHistory(
  messages: StoredMessage[],
  snapshot: Array<{ source_id: string; revision: number }>,
  limit = HISTORY_TURN_LIMIT,
): HistoryTurn[] {
  const turns = new Map<string, { question?: StoredMessage; answer?: StoredMessage }>();
  for (const m of messages) {
    const turn = turns.get(m.turn_id) ?? {};
    if (m.role === "user") turn.question = m;
    else turn.answer = m;
    turns.set(m.turn_id, turn);
  }
  const eligible: HistoryTurn[] = [];
  for (const { question, answer } of turns.values()) {
    if (!question || !answer) continue;
    if (
      !isTurnProvenanceEligible(question.provenance, snapshot) ||
      !isTurnProvenanceEligible(answer.provenance, snapshot)
    )
      continue;
    eligible.push({ question: question.content, answer: stripBadges(answer.content) });
  }
  return eligible.slice(-limit);
}

type BenchmarkSpan = ReturnType<PrivateBenchmarkRecorder["begin"]>;
type CodeExecutionRuntimeDeps = NonNullable<ChatServiceDeps["codeExecution"]>;
type SettledOutcome = { ok: true; value: ControllerResult } | { ok: false; error: unknown };

function abandonReasonForError(
  err: unknown,
): "GenerationCancelled" | "AccessRevoked" | "ScopeChanged" {
  const code = (err as { code?: string }).code;
  if (code === "GenerationCancelled") {
    return "GenerationCancelled";
  }
  if (code === "InvalidScope" || code === "Forbidden") {
    return "AccessRevoked";
  }
  return "ScopeChanged";
}

function recordBenchmarkEvent(span: BenchmarkSpan | undefined, event: TurnEvent): void {
  if (!span) {
    return;
  }
  if (event.type === "status") {
    if (event.phase === "retrieving") {
      span.stage("retrieval");
    } else if (event.phase === "generating" || (event.phase as string) === "running_code") {
      span.stage("generation");
    } else if (event.phase === "verifying") {
      span.stage("verification");
    }
    return;
  }
  const assistant = event.messages.find((m) => m.role === "assistant");
  if (event.replayed) {
    span.finish("replayed");
    return;
  }
  if (assistant?.code_execution_trace) {
    span.finish("computed");
    return;
  }
  span.finish(assistant?.kind ?? "missing");
}

function buildPublishAnswer(
  result: VerificationResult,
): Parameters<typeof publishTurn>[1]["answer"] {
  if (result.kind === "answer") {
    return result;
  }
  if (result.kind === "clarification") {
    return { kind: "clarification", content: result.content, citations: [] };
  }
  return {
    kind: "refusal",
    content: result.kind === "refusal" ? result.content : REFUSAL_UNVERIFIED,
    citations: [],
  };
}

function tryBuildComputeManifest(
  provider: RequestScopedContextProvider,
  compute: Extract<VerificationResult, { kind: "compute" }>,
): { manifest: InputManifest } | { refusal: VerificationResult } {
  try {
    const manifest = buildInputManifest({
      snapshot: provider.snapshot.sources,
      chunks: provider.lastRetrieved,
      dataset: compute.computation.dataset.map((d) => ({
        label: d.label,
        value: d.value,
        unit: d.unit ?? null,
        chunk_id: d.chunk_id,
      })),
    });
    return { manifest };
  } catch (err) {
    if (!(err instanceof ManifestError)) {
      throw err;
    }
    return {
      refusal: {
        kind: "refusal",
        content: REFUSAL_INSUFFICIENT_VALUES,
        reason: "insufficient_evidence",
      },
    };
  }
}

export class ChatService {
  private readonly deps: ChatServiceDeps;
  /** Active generations per thread so "Clear chat" or notebook deletion can abort them immediately on this instance. */
  private readonly active = new Map<string, Set<AbortController>>();
  private readonly threadsByNotebook = new Map<string, Set<string>>();

  constructor(deps: ChatServiceDeps) {
    this.deps = deps;
  }

  abortThread(threadId: string): void {
    for (const controller of this.active.get(threadId) ?? [])
      controller.abort(new AppError("GenerationCancelled", 409, "Chat cleared"));
  }

  abortNotebook(notebookId: string): void {
    for (const threadId of this.threadsByNotebook.get(notebookId) ?? []) this.abortThread(threadId);
  }

  private async generate(
    input: GroundedModelInput,
    signal: AbortSignal,
  ): Promise<GroundedDraft | null> {
    try {
      return await this.deps.model.generate(input);
    } catch (err) {
      if (signal.aborted) {
        throw new AppError("GenerationCancelled", 409, "Generation was cancelled");
      }
      if (err instanceof UnverifiableDraftError) {
        return null;
      }
      if (err instanceof ModelUnavailableError) {
        throw new AppError("RetryableFailure", 503, GENERATION_ERROR_MESSAGE);
      }
      throw err;
    }
  }

  private registerActiveTurn(
    notebookId: string,
    threadId: string,
    signal?: AbortSignal,
  ): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const set = this.active.get(threadId) ?? new Set<AbortController>();
    set.add(controller);
    this.active.set(threadId, set);
    const nbThreads = this.threadsByNotebook.get(notebookId) ?? new Set<string>();
    nbThreads.add(threadId);
    this.threadsByNotebook.set(notebookId, nbThreads);

    return {
      controller,
      cleanup: () => {
        signal?.removeEventListener("abort", onAbort);
        set.delete(controller);
        if (set.size === 0) {
          this.active.delete(threadId);
          nbThreads.delete(threadId);
          if (nbThreads.size === 0) {
            this.threadsByNotebook.delete(notebookId);
          }
        }
      },
    };
  }

  private async recordScopeLedger(
    span: BenchmarkSpan | undefined,
    provider: RequestScopedContextProvider,
  ): Promise<void> {
    if (!span || !this.deps.benchmark?.tokenizer) {
      return;
    }
    try {
      span.recordScope(await this.deps.benchmark.corpusLedger(this.deps.pool, provider.snapshot));
    } catch {
      /* Scoped ledger unknown; the private benchmark cannot pass. */
    }
  }

  private async *generateAndVerifyDraft(input: {
    request: TurnRequest;
    question: string;
    provider: RequestScopedContextProvider;
    chunks: Awaited<ReturnType<RequestScopedContextProvider["getScopedContext"]>>;
    history: HistoryTurn[];
    signal: AbortSignal;
    span: BenchmarkSpan | undefined;
  }): AsyncGenerator<
    TurnEvent,
    {
      modelInput: GroundedModelInput | null;
      draft: GroundedDraft | null;
      result: VerificationResult;
    }
  > {
    if (input.chunks.length === 0) {
      return {
        modelInput: null,
        draft: null,
        result: verifyDraft({ status: "not_in_sources", sentences: [] }, []),
      };
    }

    yield { type: "status", phase: "generating" };
    const preferences = await this.deps.resolvePreferences?.(
      input.request.ownerId,
      input.request.notebookId,
      input.request.browserLocale,
    );
    const queryClass = classifyQuery(input.question);
    const guides: SourceGuide[] | undefined =
      queryClass === "broad"
        ? await input.provider.readScopedGuides(preferences?.output_language)
        : undefined;

    planChatContext({
      requestId: input.request.requestId,
      scopeManifestHash: createHash("sha256")
        .update(
          input.provider.snapshot.sources
            .map((s) => `${s.source_id}:${s.revision}`)
            .sort()
            .join(","),
        )
        .digest("hex"),
      question: input.question,
      model: this.deps.model.id,
      modelVersion: "1",
      inputLimit: 100_000,
      outputReserve: 4096,
      instructionTokens: 500,
      historyTokens: Math.min(1000, 100 * input.history.length),
      guideTokens: Math.round((guides ?? []).reduce((acc, g) => acc + g.summary_md.length / 4, 0)),
      chunkMarkerTokens: 50 * input.chunks.length,
      evidenceTokens: input.chunks.reduce((acc, c) => acc + c.token_count, 0),
      requiredGuideIds: (guides ?? []).map((g) => g.source_id),
      detailChunkIds: input.chunks.map((c) => c.chunk_id),
    });

    let modelInput: GroundedModelInput = {
      question: input.question,
      chunks: input.chunks,
      history: input.history,
      signal: input.signal,
      ...(preferences ? { preferences } : {}),
      ...(guides ? { guides } : {}),
    };
    input.span?.observePrompt(modelInput);
    let draft = await this.generate(modelInput, input.signal);
    yield { type: "status", phase: "verifying" };
    let result: VerificationResult = draft
      ? verifyDraft(draft, input.provider.lastRetrieved)
      : { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "unverifiable" };

    if (result.kind === "compute") {
      const expanded = yield* this.expandComputeEvidence({
        provider: input.provider,
        modelInput,
        draft,
        result,
        signal: input.signal,
        span: input.span,
      });
      modelInput = expanded.modelInput;
      draft = expanded.draft;
      result = expanded.result;
    }

    return { modelInput, draft, result };
  }

  private async *expandComputeEvidence(input: {
    provider: RequestScopedContextProvider;
    modelInput: GroundedModelInput;
    draft: GroundedDraft | null;
    result: Extract<VerificationResult, { kind: "compute" }>;
    signal: AbortSignal;
    span: BenchmarkSpan | undefined;
  }): AsyncGenerator<
    TurnEvent,
    { modelInput: GroundedModelInput; draft: GroundedDraft | null; result: VerificationResult }
  > {
    // FR-GC-08: never pretend a computation; whole-table calculations need the complete scoped snapshot.
    if (!this.deps.codeExecution) {
      throw new AppError(
        "RetryableFailure",
        503,
        "Code execution is not available right now. Please try again later.",
      );
    }
    const complete = await input.provider.readCompleteSnapshot(MAX_COMPUTE_CHUNKS + 1);
    const supplied = new Set(input.provider.lastRetrieved.map((c) => c.chunk_id));
    const plan = evidencePlan({
      retrieved: complete.filter((c) => supplied.has(c.chunk_id)).length,
      snapshotTotal: complete.length,
    });
    if (plan.kind === "insufficient") {
      return {
        modelInput: input.modelInput,
        draft: input.draft,
        result: {
          kind: "refusal",
          content: REFUSAL_TOO_LARGE_FOR_COMPLETE_DATA,
          reason: "insufficient_evidence",
        },
      };
    }
    if (plan.kind === "expand") {
      input.provider.useCompleteSnapshot(complete);
      yield { type: "status", phase: "generating" };
      const modelInput: GroundedModelInput = { ...input.modelInput, chunks: complete };
      input.span?.observePrompt(modelInput);
      const draft = await this.generate(modelInput, input.signal);
      yield { type: "status", phase: "verifying" };
      const result: VerificationResult = draft
        ? verifyDraft(draft, input.provider.lastRetrieved)
        : { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "unverifiable" };
      return { modelInput, draft, result };
    }
    return { modelInput: input.modelInput, draft: input.draft, result: input.result };
  }

  /**
   * FR-GC-08: run the deterministic controller, stream its truthful progress, then publish exactly one result —
   * the validated computed answer or a transparent error — together with the ordered trace, under the execution
   * lease and the snapshot/epoch fence. A refused publication ends the execution without publishing anything.
   */
  private async *executeAndPublish(input: {
    codeExecution: CodeExecutionRuntimeDeps;
    request: TurnRequest;
    question: string;
    thread: Awaited<ReturnType<typeof getOrCreateThread>>;
    provider: RequestScopedContextProvider;
    compute: Extract<VerificationResult, { kind: "compute" }>;
    manifest: InputManifest;
    signal: AbortSignal;
  }): AsyncGenerator<TurnEvent> {
    const { pool } = this.deps;
    const execution = new CodeExecutionController({
      pool,
      ...input.codeExecution,
      evidenceIdentity: this.deps.benchmark?.executionIdentity(input.thread.notebook_id),
    });
    const privateExecution = this.deps.benchmark?.beginExecution({
      notebook_id: input.thread.notebook_id,
      owner_id: input.thread.user_id,
      request_id: input.request.requestId,
      source_snapshot: input.provider.snapshot.sources,
    });
    const messageId = randomUUID();
    const queue: TurnEvent[] = [];
    const state: { wake: (() => void) | null; settled: SettledOutcome | null } = {
      wake: null,
      settled: null,
    };
    const correct = this.deps.model.correctCode?.bind(this.deps.model);
    void execution
      .run({
        thread: input.thread,
        requestId: input.request.requestId,
        ...(privateExecution ? { onTiming: privateExecution.timing } : {}),
        snapshot: input.provider.snapshot.sources,
        question: input.question,
        intent: input.compute.computation.intent,
        code: input.compute.computation.code,
        manifest: input.manifest,
        messageId,
        correct,
        signal: input.signal,
        onStatus: (status) => {
          queue.push(status);
          state.wake?.();
        },
      })
      .then(
        (value) => {
          state.settled = { ok: true, value };
        },
        (error: unknown) => {
          state.settled = { ok: false, error };
        },
      )
      .finally(() => state.wake?.());
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (state.settled !== null) {
        break;
      }
      await new Promise<void>((resolve) => {
        state.wake = resolve;
      });
      state.wake = null;
    }
    const outcome = state.settled;
    if (!outcome.ok) {
      throw outcome.error;
    }
    const run = outcome.value;
    // NFR-PERF-01: only the actual durable terminal trace is authoritative after publication/abandon.
    // A missing/deleted row, failed durable update or active state withholds evidence; attempts remain in HTTP diagnostics.
    const recordCanonical = async (publishedAt: string | null) => {
      if (!privateExecution) return;
      try {
        const row = await getCodeExecution(pool, run.executionId);
        if (
          row &&
          (row.state === "Succeeded" || row.state === "Failed" || row.state === "TimedOut") &&
          row.trace.state === row.state
        )
          privateExecution.finish(row.trace, publishedAt);
      } catch {
        /* No canonical proof: UNAVAILABLE. */
      }
    };
    if (input.signal.aborted) {
      await execution.abandon(run, "GenerationCancelled");
      await recordCanonical(null);
      throw new AppError("GenerationCancelled", 409, "Generation was cancelled");
    }
    const answer =
      run.trace.state === "Succeeded"
        ? {
            id: messageId,
            ...composeComputedAnswer({
              preamble: input.compute.preamble,
              results: run.results,
              retrieved: input.provider.lastRetrieved,
            }),
            trace: run.trace,
          }
        : {
            id: messageId,
            kind: "refusal" as const,
            content: computationFailureMessage(run.trace.failure_code ?? "ExecutionOutcomeUnknown"),
            citations: [],
            trace: run.trace,
          };
    let stored;
    try {
      stored = await publishTurn(pool, {
        thread: input.thread,
        snapshot: input.provider.snapshot,
        requestId: input.request.requestId,
        question: input.question,
        answer,
        execution: {
          executionId: run.executionId,
          leaseToken: run.leaseToken,
          publishArtifactIds: run.publishArtifactIds,
        },
      });
    } catch (err) {
      await execution.abandon(run, abandonReasonForError(err));
      await recordCanonical(null);
      throw err;
    }
    await recordCanonical(new Date().toISOString());
    yield {
      type: "final",
      messages: await projectVisibleMessages(pool, input.request.notebookId, stored),
      replayed: false,
    };
  }

  async *runTurn(request: TurnRequest, signal?: AbortSignal): AsyncGenerator<TurnEvent> {
    const span = this.deps.benchmark?.begin(request.notebookId, request.requestId);
    try {
      for await (const event of this.runTurnCore(request, signal, span)) {
        recordBenchmarkEvent(span, event);
        yield event;
      }
    } catch (error) {
      span?.finish(signal?.aborted ? "cancelled" : "error");
      throw error;
    } finally {
      span?.finish("cancelled");
    }
  }

  private async *runTurnCore(
    request: TurnRequest,
    signal?: AbortSignal,
    span?: BenchmarkSpan,
  ): AsyncGenerator<TurnEvent> {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted");
    }
    const { pool } = this.deps;
    const question = normalizeMessage(request.message);
    // Submission snapshot: owner, explicit non-empty Ready selection, exact revisions (CP-01).
    const provider = await RequestScopedContextProvider.capture({
      pool,
      embedder: this.deps.embedder,
      ownerId: request.ownerId,
      notebookId: request.notebookId,
      activeSourceIds: request.activeSourceIds,
      query: question,
      ...(this.deps.retrievalLimit ? { limit: this.deps.retrievalLimit } : {}),
    });
    await this.recordScopeLedger(span, provider);
    const thread = await getOrCreateThread(pool, request.ownerId, request.notebookId);

    const replay = await findTurnByRequest(pool, thread.id, request.requestId);
    if (replay.length > 0) {
      yield {
        type: "final",
        messages: await projectVisibleMessages(pool, request.notebookId, replay),
        replayed: true,
      };
      return;
    }

    const { controller, cleanup } = this.registerActiveTurn(request.notebookId, thread.id, signal);
    try {
      yield { type: "status", phase: "retrieving" };
      const snapshotIds = provider.snapshot.sources.map((p) => p.source_id);
      const chunks = await provider.getScopedContext(request.notebookId, snapshotIds);
      const history = selectEligibleHistory(
        await listThreadMessages(pool, thread.id),
        provider.snapshot.sources,
      );

      const generated = yield* this.generateAndVerifyDraft({
        request,
        question,
        provider,
        chunks,
        history,
        signal: controller.signal,
        span,
      });
      let result = generated.result;

      this.deps.observer?.({
        requestId: request.requestId,
        snapshot: provider.snapshot.sources,
        retrieved: provider.lastRetrieved.map((c) => ({
          chunk_id: c.chunk_id,
          source_id: c.source_id,
          revision: c.revision,
          text: c.text,
        })),
        modelInput: generated.modelInput,
        draft: generated.draft,
        result,
      });
      if (controller.signal.aborted) {
        throw new AppError("GenerationCancelled", 409, "Generation was cancelled");
      }

      if (result.kind === "compute" && this.deps.codeExecution) {
        const built = tryBuildComputeManifest(provider, result);
        if ("manifest" in built) {
          yield* this.executeAndPublish({
            codeExecution: this.deps.codeExecution,
            request,
            question,
            thread,
            provider,
            compute: result,
            manifest: built.manifest,
            signal: controller.signal,
          });
          return;
        }
        result = built.refusal;
      }

      span?.stage("publication");
      const stored = await publishTurn(pool, {
        thread,
        snapshot: provider.snapshot,
        requestId: request.requestId,
        question,
        answer: buildPublishAnswer(result),
      });
      yield {
        type: "final",
        messages: await projectVisibleMessages(pool, request.notebookId, stored),
        replayed: false,
      };
    } finally {
      cleanup();
    }
  }
}
