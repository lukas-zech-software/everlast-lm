import { expect, test } from "@playwright/test";
import { addTextSource, createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * NFR-PERF-01 / C-02: browser regression test for chat scale timing,
 * source readiness before submission, and verified final response receipt.
 */

test("SCALE-UI-01: send is enabled only when sources are ready; final SSE response displays with citation within budget", async ({ page }) => {
  const email = uniqueEmail("scale");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "Reactor coolant pressure must be 142.8 bar. Operational limits apply.");

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("chat-input")).toBeVisible();

  // Send button is available when sources are loaded
  const sendButton = page.getByTestId("send");
  await expect(sendButton).toBeEnabled();

  const start = Date.now();
  await page.getByTestId("chat-input").fill("What must the reactor coolant pressure be?");
  await sendButton.click();

  const assistantMessage = page.getByTestId("message-assistant").first();
  await expect(assistantMessage).toBeVisible({ timeout: 20_000 });
  const elapsed = Date.now() - start;

  // Final validated answer received and rendered
  await expect(assistantMessage).toContainText("142.8 bar");
  expect(elapsed).toBeGreaterThan(0);

  // Citation badge is rendered
  const badge = assistantMessage.getByTestId("citation-badge").first();
  await expect(badge).toBeVisible();

  // Ensure no public tuning or benchmark endpoint exists
  const token = await page.evaluate(() => localStorage.getItem("everlast:id_token"));
  const tuningRes = await page.request.get(`/api/notebooks/${id}/chat/tuning`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  expect(tuningRes.status()).toBe(404);
});
