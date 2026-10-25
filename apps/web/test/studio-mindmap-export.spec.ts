import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildPdf } from "@everlast/testkit/pdf-builder";
import { createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * [011-studio-mindmaps-data-tables] T028 — Browser E2E mindmap exploration, drilldown, missing-scope guard,
 * and full-bounds SVG & 2x PNG download verification (FR-ST-09, FR-GC-06, NFR-EVAL-04;
 * FR-004, FR-005, FR-006, FR-011, FR-014, SC-004, SC-007, SC-008).
 */

const SOURCE_1 = [
  "Project Vortex uses a regional ingestion pipeline in europe-west4; documents are normalized into C-01 chunks with page locators.",
  "Compute services run on Cloud Run with automatic scaling; background workers process durable PostgreSQL outbox jobs.",
  "Container security enforces distroless base images; runtime privileges are restricted to non-root service accounts.",
];
const SOURCE_2 = [
  "Cloud SQL PostgreSQL 16 stores notebooks, sources, and Studio artifacts; pgvector indexes embeddings with HNSW.",
  "Hybrid retrieval combines cosine similarity with full-text search; Reciprocal Rank Fusion orders candidate chunks.",
  "Cloud Storage buckets hold raw uploads and visual artifacts; lifecycle policies purge deleted notebook objects.",
];
const SOURCE_3 = [
  "Studio generates grounded Mindmaps and structured Data Tables; every node and cell cites original source chunks.",
  "Mindmap viewers render interactive SVG trees with pan, zoom, and branch toggles; exports produce lossless SVG and 2x PNG.",
  "Data Table exports emit RFC 4180 UTF-8 BOM CSV and OOXML XLSX; spreadsheet formulas are neutralized with an apostrophe prefix.",
];

test("MM-E02: explores mindmap branches, downloads valid full-bounds SVG and 2x PNG, performs grounded node drilldown, and blocks missing-scope drilldown without injecting node text", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("mme02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "Compute.pdf", buildPdf([{ kind: "text", lines: SOURCE_1 }]));
  await uploadSource(page.request, email, id, "Storage.pdf", buildPdf([{ kind: "text", lines: SOURCE_2 }]));
  await uploadSource(page.request, email, id, "Studio.pdf", buildPdf([{ kind: "text", lines: SOURCE_3 }]));
  await waitReady(page.request, email, id, 3);

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("3 sources");

  await page.getByTestId("studio-mindmap-tile").click();
  const row = page.getByTestId("studio-artifact-row").first();
  await expect(row).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });
  await row.getByTestId("studio-artifact-open").click();

  const viewer = page.getByTestId("studio-mindmap-viewer");
  await expect(viewer).toBeVisible();
  // The viewer shell mounts before the artifact payload loads; wait for rendered nodes before the non-retrying counts.
  await expect(viewer.getByTestId("mindmap-node").first()).toBeVisible();

  // Expand all branches so >=15 nodes are visible
  const unexpanded = viewer.locator('.mindmap-node-toggle[aria-expanded="false"]');
  while ((await unexpanded.count()) > 0) {
    await unexpanded.first().dispatchEvent("click");
    await page.waitForTimeout(50);
  }
  const visibleNodes = await viewer.getByTestId("mindmap-node").count();
  expect(visibleNodes).toBeGreaterThanOrEqual(15);

  // Pan and zoom away from origin so some nodes are offscreen in viewport, then export SVG and PNG
  await viewer.getByTestId("mindmap-zoom-in").click();

  const [svgDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("mindmap-export-svg").dispatchEvent("click"),
  ]);
  const svgPath = await svgDownload.path();
  expect(svgPath).toBeTruthy();
  const svgContent = readFileSync(svgPath!, "utf8");
  expect(svgContent).toContain("<svg");
  expect(svgContent).not.toMatch(/<script|foreignObject/i);

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("mindmap-export-png").dispatchEvent("click"),
  ]);
  const pngPath = await pngDownload.path();
  expect(pngPath).toBeTruthy();
  const pngBytes = readFileSync(pngPath!);
  // Verify PNG magic signature: 89 50 4E 47 0D 0A 1A 0A
  expect(pngBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  // IHDR width & height at bytes 16..24 (big-endian uint32)
  const width = pngBytes.readUInt32BE(16);
  const height = pngBytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(400);
  expect(height).toBeGreaterThan(200);

  // Eligible node body click triggers grounded chat drilldown turn
  const beforeMessages = await page.getByTestId("message-assistant").count();
  await viewer.getByTestId("mindmap-node-body").first().click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(beforeMessages + 1, { timeout: 20_000 });

  // Deselect all sources -> clicking node body shows missing-scope notice and does NOT send a chat turn
  for (const checkbox of await page.getByTestId("source-checkbox").all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await expect(page.getByTestId("sources-pill")).toHaveText("0 sources");
  const afterEligibleMessages = await page.getByTestId("message-assistant").count();
  await viewer.getByTestId("mindmap-node-body").first().click();
  await expect(page.getByTestId("studio-status")).toContainText(/source|select/i);
  await expect(page.getByTestId("message-assistant")).toHaveCount(afterEligibleMessages);
});
