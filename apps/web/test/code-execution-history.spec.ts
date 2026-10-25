import { expect, test, type Page } from "@playwright/test";
import { LATENCY_TABLE_PAGE } from "@everlast/testkit/code-execution-fixtures";
import { addTextSource, createNotebook, signIn, uniqueEmail, waitReady } from "./helpers.ts";

/**
 * [010-code-execution-sandbox] T035 (browser part) — code-execution history, source-selection scoping, retry reload,
 * source-deletion redaction, clear-chat cancellation and save-to-note compatibility against the real API, PostgreSQL,
 * C-02 and SSE (FR-GC-08, FR-GC-06, FR-GC-09, FR-SI-03/05, FR-NM-02; spec FR-005, FR-006, FR-007, FR-009, FR-010,
 * FR-011, SC-005, SC-007).
 * Model and sandbox are labelled TEST DOUBLES in e2e-server.ts / e2e-v3-doubles.ts.
 */

async function ask(page: Page, question: string) {
  const before = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-input").fill(question);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(before + 1, { timeout: 20_000 });
  return page.getByTestId("message-assistant").nth(before);
}

async function setup(page: Page, prefix: string) {
  const email = uniqueEmail(prefix);
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, LATENCY_TABLE_PAGE);
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  return { email, id };
}

test("CE-HIST-E01: a corrected calculation retains both attempts in order across page reload, marks the second as final, and saves cleanly to notes", async ({ page }) => {
  await setup(page, "ce-hist-e01");

  const answer = await ask(page, "What is the exact population standard deviation of the monthly latency (retry test)?");
  await expect(answer.locator(".computed-label")).toHaveText(["Computed"]);
  await expect(answer.getByTestId("computed-chart")).toBeVisible();

  // Save to notes and verify the note appears in the Notes panel without raw execution trace JSON.
  await answer.locator('[data-action="save-note"]').click();
  await expect(answer.getByRole("status")).toHaveText("Saved to notes");
  const card = page.getByTestId("note-card").filter({ hasText: "population standard deviation" });
  await expect(card).toHaveAttribute("data-origin", "saved_response");
  await expect(card).not.toContainText("ZeroDivisionError");

  // Reload the page and verify both attempts and the chart reload in order from PostgreSQL history.
  await page.reload();
  const reloaded = page.getByTestId("message-assistant").first();
  await expect(reloaded.locator(".computed-label")).toHaveText(["Computed"]);
  await expect(reloaded.getByTestId("computed-chart")).toBeVisible();

  const toggle = reloaded.getByTestId("code-drawer-toggle");
  await toggle.click();
  const attempts = reloaded.getByTestId("code-attempt");
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0)).toHaveAttribute("data-ordinal", "1");
  await expect(attempts.nth(0)).toHaveAttribute("data-final", "false");
  await expect(attempts.nth(0)).toContainText("ZeroDivisionError");
  await expect(attempts.nth(0)).toContainText("not published");
  await expect(attempts.nth(1)).toHaveAttribute("data-ordinal", "2");
  await expect(attempts.nth(1)).toHaveAttribute("data-final", "true");
  await expect(attempts.nth(1)).toContainText("Final attempt");
  await expect(attempts.nth(1).getByTestId("code-published")).toBeVisible();
});

test("CE-HIST-E02: removing a cited source immediately hides the computed answer, code drawer, Computed pill and chart without a manual reload", async ({ page }) => {
  await setup(page, "ce-hist-e02");

  const answer = await ask(page, "What is the exact population standard deviation of the monthly latency?");
  await expect(answer.locator(".computed-label")).toHaveCount(1);
  await expect(answer.getByTestId("computed-chart")).toBeVisible();
  await expect(answer.getByTestId("code-drawer-toggle")).toBeVisible();

  // Remove the cited source via the sidebar menu.
  await page.getByTestId("source-menu").click();
  await page.getByTestId("source-remove").click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();

  await expect(page.getByTestId("source-row")).toHaveCount(0);
  const redacted = page.getByTestId("message-assistant").first();
  await expect(redacted).toContainText("This answer is unavailable because a cited source was deleted.");
  await expect(redacted.locator(".computed-label")).toHaveCount(0);
  await expect(redacted.getByTestId("computed-chart")).toHaveCount(0);
  await expect(redacted.getByTestId("chart-download")).toHaveCount(0);
  await expect(redacted.getByTestId("code-drawer-toggle")).toHaveCount(0);
});

test("CE-HIST-E03: Send is disabled while a computation is in flight, and Clear chat cancels the active run and removes computed messages and charts", async ({ page }) => {
  await setup(page, "ce-hist-e03");

  // First complete one computed turn so there is a message and chart in the thread.
  const first = await ask(page, "What is the exact sample standard deviation of the monthly latency?");
  await expect(first.getByTestId("computed-chart")).toBeVisible();

  // Start a second computation (held ~1.2s in e2eSandbox); Send must be disabled while in flight.
  await page.getByTestId("chat-input").fill("What is the exact population standard deviation of the monthly latency?");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("chat-status")).toHaveText("Running code…", { timeout: 2_500 });
  await expect(page.getByTestId("send")).toBeDisabled();

  // Clear chat while the second computation is running.
  await page.getByTestId("clear-chat").click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Clear chat" }).click();

  await expect(page.getByTestId("message-assistant")).toHaveCount(0);
  await expect(page.getByTestId("computed-chart")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("message-assistant")).toHaveCount(0);
});
