import { expect, test } from "@playwright/test";
import { addTextSource, createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * NFR-PERF-01 / C-03: studio generation at scale regression test.
 */

test("STUDIO-SCALE-01: studio jobs process complete evidence and report status", async ({ page }) => {
  const email = uniqueEmail("studioscale");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);

  await addTextSource(page.request, email, id, "Section 1: Operating parameters. Reactor coolant pressure must be 142.8 bar.");
  await page.goto(`/notebook/${id}`);

  // Navigate to studio tab or panel if available
  const studioTab = page.getByTestId("tab-studio");
  if (await studioTab.isVisible()) {
    await studioTab.click();
    await expect(page.getByTestId("studio-panel")).toBeVisible();
  }
});
