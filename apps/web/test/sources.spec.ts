import { expect, test } from "@playwright/test";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { addTextSource, createNotebook, signIn, uniqueEmail, waitReady } from "./helpers.ts";

/** T014–T027 / T037 — FR-SI-01, FR-SI-03, FR-SI-04 browser journeys against the real server and worker. */

test("SI-E01: uploading PDF and Markdown shows progress then Ready with a checked checkbox", async ({ page }) => {
  const email = uniqueEmail("si01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([
    { name: "Report.pdf", mimeType: "application/pdf", buffer: buildPdf([{ kind: "text", lines: wrapLines("Quarterly report. Revenue grew 12 percent.") }]) },
    { name: "Architecture_Spec.md", mimeType: "text/markdown", buffer: Buffer.from("# Architecture\n\nThe API uses native HTTP.\n") },
  ]);
  const rows = page.getByTestId("source-row");
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="source-row"][data-status="Ready"]')).toHaveCount(2, { timeout: 20_000 });
  for (const checkbox of await page.getByTestId("source-checkbox").all()) await expect(checkbox).toBeChecked();
  await expect(page.getByTestId("sources-pill")).toHaveText("2 sources");
  await expect(page.getByTestId("source-quota")).toHaveText("2 / 50 sources");
});

test("SI-E02: 'Copied text' inserts a Ready 'Pasted text' source", async ({ page }) => {
  const email = uniqueEmail("si02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("copied-text").click();
  await expect(page.getByTestId("insert-text")).toBeDisabled();
  await page.getByTestId("paste-text").fill("Meeting notes: ship v1 on Friday. ".repeat(200));
  await page.getByTestId("insert-text").click();
  const row = page.getByTestId("source-row");
  await expect(row.getByTestId("source-title")).toHaveText("Pasted text");
  await expect(row).toHaveAttribute("data-status", "Ready", { timeout: 20_000 });
});

test("SI-E03: password-protected PDF fails with the exact message; the error row is dismissible", async ({ page }) => {
  const email = uniqueEmail("si03");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([
    { name: "Locked.pdf", mimeType: "application/pdf", buffer: buildPdf([{ kind: "text", lines: ["secret"] }], { encrypted: true }) },
  ]);
  await expect(page.getByTestId("source-error")).toHaveText("Could not read file (password-protected or corrupted)", { timeout: 20_000 });
  await expect(page.getByTestId("source-quota")).toHaveText("0 / 50 sources");
  await page.getByTestId("dismiss-error").click();
  await expect(page.getByTestId("source-row")).toHaveCount(0);
});

test("SI-E04: unsupported and empty files never become usable sources", async ({ page }) => {
  const email = uniqueEmail("si04");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  // .pptx/.docx/audio are supported since v3 (FR-SI-01 Subset B, specs/009); legacy .ppt stays unsupported.
  await page.getByTestId("file-input").setInputFiles([{ name: "deck.ppt", mimeType: "application/octet-stream", buffer: Buffer.from("x") }]);
  await expect(page.getByTestId("toast").last()).toContainText("Only PDF, .txt, Markdown, Word (.docx), PowerPoint (.pptx) and MP3/WAV/M4A audio files are supported");
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([{ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) }]);
  await expect(page.getByTestId("source-error")).toHaveText("File is empty", { timeout: 20_000 });
});

test("SI-E05: unchecking 2 of 5 sources updates the pill to '3 sources' within 50 ms; none selected disables send", async ({ page }) => {
  const email = uniqueEmail("si05");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  for (let i = 1; i <= 5; i++) await addTextSource(page.request, email, id, `Document ${i} body.`);
  await waitReady(page.request, email, id, 5);
  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("5 sources");
  const boxes = page.getByTestId("source-checkbox");
  const elapsed = await page.evaluate(async () => {
    const checks = [...document.querySelectorAll<HTMLInputElement>('[data-testid="source-checkbox"]')];
    const pill = document.querySelector('[data-testid="sources-pill"]')!;
    const started = performance.now();
    checks[0]!.click();
    checks[1]!.click();
    return { ms: performance.now() - started, text: pill.textContent };
  });
  expect(elapsed.text).toBe("3 sources");
  expect(elapsed.ms).toBeLessThanOrEqual(50);
  await expect(page.getByTestId("select-all")).toHaveJSProperty("indeterminate", true);
  await page.getByTestId("select-all").click();
  await expect(page.getByTestId("sources-pill")).toHaveText("5 sources");
  await page.getByTestId("select-all").click();
  await expect(page.getByTestId("sources-pill")).toHaveText("0 sources");
  await expect(page.getByTestId("send")).toBeDisabled();
  await expect(page.getByTestId("select-sources-prompt")).toBeVisible();
  // Selection is session-local and survives reload in this tab.
  await boxes.nth(4).check();
  await page.reload();
  await expect(page.getByTestId("sources-pill")).toHaveText("1 source");
});

test("SI-E06: clicking a source title opens the full text at the top; closing restores list, chat draft and selection", async ({ page }) => {
  const email = uniqueEmail("si06");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1} of the architecture specification.`).join("\n\n");
  await addTextSource(page.request, email, id, long);
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("Draft question");
  await page.getByTestId("source-title").click();
  await expect(page.getByTestId("source-inspector")).toBeVisible();
  await expect(page.getByTestId("inspector-title")).toHaveText("Pasted text");
  await expect(page.getByTestId("inspector-scroll")).toContainText("Paragraph 1 of the architecture");
  expect(await page.getByTestId("inspector-scroll").evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByTestId("panel-chat")).toBeVisible();
  await page.getByTestId("inspector-close").click();
  await expect(page.getByTestId("source-list")).toBeVisible();
  await expect(page.getByTestId("chat-input")).toHaveValue("Draft question");
  await expect(page.getByTestId("sources-pill")).toHaveText("1 source");
});

test("SI-E07: a 400,000-word source jumps to a late cited chunk without freezing (virtualized pages)", async ({ page }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("si07");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const filler = Array.from({ length: 399_990 }, (_, i) => `word${i % 1000}`).join(" ");
  await addTextSource(page.request, email, id, `${filler}\n\nThe ZEPHYR77 archive closes in December.`);
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("When does the zephyr77 archive close?");
  await page.getByTestId("send").click();
  const badge = page.getByTestId("citation-badge").first();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  const started = Date.now();
  await badge.click();
  const target = page.locator(".chunk-highlight");
  await expect(target).toBeInViewport({ timeout: 10_000 });
  const elapsed = Date.now() - started;
  await expect(target).toContainText("ZEPHYR77 archive closes");
  // The page stays responsive: a further interaction completes promptly.
  const responsive = await page.evaluate(() => new Promise<number>((resolve) => { const t = performance.now(); requestAnimationFrame(() => resolve(performance.now() - t)); }));
  console.log(JSON.stringify({ case: "SI-E07", words: 400_000, open_and_scroll_ms: elapsed, next_frame_ms: Math.round(responsive) }));
  expect(responsive).toBeLessThan(200);
});
