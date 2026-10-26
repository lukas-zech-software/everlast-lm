import { defineConfig } from "vitest/config";

/**
 * Vitest projects (Constitution II, SC-CADENCE):
 * - unit: pure logic, no external services.
 * - integration: real PostgreSQL 16 + pgvector via TEST_DATABASE_URL (fails with UNAVAILABLE when unset).
 * Playwright journeys (*.spec.ts) run separately via `pnpm test:e2e`.
 */
const UNIT = [
  "packages/evals/test/latency.test.ts",
  "packages/evals/test/v3-scale-client.test.ts",
  "apps/api/test/benchmark-readiness.test.ts",
  "packages/evals/test/v3-scale.eval.test.ts",
  "packages/contracts/test/**/*.test.ts",
  "apps/api/test/identity.test.ts",
  "apps/api/test/chat-verifier.test.ts",
  "packages/cloud/test/ocr.test.ts",
  "apps/web/test/lib.test.ts",
  "packages/evals/test/release-v1.test.ts",
  "packages/evals/test/release-v1.boundaries.test.ts",
  "packages/evals/test/response-length.test.ts",
  // Package 3.2 (specs/010 T003): pure sandbox adapter/manifest/output/model tests (no database, no provider).
  "apps/api/test/code-execution-runtime.test.ts",
  "apps/api/test/code-execution-manifest.test.ts",
  "apps/api/test/code-execution-output.test.ts",
  "apps/api/test/code-execution-model.test.ts",
  "apps/api/test/chat-sanitize.test.ts",
  "packages/evals/test/code-execution-performance.test.ts",
  // Package 3.3 (specs/011 T003): pure mindmap/table pipeline, viewer layout, eval and performance aggregation tests.
  "apps/worker/test/mindmap.test.ts",
  "apps/worker/test/studio-evidence.test.ts",
  "apps/worker/test/data-table.test.ts",
  "apps/web/test/studio-mindmap.test.ts",
  "apps/web/test/mindmap-viewer.test.ts",
  "apps/web/test/mindmap-performance.test.ts",
  "apps/web/test/studio-table.test.ts",
  "packages/evals/test/studio-structure.eval.test.ts",
  "packages/evals/test/studio-structure-performance.test.ts",
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
