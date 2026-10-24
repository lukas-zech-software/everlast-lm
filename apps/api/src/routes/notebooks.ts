import { z } from "zod";
import { AppError, NotebookIconSchema, NotebookSortOrderSchema, type NotebookDto } from "@everlast/contracts";
import {
  countReadySources,
  createNotebook,
  deleteNotebook,
  dismissSourceError,
  getCleanupStatus,
  getNotebook,
  getQuotaSummary,
  listNotebooks,
  renameNotebook,
  setReadySourceCount,
} from "@everlast/db";
import { readJson, sendJson, sendNoContent, validationError } from "../http.ts";
import type { Router } from "../router.ts";
import type { AppDeps } from "../app.ts";

/**
 * Notebook CRUD, quota and deletion-status routes (FR-WM-01, FR-WM-04, FR-WM-07). With the release v2 runtime
 * (D16) the notebook rows also carry icon, Ready count and the caller's pin and last-opened state
 * (FR-WM-02, FR-WM-03); PostgreSQL stays the authority for existence and ownership.
 */

const CreateBody = z.object({ title: z.string().optional() }).strict();
const RenameBody = z.object({ title: z.string() }).strict();
const IconBody = z.object({ icon_emoji: z.string() }).strict();

export function registerNotebookRoutes(router: Router, deps: AppDeps): void {
  /** v1 DTO plus v2 overview fields (owner-scoped, never another user's state). */
  const present = async (userId: string, notebook: NotebookDto) => {
    if (!deps.v2) return notebook;
    const { owner_id: _owner, ...decorated } = await deps.v2.workspace.decorate(userId, deps.v2.syncNotebook(userId, notebook));
    return decorated;
  };
  const refreshReadyCount = async (userId: string, notebookId: string) => {
    setReadySourceCount(notebookId, (await countReadySources(deps.pool, userId)).get(notebookId) ?? 0);
  };

  router.add("GET", "/api/notebooks", async ({ res, user, url }) => {
    const list = await listNotebooks(deps.pool, user.userId);
    const v2 = deps.v2;
    if (!v2) return sendJson(res, 200, list);
    const requested = url.searchParams.get("sort_order");
    const sort = requested ? NotebookSortOrderSchema.safeParse(requested) : null;
    if (sort && !sort.success) throw new AppError("InvalidPreference", 400, "Unsupported sort_order");
    const ready = await countReadySources(deps.pool, user.userId);
    const notebooks = list.notebooks.map((nb) => {
      setReadySourceCount(nb.id, ready.get(nb.id) ?? 0);
      return v2.syncNotebook(user.userId, nb);
    });
    const overview = await v2.workspace.overview(user.userId, notebooks, sort?.success ? sort.data : undefined);
    sendJson(res, 200, { ...list, notebooks: overview.map(({ owner_id: _owner, ...rest }) => rest) });
  });

  router.add("POST", "/api/notebooks", async ({ req, res, user }) => {
    const parsed = CreateBody.safeParse(await readJson(req));
    if (!parsed.success) throw validationError("Unknown or invalid notebook fields");
    const key = req.headers["idempotency-key"];
    const result = await createNotebook(deps.pool, user.userId, parsed.data, {
      idempotencyKey: typeof key === "string" ? key : undefined,
    });
    sendJson(res, 201, { notebook: await present(user.userId, result.notebook) });
  });

  router.add("GET", "/api/notebooks/:id", async ({ res, user, params }) => {
    const notebook = await getNotebook(deps.pool, user.userId, params.id!);
    const quota = await getQuotaSummary(deps.pool, user.userId, notebook.id, deps.config.sourceLimit);
    if (deps.v2) await refreshReadyCount(user.userId, notebook.id);
    sendJson(res, 200, { notebook: await present(user.userId, notebook), quota });
  });

  router.add("PATCH", "/api/notebooks/:id", async ({ req, res, user, params }) => {
    const parsed = RenameBody.safeParse(await readJson(req));
    if (!parsed.success) throw validationError("Only {title: string} may be changed");
    const notebook = await renameNotebook(deps.pool, user.userId, params.id!, parsed.data.title);
    sendJson(res, 200, { notebook: await present(user.userId, notebook) });
  });

  router.add("DELETE", "/api/notebooks/:id", async ({ res, user, params }) => {
    const { deletion_id } = await deleteNotebook(deps.pool, user.userId, params.id!);
    deps.chat?.abortNotebook(params.id!);
    await deps.v2?.notebookDeleted(params.id!);
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
    // Release v2 (FR-WM-02): removing a source advances the notebook's modified time.
    if (deps.v2) await deps.v2.notebookModified(user.userId, await getNotebook(deps.pool, user.userId, params.id!));
    sendNoContent(res);
  });

  // ---- Release v2 (FR-WM-02, FR-WM-03): custom icon and last-opened state ----------------------------
  router.add("PATCH", "/api/notebooks/:id/icon", async ({ req, res, user, params }) => {
    const v2 = deps.v2;
    if (!v2) throw new AppError("NotFound", 404, "API endpoint not found");
    const notebook = await getNotebook(deps.pool, user.userId, params.id!);
    const parsed = IconBody.safeParse(await readJson(req));
    if (!parsed.success || !NotebookIconSchema.safeParse(parsed.data.icon_emoji).success) {
      throw new AppError("InvalidEmoji", 400, "Icon must be one valid emoji grapheme");
    }
    v2.syncNotebook(user.userId, notebook);
    await v2.workspace.updateNotebookIcon(user.userId, notebook.id, parsed.data.icon_emoji);
    sendJson(res, 200, { notebook: await present(user.userId, notebook) });
  });

  router.add("POST", "/api/notebooks/:id/opened", async ({ res, user, params }) => {
    const v2 = deps.v2;
    if (!v2) throw new AppError("NotFound", 404, "API endpoint not found");
    const notebook = await getNotebook(deps.pool, user.userId, params.id!);
    v2.syncNotebook(user.userId, notebook);
    await v2.workspace.markNotebookOpened(user.userId, notebook.id);
    sendNoContent(res);
  });
}
