import http from "node:http";
import type { AddressInfo } from "node:net";
import { createTestDatabase, type TestDatabase } from "@everlast/db/testing";
import { createApp, type AppDeps } from "../src/app.ts";
import { LocalIdentityIssuer } from "../src/auth/identity.ts";
import type { ApiConfig } from "../src/config.ts";

/** TEST-ONLY: real API app on an ephemeral port, real isolated PostgreSQL, locally signed tokens. */

export interface TestApi {
  baseUrl: string;
  db: TestDatabase;
  issuer: LocalIdentityIssuer;
  deps: AppDeps;
  token(user: string): string;
  fetch(path: string, init?: RequestInit & { as?: string; json?: unknown }): Promise<Response>;
  close(): Promise<void>;
}

export async function startTestApi(
  overrides: Partial<ApiConfig> = {},
  extraOrFactory: Partial<AppDeps> | ((db: TestDatabase) => Partial<AppDeps>) = {}
): Promise<TestApi> {
  const db = await createTestDatabase();
  const extra = typeof extraOrFactory === "function" ? extraOrFactory(db) : extraOrFactory;
  const issuer = new LocalIdentityIssuer({ NODE_ENV: "test" });
  const deps: AppDeps = {
    pool: db.pool,
    config: { port: 0, authMode: "local", projectId: "test", sourceLimit: 50, checkRevocation: false, ...overrides },
    verifier: issuer.verifier,
    localIssuer: issuer,
    notifyJobs: () => undefined,
    ...extra,
  };
  const server = http.createServer(createApp(deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = (user: string) => issuer.issue(`local:${user}`, { email: `${user}@example.test` });
  return {
    baseUrl,
    db,
    issuer,
    deps,
    token,
    fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.as) headers.set("authorization", `Bearer ${token(init.as)}`);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(init.json);
      }
      return fetch(`${baseUrl}${path}`, { ...init, headers, body: body ?? null });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.drop();
    },
  };
}
