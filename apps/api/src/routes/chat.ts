import type { ServerResponse } from "node:http";
import { z } from "zod";
import { AppError, OutputLanguageSchema, isAppError } from "@everlast/contracts";
import { clearThread, getOrCreateThread, loadVisibleThread, searchThread } from "@everlast/db";
import { readJson, requireParam, sendJson, validationError } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/**
 * Chat routes (FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06). The turn endpoint streams Server-Sent Events: only
 * status events while the draft is buffered and verified, then exactly one final event (validated answer or
 * refusal) or an error event. Validation errors are returned as JSON before the stream starts.
 */

const TurnBody = z
  .object({
    message: z.string(),
    active_source_ids: z.array(z.string()),
    request_id: z.uuid(),
  })
  .strict();

/** First Accept-Language entry that is a supported output language (FR-UI-02 browser fallback). */
export function browserLocaleOf(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  for (const entry of header.split(",")) {
    const tag = entry.split(";")[0]?.trim();
    if (!tag || tag === "*") continue;
    try {
      const locale = Intl.getCanonicalLocales(tag)[0];
      if (locale && OutputLanguageSchema.safeParse(locale).success) return locale;
    } catch {
      // ignore malformed tags
    }
  }
  return undefined;
}

function countCodePoints(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch) count += 1;
  }
  return count;
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerChatRoutes(router: Router, deps: AppDeps): void {
  const chat = () => {
    if (!deps.chat) throw new AppError("RetryableFailure", 503, "Chat model is not configured");
    return deps.chat;
  };

  router.add(
    "POST",
    "/api/notebooks/:id/chat/turns",
    async ({ req, res, user, params, requestId }) => {
      const parsed = TurnBody.safeParse(await readJson(req, 200_000));
      if (!parsed.success) {
        const raw = parsed.error.issues[0];
        if (raw?.path[0] === "active_source_ids")
          throw new AppError(
            "EmptyScope",
            400,
            "active_source_ids must list at least one Ready source",
          );
        throw validationError("Body must be {message, active_source_ids, request_id}");
      }
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded)
          abort.abort(new AppError("GenerationCancelled", 409, "Client disconnected"));
      });
      const turn = chat().runTurn(
        {
          ownerId: user.userId,
          notebookId: requireParam(params, "id"),
          message: parsed.data.message,
          activeSourceIds: parsed.data.active_source_ids,
          requestId: parsed.data.request_id,
          browserLocale: browserLocaleOf(req.headers["accept-language"]),
        },
        abort.signal,
      );

      // Pull the first event before committing to a stream so scope/validation errors keep their HTTP status.
      const first = await turn.next();
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      try {
        for (let step = first; !step.done; step = await turn.next()) {
          const event = step.value;
          if (event.type === "status") {
            // FR-GC-08 FR-004: running_code carries only its execution identity and attempt ordinal.
            sse(
              res,
              "status",
              event.phase === "running_code"
                ? { phase: event.phase, execution_id: event.execution_id, attempt: event.attempt }
                : { phase: event.phase },
            );
          } else sse(res, "final", { messages: event.messages, replayed: event.replayed });
        }
      } catch (err) {
        const error = isAppError(err)
          ? { code: err.code, message: err.message }
          : {
              code: "InternalError",
              message: "An error occurred while generating the response. Please try again.",
            };
        if (!isAppError(err))
          console.error(
            JSON.stringify({
              severity: "ERROR",
              request_id: requestId,
              message: (err as Error).message,
            }),
          );
        sse(res, "error", { error, request_id: requestId });
      }
      res.end();
    },
  );

  router.add("GET", "/api/notebooks/:id/chat", async ({ res, user, params }) => {
    const notebookId = requireParam(params, "id");
    sendJson(res, 200, { messages: await loadVisibleThread(deps.pool, user.userId, notebookId) });
  });

  router.add("DELETE", "/api/notebooks/:id/chat", async ({ res, user, params }) => {
    const notebookId = requireParam(params, "id");
    const thread = await getOrCreateThread(deps.pool, user.userId, notebookId);
    deps.chat?.abortThread(thread.id);
    const result = await clearThread(deps.pool, user.userId, notebookId);
    sendJson(res, 200, { cleared: true, generation_epoch: result.generation_epoch });
  });

  router.add("GET", "/api/notebooks/:id/chat/search", async ({ res, url, user, params }) => {
    const notebookId = requireParam(params, "id");
    const q = url.searchParams.get("q") ?? "";
    if (countCodePoints(q.trim()) > 1000) throw validationError("Search term is too long");
    sendJson(res, 200, { results: await searchThread(deps.pool, user.userId, notebookId, q) });
  });
}
