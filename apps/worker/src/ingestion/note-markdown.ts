import { countWords, type NoteSourceIngestor } from "@everlast/contracts";
import { chunkDocument } from "./chunker.ts";
import { extractPlainText, IngestionFailure } from "./extract.ts";

/**
 * Note → source conversion over the Markdown ingestion path (FR-NM-03, FR-SI-01, C-01): same UTF-8 decoding,
 * logical pages and 300–600-token chunker as uploaded Markdown. Note sources are not embedded; they are read
 * whole through the note source registry (D16 proof of concept).
 */
export function createNoteMarkdownIngestor(): NoteSourceIngestor {
  return {
    async ingest(input) {
      const bytes = Buffer.from(input.markdown, "utf8");
      try {
        const doc = extractPlainText(bytes, "text/markdown");
        return {
          status: "Ready",
          byte_size: bytes.length,
          word_count: countWords(input.markdown),
          chunks: chunkDocument(doc, input.source_id, input.revision_id),
        };
      } catch (e) {
        if (!(e instanceof IngestionFailure)) throw e;
        return { status: "Failed", byte_size: bytes.length, word_count: 0, chunks: [], error_message: e.message };
      }
    },
  };
}
