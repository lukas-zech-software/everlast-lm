import http from "node:http";

/**
 * Native Node HTTP server entrypoint.
 * Interface stub for test compilation before T020 implementation.
 */

import { verifyBearerToken, resolveOwnerContext } from "./auth/identity.js";
import { WorkspaceService } from "./services/workspace.js";
import { handleNotebookRoute } from "./routes/notebooks.js";
import { handlePackageV22Route, type PackageV22ApiDependencies } from "./routes/package-v2-2.js";
import { handleChatRoute, type ChatServiceDependencies } from "./routes/chat.js";
import { sendJson } from "./http.js";

export function createServer(options?: { service?: WorkspaceService; projectId?: string; packageV22?: PackageV22ApiDependencies; chat?: ChatServiceDependencies }) {
  const service = options?.service || new WorkspaceService();
  const projectId = options?.projectId || process.env.GOOGLE_CLOUD_PROJECT || "everlast-test-project";

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // API routes require authentication
      if (url.pathname.startsWith("/api/")) {
        let identity;
        try {
          identity = await verifyBearerToken(req.headers.authorization, {
            projectId,
          });
        } catch (authErr: any) {
          sendJson(res, 401, {
            error: {
              code: "Unauthorized",
              message: authErr.message || "Unauthorized",
            },
          });
          return;
        }

        const ownerContext = resolveOwnerContext(identity);

        const packageV22 = options?.packageV22 ?? {
          authorizeNotebook: async (userId: string, notebookId: string) => Boolean(await service.getNotebook(userId, notebookId)),
          authorizeSource: async () => ({ exists: false, ready: false, revision: 0 }),
        };
        const featureHandled = await handlePackageV22Route(req, res, ownerContext.ownerId, packageV22);
        if (featureHandled) return;
        if (/^\/api\/notebooks\/[0-9a-f-]{36}\/chat(?:\/|$)/i.test(url.pathname)) {
          const notebookId = url.pathname.match(/^\/api\/notebooks\/([0-9a-f-]{36})\/chat/i)?.[1];
          if (!notebookId || !(await service.getNotebook(ownerContext.ownerId, notebookId))) {
            sendJson(res, 404, { error: { code: "NotFound", message: "Notebook not found" } });
            return;
          }
          const chatHandled = await handleChatRoute(req, res, options?.chat ?? {}, ownerContext.ownerId);
          if (chatHandled) return;
        }
        const handled = await handleNotebookRoute(req, res, service, ownerContext.ownerId);
        if (!handled) {
          sendJson(res, 404, {
            error: {
              code: "NotFound",
              message: "API endpoint not found",
            },
          });
        }
        return;
      }

      if (url.pathname === "/healthz") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err: any) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: {
            code: "InternalServerError",
            message: err.message || "Internal server error",
          },
        });
      }
    }
  });
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("server.ts")) {
  const server = createServer();
  const port = process.env.PORT || 8080;
  server.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
}
