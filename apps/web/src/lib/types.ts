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
  status: "available" | "deleted";
  source_title: string | null;
  snippet: string | null;
  locator: PageSpan | null;
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

export interface InspectorContent {
  source: { id: string; title: string; media_type: string; revision: number; page_count: number };
  pages: { page_number: number; physical_page?: number; text: string }[];
  chunks: { chunk_id: string; locator: PageSpan; text: string }[];
  highlight: { chunk_id: string; page_number: number; start_offset: number; end_offset: number } | null;
  next_cursor: string | null;
}
