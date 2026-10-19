import type { NoteSourceIngestor } from "@everlast/contracts";
import type { IngestionPipeline } from "./pipeline.js";

/** Adapts the Markdown ingestion path (FR-SI-01) to the note conversion port (FR-NM-03, C-01). */
export function createNoteMarkdownIngestor(pipeline: IngestionPipeline): NoteSourceIngestor {
  return {
    async ingest(input) {
      const r = await pipeline.process({
        attempt_id: input.attempt_id,
        notebook_id: input.notebook_id,
        source_id: input.source_id,
        revision_id: input.revision_id,
        title: input.title,
        media_type: "text/markdown",
        content: input.markdown,
      });
      return {
        status: r.status === "Ready" ? "Ready" : "Failed",
        byte_size: r.byte_size,
        word_count: r.word_count,
        chunks: r.chunks,
        ...(r.error_message !== undefined ? { error_message: r.error_message } : {}),
      };
    },
  };
}
