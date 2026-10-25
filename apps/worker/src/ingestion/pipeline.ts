import { createHash } from "node:crypto";
import type { Pool } from "@everlast/db";
import {
  claimSourceOperation,
  failSource,
  failSourceOperation,
  getSourceById,
  publishReadySource,
  releaseOperationLease,
  renewOperationLease,
  setImportedMediaType,
  setOperationProgress,
  setSourceProgress,
  MAX_JOB_ATTEMPTS,
  type PublishChunk,
  type RevisionManifest,
  type SourceRecord,
} from "@everlast/db";
import {
  AppError,
  CONTENT_QUARANTINED_MESSAGE,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  isAudioMediaType,
  isOfficeMediaType,
  type SourceProgress,
  type ViewerKind,
} from "@everlast/contracts";
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
import { chunkDocumentAnchored, chunkTranscript, type ChunkerOptions } from "./chunker.ts";
import type { ContentScreener } from "./screening.ts";

/**
 * Deterministic ingestion pipeline (FR-SI-01, FR-WM-07, C-01): read or fetch the source, normalize it to canonical
 * pages (format adapters), enforce the inclusive word limit, screen external content (fail closed), chunk, embed
 * with RETRIEVAL_DOCUMENT and publish atomically. Failures transition to Failed exactly once and purge the source's
 * objects. No database lock is held during fetching, parsing, transcription, screening or embedding.
 *
 * v3 (specs/009): uploads of DOCX/PPTX/MP3/WAV/M4A and linked Web/Video/Drive imports route through an adapter
 * registry; linked imports run under their durable source operation (lease + fencing token). Initial imports keep
 * the Processing-only publication path; re-sync uses the Ready-preserving path in `sync.ts`.
 */

/** A format adapter's complete normalized output; nothing is published until every check passed. */
export interface NormalizedSource {
  doc: CanonicalDocument;
  viewerKind: ViewerKind;
  /** Actual input bytes (upload object or fetched body), checked against the inclusive 200,000,000-byte limit. */
  byteSize: number;
  /** External/linked content is screened for prompt injection before indexing (Constitution VI). */
  screen: boolean;
  title?: string | undefined;
  canonicalUrl?: string | undefined;
  mediaType?: string | undefined;
  mediaDurationMs?: number | null | undefined;
  mediaObject?: { name: string; generation: string } | null | undefined;
  player?: Record<string, unknown> | null | undefined;
  upstreamVersion?: string | null | undefined;
}

export interface AdapterContext {
  source: SourceRecord;
  deps: IngestionDeps;
  /** Reports a progress substate (Fetching/Transcribing/Parsing). */
  progress(progress: SourceProgress): Promise<void>;
  /** Raw upload bytes (uploads only; linked sources fetch their own content). */
  readUpload(): Promise<Buffer>;
}

export type SourceAdapter = (ctx: AdapterContext) => Promise<NormalizedSource>;

export type AdapterKey = "office" | "audio" | "web" | "video" | "drive";

export interface IngestionDeps {
  pool: Pool;
  storage: ObjectStorage;
  embedder: Embedder;
  ocr: OcrEngine;
  chunker?: ChunkerOptions;
  /** v3 format adapters (specs/009). A missing adapter fails that source type clearly; v1 types never need one. */
  adapters?: Partial<Record<AdapterKey, SourceAdapter>> | undefined;
  /** Prompt-injection screening of external content (Model Armor in production). Absent → external content fails closed. */
  screener?: ContentScreener | undefined;
  /** Lease for linked-import operations (seconds). */
  leaseSeconds?: number;
}

export type IngestOutcome =
  | { status: "ready"; revision: number; chunks: number; words: number }
  | { status: "failed"; code: string; message: string }
  | { status: "stale"; reason: string }
  | { status: "busy" }
  | { status: "retry"; errorCode: string };

export function sourceObjectPrefix(source: Pick<SourceRecord, "notebook_id" | "id">): string {
  return `notebooks/${source.notebook_id}/sources/${source.id}/`;
}

export async function purgeSourceObjects(storage: ObjectStorage, source: Pick<SourceRecord, "notebook_id" | "id">): Promise<void> {
  for (const version of await storage.listVersions(sourceObjectPrefix(source))) {
    await storage.deleteVersion(version.name, version.generation).catch(() => undefined);
  }
}

export class AdapterUnavailableError extends Error {
  constructor(key: string) {
    super(`No ${key} adapter is configured`);
    this.name = "AdapterUnavailableError";
  }
}

