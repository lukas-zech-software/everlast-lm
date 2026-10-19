import http from "node:http";

/**
 * Native Node HTTP server entrypoint.
 * Interface stub for test compilation before T020 implementation.
 */

import { verifyBearerToken, resolveOwnerContext } from "./auth/identity.js";
import { WorkspaceService } from "./services/workspace.js";
import { handleNotebookRoute } from "./routes/notebooks.js";
import { handleWorkspacePreferencesRoute } from "./routes/workspace-preferences.js";
import { handleChatRoute, type ChatServiceDependencies } from "./routes/chat.js";
import { sendJson } from "./http.js";

export function createServer(options?: { service?: WorkspaceService; projectId?: string; chatDependencies?: ChatServiceDependencies }) {
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

        const chatPath = url.pathname.match(/^\/api\/notebooks\/([^/]+)\/chat(?:\/|$)/);
        if (chatPath) {
          const notebookId = chatPath[1]!;
          const notebook = await service.getNotebook(ownerContext.ownerId, notebookId);
          if (!notebook) {
            const raw = service.getNotebookRaw(notebookId);
            sendJson(res, raw && raw.owner_id !== ownerContext.ownerId ? 403 : 404, {
              error: { code: raw && raw.owner_id !== ownerContext.ownerId ? "Forbidden" : "NotebookNotFound", message: "Notebook is unavailable" },
            });
            return;
          }
        }
        const chatDependencies: ChatServiceDependencies = {
          ...options?.chatDependencies,
          resolveLanguagePreferences: options?.chatDependencies?.resolveLanguagePreferences
            ?? ((notebookId, userId, browserLocale) => service.resolveLanguagePreferences(userId, notebookId, browserLocale)),
        };
        const handled = await handleNotebookRoute(req, res, service, ownerContext.ownerId)
          || await handleWorkspacePreferencesRoute(req, res, service, ownerContext.ownerId)
          || await handleChatRoute(req, res, chatDependencies, ownerContext.ownerId);
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
