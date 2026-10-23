import { randomUUID } from "node:crypto";
import { AppError, isTurnProvenanceEligible } from "@everlast/contracts";
import {
  findTurnByRequest,
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
import type { HistoryTurn, ResponsePreferences } from "./prompt.ts";
import { ModelUnavailableError, UnverifiableDraftError, type GroundedModel, type GroundedModelInput } from "./model.ts";
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
import { buildInputManifest, evidencePlan, ManifestError, MAX_COMPUTE_CHUNKS, type InputManifest } from "./execution/manifest.ts";
import { CodeExecutionController, type ControllerResult, type ExecutionStatus } from "./execution/controller.ts";
import type { SandboxRuntime } from "./execution/runtime.ts";

/**
 * Grounded chat turn (FR-GC-01, FR-GC-02, FR-GC-06, C-02, D13).
 * submission snapshot → C-02 retrieval → provenance-eligible history → buffered model draft → deterministic
 * verification → fenced atomic publication. No source content reaches the client before verification.
 */

export const GENERATION_ERROR_MESSAGE = "An error occurred while generating the response. Please try again.";
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
  snapshot: { source_id: string; revision: number }[];
  retrieved: { chunk_id: string; source_id: string; revision: number; text: string }[];
  modelInput: GroundedModelInput | null;
  draft: GroundedDraft | null;
  result: VerificationResult;
}

export interface ChatServiceDeps {
  pool: Pool;
  embedder: Embedder;
  model: GroundedModel;
  retrievalLimit?: number;
  observer?: (observation: TurnObservation) => void;
  /** FR-GC-08 managed sandbox (specs/010); absent → computations fail safely with 503, nothing is pretended. */
  codeExecution?: { runtime: SandboxRuntime; storage: ObjectStorage; deadlineMs?: number } | undefined;
  /** Release v2 response preferences of the caller (style, length, languages). */
  resolvePreferences?: (ownerId: string, notebookId: string, browserLocale?: string) => Promise<ResponsePreferences>;
}

/** Message length rule: 1–10,000 Unicode code points after outer trim, never truncated (FR-GC-01). */
export function normalizeMessage(message: unknown): string {
  if (typeof message !== "string") throw new AppError("ValidationFailed", 422, "message must be a string");
  const trimmed = message.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > MAX_MESSAGE_CODE_POINTS) {
    throw new AppError("ValidationFailed", 422, "message must be 1–10,000 Unicode code points after trimming");
  }
  return trimmed;
}

/**
 * Eligible history (FR-GC-01, NFR-EVAL-04): a turn is included only if its complete provenance is a subset of
 * the current snapshot. Missing provenance excludes the turn. Question and answer are kept or dropped together.
 */
export function selectEligibleHistory(
  messages: StoredMessage[],
  snapshot: { source_id: string; revision: number }[],
  limit = HISTORY_TURN_LIMIT
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
    if (!isTurnProvenanceEligible(question.provenance, snapshot) || !isTurnProvenanceEligible(answer.provenance, snapshot)) continue;
    eligible.push({ question: question.content, answer: stripBadges(answer.content) });
  }
  return eligible.slice(-limit);
}

export class ChatService {
  private readonly deps: ChatServiceDeps;
  /** Active generations per thread so "Clear chat" can abort them immediately on this instance. */
  private readonly active = new Map<string, Set<AbortController>>();

  constructor(deps: ChatServiceDeps) {
    this.deps = deps;
  }

  abortThread(threadId: string): void {
    for (const controller of this.active.get(threadId) ?? []) controller.abort(new AppError("GenerationCancelled", 409, "Chat cleared"));
  }

  private async generate(input: GroundedModelInput, signal: AbortSignal): Promise<GroundedDraft | null> {
    try {
      return await this.deps.model.generate(input);
    } catch (err) {
      if (signal.aborted) throw new AppError("GenerationCancelled", 409, "Generation was cancelled");
      if (err instanceof UnverifiableDraftError) return null;
      if (err instanceof ModelUnavailableError) throw new AppError("RetryableFailure", 503, GENERATION_ERROR_MESSAGE);
      throw err;
    }
  }