export function adapterKeyFor(source: Pick<SourceRecord, "media_type" | "link_kind">): AdapterKey | null {
  if (source.link_kind === "web") return "web";
  if (source.link_kind === "video") return "video";
  if (source.link_kind === "drive") return "drive";
  if (isOfficeMediaType(source.media_type)) return "office";
  if (isAudioMediaType(source.media_type)) return "audio";
  return null;
}

/** Deterministic hash of the normalized viewer content (unchanged-upstream detection on re-sync). */
export function contentHashOf(doc: CanonicalDocument): string {
  const hash = createHash("sha256");
  for (const page of doc.pages) hash.update(`${page.page_number}\u0000${page.dom_selector ?? ""}\u0000${page.start_ms ?? ""}-${page.end_ms ?? ""}\u0000${page.text}\u0001`);
  return `sha256:${hash.digest("hex")}`;
}

/** Normalizes one source through v1 extraction or its v3 adapter. */
export async function normalizeSource(deps: IngestionDeps, source: SourceRecord, progress: (p: SourceProgress) => Promise<void>): Promise<NormalizedSource> {
  const readUpload = async () => {
    if (!source.object_name || !source.object_generation) throw new IngestionFailure("Unreadable", "Could not read file (password-protected or corrupted)");
    const bytes = await deps.storage.read(source.object_name, source.object_generation);
    if (bytes.length > MAX_SOURCE_BYTES) throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
    return bytes;
  };
  const key = adapterKeyFor(source);
  if (key) {
    const adapter = deps.adapters?.[key];
    if (!adapter) throw new AdapterUnavailableError(key);
    return adapter({ source, deps, progress, readUpload });
  }
  const bytes = await readUpload();
  const doc =
    source.media_type === "application/pdf"
      ? await extractPdf(bytes, deps.ocr)
      : extractPlainText(bytes, source.media_type as "text/plain" | "text/markdown" | "copied_text" | "note_markdown");
  return { doc, viewerKind: "pages", byteSize: bytes.length, screen: false };
}

export interface PreparedRevision {
  normalized: NormalizedSource;
  words: number;
  contentHash: string;
  chunks: PublishChunk[];
  manifest: RevisionManifest;
}

/**
 * Validates, screens, chunks and embeds a normalized source for a given revision. Throws IngestionFailure for
 * every user-visible rejection; nothing is written.
 */
export async function prepareRevision(deps: IngestionDeps, source: SourceRecord, normalized: NormalizedSource, revision: number): Promise<PreparedRevision> {
  if (normalized.byteSize > MAX_SOURCE_BYTES) throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
  const doc = normalized.doc;
  const words = doc.pages.reduce((sum, page) => sum + countWords(page.text), 0);
  if (words === 0) throw new IngestionFailure("NoExtractableText", MSG_NO_TEXT);
  if (words > MAX_SOURCE_WORDS) throw new IngestionFailure("SourceOversizedWords", MSG_TOO_MANY_WORDS);

  if (normalized.screen) {
    if (!deps.screener) throw new IngestionFailure("ScreeningUnavailable", "Content safety screening is unavailable; the source was not indexed");
    let verdict;
    try {
      verdict = await deps.screener.screen(doc.pages.map((p) => p.text));
    } catch {
      throw new IngestionFailure("ScreeningUnavailable", "Content safety screening is unavailable; the source was not indexed");
    }
    if (verdict.verdict !== "clean") throw new IngestionFailure("ContentQuarantined", CONTENT_QUARANTINED_MESSAGE);
  }

  const anchored = normalized.viewerKind === "transcript" ? chunkTranscript(doc, source.id, revision) : chunkDocumentAnchored(doc, source.id, revision, deps.chunker);
  if (anchored.length === 0) throw new IngestionFailure("NoExtractableText", MSG_NO_TEXT);
  const embeddings = await deps.embedder.embed(
    anchored.map((c) => c.chunk.text),
    "RETRIEVAL_DOCUMENT"
  );
  const contentHash = contentHashOf(doc);
  return {
    normalized,
    words,
    contentHash,
    chunks: anchored.map((c, i) => ({ chunk: c.chunk, embedding: embeddings[i]!, anchorPage: c.anchorPage })),
    manifest: {
      contentHash,
      viewerKind: normalized.viewerKind,
      mediaDurationMs: normalized.mediaDurationMs ?? null,
      mediaObjectName: normalized.mediaObject?.name ?? null,
      mediaObjectGeneration: normalized.mediaObject?.generation ?? null,
      player: normalized.player ?? null,
      canonicalUrl: normalized.canonicalUrl ?? null,
      upstreamVersion: normalized.upstreamVersion ?? null,
    },
  };
}

