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
import type { Embedder } from "@everlast/cloud";
import { RequestScopedContextProvider } from "../services/source-context.ts";
import type { HistoryTurn, ResponsePreferences } from "./prompt.ts";
import { ModelUnavailableError, UnverifiableDraftError, type GroundedModel, type GroundedModelInput } from "./model.ts";
import type { GroundedDraft } from "./draft.ts";
import { REFUSAL_UNVERIFIED, stripBadges, verifyDraft, type VerificationResult } from "./verifier.ts";

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
        try {
          draft = await this.deps.model.generate(modelInput);
        } catch (err) {
          if (controller.signal.aborted) throw new AppError("GenerationCancelled", 409, "Generation was cancelled");
          if (err instanceof UnverifiableDraftError) draft = null;
          else if (err instanceof ModelUnavailableError) throw new AppError("RetryableFailure", 503, GENERATION_ERROR_MESSAGE);
          else throw err;
        }
        yield { type: "status", phase: "verifying" };
        result = draft ? verifyDraft(draft, provider.lastRetrieved) : { kind: "refusal", content: REFUSAL_UNVERIFIED, reason: "unverifiable" };
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

      const stored = await publishTurn(pool, {
        thread,
        snapshot: provider.snapshot,
        requestId: request.requestId,
        question,
        answer: result.kind === "answer" ? result : { kind: "refusal", content: result.content, citations: [] },
      });
      yield { type: "final", messages: await projectVisibleMessages(pool, request.notebookId, stored), replayed: false };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      set.delete(controller);
      if (set.size === 0) this.active.delete(thread.id);
    }
  }
}
