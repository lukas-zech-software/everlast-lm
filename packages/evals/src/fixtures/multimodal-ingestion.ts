/**
 * Versioned synthetic multimodal fixtures (FR-SI-01 Subset B, FR-SI-05, FR-NM-03, C-01; specs/009 T002).
 * The builders live in the test-only `@everlast/testkit` package so worker/API suites can share them without an
 * evals dependency; this module is the eval-facing entry point named by the plan.
 */
export * from "@everlast/testkit/multimodal-fixtures";
