import type { IncomingMessage, ServerResponse } from "node:http";
import { parseJsonBody, sendJson } from "../http.js";
import type { WorkspaceService } from "../services/workspace.js";
import {
  NotebookNotFoundError,
  NotebookQuotaExceededError,
  InvalidTitleError,
} from "@everlast/db";
import { NotebookIconSchema, NotebookSortOrderSchema, validateNotebookTitle } from "@everlast/contracts";

/**
 * Notebook HTTP API Route Dispatcher (FR-WM-01, FR-WM-04, FR-WM-07).
 */

export async function handleNotebookRoute(
  req: IncomingMessage,
  res: ServerResponse,
  service: WorkspaceService,
  ownerId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase();

  // 1. GET /api/notebooks
  if (method === "GET" && pathname === "/api/notebooks") {
    const requestedSort = url.searchParams.get("sort_order");
    if (requestedSort && !NotebookSortOrderSchema.safeParse(requestedSort).success) {
      sendJson(res, 400, { error: { code: "InvalidPreference", message: "Unsupported sort_order" } });
      return true;
    }
    const list = await service.listNotebooks(ownerId, requestedSort ? requestedSort as any : undefined);
    sendJson(res, 200, list);
    return true;
  }

  // 2. POST /api/notebooks
  if (method === "POST" && pathname === "/api/notebooks") {
    try {
      const body = await parseJsonBody<any>(req).catch(() => ({}));
      const idempotencyKey = (req.headers["idempotency-key"] as string) || undefined;

      const notebook = await service.createNotebook(
        ownerId,
        body || {},
        idempotencyKey ? { idempotencyKey } : undefined
      );
      sendJson(res, 201, { notebook });
      return true;
    } catch (err: any) {
      if (err instanceof NotebookQuotaExceededError) {
        sendJson(res, 409, { error: { code: err.code, message: err.message } });
        return true;
      }
      if (err instanceof InvalidTitleError) {
        sendJson(res, 422, { error: { code: err.code, message: err.message } });
        return true;
      }
      sendJson(res, 500, { error: { code: "InternalError", message: err.message } });
      return true;
    }
  }

  // 3. GET /api/notebook-deletions/:id
  const deletionMatch = pathname.match(/^\/api\/notebook-deletions\/([^/]+)$/);
  if (method === "GET" && deletionMatch) {
    const deletionId = deletionMatch[1]!;
    try {
      const op = await service.getDeletionStatus(ownerId, deletionId);
      if (!op) {
        sendJson(res, 404, { error: { code: "NotFound", message: "Deletion operation not found" } });
        return true;
      }
      sendJson(res, 200, {
        deletion_id: op.operation_id,
        status: op.status,
        last_error_code: op.last_error_code,
      });
      return true;
    } catch (err: any) {
      if (err.statusCode === 403) {
        sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cross-owner deletion status rejected" } });
        return true;
      }
      sendJson(res, 500, { error: { code: "InternalError", message: err.message } });
      return true;
    }
  }

  // 4. POST /api/notebooks/:id/sources/admission
  const admissionMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/sources\/admission$/);
  if (method === "POST" && admissionMatch) {
    const notebookId = admissionMatch[1]!;
    try {
      const body = await parseJsonBody<any>(req);
      if (body.declared_byte_size !== undefined && body.declared_byte_size > 200_000_000) {
        sendJson(res, 422, {
          error: {
            code: "SourceOversized",
            message: "Source exceeds 200,000,000 bytes limit",
          },
        });
        return true;
      }
      const attempt = {
        attempt_id: body.attempt_id,
        notebook_id: notebookId,
        declared_byte_size: body.declared_byte_size ?? 0,
        file_name: body.file_name || "untitled",
        mime_type: body.mime_type || "application/octet-stream",
      };
      const result = await service.reserveSource(ownerId, notebookId, attempt);
      sendJson(res, 201, result);
      return true;
    } catch (err: any) {
      if (err.name === "SourceQuotaExceededError" || err.code === "SourceQuotaExceeded") {
        sendJson(res, 409, { error: { code: "SourceQuotaExceeded", message: err.message } });
        return true;
      }
      if (err.name === "SourceOversizedBytesError" || err.code === "SourceOversized") {
        sendJson(res, 422, { error: { code: "SourceOversized", message: err.message } });
        return true;
      }
      if (err.name === "InvalidScopeError" || err.name === "NotebookNotFoundError" || err.message?.includes("not found")) {
        sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found" } });
        return true;
      }
      sendJson(res, 500, { error: { code: "InternalError", message: err.message } });
      return true;
    }
  }

  // 5. DELETE /api/notebooks/:id/sources/:sourceId/error
  const dismissMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/sources\/([^/]+)\/error$/);
  if (method === "DELETE" && dismissMatch) {
    const notebookId = dismissMatch[1]!;
    const attemptId = dismissMatch[2]!;
    await service.dismissSourceError(ownerId, notebookId, attemptId);
    res.writeHead(204);
    res.end();
    return true;
  }

  const iconMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/icon$/);
  if (method === "PATCH" && iconMatch) {
    const notebookId = iconMatch[1]!;
    const raw = service.getNotebookRaw(notebookId);
    if (!raw) {
      sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found" } });
      return true;
    }
    if (raw.owner_id !== ownerId) {
      sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cannot mutate foreign notebook" } });
      return true;
    }
    try {
      const body = await parseJsonBody<any>(req);
      if (!body || Object.keys(body).some((key) => key !== "icon_emoji") || !NotebookIconSchema.safeParse(body.icon_emoji).success) {
        sendJson(res, 400, { error: { code: "InvalidEmoji", message: "Icon must be one valid emoji grapheme" } });
        return true;
      }
      await service.updateNotebookIcon(ownerId, notebookId, body.icon_emoji);
      const result = await service.getNotebook(ownerId, notebookId);
      sendJson(res, 200, { notebook: result?.notebook });
      return true;
    } catch (err: any) {
      sendJson(res, 400, { error: { code: "InvalidEmoji", message: err.message } });
      return true;
    }
  }

  const openedMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/opened$/);
  if (method === "POST" && openedMatch) {
    const notebookId = openedMatch[1]!;
    const raw = service.getNotebookRaw(notebookId);
    if (!raw) {
      sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found" } });
      return true;
    }
    if (raw.owner_id !== ownerId) {
      sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cross-owner access rejected" } });
      return true;
    }
    await service.markNotebookOpened(ownerId, notebookId);
    res.writeHead(204);
    res.end();
    return true;
  }

  // 6. Notebook ID routes: /api/notebooks/:id and sub-resources
  const notebookSubMatch = pathname.match(/^\/api\/notebooks\/([^/]+)(?:\/([^/]+))?$/);
  if (notebookSubMatch) {
    const notebookId = notebookSubMatch[1]!;
    const subResource = notebookSubMatch[2];

    // GET /api/notebooks/:id/quota
    if (method === "GET" && subResource === "quota") {
      const nbResult = await service.getNotebook(ownerId, notebookId);
      if (!nbResult) {
        // Check foreign access
        const raw = service.getNotebookRaw(notebookId);
        if (raw && raw.owner_id !== ownerId) {
          sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cross-owner access rejected" } });
          return true;
        }
        sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found" } });
        return true;
      }
      const quota = await service.getNotebookQuota(ownerId, notebookId);
      sendJson(res, 200, quota);
      return true;
    }

    // GET /api/notebooks/:id
    if (method === "GET" && !subResource) {
      const result = await service.getNotebook(ownerId, notebookId);
      if (!result) {
        // Check foreign access
        const raw = service.getNotebookRaw(notebookId);
        if (raw && raw.owner_id !== ownerId) {
          sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cross-owner access rejected" } });
          return true;
        }
        sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook no longer exists" } });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    // PATCH /api/notebooks/:id
    if (method === "PATCH" && !subResource) {
      try {
        const raw = service.getNotebookRaw(notebookId);
        if (raw && raw.owner_id !== ownerId) {
          sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cannot mutate foreign notebook" } });
          return true;
        }

        const body = await parseJsonBody<any>(req);
        // Reject unknown fields
        const keys = Object.keys(body || {});
        if (keys.some((k) => k !== "title")) {
          sendJson(res, 422, { error: { code: "InvalidTitle", message: "Unknown mutation fields rejected" } });
          return true;
        }

        if (typeof body.title !== "string") {
          sendJson(res, 422, { error: { code: "InvalidTitle", message: "Title must be a string" } });
          return true;
        }

        const valResult = validateNotebookTitle(body.title);
        if (!valResult.valid) {
          sendJson(res, 422, { error: { code: "InvalidTitle", message: valResult.error } });
          return true;
        }

        const updated = await service.updateNotebookTitle(ownerId, notebookId, { title: body.title });
        sendJson(res, 200, { notebook: updated });
        return true;
      } catch (err: any) {
        if (err instanceof NotebookNotFoundError) {
          sendJson(res, 404, { error: { code: err.code, message: err.message } });
          return true;
        }
        if (err instanceof InvalidTitleError) {
          sendJson(res, 422, { error: { code: err.code, message: err.message } });
          return true;
        }
        sendJson(res, 500, { error: { code: "InternalError", message: err.message } });
        return true;
      }
    }

    // DELETE /api/notebooks/:id
    if (method === "DELETE" && !subResource) {
      const raw = service.getNotebookRaw(notebookId);
      if (raw && raw.owner_id !== ownerId) {
        sendJson(res, 403, { error: { code: "Forbidden", message: "Forbidden: cannot delete foreign notebook" } });
        return true;
      }

      const result = await service.deleteNotebook(ownerId, notebookId);
      if (!result.deleted) {
        sendJson(res, 404, { error: { code: "NotebookNotFound", message: "Notebook not found or already deleted" } });
        return true;
      }
      sendJson(res, 202, { deletion_id: result.deletionId, status: "Pending" });
      return true;
    }
  }

  return false;
}
