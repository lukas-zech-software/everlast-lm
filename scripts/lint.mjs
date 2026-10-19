#!/usr/bin/env node
/**
 * Monorepo lint script.
 * Validates spec integrity and TypeScript type diagnostics across all workspaces.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

console.log("Checking spec integrity...");
execFileSync("node", ["scripts/check-spec-integrity.mjs"], { stdio: "inherit" });

console.log("Checking TypeScript compilation...");
// Direct compiler call: `npx` enforces devEngines and refuses other Node majors.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-b", "--noEmit"], { stdio: "inherit" });

console.log("✓ All lint checks passed.");
