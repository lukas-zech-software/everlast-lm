#!/usr/bin/env node
/**
 * Monorepo lint script.
 * Validates spec integrity, architecture boundaries, Prettier formatting,
 * Tier-2 clean-code ESLint rules, and TypeScript type diagnostics across all workspaces.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function resolveBin(pkgName, binName = pkgName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!binRel) {
    throw new Error(`Could not resolve binary "${binName}" from ${pkgName}`);
  }
  return join(dirname(pkgJsonPath), binRel);
}

console.log("Checking spec integrity...");
execFileSync(process.execPath, ["scripts/check-spec-integrity.mjs"], { stdio: "inherit" });

console.log("Checking architecture fixtures and boundaries...");
execFileSync(process.execPath, ["--test", "scripts/test/architecture.test.mjs", "scripts/test/architecture-artifacts.test.mjs"], { stdio: "inherit" });
const architectureArgs = process.env.ARCHITECTURE_BASE_REF ? ["--base-ref", process.env.ARCHITECTURE_BASE_REF] : [];
execFileSync(process.execPath, ["scripts/check-architecture.mjs", ...architectureArgs], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check-architecture-artifacts.mjs", ...architectureArgs], { stdio: "inherit" });

console.log("Checking Prettier formatting...");
execFileSync(process.execPath, [resolveBin("prettier"), "--check", "."], { stdio: "inherit" });

console.log("Checking ESLint clean-code conventions...");
execFileSync(process.execPath, [resolveBin("eslint"), "."], { stdio: "inherit" });

console.log("Checking TypeScript compilation...");
// Direct compiler call: `npx` enforces devEngines and refuses other Node majors.
execFileSync(process.execPath, [resolveBin("typescript", "tsc"), "-b", "--noEmit"], { stdio: "inherit" });

console.log("✓ All lint checks passed.");
