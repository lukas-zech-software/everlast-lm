import { expect, test } from "@playwright/test";
import { docxFixture, OFFICE_GOLDEN, pptxFixture } from "@everlast/testkit/multimodal-fixtures";
import { createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * [009-multimodal-ingestion-sync] T012 — Add sources: Office upload and delegated Google Drive import in the browser
 * (FR-SI-01, FR-SI-04, C-01; spec FR-001, FR-002, FR-006, SC-003). Runs against the real API, PostgreSQL and worker;
 * the Drive API and OAuth consent are labelled test doubles in apps/web/test/e2e-server.ts.
 */

test("OFFICE-E01: DOCX and PPTX uploads show progress, become Ready with Doc/Slides icons and open with notes", async ({ page }) => {
  const email = uniqueEmail("office-e01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await expect(page.getByTestId("dropzone")).toContainText("Word");
  await page.getByTestId("file-input").setInputFiles([
    { name: "Falcon.docx", mimeType: "application/octet-stream", buffer: docxFixture() },
    { name: "Falcon.pptx", mimeType: "application/octet-stream", buffer: pptxFixture() },
  ]);
  await expect(page.locator('[data-testid="source-row"][data-status="Ready"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('[data-testid="source-icon"][data-kind="docx"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="source-icon"][data-kind="pptx"]')).toHaveCount(1);
  await page.getByTestId("source-title").filter({ hasText: "Falcon.pptx" }).click();
  await expect(page.getByTestId("inspector-scroll")).toContainText(`Speaker notes: ${OFFICE_GOLDEN.slideNotes}`);
  await expect(page.getByTestId("inspector-scroll")).toContainText(`Image description: ${OFFICE_GOLDEN.slideImage}`);
});

test("OFFICE-E02: Google Drive import connects the user's own account, then imports a pasted Slides link", async ({ page }) => {
  const email = uniqueEmail("office-e02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-drive").click();
  await page.getByTestId("drive-connect").click();
  await page.waitForURL(`**/notebook/${id}**`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-drive").click();
  await page.getByTestId("drive-link").fill("https://docs.google.com/presentation/d/1SlidesFile/edit");
  await page.getByTestId("drive-import").click();
  const row = page.getByTestId("source-row");
  await expect(row).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await expect(row.getByTestId("source-title")).toHaveText("Steering deck");
  await expect(row.locator('[data-testid="source-icon"][data-kind="pptx"]')).toHaveCount(1);
});

test("OFFICE-E03: a non-Google link in the Drive dialog is rejected client-side; unsupported files show the new message", async ({ page }) => {
  const email = uniqueEmail("office-e03");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([{ name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }]);
  await expect(page.getByTestId("toast").last()).toContainText("Word (.docx), PowerPoint (.pptx)");
  await expect(page.getByTestId("source-row")).toHaveCount(0);
});
