import { test, expect } from "@playwright/test";
import { startTestServer } from "./test-server.js";

test.describe("Workspace comfort Chromium acceptance (FR-WM-02, FR-WM-03, FR-UI-02)", () => {
  let serverInstance: ReturnType<typeof startTestServer>;
  let baseUrl: string;

  test.beforeAll(async () => {
    serverInstance = startTestServer();
    baseUrl = await serverInstance.listen();
  });

  test.afterAll(async () => serverInstance.close());

  test("shows metadata promptly and sorts/views 500 notebooks within 100ms", async ({ page }) => {
    for (let index = 0; index < 500; index++) {
      const id = `comfort-${String(index).padStart(3, "0")}`;
      serverInstance.notebooks.set(id, {
        id,
        title: `Notebook ${String(499 - index).padStart(3, "0")}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        sources_used: 2,
      });
    }
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      (window as any).__notebookResponseAt = 0;
      (window as any).__metadataVisibleAt = 0;
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        if (String(args[0]).includes("/api/notebooks") && !String(args[0]).includes("/preferences")) {
          (window as any).__notebookResponseAt = performance.now();
        }
        return response;
      };
      const observer = new MutationObserver(() => {
        if (document.querySelector(".notebook-source-count")) {
          (window as any).__metadataVisibleAt = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto(baseUrl);
    await expect(page.locator(".notebook-card")).toHaveCount(500);
    const metadataLatency = await page.evaluate(() => (window as any).__metadataVisibleAt - (window as any).__notebookResponseAt);
    expect(metadataLatency).toBeGreaterThanOrEqual(0);
    expect(metadataLatency).toBeLessThan(200);

    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>("#notebook-view-list")!;
      button.addEventListener("click", () => { (window as any).__viewStart = performance.now(); }, { capture: true });
    });
    await page.locator("#notebook-view-list").click();
    const viewLatency = await page.evaluate(() => performance.now() - (window as any).__viewStart);
    expect(viewLatency).toBeLessThan(100);
    await expect(page.locator("#notebook-list")).toHaveAttribute("data-view-mode", "list");

    await page.evaluate(() => {
      const sort = document.querySelector<HTMLSelectElement>("#notebook-sort")!;
      sort.addEventListener("change", () => { (window as any).__sortStart = performance.now(); }, { capture: true });
    });
    await page.locator("#notebook-sort").selectOption("title_asc");
    const sortLatency = await page.evaluate(() => performance.now() - (window as any).__sortStart);
    expect(sortLatency).toBeLessThan(100);
    await expect(page.locator(".notebook-card").first()).toContainText("Notebook 000");
    console.info(`Workspace comfort timings: metadata=${metadataLatency.toFixed(2)}ms, view=${viewLatency.toFixed(2)}ms, sort=${sortLatency.toFixed(2)}ms`);
  });

  test("shows a saved custom notebook icon in the workspace header", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();
    const card = page.locator(".notebook-card").first();
    await expect(card).toBeVisible();
    await card.locator(".notebook-icon-picker").selectOption("🧬");
    await expect(card.locator(".notebook-icon")).toHaveText("🧬");
    await card.click({ position: { x: 20, y: 20 } });
    await expect(page.locator(".workspace-notebook-icon")).toHaveText("🧬");
    await expect(page.locator(".notebook-title")).toHaveText("Untitled notebook");
  });

  test("applies theme changes immediately across workspace surfaces", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();
    await page.locator(".notebook-card").first().click({ position: { x: 20, y: 20 } });
    await expect(page.locator(".workspace-header")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.evaluate(() => {
      const theme = document.querySelector<HTMLSelectElement>("#theme-select")!;
      theme.addEventListener("change", () => { (window as any).__themeStart = performance.now(); }, { capture: true });
    });
    await page.locator("#theme-select").selectOption("dark");
    const result = await page.evaluate(() => ({
      latency: performance.now() - (window as any).__themeStart,
      rootTheme: document.documentElement.dataset.theme,
    }));
    expect(result.rootTheme).toBe("dark");
    expect(result.latency).toBeLessThan(50);
    const panelColors = await page.evaluate(() => [".workspace-header", ".panel-sources", ".panel-chat", ".panel-studio"].map((selector) => getComputedStyle(document.querySelector(selector)!).backgroundColor));
    expect(new Set(panelColors).size).toBe(1);
    console.info(`Workspace theme update: ${result.latency.toFixed(2)}ms across ${panelColors.length} panels`);
  });
});
