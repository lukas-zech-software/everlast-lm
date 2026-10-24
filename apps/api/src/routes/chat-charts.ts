import { createHash } from "node:crypto";
import { AppError } from "@everlast/contracts";
import { chartProvenanceAvailable, findPublishedChart, isUuid, requireOwnedNotebook } from "@everlast/db";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/**
 * Authorized private chart delivery (FR-GC-08 FR-005, NFR-SEC-02, NFR-EVAL-04; specs/010 T038).
 * GET /api/notebooks/:id/chat/messages/:messageId/charts/:artifactId — bearer-authenticated, Owner-checked
 * (404 missing / 403 foreign notebook), bound to a PUBLISHED artifact of a message in the caller's own thread whose
 * source provenance is still available. Re-checked on every request including byte ranges; no signed-URL bypass.
 * Bytes are served private/no-store with a sandboxing CSP so even an SVG cannot run anything.
 */

const NOT_FOUND = () => new AppError("NotFound", 404, "Chart not found");
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox";

export function registerChatChartRoutes(router: Router, deps: AppDeps): void {
  router.add("GET", "/api/notebooks/:id/chat/messages/:messageId/charts/:artifactId", async ({ req, res, url, user, params }) => {
    await requireOwnedNotebook(deps.pool, user.userId, params.id!);
    if (!isUuid(params.messageId) || !isUuid(params.artifactId)) throw NOT_FOUND();
    const chart = await findPublishedChart(deps.pool, { ownerId: user.userId, notebookId: params.id!, messageId: params.messageId!, artifactId: params.artifactId! });
    if (!chart || !(await chartProvenanceAvailable(deps.pool, params.id!, chart.source_snapshot))) throw NOT_FOUND();
    if (!deps.storage) throw new AppError("RetryableFailure", 503, "Storage is not configured");
    const bytes = await deps.storage.read(chart.object_key, chart.object_generation).catch(() => {
      throw NOT_FOUND();
    });
    // FR-011: deletion/clear may commit while the object store is being read. Recheck before sending any bytes.
    await requireOwnedNotebook(deps.pool, user.userId, params.id!);
    if (!(await findPublishedChart(deps.pool, { ownerId: user.userId, notebookId: params.id!, messageId: params.messageId!, artifactId: params.artifactId! })) ||
        !(await chartProvenanceAvailable(deps.pool, params.id!, chart.source_snapshot))) throw NOT_FOUND();
    // Integrity: the stored generation must still be exactly the validated, published bytes.
    if (createHash("sha256").update(bytes).digest("hex") !== chart.digest) throw NOT_FOUND();
    const extension = chart.mime_type === "image/png" ? "png" : "svg";
    const position = Math.max(1, Number(/chart_(\d)/.exec(chart.object_key)?.[1] ?? 1));
    const disposition = `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="chart-${position}.${extension}"`;
    const headers = {
      "Content-Type": chart.mime_type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": CSP,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": disposition,
      "Accept-Ranges": "bytes",
    };
    const size = bytes.length;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
        return;
      }
      const body = bytes.subarray(start, end + 1);
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": body.length }).end(body);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": size }).end(bytes);
  });
}
