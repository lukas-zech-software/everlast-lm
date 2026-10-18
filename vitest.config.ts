import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: false,
    include: [
      "**/test/**/*.test.ts",
      "**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/web/test/**/*.spec.ts", // Playwright E2E journeys
    ],
  },
});
