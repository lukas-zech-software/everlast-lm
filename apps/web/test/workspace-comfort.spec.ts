import { expect, test } from "@playwright/test";
import { apiCall, createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * Package 2.1 Chromium acceptance on the real API (FR-WM-02, FR-WM-03, FR-UI-02; D16 in-memory v2 stores).
 * SC-002 is measured at the notebook cap of 100 per user (FR-WM-07), the largest list an owner can have.
 */

test("WC-E01: shows metadata and switches view/sort of 100 notebooks within 100 ms", async ({ page, request }) => {
  const email = uniqueEmail("comfort");
  for (let i = 0; i < 100; i++) await createNotebook(request, email, `Notebook ${String(99 - i).padStart(3, "0")}`);
  await signIn(page, email);
  await expect(page.getByTestId("notebook-card")).toHaveCount(100);
  await expect(page.getByTestId("notebook-source-count").first()).toHaveText("0 sources");

  await page.evaluate(() => {
    document.querySelector("[data-testid=notebook-view-list]")!.addEventListener("click", () => ((window as any).__viewStart = performance.now()), { capture: true });
  });
  await page.getByTestId("notebook-view-list").click();
  const viewLatency = await page.evaluate(() => performance.now() - (window as any).__viewStart);
  await expect(page.getByTestId("notebook-grid")).toHaveAttribute("data-view-mode", "list");
  expect(viewLatency).toBeLessThan(100);

  await page.evaluate(() => {
    document.querySelector("[data-testid=notebook-sort]")!.addEventListener("change", () => ((window as any).__sortStart = performance.now()), { capture: true });
  });
  await page.getByTestId("notebook-sort").selectOption("title_asc");
  const sortLatency = await page.evaluate(() => performance.now() - (window as any).__sortStart);
  await expect(page.getByTestId("card-title").first()).toHaveText("Notebook 000");
  expect(sortLatency).toBeLessThan(100);
  console.info(`Workspace comfort timings (100 notebooks): view=${viewLatency.toFixed(1)}ms sort=${sortLatency.toFixed(1)}ms`);
});

test("WC-E02: a pinned notebook stays first and a custom icon shows in the workspace header", async ({ page, request }) => {
  const email = uniqueEmail("comfort");
  await createNotebook(request, email, "Alpha");
  const beta = await createNotebook(request, email, "Beta");
  await signIn(page, email);
  await page.getByTestId("notebook-sort").selectOption("title_asc");
  const betaCard = page.locator(`[data-notebook-id="${beta}"]`);
  await betaCard.getByTestId("notebook-pin").click();
  await expect(page.getByTestId("card-title").first()).toHaveText("Beta");
  await betaCard.getByTestId("notebook-icon").selectOption("🧬");
  await expect(betaCard.getByTestId("notebook-icon")).toHaveValue("🧬");
  await betaCard.getByTestId("card-title").click();
  await expect(page.getByTestId("workspace-notebook-icon")).toHaveText("🧬");
  const list = await apiCall<{ notebooks: { id: string; is_pinned: boolean; icon_emoji: string; last_opened_at: string | null }[] }>(request, email, "GET", "/api/notebooks");
  expect(list.notebooks.find((n) => n.id === beta)).toMatchObject({ is_pinned: true, icon_emoji: "🧬" });
});

test("WC-E03: theme changes apply immediately to every workspace panel", async ({ page, request }) => {
  const email = uniqueEmail("comfort");
  const id = await createNotebook(request, email, "Themes");
  await signIn(page, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("workspace-settings-toggle").click();
  await page.evaluate(() => {
    document.querySelector("#theme-select")!.addEventListener("change", () => ((window as any).__themeStart = performance.now()), { capture: true });
  });
  await page.locator("#theme-select").selectOption("dark");
  const result = await page.evaluate(() => ({
    latency: performance.now() - (window as any).__themeStart,
    theme: document.documentElement.dataset.theme,
    panels: ["panel-sources", "panel-chat", "panel-studio"].map((t) => getComputedStyle(document.querySelector(`[data-testid=${t}]`)!).backgroundColor),
  }));
  expect(result.theme).toBe("dark");
  expect(result.latency).toBeLessThan(50);
  expect(new Set(result.panels).size).toBe(1);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