export function toPublishPages(doc: CanonicalDocument) {
  return doc.pages.map((p) => ({
    page_number: p.page_number,
    physical_page: p.physical_page,
    text: p.text,
    dom_selector: p.dom_selector,
    start_ms: p.start_ms,
    end_ms: p.end_ms,
  }));
}

export async function processIngestJob(
  deps: IngestionDeps,
  payload: { source_id: string; attempt_id: string; operation_id?: string | undefined },
  attempt = 1
): Promise<IngestOutcome> {
  const source = await getSourceById(deps.pool, payload.source_id);
  if (!source) return { status: "stale", reason: "source_deleted" };
  if (source.attempt_id !== payload.attempt_id) return { status: "stale", reason: "attempt_mismatch" };
  if (source.status !== "Processing") return { status: "stale", reason: `status_${source.status}` };

  // Linked imports run under their durable operation: a redelivered job resumes it, a live lease is not stolen.
  let operation: { id: string; fencingToken: number } | undefined;
  if (payload.operation_id) {
    const claim = await claimSourceOperation(deps.pool, payload.operation_id, { leaseSeconds: deps.leaseSeconds ?? 900 });
    if (claim.status === "busy") return { status: "busy" };
    if (claim.status !== "claimed") return { status: "stale", reason: `operation_${claim.status}` };
    operation = { id: payload.operation_id, fencingToken: claim.fencingToken };
  }

  const fail = async (code: string, message: string): Promise<IngestOutcome> => {
    if (operation) await failSourceOperation(deps.pool, { operationId: operation.id, fencingToken: operation.fencingToken, code, message });
    else await failSource(deps.pool, { sourceId: source.id, attemptId: source.attempt_id, code, message });
    await purgeSourceObjects(deps.storage, source);
    return { status: "failed", code, message };
  };
  const progress = async (p: SourceProgress) => {
    if (operation) {
      await setOperationProgress(deps.pool, { operationId: operation.id, fencingToken: operation.fencingToken, progress: p });
      await renewOperationLease(deps.pool, { operationId: operation.id, fencingToken: operation.fencingToken, leaseSeconds: deps.leaseSeconds ?? 900 });
    } else {
      await setSourceProgress(deps.pool, source.id, source.attempt_id, p);
    }
  };

  try {
    const normalized = await normalizeSource(deps, source, progress);
    const revision = (source.active_revision ?? 0) + 1;
    if (adapterKeyFor(source)) await progress("Parsing");
    const prepared = await prepareRevision(deps, source, normalized, revision);
    if (normalized.mediaType && normalized.mediaType !== source.media_type) {
      await setImportedMediaType(deps.pool, source.id, source.attempt_id, normalized.mediaType);
    }

    const outcome = await publishReadySource(deps.pool, {
      sourceId: source.id,
      attemptId: source.attempt_id,
      revision,
      byteSize: normalized.byteSize,
      wordCount: prepared.words,
      pageCount: normalized.doc.pageCount,
      embeddingModel: deps.embedder.model,
      pages: toPublishPages(normalized.doc),
      chunks: prepared.chunks,
      manifest: prepared.manifest,
      operation,
      title: source.link_kind ? normalized.title : undefined,
    });
    if (!outcome.published) {
      // Deleted notebook/source, replaced attempt, stale fencing token: never publish late, remove our objects.
      if (outcome.reason === "fenced") await purgeSourceObjects(deps.storage, source);
      return { status: "stale", reason: outcome.reason };
    }
    return { status: "ready", revision: outcome.revision, chunks: prepared.chunks.length, words: prepared.words };
  } catch (err) {
    if (err instanceof IngestionFailure || (err instanceof AppError && err.code === "DelegatedAccessDenied")) return fail(err.code, err.message);
    const name = (err as Error).name;
    const errorCode = name === "OcrUnavailableError" ? "OcrUnavailable" : name === "AdapterUnavailableError" ? "AdapterUnavailable" : "ProcessingError";
    if (errorCode === "OcrUnavailable" || attempt >= MAX_JOB_ATTEMPTS) {
      const message =
        errorCode === "OcrUnavailable" ? "Scanned pages could not be processed" : errorCode === "AdapterUnavailable" ? "This source type is not available" : "Processing failed";
      return fail(errorCode, message);
    }
    console.error(JSON.stringify({ severity: "WARNING", source_id: source.id, error: name }));
    if (operation) await releaseOperationLease(deps.pool, { operationId: operation.id, fencingToken: operation.fencingToken });
    return { status: "retry", errorCode };
  }
}
