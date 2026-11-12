import { createHash } from "node:crypto";
import {
  acceptReceivedSource,
  failSource,
  getSourceById,
  publishReadySource,
  type Pool,
  type PublishChunk,
  type SourceRecord,
} from "@everlast/db";
import { MAX_SOURCE_BYTES, MAX_SOURCE_WORDS } from "@everlast/contracts";
import type { Embedder, ObjectStorage } from "@everlast/cloud";
import { chunkDocumentAnchored } from "./chunker.ts";
import { IngestionFailure, MSG_NO_TEXT, MSG_TOO_MANY_WORDS, countWords, extractPlainText, type CanonicalDocument } from "./normalizer.ts";

/**
 * Note → source conversion (FR-NM-03, FR-SI-01, C-01, FR-WM-07; owner decision 2026-10-20, D16, D21).
 * The caller has reserved an `Uploading` v1 source row with `media_type: note_markdown`. This writes the combined
 * Markdown as the raw object, receives it, normalizes it (Markdown sections, 300–600-token chunks), embeds with
 * RETRIEVAL_DOCUMENT and publishes atomically to `Ready` through the existing fenced publication. Any failure marks
 * the source Failed (slot released) and purges its objects; nothing is retried later. Persistence adapter: all SQL
 * stays behind `@everlast/db`; callers (API services) see only this function.
 */

export interface NoteSourceIngestDeps {
  pool: Pool;
  storage: ObjectStorage;
  embedder: Embedder;
}

export type NoteSourceIngestOutcome =
  | { status: "ready"; revision: number; chunks: number; words: number }
  | { status: "failed"; code: string; message: string }
  | { status: "stale"; reason: string };

export function noteSourceObjectPrefix(source: Pick<SourceRecord, "notebook_id" | "id">): string {
  return `notebooks/${source.notebook_id}/sources/${source.id}/`;
}

async function purge(storage: ObjectStorage, source: Pick<SourceRecord, "notebook_id" | "id">): Promise<void> {
  for (const version of await storage.listVersions(noteSourceObjectPrefix(source))) {
    await storage.deleteVersion(version.name, version.generation).catch(() => undefined);
  }
}

/** Same hash as the worker's pipeline so a note-source is indistinguishable from an uploaded Markdown source. */
function contentHashOf(doc: CanonicalDocument): string {
  const hash = createHash("sha256");
  for (const page of doc.pages) hash.update(`${page.page_number}\u0000${page.dom_selector ?? ""}\u0000${page.start_ms ?? ""}-${page.end_ms ?? ""}\u0000${page.text}\u0001`);
  return `sha256:${hash.digest("hex")}`;
}

export async function ingestNoteSource(deps: NoteSourceIngestDeps, input: { source: SourceRecord; markdown: string }): Promise<NoteSourceIngestOutcome> {
  const { source } = input;
  const objectName = `${noteSourceObjectPrefix(source)}raw`;
  const written = await deps.storage.write(objectName, Buffer.from(input.markdown, "utf8"), "text/markdown; charset=utf-8");
  const received = await acceptReceivedSource(deps.pool, {
    sourceId: source.id,
    attemptId: source.attempt_id,
    actualBytes: written.size,
    objectName,
    objectGeneration: written.generation,
  });
  if (received.outcome === "rejected") return { status: "stale", reason: received.reason };
  if (received.outcome === "failed") return { status: "failed", code: received.source.failure_code ?? "Failed", message: received.source.failure_message ?? "Failed" };

  const current = await getSourceById(deps.pool, source.id);
  if (!current) return { status: "stale", reason: "source_deleted" };
  if (current.attempt_id !== source.attempt_id) return { status: "stale", reason: "attempt_mismatch" };
  if (current.status !== "Processing") return { status: "stale", reason: `status_${current.status}` };

  const fail = async (code: string, message: string): Promise<NoteSourceIngestOutcome> => {
    await failSource(deps.pool, { sourceId: current.id, attemptId: current.attempt_id, code, message });
    await purge(deps.storage, current);
    return { status: "failed", code, message };
  };

  try {
    if (written.size > MAX_SOURCE_BYTES) throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
    const doc = extractPlainText(Buffer.from(input.markdown, "utf8"), "note_markdown");
    const words = doc.pages.reduce((sum, page) => sum + countWords(page.text), 0);
    if (words === 0) throw new IngestionFailure("NoExtractableText", MSG_NO_TEXT);
    if (words > MAX_SOURCE_WORDS) throw new IngestionFailure("SourceOversizedWords", MSG_TOO_MANY_WORDS);
    const revision = (current.active_revision ?? 0) + 1;
    const anchored = chunkDocumentAnchored(doc, current.id, revision);
    if (anchored.length === 0) throw new IngestionFailure("NoExtractableText", MSG_NO_TEXT);
    const embeddings = await deps.embedder.embed(
      anchored.map((c) => c.chunk.text),
      "RETRIEVAL_DOCUMENT"
    );
    const chunks: PublishChunk[] = anchored.map((c, i) => ({ chunk: c.chunk, embedding: embeddings[i]!, anchorPage: c.anchorPage }));
    const contentHash = contentHashOf(doc);
    const outcome = await publishReadySource(deps.pool, {
      sourceId: current.id,
      attemptId: current.attempt_id,
      revision,
      byteSize: written.size,
      wordCount: words,
      pageCount: doc.pageCount,
      embeddingModel: deps.embedder.model,
      pages: doc.pages.map((p) => ({ page_number: p.page_number, physical_page: p.physical_page, text: p.text, dom_selector: p.dom_selector, start_ms: p.start_ms, end_ms: p.end_ms })),
      chunks,
      manifest: {
        contentHash,
        viewerKind: "pages",
        mediaDurationMs: null,
        mediaObjectName: null,
        mediaObjectGeneration: null,
        player: null,
        canonicalUrl: null,
        upstreamVersion: null,
      },
      operation: undefined,
      title: undefined,
    });
    if (!outcome.published) {
      if (outcome.reason === "fenced") await purge(deps.storage, current);
      return { status: "stale", reason: outcome.reason };
    }
    return { status: "ready", revision: outcome.revision, chunks: chunks.length, words };
  } catch (err) {
    if (err instanceof IngestionFailure) return fail(err.code, err.message);
    return fail("ProcessingError", "Processing failed");
  }
}
