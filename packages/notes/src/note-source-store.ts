import type { Citation, NoteSource, NoteSourceOrigin } from "@everlast/contracts";

/** Port: note-sources as v1 sources (FR-NM-03, FR-WM-07, D21). The API service depends only on this interface. */
export interface NoteSourceStore {
  /** Occupied (Uploading, Processing, Ready) and maximum source slots of the notebook. */
  slots(notebookId: string): Promise<{ used: number; limit: number }>;
  /** A Ready note-source converted from exactly these notes at these revisions (FR-NM-04 reuse), else null. */
  findReusable(ownerId: string, notebookId: string, origins: NoteSourceOrigin[]): Promise<NoteSource | null>;
  /** Reserves one slot, ingests the Markdown to Ready; throws SourceQuotaExceededError or an ingestion error. */
  create(
    ownerId: string,
    notebookId: string,
    input: { title: string; markdown: string; origin_notes: NoteSourceOrigin[]; origin_citations: Citation[] }
  ): Promise<NoteSource>;
}
