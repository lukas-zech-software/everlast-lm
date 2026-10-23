import { expect, test, type Page } from "@playwright/test";
import { LATENCY_TABLE_PAGE } from "@everlast/testkit/code-execution-fixtures";
import { addTextSource, createNotebook, signIn, uniqueEmail, waitReady } from "./helpers.ts";

/**
 * [010-code-execution-sandbox] T016 (browser part) — quantitative chat journey against the real API, PostgreSQL,
 * C-02 and SSE (FR-GC-08, FR-GC-06; spec FR-004, FR-005, FR-007, FR-009, FR-014, SC-001, SC-003, SC-007).
 * The e2e fixture model and the scripted sandbox (labelled TEST DOUBLES in e2e-v3-doubles.ts) replace Gemini and
 * Agent Platform; the sandbox double holds each run ~1.2 s so the truthful progress state is observable.
 */

async function ask(page: Page, question: string) {
  const before = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-input").fill(question);
  const started = Date.now();
  await page.getByTestId("send").click();
  return { before, started };
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

test("CE-E01: Running code… appears ≤2.5 s, then Computed value, inline chart with download and a keyboard-accessible code drawer", async ({ page }) => {
  await setup(page, "ce-e01");
  const { before, started } = await ask(page, "What is the exact population standard deviation of the monthly latency? Plot the trend.");
  const status = page.getByTestId("chat-status");
  await expect(status).toHaveText("Running code…", { timeout: 2_500 });
  expect(Date.now() - started).toBeLessThanOrEqual(2_500);
  await expect(page.getByTestId("message-assistant")).toHaveCount(before + 1, { timeout: 20_000 });
  const answer = page.getByTestId("message-assistant").nth(before);
  await expect(answer.locator(".computed-label")).toHaveText(["Computed"]);
  await expect(answer).toContainText("Population standard deviation: 3.4520525295346");
  await expect(answer.getByTestId("citation-badge").first()).toHaveText("1");
  const chart = answer.getByTestId("computed-chart");
  await expect(chart).toBeVisible();
  await expect(chart).toHaveJSProperty("complete", true);
  const download = answer.getByTestId("chart-download");
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  const toggle = answer.getByTestId("code-drawer-toggle");
  await expect(toggle).toHaveText("View executed code");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(answer.getByTestId("code-attempt")).toHaveCount(1);
  await expect(answer.getByTestId("code-attempt").first()).toContainText("Final attempt");
  await expect(answer.getByTestId("code-source").first()).toContainText("emit(");
  await expect(answer.getByTestId("code-stdout").first()).toBeVisible();
});

test("CE-E02: an ambiguous statistical request gets a clarification without Running code…; the answer computes with the current selection", async ({ page }) => {
  await setup(page, "ce-e02");
  const seen: string[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/chat/turns")) seen.push(await res.text().catch(() => ""));
  });
  const first = await ask(page, "What is the exact standard deviation of the monthly latency and plot the trend?");
  await expect(page.getByTestId("message-assistant")).toHaveCount(first.before + 1, { timeout: 20_000 });
  const clarification = page.getByTestId("message-assistant").nth(first.before);
  await expect(clarification).toHaveClass(/kind-clarification/);
  await expect(clarification).toContainText(/population or a sample/i);
  await expect(clarification.getByTestId("code-drawer-toggle")).toHaveCount(0);
  expect(seen.join("")).not.toContain("running_code");
  const second = await ask(page, "Population, please.");
  await expect(page.getByTestId("message-assistant")).toHaveCount(second.before + 1, { timeout: 20_000 });
  await expect(page.getByTestId("message-assistant").nth(second.before).locator(".computed-label")).toHaveCount(1);
});

test("CE-E03: Send stays disabled until sources and history are loaded (readiness gate kept)", async ({ page }) => {
  const { id } = await setup(page, "ce-e03");
  await page.route(`**/api/notebooks/${id}/chat`, async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("What is the exact population standard deviation of the monthly latency?");
  await expect(page.getByTestId("send")).toBeDisabled();
  await expect(page.getByTestId("send")).toBeEnabled({ timeout: 10_000 });
});
