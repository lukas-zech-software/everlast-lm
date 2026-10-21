import { expect, test, type Page } from "@playwright/test";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { addTextSource, createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * T043 — FR-GC-01/02/03/06 browser journeys against the real API, PostgreSQL and C-02 retrieval, with the E2E
 * fixture model (deterministic test double) generating citations from retrieved chunks.
 */

async function ask(page: Page, question: string) {
  const before = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-input").fill(question);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(before + 1, { timeout: 20_000 });
  return page.getByTestId("message-assistant").nth(before);
}

test("GC-E01: grounded answer shows badges; hover previews title + verbatim snippet within 300 ms", async ({ page }) => {
  const email = uniqueEmail("gc01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "Security_Policy.pdf", buildPdf([{ kind: "text", lines: wrapLines("Passwords rotate every 90 days for all staff accounts.") }]));
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  const answer = await ask(page, "How often do passwords rotate?");
  const badge = answer.getByTestId("citation-badge").first();
  await expect(badge).toHaveText("1");
  const started = Date.now();
  await badge.hover();
  const popover = page.getByTestId("citation-popover");
  await expect(popover).toBeVisible();
  expect(Date.now() - started).toBeLessThan(300);
  await expect(popover).toContainText("Security_Policy.pdf");
  await expect(popover).toContainText("Passwords rotate every 90 days for all staff accounts.");
  await badge.focus();
  await expect(popover).toBeVisible();
});

test("GC-E02: clicking [n] opens the inspector on the cited page and highlights the exact chunk element", async ({ page }) => {
  const email = uniqueEmail("gc02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const pages = Array.from({ length: 6 }, (_, i) =>
    i === 2
      ? { kind: "text" as const, lines: wrapLines("Badges must be worn visibly inside the data center at all times.") }
      : { kind: "text" as const, lines: wrapLines(`Filler page ${i + 1}. ${"General guidance text. ".repeat(80)}`) }
  );
  await uploadSource(page.request, email, id, "Security_Policy.pdf", buildPdf(pages));
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  const answer = await ask(page, "Where must badges be worn?");
  const badge = answer.getByTestId("citation-badge").first();
  const chunkId = await badge.getAttribute("data-chunk-id");
  await badge.click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Security_Policy.pdf");
  const target = page.locator(`[data-testid="inspector-scroll"] [data-chunk-id="${chunkId}"]`);
  await expect(target).toHaveClass(/chunk-highlight/);
  await expect(target).toBeInViewport();
  await expect(target).toContainText("Badges must be worn visibly");
  await expect(target.locator("xpath=ancestor::section[1]")).toHaveAttribute("data-page", "3");
  await expect(page.getByTestId("panel-chat")).toBeVisible();
});

test("GC-E03: a second citation from another source switches the open inspector and scrolls to it", async ({ page }) => {
  const email = uniqueEmail("gc03");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "Server Alpha runs on port 8080.");
  await addTextSource(page.request, email, id, "Port 8080 requires mTLS client certificates.");
  await waitReady(page.request, email, id, 2);
  await page.goto(`/notebook/${id}`);
  const answer = await ask(page, "Which requirement applies to port 8080?");
  const badges = answer.getByTestId("citation-badge");
  await expect(badges).toHaveCount(2);
  const firstId = (await badges.nth(0).getAttribute("data-chunk-id"))!;
  const secondId = (await badges.nth(1).getAttribute("data-chunk-id"))!;
  await badges.nth(0).click();
  await expect(page.getByTestId("source-inspector")).toHaveAttribute("data-highlight", firstId);
  const firstSource = await page.getByTestId("source-inspector").getAttribute("data-source-id");
  await badges.nth(1).click();
  await expect(page.getByTestId("source-inspector")).toHaveAttribute("data-highlight", secondId);
  expect(await page.getByTestId("source-inspector").getAttribute("data-source-id")).not.toBe(firstSource);
  await expect(page.locator(`[data-chunk-id="${secondId}"].chunk-highlight`)).toBeInViewport();
});

test.fixme("GC-E04: out-of-source question gets the refusal without badges; selection is sent explicitly", async ({ page }) => {
  const email = uniqueEmail("gc04");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "Use four spaces per indentation level in Python.");
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  const request = page.waitForRequest((r) => r.url().endsWith("/chat/turns"));
  const answer = await ask(page, "Who won the FIFA World Cup in 2022?");
  const body = JSON.parse((await request).postData()!);
  expect(body.active_source_ids).toHaveLength(1);
  await expect(answer).toContainText("The selected sources do not contain information about");
  await expect(answer.getByTestId("citation-badge")).toHaveCount(0);
});

