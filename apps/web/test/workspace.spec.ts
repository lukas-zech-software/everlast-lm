import { expect, test } from "@playwright/test";
import { createNotebook, signIn, uniqueEmail, addTextSource, waitReady, apiCall } from "./helpers.ts";

/** T015/T055 — FR-WM-01 notebook journeys and FR-WM-07 capacity UI against the real server. */

test("WM-E01: create opens /notebook/{id} with Add sources; default title; reopen keeps the same notebook", async ({ page }) => {
  await signIn(page, uniqueEmail("wm01"));
  await page.getByTestId("create-notebook").click();
  await expect(page).toHaveURL(/\/notebook\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("add-sources-modal")).toBeVisible();
  await expect(page.getByText("Upload files: PDF, .txt, Markdown")).toBeVisible();
  await expect(page.getByTestId("notebook-title")).toHaveValue("Untitled notebook");
  const url = page.url();
  await page.getByTestId("close-add-sources").click();
  await page.getByTestId("home-link").click();
  await expect(page.getByTestId("notebook-card")).toHaveCount(1);
  await page.getByTestId("notebook-card").click();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("add-sources-modal")).toHaveCount(0);
  await page.goto(url); // native navigation uses the SPA fallback
  await expect(page.getByTestId("notebook-title")).toHaveValue("Untitled notebook");
});

test("WM-E02: title saves on Enter and blur; whitespace and 101 code points are rejected; network error restores", async ({ page }) => {
  const email = uniqueEmail("wm02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email, "Original");
  await page.goto(`/notebook/${id}`);
  const title = page.getByTestId("notebook-title");
  await title.fill("Renamed 🔬");
  await title.press("Enter");
  await expect(title).toHaveValue("Renamed 🔬");
  await page.reload();
  await expect(title).toHaveValue("Renamed 🔬");

  await title.fill("   ");
  await title.blur();
  await expect(page.getByTestId("toast").last()).toContainText("Title cannot be empty");
  await expect(title).toHaveValue("Renamed 🔬");
  await title.fill("é".repeat(101));
  await title.press("Enter");
  await expect(title).toHaveValue("Renamed 🔬");
  await title.fill("é".repeat(100));
  await title.press("Enter");
  await expect(title).toHaveValue("é".repeat(100));

  await page.route("**/api/notebooks/*", (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()));
  await title.fill("Will fail");
  await title.press("Enter");
  await expect(title).toHaveValue("é".repeat(100));
  await expect(page.getByTestId("toast").last()).toContainText("previous title was restored");
});

test("WM-E03: card menu rename and delete with confirmation; cancel sends no request", async ({ page }) => {
  const email = uniqueEmail("wm03");
  await signIn(page, email);
  await createNotebook(page.request, email, "Card notebook");
  await page.reload();
  await page.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("card-title-input").fill("Card renamed");
  await page.getByTestId("card-title-input").press("Enter");
  await expect(page.getByTestId("card-title")).toHaveText("Card renamed");

  let deletes = 0;
  page.on("request", (r) => {
    if (r.method() === "DELETE") deletes++;
  });
  await page.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancel" }).click();
  expect(deletes).toBe(0);
  await expect(page.getByTestId("notebook-card")).toHaveCount(1);
  await page.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("notebook-card")).toHaveCount(0);
  expect(deletes).toBe(1);
});

test("WM-E04: a second tab sees 'Notebook no longer exists' after deletion and returns home", async ({ page, context }) => {
  const email = uniqueEmail("wm04");
  await signIn(page, email);
  const id = await createNotebook(page.request, email, "Shared tabs");
  await page.goto(`/notebook/${id}`);
  const tabB = await context.newPage();
  await tabB.goto(`/notebook/${id}`);
  await expect(tabB.getByTestId("notebook-title")).toHaveValue("Shared tabs");
  await page.getByTestId("delete-notebook").click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("notebook-grid")).toBeVisible();
  await tabB.getByTestId("notebook-title").fill("Edit after delete");
  await tabB.getByTestId("notebook-title").press("Enter");
  await expect(tabB.getByTestId("notebook-missing")).toContainText("Notebook no longer exists");
  await expect(tabB.getByTestId("notebook-grid")).toBeVisible({ timeout: 10_000 });
});

test("WM-E05: capacity counter shows server occupancy; at the limit Add source and the dropzone are disabled", async ({ page }) => {
  const email = uniqueEmail("wm05");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  for (let i = 0; i < 50; i++) await addTextSource(page.request, email, id, `Seed source ${i}.`);
  await waitReady(page.request, email, id, 50);
  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("source-quota")).toHaveText("50 / 50 sources");
  await expect(page.getByTestId("add-source")).toBeDisabled();
  // The server rejects a tampered client regardless of the disabled UI.
  const res = await page.request.post(`/api/notebooks/${id}/sources/text`, {
    headers: { authorization: `Bearer ${(await (await page.request.post("/auth/local/login", { data: { email } })).json()).id_token}` },
    data: { attempt_id: crypto.randomUUID(), text: "one more" },
  });
  expect(res.status()).toBe(409);
  const quota = await apiCall<{ sources_used: number }>(page.request, email, "GET", `/api/notebooks/${id}/quota`);
  expect(quota.sources_used).toBe(50);
});

test("WM-E06 (T017/T047): create → workspace with Add sources completes within 1.0 s P95 over 10 warm samples", async ({ page }) => {
  await signIn(page, uniqueEmail("wm06"));
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    await page.goto("/");
    await expect(page.getByTestId("create-notebook")).toBeEnabled();
    const started = Date.now();
    await page.getByTestId("create-notebook").click();
    await expect(page.getByTestId("add-sources-modal")).toBeVisible();
    samples.push(Date.now() - started);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ case: "WM-E06", samples_ms: samples, p95_ms: samples[9] }));
  expect(samples[9]!).toBeLessThanOrEqual(1000);
});
