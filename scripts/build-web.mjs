#!/usr/bin/env node
/**
 * Builds the SPA (FR-UI-01): `tsc` emits browser ESM with rewritten `.js` imports; static assets are copied.
 * No bundler or framework (plan.md: native DOM, tsc only).
 */
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

rmSync("apps/web/dist", { recursive: true, force: true });
// Run the workspace TypeScript compiler directly: `npx` enforces devEngines and refuses other Node majors.
const tsPkg = createRequire(import.meta.url).resolve("typescript/package.json");
const tsc = join(dirname(tsPkg), "bin/tsc");
execFileSync(process.execPath, [tsc, "-p", "apps/web/tsconfig.build.json"], { stdio: "inherit" });
cpSync("apps/web/src/index.html", "apps/web/dist/index.html");
cpSync("apps/web/src/workspace.css", "apps/web/dist/workspace.css");
console.log("Built apps/web/dist");
