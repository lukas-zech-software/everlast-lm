/**
 * Prompt-injection screening boundary for external content (FR-SI-01/05, NFR-SEC-01/02, Constitution VI).
 * Web, synced and delegated-import content is screened before indexing or model use; quarantined content never
 * becomes Ready or enters C-02. Any screening error or timeout fails closed.
 */

export interface ScreeningVerdict {
  verdict: "clean" | "quarantined";
  /** Stable filter name that matched (no content). */
  reason?: string | undefined;
}

export interface ContentScreener {
  readonly name: string;
  /** Screens every text block; throws on transport/provider errors (callers fail closed). */
  screen(texts: string[]): Promise<ScreeningVerdict>;
}

export class ScreeningUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningUnavailableError";
  }
}
