import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ChatConfigurationSchema,
  FollowUpSuggestionsSchema,
  MessageFeedbackInputSchema,
  NotebookOverviewSchema,
  OutputLanguageSchema,
  SaveResponseNoteRequestSchema,
  SaveResponseNoteResponseSchema,
  SourceGuideSchema,
  NotebookSourceSelectionSchema,
  type ChatMessage,
  type Note,
  type SavedResponseNote,
} from "@everlast/contracts";
import {
  getChatConfiguration,
  getOverviewForUser,
  getSourceGuide,
  saveChatConfiguration,
  saveMessageFeedback,
  clearMessageFeedback,
  getChatMessages,
  getMessageFollowUps,
  saveMessageFollowUps,
} from "@everlast/db";
import { parseJsonBody, parseRequestUrl, sendJson } from "../http.ts";
import type { NotesService } from "../notes/service.ts";

const SourceRevisionListSchema = z.array(z.object({ source_id: z.string(), revision: z.number() }));

/**
 * Shared save-note route (FR-GC-09, FR-NM-02): writes the single Package 2.3 notes store and maps the note to
 * the stable 2.2 DTO, so the saved response is the record the notes panel lists.
 */
export function savedResponseNoteSaver(service: Pick<NotesService, "saveFromMessage">) {
  return async (input: {
    notebook_id: string;
    message_id: string;
    user_id: string;
  }): Promise<SavedResponseNote> => {
    const { note } = await service.saveFromMessage(
      input.notebook_id,
      input.user_id,
      input.message_id,
    );
    return toSavedResponseNote(note);
  };
}

function toSavedResponseNote(note: Note): SavedResponseNote {
  if (!note.source_message_id) {
    throw new Error("Saved response note is missing source_message_id");
  }
  return {
    id: note.id,
    notebook_id: note.notebook_id,
    source_message_id: note.source_message_id,
    title: note.title,
    content_md: note.content_md,
    citations_json: note.citations_json,
    origin_type: "saved_response",
    read_only: true,
    created_at: note.created_at,
  };
}

export interface PackageV22ApiDependencies {
  authorizeNotebook: (userId: string, notebookId: string) => Promise<boolean>;
  authorizeSource: (
    userId: string,
    notebookId: string,
    sourceId: string,
    revision?: number,
  ) => Promise<{ exists: boolean; ready: boolean; revision: number }>;
  listSources?: (userId: string, notebookId: string) => Promise<unknown[]>;
  generateOverview?: (input: {
    notebook_id: string;
    user_id: string;
    source_revisions: Array<{ source_id: string; revision: number }>;
    output_language: string;
  }) => Promise<unknown>;
  getConfiguration?: typeof getChatConfiguration;
  getGuide?: typeof getSourceGuide;
  getOverview?: typeof getOverviewForUser;
  saveConfiguration?: typeof saveChatConfiguration;
  saveFeedback?: typeof saveMessageFeedback;
  clearFeedback?: typeof clearMessageFeedback;
  /** Shared save-note writer (see `savedResponseNoteSaver`); absent → 503. */
  saveNote?: (input: {
    notebook_id: string;
    message_id: string;
    user_id: string;
  }) => Promise<SavedResponseNote>;
  generateFollowUps?: (input: {
    notebook_id: string;
    user_id: string;
    answer: string;
    source_revisions: Array<{ source_id: string; revision: number }>;
    output_language: string;
  }) => Promise<unknown>;
  /** Notebook's effective output language for the caller (FR-UI-02); default `en-US`. */
  resolveOutputLanguage?: (userId: string, notebookId: string) => Promise<string>;
  /** Starts Source Guide generation in the background for a language that has no guide yet (FR-SI-02). */
  startGuide?: (input: {
    notebook_id: string;
    user_id: string;
    source_id: string;
    revision: number;
    output_language: string;
  }) => void | Promise<void>;
  getFollowUps?: typeof getMessageFollowUps;
  saveFollowUps?: typeof saveMessageFollowUps;
  getThreadMessages?: (notebookId: string, userId: string) => Promise<ChatMessage[]>;
}

