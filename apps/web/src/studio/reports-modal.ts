import type { ReportSuggestion } from "@everlast/contracts";
import type { ArtifactDto, StudioApi } from "./api.js";

export type SuggestionState = "SuggestionsLoading" | "SuggestionsReady" | "SuggestionsUnavailable";
export const CUSTOM_PROMPT_MAX = 5000;

export interface ReportsModalOptions {
  api: StudioApi;
  notebookId: string;
  getActiveSourceIds: () => string[];
  outputLanguage?: string;
}

/** Reports modal state (FR-ST-11, FR-018): templates and custom prompt never wait on suggestions. */
export class ReportsModalController {
  suggestionState: SuggestionState = "SuggestionsLoading";
  suggestions: ReportSuggestion[] = [];
  prompt = "";

  constructor(private readonly options: ReportsModalOptions) {}

  get templatesEnabled(): boolean {
    return this.options.getActiveSourceIds().length > 0;
  }

  get canGenerate(): boolean {
    const length = Array.from(this.prompt).length;
    return this.templatesEnabled && this.prompt.trim().length > 0 && length <= CUSTOM_PROMPT_MAX;
  }

  setPrompt(text: string): void {
    this.prompt = text;
  }

  async loadSuggestions(): Promise<void> {
    this.suggestionState = "SuggestionsLoading";
    const ids = this.options.getActiveSourceIds();
    if (ids.length === 0) {
      this.suggestionState = "SuggestionsUnavailable";
      return;
    }
    try {
      const result = await this.options.api.suggestions(ids, this.options.outputLanguage);
      this.suggestionState = result.state;
      this.suggestions = result.state === "SuggestionsReady" ? result.suggestions : [];
    } catch {
      this.suggestionState = "SuggestionsUnavailable";
      this.suggestions = [];
    }
  }

  /** Pencil action: pre-fills the editable prompt from a suggestion. */
  editSuggestion(index: number): void {
    const s = this.suggestions[index];
    if (s) this.prompt = s.prompt_template;
  }

  generate(): Promise<ArtifactDto> {
    if (!this.canGenerate) throw new Error("Prompt must be 1–5,000 characters and at least one source must be active.");
    return this.options.api.create({
      plugin_type: "report",
      subtype: "custom",
      active_source_ids: this.options.getActiveSourceIds(),
      custom_prompt: this.prompt,
      ...(this.options.outputLanguage ? { output_language: this.options.outputLanguage } : {}),
    });
  }
}
