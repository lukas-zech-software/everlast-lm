/** Wire types consumed by the SPA (mirrors packages/contracts DTOs and the chat API projection). */
export type { NotebookDto, QuotaSummary, SourceDto, UnifiedDocumentChunk } from "@everlast/contracts";

export interface PageSpan {
  page_number: number;
  physical_page?: number;
  start_offset: number;
  end_offset: number;
}

export interface Citation {
  badge_number: number;
  source_id: string;
  chunk_id: string;
  /** `updated`: the cited revision was replaced by a re-sync (FR-SI-05); `deleted`: removed or revoked. */
  status: "available" | "updated" | "deleted";
  source_title: string | null;
  /** `note_markdown` marks a note-source (FR-NM-04 `Note` label). */
  source_media_type?: string | null;
  snippet: string | null;
  locator: AnyLocator | null;
}

export interface ChatMessage {
  id: string;
  turn_id: string;
  role: "user" | "assistant";
  kind: "question" | "answer" | "refusal";
  content: string | null;
  unavailable_reason: "source_deleted" | null;
  citations: Citation[];
  created_at: string;
}

/** C-01 locator union as seen by the SPA (page_span, time_span, dom_path). */
export type AnyLocator = PageSpan | { start_ms: number; end_ms: number } | { selector: string; start_offset: number; end_offset: number };

export interface InspectorContent {
  source: {
    id: string;
    title: string;
    media_type: string;
    revision: number;
    page_count: number;
    /** v3 additive fields (specs/009). */
    viewer_kind?: "pages" | "article" | "transcript";
    link_kind?: string | null;
    external_url?: string | null;
    canonical_url?: string | null;
    last_synced_at?: string | null;
    media_duration_ms?: number | null;
  };
  pages: { page_number: number; physical_page?: number; text: string; dom_selector?: string; start_ms?: number; end_ms?: number }[];
  chunks: { chunk_id: string; locator: AnyLocator; text: string }[];
  highlight: {
    chunk_id: string;
    page_number: number;
    start_offset?: number;
    end_offset?: number;
    start_ms?: number;
    end_ms?: number;
    display_time?: string;
    selector?: string;
  } | null;
  next_cursor: string | null;
  transcript?: { page_number: number; start_ms: number; end_ms: number; display_time: string; text: string }[];
  player?:
    | { type: "audio"; url: string; duration_ms: number | null }
    | { type: "video"; url: string; duration_ms: number | null }
    | { type: "youtube"; video_id: string }
    | { type: "link"; url: string }
    | null;
}
