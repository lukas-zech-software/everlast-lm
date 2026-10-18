import type { PublishedTurnResult } from "./publication.js";

export interface ProgressStatusEvent {
  type: "progress";
  stage: "retrieving" | "synthesizing" | "verifying";
  message: string;
}

export interface ContentStatusEvent {
  type: "content";
  delta: string;
}

export interface CompletedStatusEvent {
  type: "completed";
  data: PublishedTurnResult;
}

export type TransportStatusEvent =
  | ProgressStatusEvent
  | ContentStatusEvent
  | CompletedStatusEvent;

/**
 * Buffered turn transport for status-only streaming (FR-GC-01, FR-GC-02, D13).
 * Guarantees that draft factual tokens are buffered internally and NEVER emitted
 * to the client before deterministic citation verification completes.
 */
export class BufferedTurnTransport {
  private events: TransportStatusEvent[] = [];
  private bufferedTokens: string[] = [];

  /**
   * Emits high-level progress events (retrieving, synthesizing, verifying).
   */
  sendProgress(stage: "retrieving" | "synthesizing" | "verifying", message: string): void {
    this.events.push({
      type: "progress",
      stage,
      message,
    });
  }

  /**
   * Buffers draft LLM tokens server-side.
   * Tokens are not emitted as transport events.
   */
  bufferDraftToken(token: string): void {
    this.bufferedTokens.push(token);
  }

  /**
   * Returns the buffered draft tokens concatenated together.
   */
  getBufferedDraft(): string {
    return this.bufferedTokens.join("");
  }

  /**
   * Publishes the final verified answer (or refusal) once the publication gate clears.
   */
  publishFinalAnswer(result: PublishedTurnResult): void {
    this.events.push({
      type: "completed",
      data: result,
    });
  }

  /**
   * Retrieves all emitted transport events for inspection/streaming.
   */
  getEmittedEvents(): TransportStatusEvent[] {
    return [...this.events];
  }
}
