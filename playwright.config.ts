import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E (FR-UI-01, FR-WM-01, FR-SI-01/03/04, FR-GC-01/02/03/06, Gate v1.0 #1/#3) against the real
 * API + PostgreSQL via apps/web/test/e2e-server.ts. Requires TEST_DATABASE_URL (else UNAVAILABLE).
 */
const port = Number(process.env.E2E_PORT ?? 4317);

export default defineConfig({
  testDir: "./apps/web/test",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/build-web.mjs && node apps/web/test/e2e-server.ts",
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_PORT: String(port), TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
