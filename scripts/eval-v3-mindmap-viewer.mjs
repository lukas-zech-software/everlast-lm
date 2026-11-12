#!/usr/bin/env node
/** [011-studio-mindmaps-data-tables] T060 — collect real browser rAF intervals or aggregate diagnostics (FR-ST-09/SC-003). */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch, cpus, platform, totalmem } from "node:os";
import { chromium } from "@playwright/test";
import { StudioMindmapPayloadSchema } from "../packages/contracts/src/index.ts";
import { captureMindmapFrames } from "../apps/web/test/mindmap-browser-collector.ts";
import { evaluateMindmapFrameSamples } from "../apps/web/src/studio/mindmap-viewer.ts";
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const out = arg("out") ?? "reports";
mkdirSync(out, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const provenance = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), node: process.version, platform: platform(), architecture: arch(), cpu_count: cpus().length, memory_bytes: totalmem() };
const write = record => writeFileSync(join(out, "v3-mindmap-viewer-benchmark.json"), JSON.stringify(record, null, 2));
let browser;
let plan;
let samples;
try {
  if (process.argv.includes("--collect")) {
    if (process.env.MINDMAP_VIEWER_BENCHMARK_IT !== "1" || !arg("plan") || !arg("storage-state")) {
      console.error("[UNAVAILABLE] eval:v3-mindmap-viewer: collection needs explicit opt-in, plan and private storage state.");
      write({ status: "UNAVAILABLE", release_eligible: false, reason: "Collection requires MINDMAP_VIEWER_BENCHMARK_IT=1, --plan and a private --storage-state authenticated browser session.", provenance });
      process.exitCode = 2;
    } else {
      const bytes = readFileSync(arg("plan")); plan = JSON.parse(bytes);
      provenance.plan_sha256 = hash(bytes);
      const url = new URL(plan.url);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(plan.environment_kind === "local_fixture" && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new Error("Use an HTTPS application URL without credentials/query; fixture HTTP must be loopback-only");
      if (!Number.isFinite(Date.parse(plan.declared_at)) || Date.parse(plan.declared_at) > Date.now() || !/^[a-f0-9]{64}$/.test(plan.fixture_sha256) || !/^[a-f\d-]{36}$/i.test(plan.artifact_id) || !plan.deployment_revision || !plan.environment || !plan.hardware || !["enterprise_live", "local_fixture"].includes(plan.environment_kind) || typeof plan.headless !== "boolean" || !Number.isInteger(plan.viewport?.width) || !Number.isInteger(plan.viewport?.height) || plan.viewport.width < 1 || plan.viewport.height < 1) throw new Error("Declare timestamp, payload fixture hash, artifact, revision, environment, hardware, headless mode and viewport before capture");
      // Validate the frame population before browser navigation or credentials are used.
      if (!Array.isArray(plan.windows) || plan.windows.some(w => !["pan", "zoom", "expand", "collapse"].includes(w.operation) || !Number.isInteger(w.frames) || w.frames < 1) || new Set(plan.windows.map(w => w.operation)).size !== 4 || plan.windows.reduce((n, w) => n + w.frames, 0) < 20) throw new Error("Predeclare all four operations and at least 20 frames");
      const checkpoint = observations => writeFileSync(join(out, "v3-mindmap-viewer-observations.json"), JSON.stringify({ plan, provenance, samples: observations, recorded_at: new Date().toISOString() }, null, 2));
      checkpoint([]);
      browser = await chromium.launch({ headless: plan.headless });
      provenance.browser = browser.version();
      const context = await browser.newContext({ viewport: plan.viewport, storageState: arg("storage-state") });
      const page = await context.newPage();
      await page.goto(plan.url);
      const row = page.locator(`[data-testid="studio-artifact-row"][data-artifact-id="${plan.artifact_id}"]`);
      const responsePromise = page.waitForResponse(r => r.url().startsWith(url.origin + "/api/notebooks/") && r.url().endsWith(`/studio/artifacts/${plan.artifact_id}`) && r.request().method() === "GET");
      await row.getByTestId("studio-artifact-open").click();
      const response = await responsePromise;
      const result = await response.json();
      if (!response.ok() || result.unavailable || result.artifact?.id !== plan.artifact_id || result.artifact?.status !== "Completed") throw new Error("Expected authorized Completed artifact");
      const payload = StudioMindmapPayloadSchema.parse(result.artifact.payload_json);
      if (payload.node_count !== 120 || hash(JSON.stringify(result.artifact.payload_json)) !== plan.fixture_sha256) throw new Error("Loaded mindmap does not match the predeclared 120-node payload digest");
      await page.locator('[data-testid="studio-mindmap-viewer"][data-node-count="120"]').waitFor();
      provenance.user_agent = await page.evaluate(() => navigator.userAgent);
      samples = await captureMindmapFrames(page, plan.windows, checkpoint);
      await page.screenshot({ path: join(out, "v3-mindmap-viewer.png"), fullPage: true });
    }
  } else if (arg("samples")) {
    const bytes = readFileSync(arg("samples"));
    provenance.observations_sha256 = hash(bytes);
    const imported = JSON.parse(bytes); samples = Array.isArray(imported) ? imported : imported.samples;
  } else {
    console.error("[UNAVAILABLE] eval:v3-mindmap-viewer: no frame collection executed.");
    write({ status: "UNAVAILABLE", release_eligible: false, reason: "No frame capture executed. Use --collect --plan <plan.json> --storage-state <private-state.json>, or --samples for diagnostics. A flag alone does not collect frames.", provenance });
    process.exitCode = 2;
  }
  if (samples) {
    const report = evaluateMindmapFrameSamples(samples);
    const eligible = report.passed;
    const status = report.passed ? eligible ? "PASS" : "DIAGNOSTIC_PASS" : "FAIL";
    write({ status, passed: report.passed, release_eligible: !!eligible, plan, provenance, node_count: 120, frame_report: report, recorded_at: new Date().toISOString() });
    console.log(JSON.stringify({ status, p95_frame_ms: report.p95_frame_ms, release_eligible: !!eligible }));
    process.exitCode = report.passed ? 0 : 1;
  }
} catch (error) {
  write({ status: "FAIL", release_eligible: false, reason: error instanceof Error ? error.name : "CollectionError", plan, provenance, recorded_at: new Date().toISOString() });
  console.error("[FAIL] eval:v3-mindmap-viewer: invalid evidence or failed browser collection; inspect the private checkpoint and browser trace.");
  process.exitCode = 1;
} finally {
  await browser?.close();
}
