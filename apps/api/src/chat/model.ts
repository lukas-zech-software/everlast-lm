import { randomUUID } from "node:crypto";
import { Gemini, InMemoryRunner, LlmAgent, isFinalResponse } from "@google/adk";
import type { UnifiedDocumentChunk } from "@everlast/contracts";
import type { Schema } from "@google/genai";
import { groundedDraftResponseSchema, GroundedDraftSchema, type GroundedDraft } from "./draft.ts";
import { buildCorrectionPayload, buildUserPayload, CODE_CORRECTION_INSTRUCTION, groundingInstruction, type HistoryTurn, type ResponsePreferences } from "./prompt.ts";

/**
 * Grounded reasoning model boundary (FR-GC-01, FR-GC-02, NFR-SEC-01, D2).
 * Production: ADK for TypeScript `LlmAgent` on Gemini Flash via Vertex AI in the configured EU region with
 * keyless ADC (enterprise endpoint, contractual no-training). Developer API keys are never used.
 */

export interface GroundedModelInput {
  question: string;
  chunks: UnifiedDocumentChunk[];
  history: HistoryTurn[];
  signal?: AbortSignal | undefined;
  preferences?: ResponsePreferences | undefined;
}

/** Input of the single permitted correction after a first-attempt Python exception (FR-GC-08 FR-006). */
export interface CodeCorrectionInput {
  question: string;
  intent: string;
  values: { label: string; value: string; unit: string | null; chunk_id: string }[];
  failedCode: string;
  stderr: string;
  signal?: AbortSignal | undefined;
}

export interface GroundedModel {
  readonly id: string;
  generate(input: GroundedModelInput): Promise<GroundedDraft>;
  /**
   * FR-GC-08: corrected program for the one automatic retry. It cannot change inputs, limits or the retry count —
   * the deterministic controller owns those. Absent → no correction retry is possible.
   */
  correctCode?(input: CodeCorrectionInput): Promise<string>;
}

const CODE_CORRECTION_RESPONSE_SCHEMA = { type: "OBJECT", properties: { code: { type: "STRING" } }, required: ["code"] } as const;

/** The model returned output that does not match the structured draft schema (treated as unverifiable). */
export class UnverifiableDraftError extends Error {
  constructor(message = "Model output did not match the grounded draft schema") {
    super(message);
    this.name = "UnverifiableDraftError";
  }
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export interface AdkModelConfig {
  project: string;
  location: string;
  model: string;
  timeoutMs?: number;
  /** FR-GC-08: offer compute/clarify only when a sandbox runtime is configured (default false). */
  codeExecution?: boolean;
}

export class AdkGroundedModel implements GroundedModel {
  readonly id: string;
  private readonly runner: InMemoryRunner;
  private readonly correctionRunner: InMemoryRunner;
  readonly llm: Gemini;
  private readonly timeoutMs: number;

  constructor(config: AdkModelConfig) {
    this.id = `vertex:${config.location}:${config.model}`;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    // Explicit vertexai + project + location: the SDK uses ADC and ignores any API key in the environment.
    this.llm = new Gemini({ model: config.model, vertexai: true, project: config.project, location: config.location });
    const agent = new LlmAgent({
      name: "grounded_chat",
      description: "Answers strictly from scoped source chunks with chunk-level citations.",
      model: this.llm,
      instruction: groundingInstruction({ codeExecution: config.codeExecution ?? false }),
      outputSchema: groundedDraftResponseSchema({ codeExecution: config.codeExecution ?? false }) as unknown as Schema,
      includeContents: "none",
      disallowTransferToParent: true,
      disallowTransferToPeers: true,
      generateContentConfig: { temperature: 0, candidateCount: 1 },
    });
    this.runner = new InMemoryRunner({ agent, appName: "everlast-chat" });
    // FR-GC-08: separate single-purpose agent for the one code correction; no tools, no transfer, no state.
    const corrector = new LlmAgent({
      name: "code_correction",
      description: "Fixes a failed sandbox program without changing its inputs or task.",
      model: this.llm,
      instruction: CODE_CORRECTION_INSTRUCTION,
      outputSchema: CODE_CORRECTION_RESPONSE_SCHEMA as unknown as Schema,
      includeContents: "none",
      disallowTransferToParent: true,
      disallowTransferToPeers: true,
      generateContentConfig: { temperature: 0, candidateCount: 1 },
    });
    this.correctionRunner = new InMemoryRunner({ agent: corrector, appName: "everlast-code-correction" });
  }

  async correctCode(input: CodeCorrectionInput): Promise<string> {
    const text = await this.run(this.correctionRunner, "everlast-code-correction", buildCorrectionPayload(input), input.signal);
    try {
      const parsed = JSON.parse(text) as { code?: unknown };
      if (typeof parsed.code !== "string" || parsed.code.length === 0 || parsed.code.length > 20_000) throw new UnverifiableDraftError("Correction did not return code");
      return parsed.code;
    } catch (err) {
      throw err instanceof UnverifiableDraftError ? err : new UnverifiableDraftError("Correction output was not JSON");
    }
  }

  private async run(runner: InMemoryRunner, appName: string, payload: string, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ModelUnavailableError("Model request timed out")), this.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const userId = "chat";
      const session = await runner.sessionService.createSession({ appName, userId, sessionId: randomUUID() });
      let text = "";
      for await (const event of runner.runAsync({ userId, sessionId: session.id, newMessage: { role: "user", parts: [{ text: payload }] }, abortSignal: controller.signal })) {
        if (event.errorCode) throw new ModelUnavailableError(`Model error ${event.errorCode}`);
        if (isFinalResponse(event)) text = (event.content?.parts ?? []).map((p) => p.text ?? "").join("");
      }
      await runner.sessionService.deleteSession({ appName, userId, sessionId: session.id }).catch(() => undefined);
      return text;
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      throw err instanceof ModelUnavailableError ? err : new ModelUnavailableError((err as Error).message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ModelUnavailableError("Model request timed out")), this.timeoutMs);
    const onAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const userId = "chat";
      const session = await this.runner.sessionService.createSession({ appName: "everlast-chat", userId, sessionId: randomUUID() });
      let text = "";
      for await (const event of this.runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: { role: "user", parts: [{ text: buildUserPayload(input.question, input.chunks, input.history, input.preferences) }] },
        abortSignal: controller.signal,
      })) {
        if (event.errorCode) throw new ModelUnavailableError(`Model error ${event.errorCode}`);
        if (isFinalResponse(event)) {
          text = (event.content?.parts ?? []).map((p) => p.text ?? "").join("");
        }
      }
      await this.runner.sessionService.deleteSession({ appName: "everlast-chat", userId, sessionId: session.id }).catch(() => undefined);
      return GroundedDraftSchema.parse(JSON.parse(text));
    } catch (err) {
      if (input.signal?.aborted) throw input.signal.reason ?? err;
      if (err instanceof SyntaxError || (err as Error).name === "ZodError") throw new UnverifiableDraftError();
      throw err instanceof ModelUnavailableError ? err : new ModelUnavailableError((err as Error).message);
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function createGroundedModelFromEnv(env: NodeJS.ProcessEnv = process.env): GroundedModel {
  const project = env.VERTEX_PROJECT ?? env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("VERTEX_PROJECT (or GCP_PROJECT_ID) is required for the chat model");
  return new AdkGroundedModel({
    project,
    location: env.VERTEX_LOCATION ?? env.VERTEX_AI_LOCATION ?? "europe-west4",
    model: env.CHAT_MODEL ?? "gemini-2.5-flash",
    codeExecution: env.CODE_EXECUTION_ENABLED === "true",
  });
}
