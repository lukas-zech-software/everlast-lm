import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { evaluateMindmapFrameSamples } from "../src/studio/mindmap-viewer.ts";
import { captureMindmapFrames } from "./mindmap-browser-collector.ts";

/** [011-studio-mindmaps-data-tables] T059: real Chromium rendering; synthetic data, FR-ST-09/SC-003. */
test("MM-COLLECT: captures every declared 120-node operation frame and real drag changes the viewer", async ({ page }) => {
  const declaration = { declared_at: new Date().toISOString(), environment_kind: "local_fixture", fixture: "120 nodes: root+7 branches+28 subbranches+84 leaves", viewport: { width: 1440, height: 900 }, headless: true, node: process.version, platform: platform(), arch: arch(), cpus: cpus().map(cpu => cpu.model), memory_bytes: totalmem(), windows: [
    { operation: "pan" as const, frames: 5 }, { operation: "zoom" as const, frames: 5 },
    { operation: "collapse" as const, frames: 5 }, { operation: "expand" as const, frames: 5 },
  ], branch_policy: "deepest toggle; lexical node ID tie-break; synthetic fixture117-to120 or120-to117; pan/zoom120", metric: "requestAnimationFrame callback timestamp difference across one operation; setup outside action window; all20 frames retained" };
  await page.goto("/");
  // Browser fixture imports the emitted public application module, with no computed import.
  await page.addScriptTag({ type: "module", content: `
    import { createMindmapViewer } from "/studio/mindmap-viewer.js";
    const cite = { badge_number: 1, source_id: "01965b10-0000-7000-8000-000000000301", chunk_id: "01965b10-0000-7000-8000-000000000302", revision: 1, snippet: "Synthetic frame fixture" };
    const node = (id, children = []) => ({ id, label: id, summary: "Fixture", label_citations: [cite], summary_citations: [cite], children });
    const root = node("root", Array.from({ length: 7 }, (_, b) => node("b" + b, Array.from({ length: 4 }, (_, c) => node("c" + b + "-" + c, Array.from({ length: 3 }, (_, d) => node("d" + b + "-" + c + "-" + d)))))));
    const viewer = createMindmapViewer({ artifactId: "fixture", title: "120 node collector fixture", payload: { root_node: root, node_count: 120, max_depth: 4, initial_expanded_depth: 2, insufficient_evidence_note: null, citations: [cite] } });
    document.body.replaceChildren(viewer.element);
  ` });
  const viewer = page.getByTestId("studio-mindmap-viewer");
  await expect(viewer).toBeVisible();
  const canvas = viewer.getByTestId("mindmap-canvas");
  const before = await canvas.getAttribute("data-transform");
  const box = await canvas.boundingBox();
  await page.mouse.move(box!.x + box!.width - 10, box!.y + 350);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 50, box!.y + 330, { steps: 3 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-transform", before!);
  const samples = await captureMindmapFrames(page, declaration.windows);
  const observation = { kind: "local_fixture", declaration, browser: page.context().browser()!.version(), samples, report: evaluateMindmapFrameSamples(samples), release_eligible: false };
  writeFileSync(test.info().outputPath("frame-observations.json"), JSON.stringify(observation, null, 2));
  await test.info().attach("fixture-frame-observations", { body: Buffer.from(JSON.stringify(observation, null, 2)), contentType: "application/json" });
  expect(samples).toHaveLength(20);
  expect(new Set(samples.map(s => s.operation)).size).toBe(4);
  expect(samples.every(s => s.rendered_nodes_before === (s.operation === "expand" ? 117 : 120))).toBe(true);
  expect(samples.every(s => s.rendered_nodes_after === (s.operation === "collapse" ? 117 : 120))).toBe(true);
  expect(samples.every(s => s.node_count === 120 && Number.isFinite(s.duration_ms) && s.duration_ms >= 0)).toBe(true);
});
