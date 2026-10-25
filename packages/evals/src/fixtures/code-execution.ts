/**
 * Code-execution fixtures (FR-GC-08, NFR-EVAL-01..04; specs/010 T002). The builders live in the test-only
 * `@everlast/testkit` package so API/DB/web suites can share them without an evals dependency; this module is the
 * eval-facing entry point named by the plan.
 */
export * from "@everlast/testkit/code-execution-fixtures";
