import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EmptyScopeError,
  InvalidScopeError,
  SourceSnapshotInvalidError,
  StudioParamsError,
} from "@everlast/contracts";
import { parseJsonBody, sendJson } from "../http.ts";
import {
  StudioConflictError,
  StudioNotFoundError,
  StudioNotImplementedError,
  StudioService,
  type StudioServiceDeps,
} from "../studio/service.ts";

export type StudioRouteDeps = StudioServiceDeps;

const isZodError = (e: unknown): e is { issues: { message: string; path: (string | number)[] }[] } =>
  e instanceof Error && e.name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);

const err = (res: ServerResponse, status: number, code: string, message: string): true => {
  sendJson(res, status, { error: { code, message } });
  return true;
};

/**
 * Studio HTTP routes (FR-ST-10, FR-ST-11, FR-NM-03); Owner-only, authorization happens server-side.
 * v2 has no cancel action (card FR-ST-10): `Cancelled` stays a C-03 state for later plugins.
 */
export async function handleStudioRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: StudioRouteDeps,
  userId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const match = url.pathname.match(
    /^\/api\/notebooks\/([^/]+)\/studio\/(artifacts(?:\/([^/]+)(?:\/(retry|convert-to-source))?)?|report-suggestions)$/
  );
  if (!match) return false;
  const [, notebookId, target, artifactId, action] = match as unknown as [string, string, string, string | undefined, string | undefined];
  const method = req.method?.toUpperCase();
  const service = new StudioService(deps);

  let body: unknown = {};
  if (method === "POST") {
    try {
      body = await parseJsonBody<unknown>(req);
    } catch {
      return err(res, 400, "InvalidJson", "Malformed JSON body.");
    }
  }

  try {
    if (target === "report-suggestions" && method === "POST") {
      sendJson(res, 200, await service.suggestions(userId, notebookId, body));
    } else if (target === "artifacts" && method === "POST") {
      sendJson(res, 202, { artifact: await service.create(userId, notebookId, body) });
    } else if (target === "artifacts" && method === "GET") {
      sendJson(res, 200, { artifacts: await service.list(userId, notebookId) });
    } else if (artifactId && !action && method === "GET") {
      sendJson(res, 200, await service.get(userId, notebookId, artifactId));
    } else if (artifactId && !action && method === "DELETE") {
      await service.remove(userId, notebookId, artifactId);
      res.writeHead(204).end();
    } else if (artifactId && action === "retry" && method === "POST") {
      sendJson(res, 202, { artifact: await service.retry(userId, notebookId, artifactId, body) });
    } else if (artifactId && action === "convert-to-source" && method === "POST") {
      sendJson(res, 201, await service.convert(userId, notebookId, artifactId));
    } else {
      return false;
    }
  } catch (e) {
    if (e instanceof EmptyScopeError) return err(res, 400, "EmptyScopeError", e.message);
    // FR-UI-02: an unsupported output language is a bad request (it would key caches and on-demand guide runs).
    if (isZodError(e) && e.issues.some((x) => x.path[0] === "output_language")) {
      return err(res, 400, "UnsupportedOutputLanguage", "Output language is not in the supported locale set.");
    }
    if (isZodError(e)) return err(res, 422, "ValidationError", e.issues.map((x) => x.message).join("; "));
    if (e instanceof StudioParamsError) return err(res, 422, "ValidationError", e.message);
    if (e instanceof InvalidScopeError) return err(res, 403, "InvalidScope", e.message);
    if (e instanceof SourceSnapshotInvalidError) return err(res, 409, "SourceSnapshotInvalid", e.message);
    if (e instanceof StudioNotFoundError) return err(res, 404, "NotFound", e.message);
    if (e instanceof StudioConflictError) return err(res, 409, "Conflict", e.message);
    if (e instanceof StudioNotImplementedError) return err(res, 501, "NotImplemented", e.message);
    return err(res, 500, "InternalError", "Unexpected error.");
  }
  return true;
}
