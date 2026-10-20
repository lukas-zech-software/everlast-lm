import { acceptReceivedSource, MAX_JOB_ATTEMPTS, type Pool, type SourceRecord } from "@everlast/db";
import type { Embedder, ObjectStorage, OcrEngine } from "@everlast/cloud";
import { processIngestJob, sourceObjectPrefix, type IngestOutcome } from "./pipeline.ts";

/**
 * Note → source conversion over the v1 ingestion (FR-NM-03, FR-SI-01, C-01; owner decision 2026-10-20, D16).
 * The caller has reserved an `Uploading` v1 source row with `media_type: note_markdown` (FR-WM-07). This writes the
 * combined Markdown as the raw object, receives it (Processing + durable ingest job) and runs the same ingest job
 * the worker runs, at once: Markdown sections, 300–600-token chunks, embeddings and the atomic Ready publication.
 * It runs as the final attempt, so any failure marks the source Failed (slot released) instead of retrying later;
 * the queued job then finds the settled source and does nothing.
 */

export interface NoteSourceIngestDeps {
  pool: Pool;
  storage: ObjectStorage;
  embedder: Embedder;
}

/** Markdown never needs OCR; the pipeline requires an engine for PDFs only. */
const NO_OCR: OcrEngine = { name: "none", recognize: async () => new Map() };

export async function ingestNoteSource(deps: NoteSourceIngestDeps, input: { source: SourceRecord; markdown: string }): Promise<IngestOutcome> {
  const { source } = input;
  const objectName = `${sourceObjectPrefix(source)}raw`;
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
  return processIngestJob({ ...deps, ocr: NO_OCR }, { source_id: source.id, attempt_id: source.attempt_id }, MAX_JOB_ATTEMPTS);
}