interface RouteCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  userId: string;
  notebookId: string;
  deps: PackageV22ApiDependencies;
}

function sendNotFound(res: ServerResponse, message = "Notebook not found"): true {
  sendJson(res, 404, { error: { code: "NotFound", message } });
  return true;
}

async function handleSourcesList(ctx: RouteCtx): Promise<true> {
  const { res, userId, notebookId, deps } = ctx;
  if (!(await deps.authorizeNotebook(userId, notebookId))) return sendNotFound(res);
  if (!deps.listSources) {
    sendJson(res, 503, {
      error: { code: "Unavailable", message: "Notebook source listing is not configured" },
    });
    return true;
  }
  const sources = await deps.listSources(userId, notebookId);
  const parsed = sources.map((source) => NotebookSourceSelectionSchema.parse(source));
  if (parsed.some((source) => source.notebook_id !== notebookId)) {
    sendJson(res, 403, {
      error: { code: "Forbidden", message: "Cross-notebook source list rejected" },
    });
    return true;
  }
  sendJson(res, 200, { sources: parsed });
  return true;
}

async function handleSourceGuide(ctx: RouteCtx, sourceId: string): Promise<true> {
  const { res, url, userId, notebookId, deps } = ctx;
  const requestedRevision = Number(url.searchParams.get("revision"));
  if (!Number.isSafeInteger(requestedRevision) || requestedRevision < 1) {
    sendJson(res, 400, {
      error: { code: "ValidationError", message: "revision must be a positive integer" },
    });
    return true;
  }
  const requestedLanguage = url.searchParams.get("language");
  if (requestedLanguage !== null && !OutputLanguageSchema.safeParse(requestedLanguage).success) {
    sendJson(res, 400, {
      error: { code: "ValidationError", message: "language must be a supported output language" },
    });
    return true;
  }
  if (!(await deps.authorizeNotebook(userId, notebookId))) {
    return sendNotFound(res, "Notebook or source not found");
  }
  const access = await deps.authorizeSource(userId, notebookId, sourceId, requestedRevision);
  if (!access.exists) return sendNotFound(res, "Source not found in notebook");
  if (!access.ready || access.revision !== requestedRevision) {
    sendJson(res, 409, {
      error: { code: "SourceNotReady", message: "Requested source revision is not Ready" },
    });
    return true;
  }
  // FR-SI-02 / FR-UI-02: the guide for the effective (or requested) output language; generate a missing one on demand.
  const language =
    requestedLanguage ??
    (deps.resolveOutputLanguage ? await deps.resolveOutputLanguage(userId, notebookId) : "en-US");
  const guide = await (deps.getGuide ?? getSourceGuide)(
    notebookId,
    sourceId,
    requestedRevision,
    language,
  );
  if (!guide) {
    await deps.startGuide?.({
      notebook_id: notebookId,
      user_id: userId,
      source_id: sourceId,
      revision: requestedRevision,
      output_language: language,
    });
    sendJson(res, 202, {
      status: "GuidePending",
      notebook_id: notebookId,
      source_id: sourceId,
      revision: requestedRevision,
      output_language: language,
    });
    return true;
  }
  sendJson(res, 200, SourceGuideSchema.parse(guide));
  return true;
}

async function handleOverviewPost(ctx: RouteCtx): Promise<true> {
  const { req, res, userId, notebookId, deps } = ctx;
  if (!deps.generateOverview) {
    sendJson(res, 503, {
      error: { code: "Unavailable", message: "Overview generation is not configured" },
    });
    return true;
  }
  try {
    const raw = await parseJsonBody<unknown>(req);
    const body =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    if (!Array.isArray(body.source_revisions) || body.source_revisions.length === 0) {
      sendJson(res, 400, {
        error: {
          code: "EmptyScopeError",
          message: "Overview requires a nonempty source revision scope",
        },
      });
      return true;
    }
    const sourceRevisions = SourceRevisionListSchema.parse(body.source_revisions);
    const outputLanguage =
      typeof body.output_language === "string" ? body.output_language : "en-US";
    const result = NotebookOverviewSchema.parse(
      await deps.generateOverview({
        notebook_id: notebookId,
        user_id: userId,
        source_revisions: sourceRevisions,
        output_language: outputLanguage,
      }),
    );
    if (
      result.notebook_id !== notebookId ||
      result.authorization_key !== createHash("sha256").update(userId).digest("hex")
    ) {
      throw new Error("Overview does not match the authenticated notebook owner");
    }
    sendJson(res, 200, result);
  } catch (error) {
    sendGenerationError(res, error);
  }
  return true;
}

