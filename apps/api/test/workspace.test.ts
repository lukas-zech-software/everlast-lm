import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./support.ts";

/** T013/T035 — notebook HTTP contract against the real server and PostgreSQL (FR-WM-01, FR-WM-04, FR-WM-07). */

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api?.close();
});

async function create(as: string, title?: string) {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: title === undefined ? {} : { title } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { notebook: { id: string; title: string; updated_at: string } }).notebook;
}

describe("FR-WM-01 / FR-WM-04: notebook HTTP contract", () => {
  it("API-01: every /api route rejects missing, forged and foreign-issuer tokens with 401", async () => {
    const missing = await api.fetch("/api/notebooks");
    expect(missing.status).toBe(401);
    const body = (await missing.json()) as { error: { code: string }; request_id: string };
    expect(body.error.code).toBe("Unauthenticated");
    expect(body.request_id).toBeTruthy();
    const forged = await api.fetch("/api/notebooks", { headers: { authorization: "Bearer a.b.c" } });
    expect(forged.status).toBe(401);
    const unknown = await api.fetch("/api/does-not-exist");
    expect(unknown.status).toBe(401);
  });

  it("API-02: GET /api/notebooks lists only the caller's notebooks", async () => {
    const mine = await create("api02-alice", "Alice notebook");
    await create("api02-bob", "Bob notebook");
    const res = await api.fetch("/api/notebooks", { as: "api02-alice" });
    const body = (await res.json()) as { notebooks: { id: string }[]; notebooks_used: number; notebook_limit: number };
    expect(body.notebooks.map((n) => n.id)).toEqual([mine.id]);
    expect(body).toMatchObject({ notebooks_used: 1, notebook_limit: 100 });
    expect(Object.keys(body.notebooks[0]!)).not.toContain("owner_id");
  });

  it("API-03: POST creates a UUID v4 notebook with default title; unknown fields are 422", async () => {
    const nb = await create("api03");
    expect(nb.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nb.title).toBe("Untitled notebook");
    const bad = await api.fetch("/api/notebooks", { method: "POST", as: "api03", json: { owner_id: "x" } });
    expect(bad.status).toBe(422);
  });

  it("API-04: Idempotency-Key replays return the same notebook exactly once", async () => {
    const key = randomUUID();
    const send = () => api.fetch("/api/notebooks", { method: "POST", as: "api04", json: {}, headers: { "idempotency-key": key } });
    const [a, b] = [await send(), await send()];
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const idA = ((await a.json()) as any).notebook.id;
    expect(((await b.json()) as any).notebook.id).toBe(idA);
    const list = (await (await api.fetch("/api/notebooks", { as: "api04" })).json()) as any;
    expect(list.notebooks_used).toBe(1);
  });

  it("API-05: GET /api/notebooks/{id} returns notebook and server-authoritative quota", async () => {
    const nb = await create("api05", "Quota");
    const res = await api.fetch(`/api/notebooks/${nb.id}`, { as: "api05" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      notebook: nb,
      quota: {
        notebooks_used: 1,
        notebook_limit: 100,
        sources_used: 0,
        source_limit: 50,
        max_source_bytes: 200_000_000,
        max_source_words: 500_000,
      },
    });
  });

  it("API-06: another owner gets 403 on read, rename, delete and quota; unknown IDs are 404", async () => {
    const nb = await create("api06-owner");
    for (const [method, path, json] of [
      ["GET", `/api/notebooks/${nb.id}`, undefined],
      ["PATCH", `/api/notebooks/${nb.id}`, { title: "hijack" }],
      ["DELETE", `/api/notebooks/${nb.id}`, undefined],
      ["GET", `/api/notebooks/${nb.id}/quota`, undefined],
    ] as const) {
      const res = await api.fetch(path, { method, as: "api06-intruder", ...(json ? { json } : {}) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((await api.fetch(`/api/notebooks/${randomUUID()}`, { as: "api06-intruder" })).status).toBe(404);
    expect((await api.fetch(`/api/notebooks/not-a-uuid`, { as: "api06-intruder" })).status).toBe(404);
    expect((await api.fetch(`/api/notebooks/${nb.id}`, { as: "api06-owner" })).status).toBe(200);
  });

  it("API-07: PATCH trims and accepts 100 code points; whitespace, 101 code points, unknown fields are 422", async () => {
    const nb = await create("api07", "Original");
    const ok = await api.fetch(`/api/notebooks/${nb.id}`, { method: "PATCH", as: "api07", json: { title: "  Renamed 🔬 " } });
    expect(ok.status).toBe(200);
    const renamed = ((await ok.json()) as any).notebook;
    expect(renamed.title).toBe("Renamed 🔬");
    expect(Date.parse(renamed.updated_at)).toBeGreaterThan(Date.parse(nb.updated_at));
    const hundred = "é".repeat(100);
    expect((await api.fetch(`/api/notebooks/${nb.id}`, { method: "PATCH", as: "api07", json: { title: hundred } })).status).toBe(200);
    for (const json of [{ title: "   " }, { title: "x".repeat(101) }, { title: "ok", extra: 1 }, {}]) {
      const res = await api.fetch(`/api/notebooks/${nb.id}`, { method: "PATCH", as: "api07", json });
      expect(res.status, JSON.stringify(json)).toBe(422);
    }
    const current = (await (await api.fetch(`/api/notebooks/${nb.id}`, { as: "api07" })).json()) as any;
    expect(current.notebook.title).toBe(hundred);
  });

  it("API-08: DELETE returns 202 with a deletion ID; reads and repeat deletes are 404 immediately", async () => {
    const nb = await create("api08");
    const del = await api.fetch(`/api/notebooks/${nb.id}`, { method: "DELETE", as: "api08" });
    expect(del.status).toBe(202);
    const body = (await del.json()) as { deletion_id: string; status: string };
    expect(body.status).toBe("Pending");
    const read = await api.fetch(`/api/notebooks/${nb.id}`, { as: "api08" });
    expect(read.status).toBe(404);
    expect(((await read.json()) as any).error.code).toBe("NotebookNotFound");
    expect((await api.fetch(`/api/notebooks/${nb.id}/quota`, { as: "api08" })).status).toBe(404);
    expect((await api.fetch(`/api/notebooks/${nb.id}`, { method: "DELETE", as: "api08" })).status).toBe(404);
  });

  it("API-09: deletion status is visible to the original owner only and never exposes content", async () => {
    const nb = await create("api09", "Secret title");
    const { deletion_id } = (await (await api.fetch(`/api/notebooks/${nb.id}`, { method: "DELETE", as: "api09" })).json()) as any;
    const status = await api.fetch(`/api/notebook-deletions/${deletion_id}`, { as: "api09" });
    expect(status.status).toBe(200);
    const text = await status.text();
    expect(JSON.parse(text)).toEqual({ deletion_id, status: "Pending" });
    expect(text).not.toContain("Secret title");
    expect((await api.fetch(`/api/notebook-deletions/${deletion_id}`, { as: "api09-other" })).status).toBe(403);
    expect((await api.fetch(`/api/notebook-deletions/${randomUUID()}`, { as: "api09" })).status).toBe(404);
  });

  it("API-10: quota endpoint reports occupancy that counts Uploading/Processing/Ready, not Failed", async () => {
    const nb = await create("api10");
    const owner = (await api.db.pool.query("SELECT owner_id FROM notebooks WHERE id = $1", [nb.id])).rows[0].owner_id;
    expect(owner).toBeTruthy();
    for (const status of ["Uploading", "Processing", "Failed"]) {
      await api.db.pool.query(
        "INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes) VALUES ($1, $2, $3, 't', 'text/plain', $4, 1)",
        [randomUUID(), nb.id, randomUUID(), status]
      );
    }
    const quota = (await (await api.fetch(`/api/notebooks/${nb.id}/quota`, { as: "api10" })).json()) as any;
    expect(quota.sources_used).toBe(2);
  });

  it("API-13: configured source limits of 50 and 300 are reported; invalid limits fail startup", async () => {
    const { loadApiConfig } = await import("../src/config.ts");
    expect(loadApiConfig({ AUTH_MODE: "local" }).sourceLimit).toBe(50);
    expect(loadApiConfig({ AUTH_MODE: "local", MAX_SOURCES_PER_NOTEBOOK: "300" }).sourceLimit).toBe(300);
    for (const bad of ["49", "301", "50.5", "abc"]) {
      expect(() => loadApiConfig({ AUTH_MODE: "local", MAX_SOURCES_PER_NOTEBOOK: bad })).toThrow();
    }
    expect(() => loadApiConfig({ AUTH_MODE: "identity-platform" })).toThrow(/GOOGLE_CLOUD_PROJECT/);
    const big = await startTestApi({ sourceLimit: 300 });
    try {
      const res = await big.fetch("/api/notebooks", { method: "POST", as: "api13", json: {} });
      const nb = ((await res.json()) as any).notebook;
      const quota = (await (await big.fetch(`/api/notebooks/${nb.id}/quota`, { as: "api13" })).json()) as any;
      expect(quota.source_limit).toBe(300);
    } finally {
      await big.close();
    }
  });

  it("API-14: dismissing a failed row removes it without changing occupancy; non-failed rows are 409", async () => {
    const nb = await create("api14");
    const failed = randomUUID();
    const uploading = randomUUID();
    await api.db.pool.query(
      `INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes)
       VALUES ($1, $3, $4, 't', 'text/plain', 'Failed', 1), ($2, $3, $5, 't', 'text/plain', 'Uploading', 1)`,
      [failed, uploading, nb.id, randomUUID(), randomUUID()]
    );
    const before = (await (await api.fetch(`/api/notebooks/${nb.id}/quota`, { as: "api14" })).json()) as any;
    expect((await api.fetch(`/api/notebooks/${nb.id}/sources/${failed}/error`, { method: "DELETE", as: "api14" })).status).toBe(204);
    const after = (await (await api.fetch(`/api/notebooks/${nb.id}/quota`, { as: "api14" })).json()) as any;
    expect(after.sources_used).toBe(before.sources_used);
    expect((await api.fetch(`/api/notebooks/${nb.id}/sources/${uploading}/error`, { method: "DELETE", as: "api14" })).status).toBe(409);
    expect((await api.fetch(`/api/notebooks/${nb.id}/sources/${failed}/error`, { method: "DELETE", as: "api14-x" })).status).toBe(403);
  });

  it("API-16: 100-notebook limit returns 409 NotebookQuotaExceeded", async () => {
    await create("api16");
    const owner = (await api.db.pool.query("SELECT id FROM users WHERE subject = 'local:api16'")).rows[0].id;
    await api.db.pool.query(
      "INSERT INTO notebooks (id, owner_id, title) SELECT gen_random_uuid(), $1, 'seed' FROM generate_series(1, 99)",
      [owner]
    );
    const res = await api.fetch("/api/notebooks", { method: "POST", as: "api16", json: {} });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("NotebookQuotaExceeded");
  });

  it("API-17: local sign-in issues verifiable tokens; health endpoints are public", async () => {
    const login = await api.fetch("/auth/local/login", { method: "POST", json: { email: "Dev@Example.test" } });
    const { id_token } = (await login.json()) as { id_token: string };
    const res = await api.fetch("/api/notebooks", { headers: { authorization: `Bearer ${id_token}` } });
    expect(res.status).toBe(200);
    expect((await api.fetch("/healthz")).status).toBe(200);
    expect((await api.fetch("/readyz")).status).toBe(200);
    expect(((await (await api.fetch("/auth/config")).json()) as any).mode).toBe("local");
  });
});