test("GC-E05: history and working citations persist across reload; clear chat keeps sources Ready", async ({ page }) => {
  const email = uniqueEmail("gc05");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  for (const text of ["Kubernetes cluster has 12 nodes.", "Backups run nightly at 02:00.", "Logs rotate weekly."]) await addTextSource(page.request, email, id, text);
  await waitReady(page.request, email, id, 3);
  await page.goto(`/notebook/${id}`);
  await ask(page, "How many kubernetes nodes are there?");
  await ask(page, "When do backups run?");
  await page.reload();
  await expect(page.getByTestId("message-user")).toHaveCount(2);
  await expect(page.getByTestId("message-assistant")).toHaveCount(2);
  const badge = page.getByTestId("message-assistant").first().getByTestId("citation-badge").first();
  await badge.hover();
  await expect(page.getByTestId("citation-popover")).toContainText("Kubernetes cluster has 12 nodes.");
  await badge.click();
  await expect(page.locator(".chunk-highlight")).toBeInViewport();

  await page.getByTestId("clear-chat").click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("message-user")).toHaveCount(2);
  await page.getByTestId("clear-chat").click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Clear chat" }).click();
  await expect(page.getByTestId("message-user")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("message-user")).toHaveCount(0);
  await expect(page.locator('[data-testid="source-row"][data-status="Ready"]')).toHaveCount(3);
});

test("GC-E06: chat search lists exactly the matching message and scrolls to it; no match shows the message", async ({ page }) => {
  const email = uniqueEmail("gc06");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "Port 8080 requires mTLS client certificates.");
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  for (const q of ["What about the weather?", "Explain the certificate requirement", "Anything on budgets?"]) await ask(page, q);
  // Only the grounded answer (message 4) quotes "mTLS".
  await page.getByTestId("chat-search").fill("mtls");
  await expect(page.getByTestId("search-hit")).toHaveCount(1);
  await page.getByTestId("search-hit").click();
  const highlighted = page.locator(".message.search-highlight");
  await expect(highlighted).toContainText("requires mTLS client certificates");
  await expect(highlighted).toHaveAttribute("data-message-id", (await page.getByTestId("chat-messages").locator(".message").nth(3).getAttribute("data-message-id"))!);
  await page.getByTestId("chat-search").fill("kubernetes");
  await expect(page.getByTestId("no-search-results")).toHaveText("No messages found");
  await expect(page.getByTestId("message-user")).toHaveCount(3);
});

test("GC-E07: a deselected source's history stays viewable but its content cannot re-enter the prompt", async ({ page }) => {
  const email = uniqueEmail("gc07");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "Policy 2024 covers travel expenses.");
  await addTextSource(page.request, email, id, "Project Aurora budget is $4.2M.");
  await waitReady(page.request, email, id, 2);
  await page.goto(`/notebook/${id}`);
  const first = await ask(page, "What is the Project Aurora budget?");
  await expect(first).toContainText("$4.2M");
  // Deselect the Aurora source (second row) and ask again.
  const rows = page.getByTestId("source-row");
  const auroraRow = rows.filter({ hasText: "Pasted text" }).nth(1);
  await auroraRow.getByTestId("source-checkbox").uncheck();
  await expect(page.getByTestId("sources-pill")).toHaveText("1 source");
  const request = page.waitForRequest((r) => r.url().endsWith("/chat/turns"));
  const second = await ask(page, "Repeat the Project Aurora budget");
  expect(JSON.parse((await request).postData()!).active_source_ids).toHaveLength(1);
  await expect(second).not.toContainText("$4.2M");
  await expect(second).toContainText("The selected sources do not contain information about");
  await expect(first).toContainText("$4.2M"); // historical answer remains viewable
});

test("GC-E08: Send stays disabled until sources and chat history have loaded, so an early turn is never lost", async ({ page }) => {
  const email = uniqueEmail("gc08");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "The backup window opens at 02:00 UTC every night.");
  await waitReady(page.request, email, id, 1);
  // Hold the source list and the chat history until the test releases them (the startup window that lost turns).
  const hold = () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    return { held, release: () => release() };
  };
  const sourcesGate = hold();
  const historyGate = hold();
  await page.route(`**/api/notebooks/${id}/sources`, async (route) => {
    if (route.request().method() === "GET") await sourcesGate.held;
    await route.continue();
  });
  await page.route(`**/api/notebooks/${id}/chat`, async (route) => {
    if (route.request().method() === "GET") await historyGate.held;
    await route.continue();
  });
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("When does the backup window open?");
  await expect(page.getByTestId("send")).toBeDisabled();
  // Sources first: the selection is known, but the history would still replace the message list.
  sourcesGate.release();
  await expect(page.getByTestId("sources-pill")).toContainText("1");
  await expect(page.getByTestId("send")).toBeDisabled();
  historyGate.release();
  await expect(page.getByTestId("send")).toBeEnabled();
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("message-assistant").getByTestId("citation-badge").first()).toBeVisible();
});
