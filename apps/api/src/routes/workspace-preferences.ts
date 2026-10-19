import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OwnerNotebookPreferencesPatchSchema,
  OwnerWorkspacePreferencesPatchSchema,
} from "@everlast/contracts";
import { NotebookPreferenceScopeError } from "@everlast/db";
import { parseJsonBody, sendJson } from "../http.ts";
import type { WorkspacePreferencesService as WorkspaceService } from "../services/workspace-preferences.ts";

function invalidPreferenceMessage(error: { errors: { message: string }[] }): string {
  return error.errors.map(({ message }) => message).join("; ");
}

export async function handleWorkspacePreferencesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  service: WorkspaceService,
  ownerId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method?.toUpperCase();

  if (url.pathname === "/api/preferences") {
    if (method === "GET") {
      sendJson(res, 200, await service.getOwnerPreferences(ownerId));
      return true;
    }
    if (method === "PATCH") {
      let body: unknown;
      try {
        body = await parseJsonBody<unknown>(req);
      } catch {
        sendJson(res, 400, { error: { code: "InvalidPreference", message: "Malformed JSON preference patch" } });
        return true;
      }
      const parsed = OwnerWorkspacePreferencesPatchSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: { code: "InvalidPreference", message: invalidPreferenceMessage(parsed.error) } });
        return true;
      }
      sendJson(res, 200, await service.patchOwnerPreferences(ownerId, parsed.data as Parameters<WorkspaceService["patchOwnerPreferences"]>[1]));
      return true;
    }
  }

  const match = url.pathname.match(/^\/api\/notebooks\/([^/]+)\/preferences$/);
  if (match) {
    const notebookId = match[1]!;
    const raw = service.getNotebookRaw(notebookId);
    if (!raw) {
      sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found" } });
      return true;
    }
    if (raw.owner_id !== ownerId) {
      sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cannot access foreign notebook preferences" } });
      return true;
    }
    if (method === "GET") {
      sendJson(res, 200, await service.getNotebookPreferences(ownerId, notebookId));
      return true;
    }
    if (method === "PATCH") {
      let body: unknown;
      try {
        body = await parseJsonBody<unknown>(req);
      } catch {
        sendJson(res, 400, { error: { code: "InvalidPreference", message: "Malformed JSON preference patch" } });
        return true;
      }
      const parsed = OwnerNotebookPreferencesPatchSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: { code: "InvalidPreference", message: invalidPreferenceMessage(parsed.error) } });
        return true;
      }
      try {
        sendJson(res, 200, await service.patchNotebookPreferences(ownerId, notebookId, parsed.data as Parameters<WorkspaceService["patchNotebookPreferences"]>[2]));
      } catch (error) {
        if (error instanceof NotebookPreferenceScopeError) {
          sendJson(res, 403, { error: { code: "Forbidden", message: error.message } });
          return true;
        }
        throw error;
      }
      return true;
    }
  }
  return false;
}
