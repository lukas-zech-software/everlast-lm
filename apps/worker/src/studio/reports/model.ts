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

export interface ReportBlock {
  id: string;
  items: ReportItem[];
  table?: ReportTable;
}

export interface ExtractRequest {
  subtype: ReportSubtype;
  custom_prompt?: string | undefined;
  chunks: UnifiedDocumentChunk[];
  signal: AbortSignal;
}

export interface ComposeRequest {
  subtype: ReportSubtype;
  custom_prompt?: string | undefined;
  findings: Finding[];
  signal: AbortSignal;
}

export interface SuggestRequest {
  guides: SourceGuideState[];
  output_language?: string | undefined;
  signal: AbortSignal;
}

/** Injectable model boundary; a Gemini adapter is out of scope for this slice. */
export interface ReportModelClient {
  extract(request: ExtractRequest): Promise<Finding[]>;
  compose(request: ComposeRequest): Promise<ReportBlock[]>;
  suggest(request: SuggestRequest): Promise<ReportSuggestion[]>;
}
