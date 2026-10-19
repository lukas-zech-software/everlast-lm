import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Pool } from "@everlast/db";
import { AppError } from "@everlast/contracts";
import { ensureUser, getNotebook } from "@everlast/db";
import { LocalObjectStorage, type Embedder, type ObjectStorage } from "@everlast/cloud";
import { readBody, readJson, sendError, sendJson, sendNoContent, validationError } from "./http.ts";
import { Router, type AuthUser, type RequestContext } from "./router.ts";
import type { ApiConfig } from "./config.ts";
import type { LocalIdentityIssuer, TokenVerifier } from "./auth/identity.ts";
import { registerNotebookRoutes } from "./routes/notebooks.ts";
import { registerSourceRoutes } from "./routes/sources.ts";
import { registerChatRoutes } from "./routes/chat.ts";
import type { ChatService } from "./chat/service.ts";
import type { V2Runtime } from "./v2/runtime.ts";

/**
 * API application (FR-WM-01, FR-WM-04, FR-WM-07, FR-UI-01).
 * Every `/api/*` request is authenticated with a verified Identity Platform token, mapped to a local user,
 * and then authorized per resource by the repositories. Non-API GETs serve the SPA with a route fallback.
 */

export interface AppDeps {
  pool: Pool;
  config: ApiConfig;
  verifier: TokenVerifier;
  localIssuer?: LocalIdentityIssuer | undefined;
  /** Wakes the worker to drain the durable job outbox (best effort; the outbox is the source of truth). */
  notifyJobs: () => void;
  storage?: ObjectStorage | undefined;
  /** Query embeddings for C-02 retrieval (RETRIEVAL_QUERY). */
  embedder?: Embedder | undefined;
  /** Grounded chat (absent when no enterprise model endpoint is configured → 503). */
  chat?: ChatService | undefined;
  /** Feature route registrations added by later packages (sources, chat). */
  extraRoutes?: ((router: Router, deps: AppDeps) => void)[];
  /** Release v2 proof-of-concept features (D16); their handlers run after notebook ownership is checked. */
  v2?: V2Runtime | undefined;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

async function serveStatic(deps: AppDeps, url: URL, res: ServerResponse): Promise<boolean> {
  const root = deps.config.webDistDir;
  if (!root) return false;
  const pathname = decodeURIComponent(url.pathname);
  const isAppRoute = pathname === "/" || /^\/notebook\/[^/]+\/?$/.test(pathname);
  const relative = isAppRoute ? "index.html" : normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = join(root, relative);
  if (!file.startsWith(normalize(root))) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": isAppRoute ? "no-cache" : "public, max-age=300",
      ...SECURITY_HEADERS,
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function createApp(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const router = new Router();
  registerNotebookRoutes(router, deps);
  registerSourceRoutes(router, deps);
  registerChatRoutes(router, deps);
  for (const register of deps.extraRoutes ?? []) register(router, deps);

  async function authenticate(req: IncomingMessage): Promise<AuthUser> {
    const identity = await deps.verifier.verifyAuthorizationHeader(req.headers.authorization);
    const user = await ensureUser(deps.pool, identity);
    return { userId: user.id, issuer: identity.issuer, subject: identity.subject };
  }

  async function handle(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();

    if (url.pathname === "/healthz") return sendJson(res, 200, { status: "ok" });
    if (url.pathname === "/readyz") {
      await deps.pool.query("SELECT 1");
      return sendJson(res, 200, { status: "ready" });
    }

    if (url.pathname === "/auth/config" && method === "GET") {
      return sendJson(res, 200, {
        mode: deps.config.authMode,
        ...(deps.config.identityPlatform ? { identity_platform: deps.config.identityPlatform } : {}),
      });
    }

    if (url.pathname === "/auth/local/login" && method === "POST") {
      if (!deps.localIssuer) throw new AppError("NotFound", 404, "Not found");
      const body = (await readJson(req)) as { email?: unknown };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw validationError("A valid email is required");
      return sendJson(res, 200, { id_token: deps.localIssuer.issue(`local:${email}`, { email }), expires_in: 3600 });
    }

    // Local development storage only: the signed capability token authorizes exactly one object write,
    // mirroring a Cloud Storage V4 signed URL. Absent when real Cloud Storage is configured.
    if (url.pathname.startsWith("/dev-storage/upload/") && method === "PUT" && deps.storage instanceof LocalObjectStorage) {
      const claims = deps.storage.verifyUploadToken(url.pathname.slice("/dev-storage/upload/".length));
      if (!claims) throw new AppError("Forbidden", 403, "Invalid or expired upload capability");
      const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      if (contentType !== claims.contentType) throw new AppError("ValidationFailed", 400, "Content-Type does not match the capability");
      const body = await readBody(req, claims.maxBytes);
      await deps.storage.write(claims.name, body, claims.contentType);
      return sendNoContent(res);
    }

    if (url.pathname.startsWith("/api/")) {
      const user = await authenticate(req);
      const match = router.match(method, url.pathname);
      if (match === null && deps.v2) {
        // v2 never decides access: the notebook must exist and belong to the caller in PostgreSQL first.
        const notebookId = /^\/api\/notebooks\/([^/]+)\//.exec(url.pathname)?.[1];
        if (notebookId) deps.v2.syncNotebook(user.userId, await getNotebook(deps.pool, user.userId, decodeURIComponent(notebookId)));
        for (const handler of deps.v2.handlers) if (await handler(req, res, user.userId)) return;
      }
      if (match === null) throw new AppError("NotFound", 404, "API endpoint not found");
      if (match === "method") throw new AppError("MethodNotAllowed", 405, "Method not allowed");
      const ctx: RequestContext = { req, res, url, params: match.params, requestId, user };
      await match.handler(ctx);
      return;
    }

    if (method === "GET" && (await serveStatic(deps, url, res))) return;
    throw new AppError("NotFound", 404, "Not found");
  }

  return (req, res) => {
    const header = req.headers["x-request-id"];
    const requestId = typeof header === "string" && /^[\w-]{8,64}$/.test(header) ? header : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    handle(req, res, requestId).catch((err) => sendError(res, err, requestId));
  };
}
