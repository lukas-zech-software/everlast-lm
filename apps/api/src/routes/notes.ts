import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ConvertToSourceInputSchema,
  CreateNoteInputSchema,
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  NOTE_ERROR_MESSAGES,
  NoteAssistantInputSchema,
  PatchNoteInputSchema,
} from "@everlast/contracts";
import {
  getNote,
  listNotes,
  NoteNotFoundError,
  NoteReadOnlyError,
  NotSavedResponseError,
  RevisionConflictError,
} from "@everlast/db";
import { parseJsonBody, sendJson } from "../http.ts";
import { NotesService, NotesServiceError } from "../notes/service.ts";

export interface NotesRouteDependencies {
  service: NotesService;
  verifyOwnership?: (notebookId: string, userId: string) => Promise<boolean> | boolean;
}

const fail = (res: ServerResponse, status: number, code: string, message: string = code) =>
  sendJson(res, status, { error: { code, message } });

/**
 * Notes & Pinboard HTTP routes (FR-NM-01..04). Owner-only: ownership is checked on every request. Save to note uses
 * the one shared route `POST /api/notebooks/{id}/chat/messages/{message_id}/note` (routes/package-v2-2.ts).
 */
export async function handleNotesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: NotesRouteDependencies,
  userId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/api\/notebooks\/([^/]+)\/notes(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (!match) return false;
  const notebookId = match[1]!;
  const seg = match[2];
  const action = match[3];
  const method = req.method?.toUpperCase();

  if (deps.verifyOwnership && !(await deps.verifyOwnership(notebookId, userId))) {
    fail(res, 403, "Forbidden", "User is not authorized for this notebook.");
    return true;
  }

  try {
    const body = async (): Promise<unknown> => {
      try {
        return await parseJsonBody<unknown>(req);
      } catch {
        throw new NotesServiceError("InvalidJson", 400, "Invalid JSON body");
      }
    };
    const invalid = (issues: { message: string }[]) =>
      new NotesServiceError("ValidationError", 422, issues.map((i) => i.message).join("; "));

    if (seg === undefined) {
      if (method === "GET") {
        const notes = await listNotes(notebookId, userId);
        // FR-WM-07: one occupancy count for uploads and note-sources (owner decision 2026-10-20).
        const source_slots = (await deps.service.sourceSlots(notebookId)) ?? { used: 0, limit: DEFAULT_MAX_SOURCES_PER_NOTEBOOK };
        sendJson(res, 200, { notes, source_slots });
        return true;
      }
      if (method === "POST") {
        const p = CreateNoteInputSchema.safeParse(await body());
        if (!p.success) throw invalid(p.error.issues);
        sendJson(res, 201, { note: await deps.service.create(notebookId, userId, p.data) });
        return true;
      }
      return false;
    }

    if (seg === "convert-to-source" && method === "POST" && !action) {
      const p = ConvertToSourceInputSchema.safeParse(await body());
      if (!p.success) throw invalid(p.error.issues);
      const { source, reused } = await deps.service.convertToSource(notebookId, userId, p.data);
      sendJson(res, reused ? 200 : 201, { source, reused });
      return true;
    }
    if (seg === "assistant" && method === "POST" && !action) {
      const p = NoteAssistantInputSchema.safeParse(await body());
      if (!p.success) throw invalid(p.error.issues);
      sendJson(res, 200, await deps.service.runAssistant(notebookId, userId, p.data));
      return true;
    }

    if (action === "convert-to-editable" && method === "POST") {
      sendJson(res, 201, { note: await deps.service.convertToEditable(notebookId, userId, seg) });
      return true;
    }
    if (action) return false;

    if (method === "GET") {
      const note = await getNote(notebookId, userId, seg);
      if (!note) throw new NoteNotFoundError();
      sendJson(res, 200, { note });
      return true;
    }
    if (method === "PATCH") {
      const p = PatchNoteInputSchema.safeParse(await body());
      if (!p.success) throw invalid(p.error.issues);
      sendJson(res, 200, { note: await deps.service.update(notebookId, userId, seg, p.data) });
      return true;
    }
    if (method === "DELETE") {
      if (url.searchParams.get("confirm") !== "true") {
        throw new NotesServiceError("ConfirmationRequired", 400, NOTE_ERROR_MESSAGES.ConfirmationRequired);
      }
      if (!(await deps.service.remove(notebookId, userId, seg))) throw new NoteNotFoundError();
      sendJson(res, 200, { deleted: true });
      return true;
    }
    return false;
  } catch (e) {
    if (e instanceof NotesServiceError) fail(res, e.httpStatus, e.code, e.message);
    else if (e instanceof NoteNotFoundError) fail(res, 404, "NoteNotFound", "Note not found");
    else if (e instanceof NoteReadOnlyError) fail(res, 409, "NoteReadOnly", NOTE_ERROR_MESSAGES.NoteReadOnly);
    else if (e instanceof RevisionConflictError) fail(res, 409, "RevisionConflict", e.message);
    else if (e instanceof NotSavedResponseError) fail(res, 409, "NotSavedResponse", e.message);
    else throw e;
    return true;
  }
}
