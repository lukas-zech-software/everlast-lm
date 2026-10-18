import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/server.js";
import http from "node:http";

describe("T036 [P] [US3] Admission-Latency Assertion (FR-WM-07, SC-003)", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  const ownerToken = (() => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const payload = {
      aud: "everlast-test-project",
      iss: "https://securetoken.google.com/everlast-test-project",
      sub: "usr_subject_perf_123",
      email: "perf@example.com",
      auth_time: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
  })();

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 8080;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("PERF-03: declared > 200,000,000 bytes rejected within <= 200 ms before issuing upload capability", async () => {
    // 1. Create a notebook
    const createRes = await fetch(`${baseUrl}/api/notebooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ title: "Perf NB" }),
    });
    const createData = (await createRes.json()) as any;
    const notebookId = createData.notebook.id;

    // 2. Measure pre-upload admission rejection latency for declared 250 MB
    const start = performance.now();
    const admissionRes = await fetch(`${baseUrl}/api/notebooks/${notebookId}/sources/admission`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        attempt_id: "a5000000-0000-4000-8000-000000000001",
        declared_byte_size: 250_000_000, // > 200,000,000 bytes
        file_name: "oversized_declared.pdf",
        mime_type: "application/pdf",
      }),
    });
    const durationMs = performance.now() - start;

    expect(admissionRes.status).toBe(422);
    const body = (await admissionRes.json()) as any;
    expect(body.error.code).toBe("SourceOversized");
    expect(durationMs).toBeLessThanOrEqual(200);
  });
});
