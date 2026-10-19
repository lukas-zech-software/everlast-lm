import { z } from "zod";
import {
  createNotebook,
  deleteNotebook,
  dismissSourceError,
  getCleanupStatus,
  getNotebook,
  getQuotaSummary,
  listNotebooks,
  renameNotebook,
} from "@everlast/db";
import { readJson, sendJson, sendNoContent, validationError } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/** Notebook CRUD, quota and deletion-status routes (FR-WM-01, FR-WM-04, FR-WM-07). */

const CreateBody = z.object({ title: z.string().optional() }).strict();
const RenameBody = z.object({ title: z.string() }).strict();

export function registerNotebookRoutes(router: Router, deps: AppDeps): void {
  router.add("GET", "/api/notebooks", async ({ res, user }) => {
    sendJson(res, 200, await listNotebooks(deps.pool, user.userId));
  });

  router.add("POST", "/api/notebooks", async ({ req, res, user }) => {
    const parsed = CreateBody.safeParse(await readJson(req));
    if (!parsed.success) throw validationError("Unknown or invalid notebook fields");
    const key = req.headers["idempotency-key"];
    const result = await createNotebook(deps.pool, user.userId, parsed.data, {
      idempotencyKey: typeof key === "string" ? key : undefined,
    });
    sendJson(res, 201, { notebook: result.notebook });
  });

  router.add("GET", "/api/notebooks/:id", async ({ res, user, params }) => {
    const notebook = await getNotebook(deps.pool, user.userId, params.id!);
    const quota = await getQuotaSummary(deps.pool, user.userId, notebook.id, deps.config.sourceLimit);
    sendJson(res, 200, { notebook, quota });
  });

  router.add("PATCH", "/api/notebooks/:id", async ({ req, res, user, params }) => {
    const parsed = RenameBody.safeParse(await readJson(req));
    if (!parsed.success) throw validationError("Only {title: string} may be changed");
    sendJson(res, 200, { notebook: await renameNotebook(deps.pool, user.userId, params.id!, parsed.data.title) });
  });

  router.add("DELETE", "/api/notebooks/:id", async ({ res, user, params }) => {
    const { deletion_id } = await deleteNotebook(deps.pool, user.userId, params.id!);
    deps.notifyJobs();
    sendJson(res, 202, { deletion_id, status: "Pending" });
  });

  router.add("GET", "/api/notebook-deletions/:id", async ({ res, user, params }) => {
    sendJson(res, 200, await getCleanupStatus(deps.pool, user.userId, params.id!));
  });

  router.add("GET", "/api/notebooks/:id/quota", async ({ res, user, params }) => {
    sendJson(res, 200, await getQuotaSummary(deps.pool, user.userId, params.id!, deps.config.sourceLimit));
  });

  router.add("DELETE", "/api/notebooks/:id/sources/:sourceId/error", async ({ res, user, params }) => {
    await dismissSourceError(deps.pool, user.userId, params.id!, params.sourceId!);
    sendNoContent(res);
  });
}