  /**
   * FR-GC-08: run the deterministic controller, stream its truthful progress, then publish exactly one result —
   * the validated computed answer or a transparent error — together with the ordered trace, under the execution
   * lease and the snapshot/epoch fence. A refused publication ends the execution without publishing anything.
   */
  private async *executeAndPublish(input: {
    request: TurnRequest;
    question: string;
    thread: Awaited<ReturnType<typeof getOrCreateThread>>;
    provider: RequestScopedContextProvider;
    compute: Extract<VerificationResult, { kind: "compute" }>;
    manifest: InputManifest;
    signal: AbortSignal;
  }): AsyncGenerator<TurnEvent> {
    const { pool } = this.deps;
    const execution = new CodeExecutionController({ pool, ...this.deps.codeExecution! });
    const messageId = randomUUID();
    const queue: TurnEvent[] = [];
    let wake: (() => void) | null = null;
    let settled: { ok: true; value: ControllerResult } | { ok: false; error: unknown } | null = null;
    const correct = this.deps.model.correctCode?.bind(this.deps.model);
    void execution
      .run({
        thread: input.thread,
        requestId: input.request.requestId,
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
          wake?.();
        },
      })
      .then(
        (value) => (settled = { ok: true, value }),
        (error) => (settled = { ok: false, error })
      )
      .finally(() => wake?.());
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (settled) break;
      await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
    }
    const outcome = settled as unknown as { ok: true; value: ControllerResult } | { ok: false; error: unknown };
    if (!outcome.ok) throw outcome.error;
    const run = outcome.value;
    if (input.signal.aborted) {
      await execution.abandon(run, "GenerationCancelled");
      throw new AppError("GenerationCancelled", 409, "Generation was cancelled");
    }
    const answer =
      run.trace.state === "Succeeded"
        ? { id: messageId, ...composeComputedAnswer({ preamble: input.compute.preamble, results: run.results, retrieved: input.provider.lastRetrieved }), trace: run.trace }
        : { id: messageId, kind: "refusal" as const, content: computationFailureMessage(run.trace.failure_code!), citations: [], trace: run.trace };
    let stored;
    try {
      stored = await publishTurn(pool, {
        thread: input.thread,
        snapshot: input.provider.snapshot,
        requestId: input.request.requestId,
        question: input.question,
        answer,
        execution: { executionId: run.executionId, leaseToken: run.leaseToken, publishArtifactIds: run.publishArtifactIds },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      await execution.abandon(run, code === "GenerationCancelled" ? "GenerationCancelled" : code === "InvalidScope" || code === "Forbidden" ? "AccessRevoked" : "ScopeChanged");
      throw err;
    }
    yield { type: "final", messages: await projectVisibleMessages(pool, input.request.notebookId, stored), replayed: false };
  }

  async *runTurn(request: TurnRequest, signal?: AbortSignal): AsyncGenerator<TurnEvent> {
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
    const thread = await getOrCreateThread(pool, request.ownerId, request.notebookId);

    const replay = await findTurnByRequest(pool, thread.id, request.requestId);
    if (replay.length > 0) {
      yield { type: "final", messages: await projectVisibleMessages(pool, request.notebookId, replay), replayed: true };
      return;
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const set = this.active.get(thread.id) ?? new Set();
    set.add(controller);
    this.active.set(thread.id, set);

    try {
      yield { type: "status", phase: "retrieving" };
      const snapshotIds = provider.snapshot.sources.map((p) => p.source_id);
      const chunks = await provider.getScopedContext(request.notebookId, snapshotIds);
      const history = selectEligibleHistory(await listThreadMessages(pool, thread.id), provider.snapshot.sources);

      let result: VerificationResult;
      let modelInput: GroundedModelInput | null = null;
      let draft: GroundedDraft | null = null;
      if (chunks.length === 0) {
        result = verifyDraft({ status: "not_in_sources", sentences: [] }, []);
      } else {
        yield { type: "status", phase: "generating" };
        const preferences = await this.deps.resolvePreferences?.(request.ownerId, request.notebookId, request.browserLocale);
        modelInput = { question, chunks, history, signal: controller.signal, ...(preferences ? { preferences } : {}) };
        draft = await this.generate(modelInput, controller.signal);
        yield { type: "status", phase: "verifying" };
        result = draft ? verifyDraft(draft, provider.lastRetrieved) : { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "unverifiable" };
        if (result.kind === "compute") {
          // FR-GC-08: never pretend a computation; whole-table calculations need the complete scoped snapshot.
          if (!this.deps.codeExecution) throw new AppError("RetryableFailure", 503, "Code execution is not available right now. Please try again later.");
          const complete = await provider.readCompleteSnapshot(MAX_COMPUTE_CHUNKS + 1);
          const supplied = new Set(provider.lastRetrieved.map((c) => c.chunk_id));
          const plan = evidencePlan({ retrieved: complete.filter((c) => supplied.has(c.chunk_id)).length, snapshotTotal: complete.length });
          if (plan.kind === "insufficient") {
            result = { kind: "refusal", content: REFUSAL_TOO_LARGE_FOR_COMPLETE_DATA, reason: "insufficient_evidence" };
          } else if (plan.kind === "expand") {
            provider.useCompleteSnapshot(complete);
            yield { type: "status", phase: "generating" };
            modelInput = { ...modelInput, chunks: complete };
            draft = await this.generate(modelInput, controller.signal);
            yield { type: "status", phase: "verifying" };
            result = draft ? verifyDraft(draft, provider.lastRetrieved) : { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "unverifiable" };
          }
        }
      }
      this.deps.observer?.({
        requestId: request.requestId,
        snapshot: provider.snapshot.sources,
        retrieved: provider.lastRetrieved.map((c) => ({ chunk_id: c.chunk_id, source_id: c.source_id, revision: c.revision, text: c.text })),
        modelInput,
        draft,
        result,
      });
      if (controller.signal.aborted) throw new AppError("GenerationCancelled", 409, "Generation was cancelled");

      if (result.kind === "compute") {
        let manifest: InputManifest | null = null;
        try {
          manifest = buildInputManifest({
            snapshot: provider.snapshot.sources,
            chunks: provider.lastRetrieved,
            dataset: result.computation.dataset.map((d) => ({ label: d.label, value: d.value, unit: d.unit ?? null, chunk_id: d.chunk_id })),
          });
        } catch (err) {
          if (!(err instanceof ManifestError)) throw err;
          result = { kind: "refusal", content: REFUSAL_INSUFFICIENT_VALUES, reason: "insufficient_evidence" };
        }
        if (manifest && result.kind === "compute") {
          yield* this.executeAndPublish({ request, question, thread, provider, compute: result, manifest, signal: controller.signal });
          return;
        }
      }

      const stored = await publishTurn(pool, {
        thread,
        snapshot: provider.snapshot,
        requestId: request.requestId,
        question,
        answer:
          result.kind === "answer"
            ? result
            : result.kind === "clarification"
              ? { kind: "clarification", content: result.content, citations: [] }
              : { kind: "refusal", content: result.kind === "refusal" ? result.content : REFUSAL_UNVERIFIED, citations: [] },
      });
      yield { type: "final", messages: await projectVisibleMessages(pool, request.notebookId, stored), replayed: false };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      set.delete(controller);
      if (set.size === 0) this.active.delete(thread.id);
    }
  }
}
