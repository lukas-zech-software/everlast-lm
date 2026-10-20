import type { ReportSubtype, ReportSuggestion, SourceGuideState, UnifiedDocumentChunk } from "@everlast/contracts";

export type FindingKind = "summary" | "fact" | "quote" | "term" | "event" | "person" | "qa" | "risk";

/** A claim extracted from exactly one chunk; `quote`/`date` must be literal substrings of it. */
export interface Finding {
  kind: FindingKind;
  text: string;
  chunk_id: string;
  source_id: string;
  quote?: string;
  date?: string;
  question?: string;
}

export interface ReportItem {
  text: string;
  chunk_id: string;
  quote?: string;
  date?: string;
  question?: string;
}

export interface ReportTable {
  columns: string[];
  rows: { cells: string[]; chunk_id: string }[];
}

/** One composed section; `id` is the stable section key (C-03 payload `sections`), `heading` an optional localized one. */
export interface ReportBlock {
  id: string;
  heading?: string;
  items: ReportItem[];
  table?: ReportTable;
}

export interface ExtractRequest {
  subtype: ReportSubtype;
  custom_prompt?: string | undefined;
  /** Effective output language (FR-UI-02). */
  output_language?: string | undefined;
  chunks: UnifiedDocumentChunk[];
  signal: AbortSignal;
}

export interface ComposeRequest {
  subtype: ReportSubtype;
  custom_prompt?: string | undefined;
  output_language?: string | undefined;
  findings: Finding[];
  signal: AbortSignal;
}

export interface SuggestRequest {
  guides: SourceGuideState[];
  output_language?: string | undefined;
  signal: AbortSignal;
}

/** Report model boundary (map: extract per bounded batch, reduce: compose). Outputs are validated before use. */
export interface ReportModelClient {
  extract(request: ExtractRequest): Promise<Finding[]>;
  compose(request: ComposeRequest): Promise<ReportBlock[]>;
}

/** Dynamic report suggestions from Source Guide metadata (FR-ST-11, Flash-Lite). */
export interface ReportSuggestionModel {
  suggest(request: SuggestRequest): Promise<ReportSuggestion[]>;
}

/** Invalid or failed model output; carries no upstream text (NFR-SEC-01). */
export class ReportGenerationError extends Error {
  constructor(message = "The report model returned invalid output.") {
    super(message);
    this.name = "ReportGenerationError";
  }
}
