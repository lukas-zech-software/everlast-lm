#!/usr/bin/env node
/**
 * Builds the SPA (FR-UI-01): `tsc` emits browser ESM with rewritten `.js` imports; static assets are copied.
 * No bundler or framework (plan.md: native DOM, tsc only).
 */
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";

rmSync("apps/web/dist", { recursive: true, force: true });
execFileSync("npx", ["tsc", "-p", "apps/web/tsconfig.build.json"], { stdio: "inherit" });
cpSync("apps/web/src/index.html", "apps/web/dist/index.html");
cpSync("apps/web/src/workspace.css", "apps/web/dist/workspace.css");
console.log("Built apps/web/dist");
