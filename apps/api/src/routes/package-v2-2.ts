import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatConfigurationSchema, FollowUpSuggestionsSchema, MessageFeedbackInputSchema, NotebookOverviewSchema, OutputLanguageSchema, SaveResponseNoteRequestSchema, SaveResponseNoteResponseSchema, SourceGuideSchema, NotebookSourceSelectionSchema } from "@everlast/contracts";
import {
  getOverviewForUser,
  getSourceGuide,
  saveChatConfiguration,
  saveMessageFeedback,
  saveResponseNote,
  getChatMessages,
  getMessageFollowUps,
  saveMessageFollowUps,
} from "@everlast/db";
import { sendJson, parseJsonBody } from "../http.ts";

export interface PackageV22ApiDependencies {
  authorizeNotebook: (userId: string, notebookId: string) => Promise<boolean>;
  authorizeSource: (userId: string, notebookId: string, sourceId: string, revision?: number) => Promise<{ exists: boolean; ready: boolean; revision: number }>;
  listSources?: (userId: string, notebookId: string) => Promise<unknown[]>;
  generateOverview?: (input: { notebook_id: string; user_id: string; source_revisions: { source_id: string; revision: number }[]; output_language: string }) => Promise<unknown>;
  getConfiguration?: typeof import("@everlast/db").getChatConfiguration;
  getGuide?: typeof getSourceGuide;
  getOverview?: typeof getOverviewForUser;
  saveConfiguration?: typeof saveChatConfiguration;
  saveFeedback?: typeof saveMessageFeedback;
  saveNote?: typeof saveResponseNote;
  generateFollowUps?: (input: { notebook_id: string; user_id: string; answer: string; source_revisions: { source_id: string; revision: number }[]; output_language: string }) => Promise<unknown>;
  /** Notebook's effective output language for the caller (FR-UI-02); default `en-US`. */
  resolveOutputLanguage?: (userId: string, notebookId: string) => Promise<string>;
  /** Starts Source Guide generation in the background for a language that has no guide yet (FR-SI-02). */
  startGuide?: (input: { notebook_id: string; user_id: string; source_id: string; revision: number; output_language: string }) => void;
  getFollowUps?: typeof getMessageFollowUps;
  saveFollowUps?: typeof saveMessageFollowUps;
  getThreadMessages?: (notebookId: string, userId: string) => Promise<import("@everlast/contracts").ChatMessage[]>;
}

