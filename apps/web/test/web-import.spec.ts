import { expect, test } from "@playwright/test";
import { WEB_GOLDEN } from "@everlast/testkit/multimodal-fixtures";
import { createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * [009-multimodal-ingestion-sync] T021 — Website import in the browser (FR-SI-01, NFR-SEC-02; spec FR-003, FR-006,
 * FR-008). The page fetch goes through the real SSRF guard with a labelled resolver/transport double.
 */

test("WEB-E01: Website import shows progress, then a Ready row with the globe icon and the article in the Inspector", async ({ page }) => {
  const email = uniqueEmail("web-e01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-website").click();
  await expect(page.getByTestId("url-import")).toBeDisabled();
  await page.getByTestId("url-input").fill("https://news.example.test/articles/depot-automation");
  await page.getByTestId("url-import").click();
  const row = page.getByTestId("source-row");
  await expect(row).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await expect(row.getByTestId("source-title")).toHaveText(WEB_GOLDEN.title);
  await expect(row.locator('[data-testid="source-icon"][data-kind="web"]')).toHaveCount(1);
  await row.getByTestId("source-title").click();
  await expect(page.getByTestId("inspector-scroll")).toContainText(WEB_GOLDEN.paragraphs[0]);
  await expect(page.getByTestId("inspector-scroll")).not.toContainText(WEB_GOLDEN.advert);
});

test("WEB-E02: a 403 page becomes a dismissible error row with the exact message", async ({ page }) => {
  const email = uniqueEmail("web-e02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-website").click();
  await page.getByTestId("url-input").fill("https://news.example.test/forbidden");
  await page.getByTestId("url-import").click();
  await expect(page.getByTestId("source-error")).toHaveText("Unable to extract content from URL", { timeout: 30_000 });
  await expect(page.getByTestId("source-quota")).toHaveText("0 / 50 sources");
});
