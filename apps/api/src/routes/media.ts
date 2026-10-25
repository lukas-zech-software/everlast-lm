import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "@everlast/contracts";
import { getSource, requireOwnedNotebook, type Pool } from "@everlast/db";
import { sendJson } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/**
 * Authorized source media delivery (FR-SI-01/04/05, NFR-SEC-02; specs/009 T030). The Inspector's `<audio>` element
 * cannot send a bearer header, so the API issues a short-lived capability bound to (user, notebook, source,
 * revision). It is not a bearer bypass: EVERY request — including each Range request — re-checks notebook ownership,
 * that the source still exists, is Ready and still at that revision, before any byte is streamed. Deleting or
 * re-syncing a source therefore stops an already issued player URL on its next request. No signed Cloud Storage URL
 * is ever handed out.
 */

const TTL_MS = 30 * 60 * 1000;

interface MediaClaims {
  u: string;
  n: string;
  s: string;
  r: number;
  e: number;
}

export function issueMediaToken(key: Buffer, claims: Omit<MediaClaims, "e">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, e: now + TTL_MS })).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

function verifyMediaToken(key: Buffer, token: string): MediaClaims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", key).update(payload).digest("base64url"));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MediaClaims;
    return Date.now() <= claims.e ? claims : null;
  } catch {
    return null;
  }
}

export function mediaUrlFor(deps: AppDeps, userId: string, notebookId: string, sourceId: string, revision: number): string {
  return `/media/${issueMediaToken(deps.mediaTokenKey!, { u: userId, n: notebookId, s: sourceId, r: revision })}`;
}

async function currentMedia(pool: Pool, claims: MediaClaims): Promise<{ name: string; generation: string; mediaType: string } | "gone" | null> {
  const row = await pool.query<{ status: string; active_revision: number | null; media_type: string; media_object_name: string | null; media_object_generation: string | null }>(
    `SELECT s.status, s.active_revision, s.media_type, r.media_object_name, r.media_object_generation
       FROM sources s LEFT JOIN source_revisions r ON r.notebook_id = s.notebook_id AND r.source_id = s.id AND r.revision = $3
      WHERE s.notebook_id = $1 AND s.id = $2`,
    [claims.n, claims.s, claims.r]
  );
  const s = row.rows[0];
  if (!s) return null;
  if (s.status !== "Ready" || s.active_revision !== claims.r || !s.media_object_name || !s.media_object_generation) return "gone";
  return { name: s.media_object_name, generation: s.media_object_generation, mediaType: s.media_type };
}

/** GET /media/:token — re-authorized on every request; supports single byte ranges. */
export async function handleMediaRequest(deps: AppDeps, req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const claims = deps.mediaTokenKey ? verifyMediaToken(deps.mediaTokenKey, token) : null;
  if (!claims) throw new AppError("Forbidden", 403, "Invalid or expired media link");
  try {
    await requireOwnedNotebook(deps.pool, claims.u, claims.n);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) throw new AppError("NotFound", 404, "Media not found");
    throw new AppError("Forbidden", 403, "Media access denied");
  }
  const media = await currentMedia(deps.pool, claims);
  if (media === null) throw new AppError("NotFound", 404, "Media not found");
  if (media === "gone") throw new AppError("NotFound", 410, "This media version is no longer available");
  if (!deps.storage) throw new AppError("RetryableFailure", 503, "Storage is not configured");
  const reauthorize = async () => {
    await requireOwnedNotebook(deps.pool, claims.u, claims.n);
    const current = await currentMedia(deps.pool, claims);
    if (!current || current === "gone" || current.name !== media.name || current.generation !== media.generation) {
      throw new AppError("NotFound", 410, "This media version is no longer available");
    }
  };
  const meta = await deps.storage.stat(media.name);
  const size = meta && meta.generation === media.generation ? meta.size : (await deps.storage.read(media.name, media.generation)).length;
  // Stored streams of video sources keep their own content type; uploads use the source media type.
  const contentType = meta?.contentType && meta.generation === media.generation ? meta.contentType : media.mediaType;
  const headers = { "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1]) end = size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
      return;
    }
    start = Math.max(0, start);
    const body = deps.storage.readRange
      ? await deps.storage.readRange(media.name, media.generation, start, end)
      : (await deps.storage.read(media.name, media.generation)).subarray(start, end + 1);
    await reauthorize();
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": body.length }).end(body);
    return;
  }
  const body = await deps.storage.read(media.name, media.generation);
  await reauthorize();
  res.writeHead(200, { ...headers, "Content-Length": body.length }).end(body);
}

export function registerMediaRoutes(router: Router, deps: AppDeps): void {
  router.add("GET", "/api/notebooks/:id/sources/:sourceId/media", async ({ res, user, params }) => {
    const source = await getSource(deps.pool, user.userId, params.id!, params.sourceId!);
    if (source.status !== "Ready" || source.active_revision === null) throw new AppError("SourceNotReady", 409, "Source is not ready");
    sendJson(res, 200, { url: mediaUrlFor(deps, user.userId, source.notebook_id, source.id, source.active_revision) });
  });
}
