#!/usr/bin/env node
/**
 * Container entrypoint (Cloud Run): SERVICE_ROLE=api|worker selects the service (infra/modules/compute).
 * TypeScript sources run directly on Node 24 (type stripping); the SPA is prebuilt into apps/web/dist.
 */
const role = process.env.SERVICE_ROLE;
if (role === "api") await import("../apps/api/src/server.ts").then((m) => m.startApiServer());
else if (role === "worker") await import("../apps/worker/src/server.ts").then((m) => m.startWorker());
else {
  console.error(`SERVICE_ROLE must be "api" or "worker", got ${role ?? "unset"}`);
  process.exit(64);
}
