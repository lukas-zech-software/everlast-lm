#!/usr/bin/env node
/**
 * Runner guard for test/eval suites.
 * Enforces Constitution Principle II and Task T003:
 * Absent downstream suites must report UNAVAILABLE and never pass on zero tests.
 */

const suite = process.argv[2] || "unknown";

const UNAVAILABLE_SUITES = {
  "eval:judged": "Model-judged evaluation suites (NFR-EVAL-01, NFR-EVAL-03) are owned by downstream packages 1.3 and 1.4.",
  "eval:release": "Release v1.0 combined gate evaluation is owned by package 1.4.",
};

if (suite in UNAVAILABLE_SUITES) {
  console.error(`[UNAVAILABLE] Suite '${suite}': ${UNAVAILABLE_SUITES[suite]}`);
  console.error("In accordance with Constitution II & CC-02, absent suites must report UNAVAILABLE and cannot pass.");
  process.exit(2);
}

console.error(`[UNAVAILABLE] Suite '${suite}' is not available.`);
process.exit(1);
