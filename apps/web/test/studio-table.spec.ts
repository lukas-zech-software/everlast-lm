import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildPdf } from "@everlast/testkit/pdf-builder";
import { createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * [011-studio-mindmaps-data-tables] T041 — Browser E2E Data Table generation, conflict/missing cells,
 * column sorting, and safe CSV/XLSX downloads (FR-ST-18, FR-SI-03, NFR-EVAL-02/04;
 * FR-007, FR-008, FR-009, FR-011, FR-014, FR-015, FR-016, SC-005, SC-006, SC-008, SC-009, SC-010).
 */

const VENDOR_ALPHA = [
  "Vendor Alpha Enterprise Plan costs $10/month per seat and guarantees a 99.9% Uptime SLA.",
  "FormulaNote: =SUM(A1:A2) is included as a literal pricing expression in the contract.",
];
const VENDOR_BETA = [
  "Vendor Beta Cloud Suite costs $15/month per seat and guarantees a 99.95% Uptime SLA.",
];
const VENDOR_GAMMA = [
  "Vendor Gamma Starter Edition costs $20/month per seat. No uptime guarantee is stated in this contract.",
];
const ALPHA_ADDENDUM = [
  "2026 Pricing Addendum: Vendor Alpha Enterprise Plan costs $12/month per seat effective immediately.",
];

test("DT-E01: generates a cited 3-vendor comparison table, displays conflicting and missing cells, sorts rows, and downloads safe CSV and XLSX files", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("dte01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "VendorAlpha.pdf", buildPdf([{ kind: "text", lines: VENDOR_ALPHA }]));
  await uploadSource(page.request, email, id, "VendorBeta.pdf", buildPdf([{ kind: "text", lines: VENDOR_BETA }]));
  await uploadSource(page.request, email, id, "VendorGamma.pdf", buildPdf([{ kind: "text", lines: VENDOR_GAMMA }]));
  await uploadSource(page.request, email, id, "AlphaAddendum.pdf", buildPdf([{ kind: "text", lines: ALPHA_ADDENDUM }]));
  await waitReady(page.request, email, id, 4);

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("4 sources");

  await page.getByTestId("studio-data-table-tile").click();
  const modal = page.getByTestId("data-table-modal");
  await expect(modal).toBeVisible();
  await modal.getByTestId("data-table-focus-prompt").fill("Compare vendor pricing and SLA");
  await modal.getByTestId("data-table-schema-select").selectOption("vendor_comparison");
  await modal.getByTestId("data-table-generate").click();

  const row = page.getByTestId("studio-artifact-row").first();
  await expect(row).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });
  await row.getByTestId("studio-artifact-open").click();

  const viewer = page.getByTestId("studio-table-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("Vendor Alpha");
  await expect(viewer).toContainText("Vendor Beta");
  await expect(viewer).toContainText("Vendor Gamma");
  await expect(viewer).toContainText("N/A (Not in sources)");
  await expect(viewer.getByTestId("table-cell-conflict").first()).toBeVisible();

  // Sort by first column
  await viewer.getByTestId("table-sort-column").first().click();

  // Download CSV and verify UTF-8 BOM + neutralized formula prefix
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("table-export-csv").click(),
  ]);
  const csvPath = await csvDownload.path();
  expect(csvPath).toBeTruthy();
  const csvText = readFileSync(csvPath!, "utf8");
  expect(csvText.startsWith("\uFEFF")).toBe(true);
  expect(csvText).toContain("'=SUM(A1:A2)");

  // Download XLSX and verify PK\x03\x04 ZIP header
  const [xlsxDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("table-export-xlsx").click(),
  ]);
  const xlsxPath = await xlsxDownload.path();
  expect(xlsxPath).toBeTruthy();
  const xlsxBytes = readFileSync(xlsxPath!);
  expect(xlsxBytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
});