async function handleOverviewRoute(ctx: RouteCtx): Promise<true> {
  const { res, url, method, userId, notebookId, deps } = ctx;
  if (!(await deps.authorizeNotebook(userId, notebookId))) return sendNotFound(res);
  if (method === "POST") return handleOverviewPost(ctx);
  const cacheKey = url.searchParams.get("cache_key");
  const overview = cacheKey
    ? await (deps.getOverview ?? getOverviewForUser)(cacheKey, userId)
    : null;
  if (overview?.notebook_id !== notebookId) {
    return sendNotFound(res, "Overview not found for current authorized scope");
  }
  for (const snapshot of overview.source_revisions) {
    const access = await deps.authorizeSource(
      userId,
      notebookId,
      snapshot.source_id,
      snapshot.revision,
    );
    if (!access.exists || !access.ready || access.revision !== snapshot.revision) {
      sendJson(res, 409, {
        error: {
          code: "SnapshotInvalid",
          message: "Overview source snapshot is stale or inaccessible",
        },
      });
      return true;
    }
  }
  sendJson(res, 200, overview);
  return true;
}

async function handleChatConfigurationRoute(ctx: RouteCtx): Promise<true> {
  const { req, res, method, userId, notebookId, deps } = ctx;
  if (!(await deps.authorizeNotebook(userId, notebookId))) return sendNotFound(res);
  if (method === "GET") {
    const config = await (deps.getConfiguration ?? getChatConfiguration)(notebookId, userId);
    sendJson(res, 200, config);
    return true;
  }
  try {
    const parsed = ChatConfigurationSchema.parse(await parseJsonBody<unknown>(req));
    const saved = await (deps.saveConfiguration ?? saveChatConfiguration)(
      notebookId,
      userId,
      parsed,
    );
    sendJson(res, 200, saved);
  } catch (error: unknown) {
    sendJson(res, 422, {
      error: {
        code: "ValidationError",
        message: error instanceof Error ? error.message : "Invalid configuration",
      },
    });
  }
  return true;
}

async function verifyFollowUpSnapshot(
  rawBody: unknown,
  snapshot: Array<{ source_id: string; revision: number }>,
  ctx: RouteCtx,
): Promise<string[]> {
  const bodyObj =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as { source_revisions?: unknown })
      : null;
  if (!Array.isArray(bodyObj?.source_revisions)) {
    throw new Error("Current source_revisions are required");
  }
  const requested = SourceRevisionListSchema.parse(bodyObj.source_revisions);
  const expected = snapshot.map((item) => `${item.source_id}:${item.revision}`).sort();
  const actual = requested.map((item) => `${item.source_id}:${item.revision}`).sort();
  if (!expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Follow-up scope does not match the current assistant message snapshot");
  }
  for (const pair of snapshot) {
    const access = await ctx.deps.authorizeSource(
      ctx.userId,
      ctx.notebookId,
      pair.source_id,
      pair.revision,
    );
    if (!access.exists || !access.ready || access.revision !== pair.revision) {
      throw new Error("Follow-up source snapshot is stale or inaccessible");
    }
  }
  return expected;
}

