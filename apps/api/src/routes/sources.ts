import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import {
  SourceSchema,
  CopiedTextInputSchema,
  type Source,
} from "@everlast/contracts";

/**
 * Sources HTTP Route Handler (FR-SI-01, FR-SI-03).
 */
export async function handleSourceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ownerId: string
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");

  // POST /api/notebooks/:notebook_id/sources/copied-text
  const copiedTextMatch = url.pathname.match(/^\/api\/notebooks\/([0-9a-f-]{36})\/sources\/copied-text$/i);
  if (req.method === "POST" && copiedTextMatch) {
    const notebookId = copiedTextMatch[1];
    if (!notebookId) {
      sendJson(res, 400, { error: "Missing notebook_id" });
      return true;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const parsedInput = CopiedTextInputSchema.parse(JSON.parse(body));
      const sourceId = "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0");
      const attemptId = "11111111-1111-4111-8111-" + Date.now().toString(16).padStart(12, "0");

      const source: Source = {
        id: sourceId,
        notebook_id: notebookId,
        title: parsedInput.title,
        media_type: "copied_text",
        status: "Ready",
        byte_size: Buffer.byteLength(parsedInput.text, "utf8"),
        word_count: parsedInput.text.trim().split(/\s+/).filter(Boolean).length,
        revision_id: 1,
        attempt_id: attemptId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      sendJson(res, 201, { source });
      return true;
    } catch (err: any) {
      sendJson(res, 400, { error: err.message || "Invalid input" });
      return true;
    }
  }

  return false;
}
