import { defineConfig } from "vitest/config";

/**
 * Vitest projects (Constitution II, SC-CADENCE):
 * - unit: pure logic, no external services.
 * - integration: real PostgreSQL 16 + pgvector via TEST_DATABASE_URL (fails with UNAVAILABLE when unset).
 * Playwright journeys (*.spec.ts) run separately via `pnpm test:e2e`.
 */
const UNIT = [
  "packages/contracts/test/**/*.test.ts",
  "apps/api/test/identity.test.ts",
  "apps/api/test/chat-verifier.test.ts",
  "packages/cloud/test/ocr.test.ts",
  "apps/web/test/lib.test.ts",
  "packages/evals/test/release-v1.test.ts",
  "packages/evals/test/release-v1.boundaries.test.ts",
  "packages/evals/test/response-length.test.ts",
];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: false,
    projects: [
      { extends: true, test: { name: "unit", include: UNIT } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
          exclude: [...UNIT, "**/node_modules/**", "**/dist/**"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