async function handleFollowUpsRoute(ctx: RouteCtx, messageId: string): Promise<true> {
  const { req, res, userId, notebookId, deps } = ctx;
  if (!(await deps.authorizeNotebook(userId, notebookId))) return sendNotFound(res);
  const messages = deps.getThreadMessages
    ? await deps.getThreadMessages(notebookId, userId)
    : await getChatMessages(undefined, notebookId, userId);
  const message = messages.find((item) => item.id === messageId && item.role === "assistant");
  if (!message) {
    sendJson(res, 404, {
      error: { code: "MessageNotFound", message: "Assistant message not found" },
    });
    return true;
  }
  try {
    const snapshot = message.active_source_revisions_snapshot;
    const expected = await verifyFollowUpSnapshot(await parseJsonBody<unknown>(req), snapshot, ctx);
    // FR-GC-05 / FR-UI-02: generated in, and cached under, the effective output language.
    const language = deps.resolveOutputLanguage
      ? await deps.resolveOutputLanguage(userId, notebookId)
      : "en-US";
    const getFollowUps = deps.getFollowUps ?? getMessageFollowUps;
    const saved = await getFollowUps(notebookId, userId, messageId, language);
    if (saved) {
      const savedSnapshot = saved.source_revisions
        .map((item) => `${item.source_id}:${item.revision}`)
        .sort();
      if (JSON.stringify(savedSnapshot) !== JSON.stringify(expected)) {
        throw new Error("Stored follow-up snapshot is stale");
      }
      sendJson(res, 200, FollowUpSuggestionsSchema.parse(saved));
      return true;
    }
    if (!deps.generateFollowUps) {
      sendJson(res, 503, {
        error: { code: "Unavailable", message: "Follow-up generation is not configured" },
      });
      return true;
    }
    const result = FollowUpSuggestionsSchema.parse(
      await deps.generateFollowUps({
        notebook_id: notebookId,
        user_id: userId,
        answer: message.content,
        source_revisions: snapshot,
        output_language: language,
      }),
    );
    const resultSnapshot = result.source_revisions
      .map((item) => `${item.source_id}:${item.revision}`)
      .sort();
    if (JSON.stringify(expected) !== JSON.stringify(resultSnapshot)) {
      throw new Error("Generated follow-up source snapshot does not match the assistant message");
    }
    if (result.output_language !== language) {
      throw new Error("Generated follow-ups do not match the effective output language");
    }
    await (deps.saveFollowUps ?? saveMessageFollowUps)({
      notebook_id: notebookId,
      user_id: userId,
      message_id: messageId,
      followups: result,
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendGenerationError(res, error);
  }
  return true;
}

async function handleSaveNoteRoute(ctx: RouteCtx, messageId: string): Promise<true> {
  const { req, res, userId, notebookId, deps } = ctx;
  // Shared contract: the body must be valid and name exactly the path IDs; otherwise 400 (FR-NM-02).
  let raw: unknown;
  try {
    raw = await parseJsonBody<unknown>(req);
  } catch {
    raw = undefined;
  }
  const body = SaveResponseNoteRequestSchema.safeParse(raw);
  if (!body.success) {
    sendJson(res, 400, {
      error: {
        code: "ValidationError",
        message: "Body must be { notebook_id, message_id } with UUIDs",
      },
    });
    return true;
  }
  if (body.data.notebook_id !== notebookId || body.data.message_id !== messageId) {
    sendJson(res, 400, {
      error: {
        code: "ValidationError",
        message: "Body notebook_id and message_id must equal the path IDs",
      },
    });
    return true;
  }
  if (!deps.saveNote) {
    sendJson(res, 503, {
      error: { code: "Unavailable", message: "Saving notes is not configured" },
    });
    return true;
  }
  try {
    const note = await deps.saveNote({
      notebook_id: notebookId,
      message_id: messageId,
      user_id: userId,
    });
    sendJson(res, 200, SaveResponseNoteResponseSchema.parse({ note }));
  } catch {
    sendJson(res, 404, {
      error: { code: "MessageNotFound", message: "Assistant message not found" },
    });
  }
  return true;
}

async function handleMessageActionRoute(
  ctx: RouteCtx,
  messageId: string,
  kind: string,
): Promise<true> {
  const { req, res, userId, notebookId, deps } = ctx;
  if (!(await deps.authorizeNotebook(userId, notebookId))) return sendNotFound(res);
  if (kind !== "feedback") {
    return handleSaveNoteRoute(ctx, messageId);
  }
  try {
    const rawBody = await parseJsonBody<unknown>(req);
    const bodyObj =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {};
    const input = MessageFeedbackInputSchema.parse({
      ...bodyObj,
      message_id: messageId,
    });
    const feedback = await (deps.saveFeedback ?? saveMessageFeedback)({
      ...input,
      notebook_id: notebookId,
      user_id: userId,
    });
    sendJson(res, 200, feedback);
  } catch (error: unknown) {
    sendJson(res, 422, {
      error: {
        code: "ValidationError",
        message: error instanceof Error ? error.message : "Invalid feedback",
      },
    });
  }
  return true;
}

async function dispatchChatMessageSuffix(ctx: RouteCtx, suffix: string): Promise<boolean> {
  const { method, res, userId, notebookId, deps } = ctx;
  const followUpsMatch = /^chat\/messages\/([0-9a-f-]{36})\/follow-ups$/i.exec(suffix);
  if (method === "POST" && followUpsMatch?.[1]) {
    return handleFollowUpsRoute(ctx, followUpsMatch[1]);
  }
  const feedbackMatch = /^chat\/messages\/([0-9a-f-]{36})\/feedback$/i.exec(suffix);
  if (method === "DELETE" && feedbackMatch?.[1]) {
    // FR-GC-09 / FR-014: clicking the active thumb clears the caller's own rating.
    if (!(await deps.authorizeNotebook(userId, notebookId))) return sendNotFound(res);
    await (deps.clearFeedback ?? clearMessageFeedback)(notebookId, userId, feedbackMatch[1]);
    res.writeHead(204);
    res.end();
    return true;
  }
  const responseMatch = /^chat\/messages\/([0-9a-f-]{36})\/(feedback|note)$/i.exec(suffix);
  if (method === "POST" && responseMatch?.[1] && responseMatch[2]) {
    return handleMessageActionRoute(ctx, responseMatch[1], responseMatch[2]);
  }
  return false;
}

export async function handlePackageV22Route(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
  deps: PackageV22ApiDependencies,
): Promise<boolean> {
  const url = parseRequestUrl(req);
  const method = req.method?.toUpperCase();
  const base = /^\/api\/notebooks\/([0-9a-f-]{36})\/(.*)$/i.exec(url.pathname);
  const notebookId = base?.[1];
  const suffix = base?.[2];
  if (!notebookId || suffix === undefined || !method) return false;

  const ctx: RouteCtx = { req, res, url, method, userId, notebookId, deps };
  if (method === "GET" && suffix === "sources") {
    return handleSourcesList(ctx);
  }
  const guideMatch = /^sources\/([0-9a-f-]{36})\/guide$/i.exec(suffix);
  if (method === "GET" && guideMatch?.[1]) {
    return handleSourceGuide(ctx, guideMatch[1]);
  }
  if (suffix === "overview" && (method === "GET" || method === "POST")) {
    return handleOverviewRoute(ctx);
  }
  if (suffix === "chat/configuration" && (method === "GET" || method === "PUT")) {
    return handleChatConfigurationRoute(ctx);
  }
  return dispatchChatMessageSuffix(ctx, suffix);
}

/**
 * Fixed error bodies for generation routes: model or upstream error text never reaches a response (NFR-SEC-01).
 * Unconfigured → 503; model failure → 502; anything else (stale or unauthorized snapshot, invalid output) → 409.
 */
function sendGenerationError(res: ServerResponse, error: unknown): void {
  const name = error instanceof Error ? error.name : "";
  if (name === "PackageV22GenerationUnavailableError") {
    sendJson(res, 503, { error: { code: "Unavailable", message: "Generation is not configured" } });
  } else if (name === "StructuredGenerationError") {
    sendJson(res, 502, {
      error: { code: "GenerationFailed", message: "Generation failed; please try again" },
    });
  } else {
    sendJson(res, 409, {
      error: {
        code: "SnapshotInvalid",
        message: "Source snapshot is stale, inaccessible or produced unsupported output",
      },
    });
  }
}