export async function handlePackageV22Route(req: IncomingMessage, res: ServerResponse, userId: string, deps: PackageV22ApiDependencies): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  const method = req.method?.toUpperCase();
  const base = path.match(/^\/api\/notebooks\/([0-9a-f-]{36})\/(.*)$/i);
  if (!base) return false;
  const notebookId = base[1]!;
  const suffix = base[2]!;

  if (method === "GET" && suffix === "sources") {
    if (!(await deps.authorizeNotebook(userId, notebookId))) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Notebook not found" } });
      return true;
    }
    if (!deps.listSources) {
      sendJson(res, 503, { error: { code: "Unavailable", message: "Notebook source listing is not configured" } });
      return true;
    }
    const sources = await deps.listSources(userId, notebookId);
    const parsed = sources.map((source) => NotebookSourceSelectionSchema.parse(source));
    if (parsed.some((source) => source.notebook_id !== notebookId)) {
      sendJson(res, 403, { error: { code: "Forbidden", message: "Cross-notebook source list rejected" } });
      return true;
    }
    sendJson(res, 200, { sources: parsed });
    return true;
  }

  const outputLanguageOf = async () => (deps.resolveOutputLanguage ? await deps.resolveOutputLanguage(userId, notebookId) : "en-US");

  const guideMatch = suffix.match(/^sources\/([0-9a-f-]{36})\/guide$/i);
  if (method === "GET" && guideMatch) {
    const sourceId = guideMatch[1]!;
    const requestedRevision = Number(url.searchParams.get("revision"));
    if (!Number.isSafeInteger(requestedRevision) || requestedRevision < 1) {
      sendJson(res, 400, { error: { code: "ValidationError", message: "revision must be a positive integer" } });
      return true;
    }
    const requestedLanguage = url.searchParams.get("language");
    if (requestedLanguage !== null && !OutputLanguageSchema.safeParse(requestedLanguage).success) {
      sendJson(res, 400, { error: { code: "ValidationError", message: "language must be a supported output language" } });
      return true;
    }
    if (!(await deps.authorizeNotebook(userId, notebookId))) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Notebook or source not found" } });
      return true;
    }
    const access = await deps.authorizeSource(userId, notebookId, sourceId, requestedRevision);
    if (!access.exists) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Source not found in notebook" } });
      return true;
    }
    if (!access.ready || access.revision !== requestedRevision) {
      sendJson(res, 409, { error: { code: "SourceNotReady", message: "Requested source revision is not Ready" } });
      return true;
    }
    // FR-SI-02 / FR-UI-02: the guide for the effective (or requested) output language; generate a missing one on demand.
    const language = requestedLanguage ?? (await outputLanguageOf());
    const guide = await (deps.getGuide ?? getSourceGuide)(notebookId, sourceId, requestedRevision, language);
    if (!guide) {
      deps.startGuide?.({ notebook_id: notebookId, user_id: userId, source_id: sourceId, revision: requestedRevision, output_language: language });
      sendJson(res, 202, { status: "GuidePending", notebook_id: notebookId, source_id: sourceId, revision: requestedRevision, output_language: language });
      return true;
    }
    sendJson(res, 200, SourceGuideSchema.parse(guide));
    return true;
  }

  if (suffix === "overview" && (method === "GET" || method === "POST")) {
    if (!(await deps.authorizeNotebook(userId, notebookId))) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Notebook not found" } });
      return true;
    }
    if (method === "POST") {
      if (!deps.generateOverview) {
        sendJson(res, 503, { error: { code: "Unavailable", message: "Overview generation is not configured" } });
        return true;
      }
      try {
        const body = await parseJsonBody<any>(req);
        if (!Array.isArray(body?.source_revisions) || body.source_revisions.length === 0) {
          sendJson(res, 400, { error: { code: "EmptyScopeError", message: "Overview requires a nonempty source revision scope" } });
          return true;
        }
        const result = NotebookOverviewSchema.parse(await deps.generateOverview({ notebook_id: notebookId, user_id: userId, source_revisions: body.source_revisions, output_language: body.output_language ?? "en-US" }));
        if (result.notebook_id !== notebookId || result.authorization_key !== (await import("node:crypto")).createHash("sha256").update(userId).digest("hex")) throw new Error("Overview does not match the authenticated notebook owner");
        sendJson(res, 200, result);
      } catch (error) {
        const unavailable = error instanceof Error && error.name === "PackageV22GenerationUnavailableError";
        sendJson(res, unavailable ? 503 : 409, { error: { code: unavailable ? "Unavailable" : "SnapshotInvalid", message: error instanceof Error ? error.message : "Source snapshot is stale" } });
      }
      return true;
    }
    const cacheKey = url.searchParams.get("cache_key");
    const overview = cacheKey ? await (deps.getOverview ?? getOverviewForUser)(cacheKey, userId) : null;
    if (!overview || overview.notebook_id !== notebookId) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Overview not found for current authorized scope" } });
      return true;
    }
    for (const snapshot of overview.source_revisions) {
      const access = await deps.authorizeSource(userId, notebookId, snapshot.source_id, snapshot.revision);
      if (!access.exists || !access.ready || access.revision !== snapshot.revision) {
        sendJson(res, 409, { error: { code: "SnapshotInvalid", message: "Overview source snapshot is stale or inaccessible" } });
        return true;
      }
    }
    sendJson(res, 200, overview);
    return true;
  }

  if (suffix === "chat/configuration" && (method === "GET" || method === "PUT")) {
    if (!(await deps.authorizeNotebook(userId, notebookId))) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Notebook not found" } });
      return true;
    }
    if (method === "GET") {
      const config = await (deps.getConfiguration ?? (await import("@everlast/db")).getChatConfiguration)(notebookId, userId);
      sendJson(res, 200, config);
      return true;
    }
    try {
      const parsed = ChatConfigurationSchema.parse(await parseJsonBody(req));
      const saved = await (deps.saveConfiguration ?? saveChatConfiguration)(notebookId, userId, parsed);
      sendJson(res, 200, saved);
    } catch (error: any) {
      sendJson(res, 422, { error: { code: "ValidationError", message: error?.message ?? "Invalid configuration" } });
    }
    return true;
  }

  const followUpsMatch = suffix.match(/^chat\/messages\/([0-9a-f-]{36})\/follow-ups$/i);
  if (method === "POST" && followUpsMatch) {
    if (!(await deps.authorizeNotebook(userId, notebookId))) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Notebook not found" } });
      return true;
    }
    const messageId = followUpsMatch[1]!;
    const messages = deps.getThreadMessages ? await deps.getThreadMessages(notebookId, userId) : await getChatMessages(undefined, notebookId, userId);
    const message = messages.find((item) => item.id === messageId && item.role === "assistant");
    if (!message) {
      sendJson(res, 404, { error: { code: "MessageNotFound", message: "Assistant message not found" } });
      return true;
    }
    try {
      const body = await parseJsonBody<any>(req);
      const snapshot = message.active_source_revisions_snapshot ?? [];
      if (!Array.isArray(body?.source_revisions)) throw new Error("Current source_revisions are required");
      const requested = body.source_revisions;
      const expected = snapshot.map((item) => `${item.source_id}:${item.revision}`).sort();
      const actual = requested.map((item: { source_id: string; revision: number }) => `${item.source_id}:${item.revision}`).sort();
      if (!expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Follow-up scope does not match the current assistant message snapshot");
      for (const pair of snapshot) {
        const access = await deps.authorizeSource(userId, notebookId, pair.source_id, pair.revision);
        if (!access.exists || !access.ready || access.revision !== pair.revision) throw new Error("Follow-up source snapshot is stale or inaccessible");
      }
      // FR-GC-05 / FR-UI-02: generated in, and cached under, the effective output language.
      const language = await outputLanguageOf();
      const getFollowUps = deps.getFollowUps ?? getMessageFollowUps;
      const saved = await getFollowUps(notebookId, userId, messageId, language);
      if (saved) {
        const savedSnapshot = saved.source_revisions.map((item) => `${item.source_id}:${item.revision}`).sort();
        if (JSON.stringify(savedSnapshot) !== JSON.stringify(expected)) throw new Error("Stored follow-up snapshot is stale");
        sendJson(res, 200, FollowUpSuggestionsSchema.parse(saved));
        return true;
      }
      if (!deps.generateFollowUps) {
        sendJson(res, 503, { error: { code: "Unavailable", message: "Follow-up generation is not configured" } });
        return true;
      }
      const result = FollowUpSuggestionsSchema.parse(await deps.generateFollowUps({ notebook_id: notebookId, user_id: userId, answer: message.content, source_revisions: snapshot, output_language: language }));
      const resultSnapshot = result.source_revisions.map((item) => `${item.source_id}:${item.revision}`).sort();
      if (JSON.stringify(expected) !== JSON.stringify(resultSnapshot)) throw new Error("Generated follow-up source snapshot does not match the assistant message");
      if (result.output_language !== language) throw new Error("Generated follow-ups do not match the effective output language");
      await (deps.saveFollowUps ?? saveMessageFollowUps)({ notebook_id: notebookId, user_id: userId, message_id: messageId, followups: result });
      sendJson(res, 200, result);
    } catch (error) {
      const unavailable = error instanceof Error && error.name === "PackageV22GenerationUnavailableError";
      sendJson(res, unavailable ? 503 : 409, { error: { code: unavailable ? "Unavailable" : "SnapshotInvalid", message: error instanceof Error ? error.message : "Source snapshot is stale" } });
    }
    return true;
  }

  const responseMatch = suffix.match(/^chat\/messages\/([0-9a-f-]{36})\/(feedback|note)$/i);
  if (method === "POST" && responseMatch) {
    if (!(await deps.authorizeNotebook(userId, notebookId))) {
      sendJson(res, 404, { error: { code: "NotFound", message: "Notebook not found" } });
      return true;
    }
    const messageId = responseMatch[1]!;
    if (responseMatch[2] === "feedback") {
      try {
        const input = MessageFeedbackInputSchema.parse({ ...(await parseJsonBody<any>(req)), message_id: messageId });
        const feedback = await (deps.saveFeedback ?? saveMessageFeedback)({ ...input, notebook_id: notebookId, user_id: userId });
        sendJson(res, 200, feedback);
      } catch (error: any) {
        sendJson(res, 422, { error: { code: "ValidationError", message: error?.message ?? "Invalid feedback" } });
      }
      return true;
    }
    let body;
    try {
      body = SaveResponseNoteRequestSchema.parse({ ...(await parseJsonBody<any>(req)), notebook_id: notebookId, message_id: messageId });
    } catch (error: any) {
      sendJson(res, 422, { error: { code: "ValidationError", message: error?.message ?? "Invalid note request" } });
      return true;
    }
    try {
      const note = await (deps.saveNote ?? saveResponseNote)({ notebook_id: body.notebook_id, message_id: body.message_id, user_id: userId });
      sendJson(res, 200, SaveResponseNoteResponseSchema.parse({ note }));
    } catch (error: any) {
      sendJson(res, 404, { error: { code: "MessageNotFound", message: error?.message ?? "Assistant message not found" } });
    }
    return true;
  }
  return false;
}
