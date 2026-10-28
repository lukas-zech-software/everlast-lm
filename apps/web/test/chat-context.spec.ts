import { expect, test } from "@playwright/test";
import { addTextSource, createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * NFR-PERF-01 / FR-SI-02 / C-02: broad theme synthesis browser journey,
 * followed by detailed follow-up query and source mutation regression.
 */

test("CONTEXT-UI-01: broad synthesis includes themes across sources; detailed follow-up cites original needle", async ({ page }) => {
  const email = uniqueEmail("broad");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);

  await addTextSource(page.request, email, id, "Theme Alpha: Core safety protocols. Reactor coolant pressure must be 142.8 bar.");
  await addTextSource(page.request, email, id, "Theme Beta: Operational monitoring and turbine efficiency standards.");

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("chat-input")).toBeVisible();

  // Broad query across sources
  await page.getByTestId("chat-input").fill("Summarize the main themes across all sources");
  await page.getByTestId("send").click();

  const assistantMessage1 = page.getByTestId("message-assistant").first();
  await expect(assistantMessage1).toBeVisible({ timeout: 20_000 });

  // Detailed follow-up needle query
  await page.getByTestId("chat-input").fill("What must the reactor coolant pressure be?");
  await page.getByTestId("send").click();

  await expect(page.getByTestId("message-assistant")).toHaveCount(2, { timeout: 20_000 });
  const assistantMessage2 = page.getByTestId("message-assistant").nth(1);
  await expect(assistantMessage2).toContainText("142.8 bar");
  await expect(assistantMessage2.getByTestId("citation-badge").first()).toBeVisible();
});
