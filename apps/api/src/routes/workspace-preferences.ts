import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OwnerNotebookPreferencesPatchSchema,
  OwnerWorkspacePreferencesPatchSchema,
} from "@everlast/contracts";
import { NotebookPreferenceScopeError } from "@everlast/db";
import { parseJsonBody, parseRequestUrl, sendJson } from "../http.ts";
import type { WorkspacePreferencesService as WorkspaceService } from "../services/workspace-preferences.ts";

function invalidPreferenceMessage(error: {
  issues?: Array<{ message: string }>;
  errors?: Array<{ message: string }>;
}): string {
  const issues = error.issues ?? error.errors ?? [];
  return issues.map(({ message }) => message).join("; ");
}

async function readPreferencePatchBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await parseJsonBody<unknown>(req) };
  } catch {
    sendJson(res, 400, {
      error: { code: "InvalidPreference", message: "Malformed JSON preference patch" },
    });
    return { ok: false };
  }
}

async function handleOwnerPreferences(
  req: IncomingMessage,
  res: ServerResponse,
  service: WorkspaceService,
  ownerId: string,
  method: string | undefined,
): Promise<boolean> {
  if (method === "GET") {
    sendJson(res, 200, await service.getOwnerPreferences(ownerId));
    return true;
  }
  if (method === "PATCH") {
    const raw = await readPreferencePatchBody(req, res);
    if (!raw.ok) return true;
    const parsed = OwnerWorkspacePreferencesPatchSchema.safeParse(raw.body);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: { code: "InvalidPreference", message: invalidPreferenceMessage(parsed.error) },
      });
      return true;
    }
    sendJson(
      res,
      200,
      await service.patchOwnerPreferences(
        ownerId,
        parsed.data as Parameters<WorkspaceService["patchOwnerPreferences"]>[1],
      ),
    );
    return true;
  }
  return false;
}

async function handleNotebookPreferences(
  ctx: {
    req: IncomingMessage;
    res: ServerResponse;
    service: WorkspaceService;
    ownerId: string;
    notebookId: string;
  },
  method: string | undefined,
): Promise<boolean> {
  const { req, res, service, ownerId, notebookId } = ctx;
  const raw = await service.getNotebook(notebookId);
  if (!raw) {
    sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found" } });
    return true;
  }
  if (raw.owner_id !== ownerId) {
    sendJson(res, 403, {
      error: {
        code: "Forbidden",
        message: "Forbidden: cannot access foreign notebook preferences",
      },
    });
    return true;
  }
  if (method === "GET") {
    sendJson(res, 200, await service.getNotebookPreferences(ownerId, notebookId));
    return true;
  }
  if (method === "PATCH") {
    const rawBody = await readPreferencePatchBody(req, res);
    if (!rawBody.ok) return true;
    const parsed = OwnerNotebookPreferencesPatchSchema.safeParse(rawBody.body);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: { code: "InvalidPreference", message: invalidPreferenceMessage(parsed.error) },
      });
      return true;
    }
    try {
      sendJson(
        res,
        200,
        await service.patchNotebookPreferences(
          ownerId,
          notebookId,
          parsed.data as Parameters<WorkspaceService["patchNotebookPreferences"]>[2],
        ),
      );
    } catch (error) {
      if (error instanceof NotebookPreferenceScopeError) {
        sendJson(res, 403, { error: { code: "Forbidden", message: error.message } });
        return true;
      }
      throw error;
    }
    return true;
  }
  return false;
}

export async function handleWorkspacePreferencesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  service: WorkspaceService,
  ownerId: string,
): Promise<boolean> {
  const url = parseRequestUrl(req);
  const method = req.method?.toUpperCase();

  if (url.pathname === "/api/preferences") {
    return handleOwnerPreferences(req, res, service, ownerId, method);
  }

  const match = /^\/api\/notebooks\/([^/]+)\/preferences$/.exec(url.pathname);
  const notebookId = match?.[1];
  if (notebookId) {
    return handleNotebookPreferences({ req, res, service, ownerId, notebookId }, method);
  }
  return false;
}
