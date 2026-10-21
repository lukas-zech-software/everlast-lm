import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  DEFAULT_COPIED_TEXT_TITLE,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  countWords,
  mediaTypeForFileName,
  type SourceDto,
} from "@everlast/contracts";
import {
  acceptReceivedSource,
  getNotebook,
  getSource,
  listSources,
  readSourceForInspection,
  reserveSources,
  type SourceRecord,
} from "@everlast/db";
import { readJson, sendJson, validationError } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/**
 * Source ingestion and inspection routes (FR-SI-01, FR-SI-03, FR-SI-04, FR-WM-07, C-02).
 * Slots are reserved through the 1.1 ledger before any upload capability is issued; actual bytes are
 * verified from storage metadata on completion; extraction and word limits run in the trusted worker.
 */

export const UPLOAD_TTL_SECONDS = 3600;
const COPIED_TEXT_BODY_LIMIT = 16 * 1024 * 1024;

export function toSourceDto(record: SourceRecord): SourceDto {
  return {
    id: record.id,
    notebook_id: record.notebook_id,
    title: record.title,
    media_type: record.media_type,
    status: record.status,
    byte_size: record.actual_bytes ?? record.declared_bytes,
    word_count: record.word_count,
    revision: record.active_revision,
    error: record.failure_code ? { code: record.failure_code, message: record.failure_message ?? "" } : null,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function rawObjectName(notebookId: string, sourceId: string): string {
  return `notebooks/${notebookId}/sources/${sourceId}/raw`;
}

const UploadBody = z
  .object({
    files: z
      .array(
        z
          .object({
            attempt_id: z.string().uuid(),
            file_name: z.string().min(1).max(1024),
            declared_bytes: z.number().int().nonnegative(),
          })
          .strict()
      )
      .min(1)
      .max(300),
  })
  .strict();

const CompleteBody = z.object({ attempt_id: z.string().uuid() }).strict();
const TextBody = z.object({ attempt_id: z.string().uuid(), text: z.string() }).strict();

export function registerSourceRoutes(router: Router, deps: AppDeps): void {
  const storage = () => {
    if (!deps.storage) throw new AppError("RetryableFailure", 503, "Storage is not configured");
    return deps.storage;
  };

  /** Release v2 (FR-WM-02): a source write advances the notebook's modified time. */
  const sourceWritten = async (userId: string, notebookId: string) => {
    if (deps.v2) await deps.v2.notebookModified(userId, await getNotebook(deps.pool, userId, notebookId));
  };

  router.add("GET", "/api/notebooks/:id/sources", async ({ res, user, params }) => {
    const sources = await listSources(deps.pool, user.userId, params.id!);
    if (deps.v2) {
      // Release v2 (D16): Ready counts, Source Guides and the topic icon follow the sources the owner sees.
      deps.v2.syncNotebook(user.userId, await getNotebook(deps.pool, user.userId, params.id!));
      deps.v2.syncSources(user.userId, params.id!, sources);
    }
    sendJson(res, 200, { sources: sources.map(toSourceDto) });
  });

  router.add("GET", "/api/notebooks/:id/sources/:sourceId", async ({ res, user, params }) => {
    sendJson(res, 200, { source: toSourceDto(await getSource(deps.pool, user.userId, params.id!, params.sourceId!)) });
  });

  router.add("POST", "/api/notebooks/:id/sources/uploads", async ({ req, res, user, params }) => {
    const parsed = UploadBody.safeParse(await readJson(req));
    if (!parsed.success) throw validationError("files must list {attempt_id, file_name, declared_bytes}");
    const notebookId = params.id!;
    const items: Record<string, unknown>[] = new Array(parsed.data.files.length);
    const admissible: { index: number; entry: Parameters<typeof reserveSources>[3][number] }[] = [];

    parsed.data.files.forEach((file, index) => {
      const mediaType = mediaTypeForFileName(file.file_name);
      if (!mediaType) {
        items[index] = {
          attempt_id: file.attempt_id,
          admitted: false,
          error: { code: "UnsupportedMediaType", message: "Only PDF, .txt and Markdown files are supported" },
        };
      } else if (file.declared_bytes > MAX_SOURCE_BYTES) {
        // Rejected before any capability is issued (FR-WM-07: <= 200 ms, no slot consumed).
        items[index] = {
          attempt_id: file.attempt_id,
          admitted: false,
          error: { code: "SourceOversized", message: "File exceeds the 200 MB limit" },
        };
      } else {
        admissible.push({
          index,
          entry: { attempt_id: file.attempt_id, title: file.file_name.trim(), media_type: mediaType, declared_bytes: file.declared_bytes },
        });
      }
    });

    if (admissible.length > 0) {
      const results = await reserveSources(
        deps.pool,
        user.userId,
        notebookId,
        admissible.map((a) => a.entry),
        { sourceLimit: deps.config.sourceLimit, uploadTtlSeconds: UPLOAD_TTL_SECONDS }
      );
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const item: Record<string, unknown> = { attempt_id: result.attempt_id, admitted: result.admitted };
        if (result.source) item.source = toSourceDto(result.source);
        if (result.error) item.error = result.error;
        const source = result.source;
        if (result.admitted && source && source.status === "Uploading") {
          const expiresAt = source.upload_expires_at ? new Date(source.upload_expires_at) : new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
          if (expiresAt.getTime() > Date.now()) {
            item.upload = await storage().createUploadUrl(rawObjectName(notebookId, source.id), {
              contentType: source.media_type,
              maxBytes: MAX_SOURCE_BYTES,
              expiresAt,
            });
          } else {
            item.error = { code: "UploadExpired", message: "Upload capability expired; start a new upload" };
          }
        }
        items[admissible[i]!.index] = item;
      }
    }
    sendJson(res, 200, { items });
  });

  router.add("POST", "/api/notebooks/:id/sources/:sourceId/complete", async ({ req, res, user, params }) => {
    const parsed = CompleteBody.safeParse(await readJson(req));
    if (!parsed.success) throw validationError("attempt_id is required");
    const source = await getSource(deps.pool, user.userId, params.id!, params.sourceId!);
    if (source.attempt_id !== parsed.data.attempt_id) throw new AppError("ValidationFailed", 409, "attempt_id does not match this source");
    if (source.status !== "Uploading") {
      sendJson(res, 200, { source: toSourceDto(source) });
      return;
    }
    const objectName = rawObjectName(source.notebook_id, source.id);
    const metadata = await storage().stat(objectName);
    if (!metadata) throw new AppError("ValidationFailed", 409, "Upload has not been received");
    const outcome = await acceptReceivedSource(deps.pool, {
      sourceId: source.id,
      attemptId: source.attempt_id,
      actualBytes: metadata.size,
      objectName,
      objectGeneration: metadata.generation,
    });
    if (outcome.outcome === "rejected") {
      if (outcome.reason === "fenced") throw new AppError("NotebookNotFound", 404, "Notebook no longer exists");
      sendJson(res, 200, { source: toSourceDto(await getSource(deps.pool, user.userId, params.id!, params.sourceId!)) });
      return;
    }
    if (outcome.outcome === "failed") {
      for (const version of await storage().listVersions(`notebooks/${source.notebook_id}/sources/${source.id}/`)) {
        await storage().deleteVersion(version.name, version.generation).catch(() => undefined);
      }
    } else {
      deps.notifyJobs();
    }
    await sourceWritten(user.userId, source.notebook_id);
    sendJson(res, 200, { source: toSourceDto(outcome.source) });
  });

  router.add("POST", "/api/notebooks/:id/sources/text", async ({ req, res, user, params }) => {
    const parsed = TextBody.safeParse(await readJson(req, COPIED_TEXT_BODY_LIMIT));
    if (!parsed.success) throw validationError("Body must be {attempt_id, text}");
    const text = parsed.data.text;
    if (Array.from(text.trim()).length < 1) throw new AppError("ValidationFailed", 422, "Pasted text must contain at least one character");
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > MAX_SOURCE_BYTES) throw new AppError("SourceOversized", 413, "Exceeds 200,000,000 bytes limit");
    if (countWords(text) > MAX_SOURCE_WORDS) throw new AppError("SourceOversizedWords", 422, "Exceeds 500,000 words limit");

    const [result] = await reserveSources(
      deps.pool,
      user.userId,
      params.id!,
      [{ attempt_id: parsed.data.attempt_id, title: DEFAULT_COPIED_TEXT_TITLE, media_type: "copied_text", declared_bytes: bytes.length }],
      { sourceLimit: deps.config.sourceLimit, uploadTtlSeconds: null }
    );
    if (!result!.admitted || !result!.source) {
      const error = result!.error ?? { code: "SourceQuotaExceeded", message: "Source limit reached" };
      throw new AppError(error.code as never, error.code === "SourceQuotaExceeded" ? 409 : 422, error.message);
    }
    let source = result!.source;
    if (source.status === "Uploading") {
      const objectName = rawObjectName(source.notebook_id, source.id);
      const written = await storage().write(objectName, bytes, "text/plain; charset=utf-8");
      const outcome = await acceptReceivedSource(deps.pool, {
        sourceId: source.id,
        attemptId: source.attempt_id,
        actualBytes: written.size,
        objectName,
        objectGeneration: written.generation,
      });
      if (outcome.outcome === "processing" || outcome.outcome === "failed") source = outcome.source;
      deps.notifyJobs();
    }
    await sourceWritten(user.userId, params.id!);
    sendJson(res, 201, { source: toSourceDto(source) });
  });

  router.add("GET", "/api/notebooks/:id/sources/:sourceId/content", async ({ res, url, user, params }) => {
    const content = await readSourceForInspection(deps.pool, user.userId, params.id!, params.sourceId!, {
      highlightChunkId: url.searchParams.get("chunk_id") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    sendJson(res, 200, content);
  });
}

export function newAttemptId(): string {
  return randomUUID();
}
