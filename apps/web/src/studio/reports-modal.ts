import type { ReportSuggestion } from "@everlast/contracts";
import type { ArtifactDto, CreateBody, StudioApi } from "./api.ts";
import { CUSTOM_REPORT_PROMPT_MAX, REPORT_TEMPLATE_TYPES } from "../lib/v2-contracts.ts";

export type SuggestionState = "SuggestionsLoading" | "SuggestionsReady" | "SuggestionsUnavailable";
export type ReportTemplate = (typeof REPORT_TEMPLATE_TYPES)[number];
/** Prompted reports: an edited or used suggestion is `dynamic`, Create Your Own is `custom` (FR-ST-11 FR-011). */
export type PromptMode = "dynamic" | "custom";
export const CUSTOM_PROMPT_MAX = CUSTOM_REPORT_PROMPT_MAX;
/** Bounded polling while Source Guides are pending (FR-018): never an endless loading state. */
export const DEFAULT_MAX_LOADING_POLLS = 20;

const TEMPLATE_TEXT: Record<ReportTemplate, { label: string; description: string }> = {
  briefing_doc: { label: "Briefing doc", description: "Overview of your sources featuring key insights and quotes" },
  study_guide: { label: "Study guide", description: "Short-answer quiz, answer key, essay questions and glossary" },
  faq: { label: "FAQ", description: "Frequently asked questions with detailed answers" },
  timeline: { label: "Timeline", description: "Chronological events and a cast of characters" },
};
export const REPORT_TEMPLATES = REPORT_TEMPLATE_TYPES.map((subtype) => ({ subtype, ...TEMPLATE_TEXT[subtype] }));

export interface ReportsModalOptions {
  api: StudioApi;
  notebookId: string;
  /** The current explicit selection (C-02); read at request time, never cached. */
  getActiveSourceIds: () => string[];
  outputLanguage?: string;
  maxLoadingPolls?: number;
}

/** Trimmed code-point length of a prompt (FR-ST-11: 1–5,000 after trimming outer whitespace). */
export const promptCodePoints = (text: string): number => Array.from(text.trim()).length;

/** Reports modal state (FR-ST-11, FR-018): templates and custom prompt never wait on suggestions. */
export class ReportsModalController {
  suggestionState: SuggestionState = "SuggestionsLoading";
  suggestions: ReportSuggestion[] = [];
  /** Why suggestions are unavailable: no explicit scope, or the server/guides could not provide them. */
  unavailableReason: "scope" | "unavailable" | null = null;
  prompt = "";
  mode: PromptMode = "custom";
  private loadingPolls = 0;

  private readonly options: ReportsModalOptions;
  constructor(options: ReportsModalOptions) {
    this.options = options;
  }

  get templatesEnabled(): boolean {
    return this.options.getActiveSourceIds().length > 0;
  }

  get canGenerate(): boolean {
    const length = promptCodePoints(this.prompt);
    return this.templatesEnabled && length >= 1 && length <= CUSTOM_PROMPT_MAX;
  }

  setPrompt(text: string): void {
    this.prompt = text;
  }

  /** Create Your Own: an empty prompt sent as `custom`. */
  startCustom(): void {
    this.mode = "custom";
    this.prompt = "";
  }

  /** Starts a new suggestions cycle (modal opened or scope changed). */
  resetSuggestions(): void {
    this.suggestionState = "SuggestionsLoading";
    this.suggestions = [];
    this.unavailableReason = null;
    this.loadingPolls = 0;
  }

  /**
   * One suggestions read for the current explicit scope. `SuggestionsLoading` (pending Source Guides) may be polled
   * again by the caller; after `maxLoadingPolls` loading answers the state becomes unavailable.
   */
  async loadSuggestions(): Promise<SuggestionState> {
    const ids = this.options.getActiveSourceIds();
    if (ids.length === 0) {
      this.setUnavailable("scope");
      return this.suggestionState;
    }
    try {
      const result = await this.options.api.suggestions(ids, this.options.outputLanguage);
      if (result.state === "SuggestionsReady") {
        this.suggestionState = "SuggestionsReady";
        this.suggestions = result.suggestions;
        this.unavailableReason = null;
      } else if (result.state === "SuggestionsLoading") {
        this.loadingPolls += 1;
        if (this.loadingPolls >= (this.options.maxLoadingPolls ?? DEFAULT_MAX_LOADING_POLLS)) this.setUnavailable("unavailable");
        else this.suggestionState = "SuggestionsLoading";
      } else this.setUnavailable("unavailable");
    } catch {
      // A failed request or an unconfigured generation client (503) means unavailable, never endless loading.
      this.setUnavailable("unavailable");
    }
    return this.suggestionState;
  }

  private setUnavailable(reason: "scope" | "unavailable"): void {
    this.suggestionState = "SuggestionsUnavailable";
    this.suggestions = [];
    this.unavailableReason = reason;
  }

  /** Pencil action: pre-fills the editable prompt from a suggestion; the result is a `dynamic` report. */
  editSuggestion(index: number): void {
    const s = this.suggestions[index];
    if (!s) return;
    this.mode = "dynamic";
    this.prompt = s.prompt_template;
  }

  private body(fields: { subtype: "briefing_doc" | "study_guide" | "faq" | "timeline" | "dynamic" | "custom"; custom_prompt?: string }): CreateBody {
    const ids = this.options.getActiveSourceIds();
    if (ids.length === 0) throw new Error("Select at least one source.");
    return {
      plugin_type: "report",
      subtype: fields.subtype,
      active_source_ids: ids,
      ...(fields.custom_prompt !== undefined ? { custom_prompt: fields.custom_prompt } : {}),
      ...(this.options.outputLanguage ? { output_language: this.options.outputLanguage } : {}),
    };
  }

  /** One-click standard template (FR-ST-10). */
  generateTemplate(subtype: ReportTemplate): Promise<ArtifactDto> {
    return this.options.api.create(this.body({ subtype }));
  }

  /** Uses a suggestion as is (subtype `dynamic`). */
  generateSuggestion(index: number): Promise<ArtifactDto> {
    const s = this.suggestions[index];
    if (!s) throw new Error("Unknown suggestion.");
    return this.options.api.create(this.body({ subtype: "dynamic", custom_prompt: s.prompt_template.trim() }));
  }

  /** Generates the prompt editor's content as `custom` (Create Your Own) or `dynamic` (edited suggestion). */
  generate(): Promise<ArtifactDto> {
    if (!this.canGenerate) throw new Error("Prompt must be 1–5,000 characters and at least one source must be active.");
    return this.options.api.create(this.body({ subtype: this.mode, custom_prompt: this.prompt.trim() }));
  }
}
