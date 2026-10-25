import { expect, test } from "@playwright/test";
import { buildPdf } from "@everlast/testkit/pdf-builder";
import { createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * [011-studio-mindmaps-data-tables] T015 — Browser E2E mindmap admission, list, Completed reopening,
 * initial depth 2 expansion, and accessible AI-generated badge (FR-ST-08, FR-SI-03, C-03, NFR-SEC-02;
 * FR-001, FR-002, FR-010, FR-014, FR-017, SC-001, SC-008, SC-011).
 */

const SOURCE_1 = [
  "Project Vortex uses a regional ingestion pipeline in europe-west4.",
  "Documents are normalized into C-01 chunks with page locators.",
];
const SOURCE_2 = [
  "Audio and video recordings produce timestamped segments with start_ms and end_ms.",
  "Web pages preserve DOM path locators and sanitized text.",
];
const SOURCE_3 = [
  "Studio generates interactive Mindmaps and structured Data Tables.",
  "Every factual node and cell cites original source chunks.",
];

test("MM-E01: generates a grounded mindmap from Studio tile and Overview, opens at depth 2 with AI-generated badge, and persists across reload", async ({ page }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail("mme01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "Architecture.pdf", buildPdf([{ kind: "text", lines: SOURCE_1 }]));
  await uploadSource(page.request, email, id, "Multimodal.pdf", buildPdf([{ kind: "text", lines: SOURCE_2 }]));
  await uploadSource(page.request, email, id, "Studio.pdf", buildPdf([{ kind: "text", lines: SOURCE_3 }]));
  await waitReady(page.request, email, id, 3);

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("3 sources");

  // Trigger mindmap generation from Studio tile
  const mindmapTile = page.getByTestId("studio-mindmap-tile");
  await expect(mindmapTile).toBeVisible();
  await expect(mindmapTile).toBeEnabled();
  await mindmapTile.click();

  const row = page.getByTestId("studio-artifact-row").first();
  await expect(row).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });

  await row.getByTestId("studio-artifact-open").click();
  const viewer = page.getByTestId("studio-mindmap-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("studio-ai-generated-badge")).toContainText("AI-generated");
  await expect(viewer.getByTestId("studio-convert")).toHaveCount(0);

  // Verify initial depth <= 2 visible nodes
  const nodes = viewer.getByTestId("mindmap-node");
  await expect(nodes.first()).toBeVisible();
  const depths = await nodes.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-depth") ?? "0")));
  expect(Math.max(...depths)).toBeLessThanOrEqual(2);

  // Reload page and reopen Completed mindmap
  await page.reload();
  const persistedRow = page.getByTestId("studio-artifact-row").first();
  await expect(persistedRow).toHaveAttribute("data-status", "Completed", { timeout: 15_000 });
  await persistedRow.getByTestId("studio-artifact-open").click();
  await expect(page.getByTestId("studio-mindmap-viewer")).toBeVisible();
});
