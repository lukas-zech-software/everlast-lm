import { randomUUID } from "node:crypto";
import {
  AppError,
  NOTE_SOURCE_MEDIA_TYPE,
  SourceQuotaExceededError,
  type Citation,
  type NoteSource,
  type NoteSourceOrigin,
} from "@everlast/contracts";
import {
  countOccupiedSources,
  failSource,
  findReusableNoteSource,
  getNoteSourceProvenance,
  getSource,
  noteSourceOriginKey,
  recordNoteSourceProvenance,
  reserveSources,
  type Pool,
  type SourceRecord,
} from "@everlast/db";
import type { Embedder, ObjectStorage } from "@everlast/cloud";
import { ingestNoteSource } from "@everlast/worker/ingestion/note-markdown";
import type { NoteSourceStore } from "./service.ts";

/**
 * Note-sources as v1 PostgreSQL sources (FR-NM-03, FR-NM-04, FR-WM-07, FR-SI-01, C-01; owner decision 2026-10-20,
 * D16 amendment). One admission for uploads and note-sources: the slot is reserved with the v1 `reserveSources`
 * under the notebook row lock before ingestion, the combined Markdown runs through the v1 ingestion at once, and any
 * failure leaves the source Failed (slot released). The provenance row is written with the reservation so reuse
 * and the Left Panel see a consistent note-source.
 */

/** Ingestion failed; the source is Failed and its slot released. Carries no upstream detail (NFR-SEC-01). */
export class NoteSourceIngestionError extends Error {
  constructor() {
    super("The notes could not be converted to a source. Please try again.");
    this.name = "NoteSourceIngestionError";
  }
}

export interface PostgresNoteSourcesOptions {
  pool: Pool;
  storage?: ObjectStorage | undefined;
  embedder?: Embedder | undefined;
  sourceLimit: number;
}

function toNoteSource(source: SourceRecord, origin_notes: NoteSourceOrigin[], origin_citations: Citation[]): NoteSource {
  return {
    id: source.id,
    notebook_id: source.notebook_id,
    title: source.title,
    media_type: NOTE_SOURCE_MEDIA_TYPE,
    status: source.status,
    revision_id: source.active_revision ?? 1,
    byte_size: source.actual_bytes ?? source.declared_bytes,
    word_count: source.word_count ?? 0,
    origin_notes,
    origin_citations,
    created_at: source.created_at,
  };
}

export function createPostgresNoteSources(options: PostgresNoteSourcesOptions): NoteSourceStore {
  const { pool } = options;
  return {
    async slots(notebookId) {
      return { used: await countOccupiedSources(pool, notebookId), limit: options.sourceLimit };
    },

    async findReusable(ownerId, notebookId, origins) {
      const id = await findReusableNoteSource(pool, ownerId, notebookId, noteSourceOriginKey(origins));
      if (!id) return null;
      const provenance = (await getNoteSourceProvenance(pool, notebookId, [id])).get(id);
      return toNoteSource(await getSource(pool, ownerId, notebookId, id), provenance?.origin_notes ?? origins, provenance?.origin_citations ?? []);
    },

    async create(ownerId, notebookId, input) {
      if (!options.storage || !options.embedder) throw new AppError("RetryableFailure", 503, "Source ingestion is not configured");
      const bytes = Buffer.byteLength(input.markdown, "utf8");
      const [admission] = await reserveSources(
        pool,
        ownerId,
        notebookId,
        [{ attempt_id: randomUUID(), title: input.title, media_type: NOTE_SOURCE_MEDIA_TYPE, declared_bytes: bytes }],
        { sourceLimit: options.sourceLimit, uploadTtlSeconds: null }
      );
      if (!admission?.admitted || !admission.source) {
        if (admission?.error?.code === "SourceQuotaExceeded") throw new SourceQuotaExceededError(admission.error.message);
        throw new AppError("ValidationFailed", 422, admission?.error?.message ?? "The note-source was not admitted");
      }
      const reserved = admission.source;
      await recordNoteSourceProvenance(pool, {
        notebook_id: notebookId,
        source_id: reserved.id,
        origin_notes: input.origin_notes,
        origin_citations: input.origin_citations,
      });
      let outcome;
      try {
        outcome = await ingestNoteSource({ pool, storage: options.storage, embedder: options.embedder }, { source: reserved, markdown: input.markdown });
      } catch {
        outcome = null;
      }
      if (outcome?.status !== "ready") {
        // Release the slot if the ingest job did not settle the source (storage or receipt failure).
        await failSource(pool, { sourceId: reserved.id, attemptId: reserved.attempt_id, code: "ProcessingError", message: "Processing failed" });
        const storage = options.storage;
        for (const version of await storage.listVersions(`notebooks/${notebookId}/sources/${reserved.id}/`).catch(() => [])) {
          await storage.deleteVersion(version.name, version.generation).catch(() => undefined);
        }
        throw new NoteSourceIngestionError();
      }
      return toNoteSource(await getSource(pool, ownerId, notebookId, reserved.id), input.origin_notes, input.origin_citations);
    },
  };
}
