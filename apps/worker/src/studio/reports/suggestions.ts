import {
  computeContextCacheKey,
  type ReportSuggestionsResult,
  type SourceGuideState,
  type SourceRevisionPair,
} from "@everlast/contracts";
import type { ReportModelClient } from "./model.ts";

export interface SourceGuideProvider {
  getGuides(notebookId: string, snapshot: SourceRevisionPair[]): Promise<SourceGuideState[]>;
}

export interface SuggestionRequest {
  notebook_id: string;
  owner_id: string;
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
}

export const SUGGESTION_TIMEOUT_MS = 3000;

export class ReportSuggestionService {
  private readonly cache = new Map<string, ReportSuggestionsResult>();

  private readonly deps: { guides: SourceGuideProvider; model: ReportModelClient; timeoutMs?: number };
  constructor(deps: { guides: SourceGuideProvider; model: ReportModelClient; timeoutMs?: number }) {
    this.deps = deps;
  }

  async getSuggestions(req: SuggestionRequest): Promise<ReportSuggestionsResult> {
    const key = computeContextCacheKey({
      notebook_id: req.notebook_id,
      source_revisions: req.snapshot,
      subject: req.owner_id,
      language: req.output_language ?? "default",
      generation_parameters: { kind: "report_suggestions" },
    });
    const cached = this.cache.get(key);
    if (cached) return structuredClone(cached);

    const unavailable: ReportSuggestionsResult = { state: "SuggestionsUnavailable", reason: "Suggestions could not be generated." };
    let guides: SourceGuideState[];
    try {
      guides = await this.deps.guides.getGuides(req.notebook_id, req.snapshot);
    } catch {
      return unavailable;
    }
    if (guides.some((g) => g.status === "Pending")) return { state: "SuggestionsLoading" };
    if (guides.some((g) => g.status === "Failed")) return unavailable;

    const controller = new AbortController();
    const timeoutMs = this.deps.timeoutMs ?? SUGGESTION_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, timeoutMs);
      });
      const suggestions = await Promise.race([
        this.deps.model.suggest({ guides, output_language: req.output_language, signal: controller.signal }),
        timeout,
      ]);
      if (suggestions.length < 3 || suggestions.length > 4) return unavailable;
      const result: ReportSuggestionsResult = { state: "SuggestionsReady", suggestions };
      this.cache.set(key, result);
      return structuredClone(result);
    } catch {
      return unavailable;
    } finally {
      clearTimeout(timer);
    }
  }
}
