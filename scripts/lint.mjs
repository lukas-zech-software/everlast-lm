#!/usr/bin/env node
/**
 * Monorepo lint script.
 * Validates spec integrity and TypeScript type diagnostics across all workspaces.
 */

import { execFileSync } from "node:child_process";

console.log("Checking spec integrity...");
execFileSync("node", ["scripts/check-spec-integrity.mjs"], { stdio: "inherit" });

console.log("Checking TypeScript compilation...");
execFileSync("npx", ["tsc", "-b", "--noEmit"], { stdio: "inherit" });

console.log("✓ All lint checks passed.");
