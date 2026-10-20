import {
  computeContextCacheKey,
  ReportSuggestionsOutputSchema,
  type ReportSuggestion,
  type ReportSuggestionsResult,
  type SourceGuideState,
  type SourceRevisionPair,
} from "@everlast/contracts";
import type { ReportSuggestionInput } from "../../package-v2-2.ts";
import { ReportGenerationError, type ReportSuggestionModel } from "./model.ts";

/** FR-SI-02 consumer port: Source Guide states of a snapshot, for the effective output language when given. */
export interface SourceGuideProvider {
  getGuides(notebookId: string, snapshot: SourceRevisionPair[], outputLanguage?: string): Promise<SourceGuideState[]>;
}

export interface SuggestionRequest {
  notebook_id: string;
  owner_id: string;
  snapshot: SourceRevisionPair[];
  output_language?: string | undefined;
}

export const SUGGESTION_TIMEOUT_MS = 3000;
export const SUGGESTIONS_NOT_CONFIGURED = "Suggested formats are unavailable because no suggestion model is configured.";
const SUGGESTIONS_FAILED = "Suggested formats are unavailable right now.";

/** The Package 2.2 structured-generation client, or anything exposing its report-suggestion method. */
export interface ReportSuggestionClient {
  generateReportSuggestions?(input: ReportSuggestionInput): Promise<unknown>;
}

/**
 * FR-ST-11 Flash-Lite suggestions on the Package 2.2 Vertex structured-generation client (no second Vertex
 * client): only guide summaries and key topics are sent; 3–4 cards are validated. Undefined when the client has
 * no suggestion method (not configured).
 */
export function structuredSuggestionModel(client: ReportSuggestionClient | undefined): ReportSuggestionModel | undefined {
  if (!client?.generateReportSuggestions) return undefined;
  return {
    async suggest(req): Promise<ReportSuggestion[]> {
      const out = await client.generateReportSuggestions!({
        guides: req.guides.map((g) => ({ source_id: g.source_id, summary: g.summary ?? "", key_topics: g.key_topics ?? [] })),
        output_language: req.output_language ?? "en-US",
      });
      const parsed = ReportSuggestionsOutputSchema.safeParse(out);
      if (!parsed.success) throw new ReportGenerationError("The suggestion model returned invalid output.");
      return parsed.data.suggestions;
    },
  };
}

/**
 * Dynamic report suggestions (FR-ST-11, FR-009, FR-018). Cached by the full scope key (notebook, source revisions,
 * subject, output language); pending guides → loading (not cached); failed guides, invalid output, a timeout or
 * no configured model → unavailable (owner default 2026-10-20: never an endless loading state).
 */
export class ReportSuggestionService {
  private readonly cache = new Map<string, ReportSuggestionsResult>();

  private readonly deps: { guides: SourceGuideProvider; model?: ReportSuggestionModel | undefined; timeoutMs?: number };
  constructor(deps: { guides: SourceGuideProvider; model?: ReportSuggestionModel | undefined; timeoutMs?: number }) {
    this.deps = deps;
  }

  async getSuggestions(req: SuggestionRequest): Promise<ReportSuggestionsResult> {
    const model = this.deps.model;
    if (!model) return { state: "SuggestionsUnavailable", reason: SUGGESTIONS_NOT_CONFIGURED };
    const key = computeContextCacheKey({
      notebook_id: req.notebook_id,
      source_revisions: req.snapshot,
      subject: req.owner_id,
      language: req.output_language ?? "default",
      generation_parameters: { kind: "report_suggestions" },
    });
    const cached = this.cache.get(key);
    if (cached) return structuredClone(cached);

    const unavailable: ReportSuggestionsResult = { state: "SuggestionsUnavailable", reason: SUGGESTIONS_FAILED };
    let guides: SourceGuideState[];
    try {
      guides = await this.deps.guides.getGuides(req.notebook_id, req.snapshot, req.output_language);
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
        model.suggest({ guides, output_language: req.output_language, signal: controller.signal }),
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
