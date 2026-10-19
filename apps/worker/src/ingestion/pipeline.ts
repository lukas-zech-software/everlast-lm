import type { Pool } from "@everlast/db";
import { failSource, getSourceById, publishReadySource, MAX_JOB_ATTEMPTS, type SourceRecord } from "@everlast/db";
import { MAX_SOURCE_BYTES, MAX_SOURCE_WORDS } from "@everlast/contracts";
import type { Embedder, ObjectStorage, OcrEngine } from "@everlast/cloud";
import {
  IngestionFailure,
  MSG_NO_TEXT,
  MSG_TOO_MANY_WORDS,
  countWords,
  extractPdf,
  extractPlainText,
  type CanonicalDocument,
} from "./extract.ts";
import { chunkDocument, type ChunkerOptions } from "./chunker.ts";

/**
 * Deterministic ingestion pipeline (FR-SI-01, FR-WM-07, C-01): read the received object, extract canonical
 * text (OCR for scanned PDF pages), enforce the inclusive word limit, chunk, embed with RETRIEVAL_DOCUMENT
 * and publish atomically. Failures transition to Failed exactly once and purge the source's objects.
 * No database lock is held during parsing, OCR or embedding.
 */

export interface IngestionDeps {
  pool: Pool;
  storage: ObjectStorage;
  embedder: Embedder;
  ocr: OcrEngine;
  chunker?: ChunkerOptions;
}

export type IngestOutcome =
  | { status: "ready"; revision: number; chunks: number; words: number }
  | { status: "failed"; code: string; message: string }
  | { status: "stale"; reason: string }
  | { status: "retry"; errorCode: string };

export function sourceObjectPrefix(source: Pick<SourceRecord, "notebook_id" | "id">): string {
  return `notebooks/${source.notebook_id}/sources/${source.id}/`;
}

async function purgeSourceObjects(storage: ObjectStorage, source: SourceRecord): Promise<void> {
  for (const version of await storage.listVersions(sourceObjectPrefix(source))) {
    await storage.deleteVersion(version.name, version.generation).catch(() => undefined);
  }
}

async function extract(deps: IngestionDeps, source: SourceRecord, bytes: Buffer): Promise<CanonicalDocument> {
  if (source.media_type === "application/pdf") return extractPdf(bytes, deps.ocr);
  return extractPlainText(bytes, source.media_type);
}

export async function processIngestJob(
  deps: IngestionDeps,
  payload: { source_id: string; attempt_id: string },
  attempt = 1
): Promise<IngestOutcome> {
  const source = await getSourceById(deps.pool, payload.source_id);
  if (!source) return { status: "stale", reason: "source_deleted" };
  if (source.attempt_id !== payload.attempt_id) return { status: "stale", reason: "attempt_mismatch" };
  if (source.status !== "Processing") return { status: "stale", reason: `status_${source.status}` };

  const fail = async (code: string, message: string): Promise<IngestOutcome> => {
    await failSource(deps.pool, { sourceId: source.id, attemptId: source.attempt_id, code, message });
    await purgeSourceObjects(deps.storage, source);
    return { status: "failed", code, message };
  };

  try {
    if (!source.object_name || !source.object_generation) return fail("Unreadable", "Could not read file (password-protected or corrupted)");
    const bytes = await deps.storage.read(source.object_name, source.object_generation);
    if (bytes.length > MAX_SOURCE_BYTES) return fail("SourceOversized", "Exceeds 200,000,000 bytes limit");

    const doc = await extract(deps, source, bytes);
    const words = doc.pages.reduce((sum, page) => sum + countWords(page.text), 0);
    if (words === 0) return fail("NoExtractableText", MSG_NO_TEXT);
    if (words > MAX_SOURCE_WORDS) return fail("SourceOversizedWords", MSG_TOO_MANY_WORDS);

    const revision = (source.active_revision ?? 0) + 1;
    const chunks = chunkDocument(doc, source.id, revision, deps.chunker);
    if (chunks.length === 0) return fail("NoExtractableText", MSG_NO_TEXT);
    const embeddings = await deps.embedder.embed(
      chunks.map((c) => c.text),
      "RETRIEVAL_DOCUMENT"
    );

    const outcome = await publishReadySource(deps.pool, {
      sourceId: source.id,
      attemptId: source.attempt_id,
      revision,
      byteSize: bytes.length,
      wordCount: words,
      pageCount: doc.pageCount,
      embeddingModel: deps.embedder.model,
      pages: doc.pages.map((p) => ({ page_number: p.page_number, physical_page: p.physical_page, text: p.text })),
      chunks: chunks.map((chunk, i) => ({ chunk, embedding: embeddings[i]! })),
    });
    if (!outcome.published) {
      // Deleted notebook, replaced attempt or cancelled source: never publish late, remove our objects.
      if (outcome.reason === "fenced") await purgeSourceObjects(deps.storage, source);
      return { status: "stale", reason: outcome.reason };
    }
    return { status: "ready", revision: outcome.revision, chunks: chunks.length, words };
  } catch (err) {
    if (err instanceof IngestionFailure) return fail(err.code, err.message);
    const errorCode = (err as Error).name === "OcrUnavailableError" ? "OcrUnavailable" : "ProcessingError";
    if (errorCode === "OcrUnavailable" || attempt >= MAX_JOB_ATTEMPTS) {
      return fail(errorCode, errorCode === "OcrUnavailable" ? "Scanned pages could not be processed" : "Processing failed");
    }
    console.error(JSON.stringify({ severity: "WARNING", source_id: source.id, error: (err as Error).name }));
    return { status: "retry", errorCode };
  }
}
