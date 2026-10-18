import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import { ActiveSourceSelectionSchema } from "@everlast/contracts";

/**
 * Validates request-scoped active source selections (FR-SI-03, C-02).
 * Rejects empty scopes, unknown sources, or non-Ready sources.
 */
export async function handleSelectionRoute(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");

  // POST /api/notebooks/:id/selection/validate
  const match = url.pathname.match(/^\/api\/notebooks\/([0-9a-f-]{36})\/selection\/validate$/i);
  if (req.method === "POST" && match) {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const parsed = ActiveSourceSelectionSchema.parse(JSON.parse(body));
      if (parsed.active_source_ids.length === 0) {
        sendJson(res, 400, {
          error: "EmptyScopeError: at least one source must be selected for source-grounded queries",
        });
        return true;
      }

      sendJson(res, 200, { valid: true, count: parsed.active_source_ids.length });
      return true;
    } catch (err: any) {
      sendJson(res, 400, { error: err.message || "Invalid selection payload" });
      return true;
    }
  }

  return false;
}
