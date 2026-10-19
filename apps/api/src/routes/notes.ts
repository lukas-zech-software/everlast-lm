import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ConvertToSourceInputSchema,
  CreateNoteInputSchema,
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  NOTE_ERROR_MESSAGES,
  NoteAssistantInputSchema,
  PatchNoteInputSchema,
  SAVED_TO_NOTES_MESSAGE,
  SaveNoteFromMessageInputSchema,
} from "@everlast/contracts";
import {
  createNote,
  deleteNote,
  getNote,
  getOccupiedSourceCount,
  listNotes,
  NoteNotFoundError,
  NoteReadOnlyError,
  NotSavedResponseError,
  RevisionConflictError,
  updateNote,
} from "@everlast/db";
import { parseJsonBody, sendJson } from "../http.js";
import { NotesService, NotesServiceError } from "../notes/service.js";

export interface NotesRouteDependencies {
  service: NotesService;
  verifyOwnership?: (notebookId: string, userId: string) => Promise<boolean> | boolean;
}

const fail = (res: ServerResponse, status: number, code: string, message: string = code) =>
  sendJson(res, status, { error: { code, message } });

/**
 * Notes & Pinboard HTTP routes (FR-NM-01..04, FR-GC-09). Owner-only: ownership is checked on every request.
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
        const used = await getOccupiedSourceCount(notebookId);
        sendJson(res, 200, { notes, source_slots: { used, limit: DEFAULT_MAX_SOURCES_PER_NOTEBOOK } });
        return true;
      }
      if (method === "POST") {
        const p = CreateNoteInputSchema.safeParse(await body());
        if (!p.success) throw invalid(p.error.issues);
        sendJson(res, 201, { note: await createNote(notebookId, userId, p.data) });
        return true;
      }
      return false;
    }

    if (seg === "from-message" && method === "POST" && !action) {
      const p = SaveNoteFromMessageInputSchema.safeParse(await body());
      if (!p.success) throw invalid(p.error.issues);
      const { note, created } = await deps.service.saveFromMessage(notebookId, userId, p.data.message_id);
      sendJson(res, created ? 201 : 200, { note, created, ...(created ? { toast: SAVED_TO_NOTES_MESSAGE } : {}) });
      return true;
    }
    if (seg === "convert-to-source" && method === "POST" && !action) {
      const p = ConvertToSourceInputSchema.safeParse(await body());
      if (!p.success) throw invalid(p.error.issues);
      sendJson(res, 201, { source: await deps.service.convertToSource(notebookId, userId, p.data) });
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
      sendJson(res, 200, { note: await updateNote(notebookId, userId, seg, p.data) });
      return true;
    }
    if (method === "DELETE") {
      if (url.searchParams.get("confirm") !== "true") {
        throw new NotesServiceError("ConfirmationRequired", 400, NOTE_ERROR_MESSAGES.ConfirmationRequired);
      }
      if (!(await deleteNote(notebookId, userId, seg))) throw new NoteNotFoundError();
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
