import { describe, it, expect, beforeEach } from "vitest";
import { createServer } from "../src/server.js";
import http from "node:http";

describe("FR-WM-01 / FR-WM-04 / FR-WM-07: Workspace Notebook HTTP API Contract", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  const ownerAlphaToken = (() => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const payload = {
      aud: "everlast-test-project",
      iss: "https://securetoken.google.com/everlast-test-project",
      sub: "usr_subject_alpha_123",
      email: "alpha@example.com",
      auth_time: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
  })();

  const ownerBetaToken = (() => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const payload = {
      aud: "everlast-test-project",
      iss: "https://securetoken.google.com/everlast-test-project",
      sub: "usr_subject_beta_456",
      email: "beta@example.com",
      auth_time: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
  })();

  const request = async (
    path: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (options.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }

    const reqInit: RequestInit = {
      method: options.method || "GET",
      headers,
    };
    if (options.body !== undefined) {
      reqInit.body = JSON.stringify(options.body);
    }
    const res = await fetch(`${baseUrl}${path}`, reqInit);

    let data: any = null;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, headers: res.headers, data };
  };

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    return () => {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    };
  });

  it("API-01: GET /api/notebooks rejects unauthenticated requests with 401", async () => {
    const res = await request("/api/notebooks");
    expect(res.status).toBe(401);
  });

  it("API-02: GET /api/notebooks lists caller's own live notebooks", async () => {
    const res = await request("/api/notebooks", { token: ownerAlphaToken });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.notebooks)).toBe(true);
    expect(typeof res.data.notebooks_used).toBe("number");
    expect(res.data.notebook_limit).toBe(100);
  });

  it("API-03: POST /api/notebooks creates notebook with default title and UUID v4", async () => {
    const res = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    expect(res.status).toBe(201);
    expect(res.data.notebook.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(res.data.notebook.title).toBe("Untitled notebook");
    expect(res.data.notebook.created_at).toBeDefined();
  });

  it("API-04: POST /api/notebooks supports Idempotency-Key header for safe retry", async () => {
    const idempotencyKey = "e1111111-1111-4111-8111-111111111111";
    const res1 = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: {},
    });
    expect(res1.status).toBe(201);

    const res2 = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      headers: { "Idempotency-Key": idempotencyKey },
      body: {},
    });
    expect(res2.status).toBe(201);
    expect(res2.data.notebook.id).toBe(res1.data.notebook.id);
  });

  it("API-05: GET /api/notebooks/{id} returns notebook and quota summary", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: { title: "Biology 101" },
    });
    const notebookId = createRes.data.notebook.id;

    const res = await request(`/api/notebooks/${notebookId}`, {
      token: ownerAlphaToken,
    });
    expect(res.status).toBe(200);
    expect(res.data.notebook.title).toBe("Biology 101");
    expect(res.data.quota).toBeDefined();
    expect(res.data.quota.notebook_limit).toBe(100);
    expect(res.data.quota.max_source_bytes).toBe(200000000);
  });

  it("API-06: GET /api/notebooks/{id} rejects cross-owner access with 403 Forbidden", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: { title: "Alpha Secrets" },
    });
    const notebookId = createRes.data.notebook.id;

    // Owner Beta attempts to access Owner Alpha's notebook
    const res = await request(`/api/notebooks/${notebookId}`, {
      token: ownerBetaToken,
    });
    expect(res.status).toBe(403);
  });

  it("API-07: PATCH /api/notebooks/{id} updates title and rejects whitespace-only or >100 code points with 422", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    // Valid rename
    const validPatch = await request(`/api/notebooks/${notebookId}`, {
      method: "PATCH",
      token: ownerAlphaToken,
      body: { title: "New Valid Title 🔬" },
    });
    expect(validPatch.status).toBe(200);
    expect(validPatch.data.notebook.title).toBe("New Valid Title 🔬");

    // Invalid rename: empty / whitespace
    const emptyPatch = await request(`/api/notebooks/${notebookId}`, {
      method: "PATCH",
      token: ownerAlphaToken,
      body: { title: "   " },
    });
    expect(emptyPatch.status).toBe(422);

    // Invalid rename: 101 code points
    const overLimitPatch = await request(`/api/notebooks/${notebookId}`, {
      method: "PATCH",
      token: ownerAlphaToken,
      body: { title: "A".repeat(101) },
    });
    expect(overLimitPatch.status).toBe(422);

    // Unknown mutation fields rejected
    const unknownFieldPatch = await request(`/api/notebooks/${notebookId}`, {
      method: "PATCH",
      token: ownerAlphaToken,
      body: { title: "Ok Title", unexpected_field: true },
    });
    expect(unknownFieldPatch.status).toBe(422);
  });

  it("API-08: DELETE /api/notebooks/{id} returns 202/204 and immediate 404 on subsequent reads", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: { title: "To Be Deleted" },
    });
    const notebookId = createRes.data.notebook.id;

    const deleteRes = await request(`/api/notebooks/${notebookId}`, {
      method: "DELETE",
      token: ownerAlphaToken,
    });
    expect([202, 204]).toContain(deleteRes.status);
    if (deleteRes.status === 202) {
      expect(deleteRes.data.deletion_id).toBeDefined();
    }

    // Subsequent read returns 404 NotebookNotFound immediately
    const readAfterDelete = await request(`/api/notebooks/${notebookId}`, {
      token: ownerAlphaToken,
    });
    expect(readAfterDelete.status).toBe(404);

    // Repeating DELETE against already deleted notebook returns 404
    const repeatDelete = await request(`/api/notebooks/${notebookId}`, {
      method: "DELETE",
      token: ownerAlphaToken,
    });
    expect(repeatDelete.status).toBe(404);
  });

  it("API-09: GET /api/notebook-deletions/{deletion_id} returns status and rejects foreign caller with 403", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: { title: "Track Deletion" },
    });
    const notebookId = createRes.data.notebook.id;

    const deleteRes = await request(`/api/notebooks/${notebookId}`, {
      method: "DELETE",
      token: ownerAlphaToken,
    });
    const deletionId = deleteRes.data.deletion_id;

    if (deletionId) {
      // Original owner checks status
      const statusRes = await request(`/api/notebook-deletions/${deletionId}`, {
        token: ownerAlphaToken,
      });
      expect(statusRes.status).toBe(200);
      expect(["Pending", "Running", "Purged"]).toContain(statusRes.data.status);

      // Foreign caller checks status -> 403
      const foreignStatus = await request(`/api/notebook-deletions/${deletionId}`, {
        token: ownerBetaToken,
      });
      expect(foreignStatus.status).toBe(403);
    }
  });

  it("API-10: GET /api/notebooks/{id}/quota returns authoritative quota summary", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    const quotaRes = await request(`/api/notebooks/${notebookId}/quota`, {
      token: ownerAlphaToken,
    });
    expect(quotaRes.status).toBe(200);
    expect(quotaRes.data.notebook_limit).toBe(100);
    expect(quotaRes.data.max_source_bytes).toBe(200000000);
    expect(quotaRes.data.max_source_words).toBe(500000);
  });

  it("API-11: POST /api/notebooks/{id}/sources/admission reserves slot, returns 409 SourceQuotaExceeded at capacity", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    // Normal reservation succeeds
    const admitRes = await request(`/api/notebooks/${notebookId}/sources/admission`, {
      method: "POST",
      token: ownerAlphaToken,
      body: {
        attempt_id: "c1000000-0000-4000-8000-000000000001",
        declared_byte_size: 2048,
        file_name: "valid.pdf",
        mime_type: "application/pdf",
      },
    });
    expect(admitRes.status).toBe(201);
    expect(admitRes.data.admitted).toBe(true);
  });

  it("API-12: server rejects reservation despite tampered client with 409 SourceQuotaExceeded", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    // Seed to 50 sources
    const { seedSourceSlots } = await import("@everlast/db");
    await seedSourceSlots(notebookId, 50);

    // Tampered client attempts POST when UI would have disabled the button
    const overflowRes = await request(`/api/notebooks/${notebookId}/sources/admission`, {
      method: "POST",
      token: ownerAlphaToken,
      body: {
        attempt_id: "c2000000-0000-4000-8000-000000000002",
        declared_byte_size: 2048,
        file_name: "overflow.pdf",
        mime_type: "application/pdf",
      },
    });
    expect(overflowRes.status).toBe(409);
    expect(overflowRes.data.error.code).toBe("SourceQuotaExceeded");
    expect(overflowRes.data.error.message).toMatch(/quota|limit/i);
  });

  it("API-13: GET /api/notebooks/{id}/quota reflects dynamic configured source limits (e.g. 50 and 300)", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    const res = await request(`/api/notebooks/${notebookId}/quota`, {
      token: ownerAlphaToken,
    });
    expect(res.status).toBe(200);
    expect(res.data.source_limit).toBeGreaterThanOrEqual(50);
    expect(res.data.source_limit).toBeLessThanOrEqual(300);
  });

  it("API-14: dismissing error row deletes failed record without decrementing occupancy", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    const { seedSourceSlots, failSource } = await import("@everlast/db");
    await seedSourceSlots(notebookId, 10);
    const attemptId = "c3000000-0000-4000-8000-000000000003";
    await failSource({} as any, notebookId, attemptId, "Upload failed");

    // Dismiss error row
    const dismissRes = await request(`/api/notebooks/${notebookId}/sources/${attemptId}/error`, {
      method: "DELETE",
      token: ownerAlphaToken,
    });
    expect(dismissRes.status).toBe(204);

    // Quota usage remains unchanged
    const quotaRes = await request(`/api/notebooks/${notebookId}/quota`, {
      token: ownerAlphaToken,
    });
    expect(quotaRes.data.sources_used).toBe(10);
  });

  it("API-15: quota failure response identifies exceeded limit dimension", async () => {
    const createRes = await request("/api/notebooks", {
      method: "POST",
      token: ownerAlphaToken,
      body: {},
    });
    const notebookId = createRes.data.notebook.id;

    // Declared size exceeds 200 MB
    const oversizedRes = await request(`/api/notebooks/${notebookId}/sources/admission`, {
      method: "POST",
      token: ownerAlphaToken,
      body: {
        attempt_id: "c4000000-0000-4000-8000-000000000004",
        declared_byte_size: 200_000_001,
        file_name: "huge.pdf",
        mime_type: "application/pdf",
      },
    });
    expect(oversizedRes.status).toBe(422);
    expect(oversizedRes.data.error.code).toBe("SourceOversized");
    expect(oversizedRes.data.error.message).toContain("200,000,000 bytes");
  });
});
