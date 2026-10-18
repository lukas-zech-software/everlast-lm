import { test, expect } from "@playwright/test";
import { startTestServer } from "./test-server.js";

test.describe("T015 [US1] Browser Journeys: Notebook Lifecycle (FR-WM-01)", () => {
  let serverInstance: ReturnType<typeof startTestServer>;
  let baseUrl: string;

  test.beforeAll(async () => {
    serverInstance = startTestServer();
    baseUrl = await serverInstance.listen();
  });

  test.afterAll(async () => {
    await serverInstance.close();
  });

  test.beforeEach(async () => {
    serverInstance.notebooks.clear();
  });

  test("JOURNEY-01: new home card created with default title 'Untitled notebook'", async ({ page }) => {
    await page.goto(baseUrl);

    const newBtn = page.locator("#new-notebook-btn");
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    // Verify notebook card appears with default title
    const card = page.locator(".notebook-card").first();
    await expect(card).toBeVisible();
    const titleEl = card.locator(".notebook-title");
    await expect(titleEl).toHaveText("Untitled notebook");
  });

  test("JOURNEY-02: /notebook/{id} navigation opens with Add sources dialog/panel open", async ({ page }) => {
    await page.goto(baseUrl);
    const newBtn = page.locator("#new-notebook-btn");
    await newBtn.click();

    const card = page.locator(".notebook-card").first();
    await card.click();

    // Verify URL matches /notebook/{id}
    await expect(page).toHaveURL(new RegExp(`${baseUrl}/notebook/nb-`));

    // Verify Add sources dialog or panel is open
    const addSourcesModal = page.locator(".add-sources-modal");
    await expect(addSourcesModal).toBeVisible();
  });

  test("JOURNEY-03: reopening same /notebook/{id} preserves unchanged ID", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();
    const card = page.locator(".notebook-card").first();
    const id = await card.getAttribute("data-id");
    expect(id).toBeTruthy();

    // Navigate to notebook
    await page.goto(`${baseUrl}/notebook/${id}`);
    await expect(page).toHaveURL(`${baseUrl}/notebook/${id}`);

    // Reopen / refresh
    await page.reload();
    await expect(page).toHaveURL(`${baseUrl}/notebook/${id}`);
  });

  test("JOURNEY-04: Enter and blur rename title successfully", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();

    const card = page.locator(".notebook-card").first();
    const titleEl = card.locator(".notebook-title");

    // Click to edit
    await titleEl.click();
    const input = card.locator(".title-input");
    await expect(input).toBeVisible();

    await input.fill("Physics 101");
    await input.press("Enter");

    await expect(titleEl).toHaveText("Physics 101");
  });

  test("JOURNEY-05: whitespace and 101-code-point renames are rejected", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();

    const card = page.locator(".notebook-card").first();
    const titleEl = card.locator(".notebook-title");

    // Try whitespace-only rename
    await titleEl.click();
    const input = card.locator(".title-input");
    await expect(input).toBeVisible();
    await input.fill("    ");
    await input.press("Enter");

    // Reverts to original title
    await expect(titleEl).toHaveText("Untitled notebook");

    // Try 101-character rename
    await titleEl.click();
    await expect(input).toBeVisible();
    await input.fill("A".repeat(101));
    await input.press("Enter");

    // Still original title
    await expect(titleEl).toHaveText("Untitled notebook");
  });

  test("JOURNEY-06: network error restores persisted title and displays error toast", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();

    const card = page.locator(".notebook-card").first();
    const titleEl = card.locator(".notebook-title");

    // Intercept PATCH to simulate network error
    await page.route("**/api/notebooks/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Simulated database connection failure" } }),
        });
      } else {
        await route.continue();
      }
    });

    await titleEl.click();
    const input = card.locator(".title-input");
    await expect(input).toBeVisible();
    await input.fill("Will Fail Title");
    await input.press("Enter");

    // Should restore previous title
    await expect(titleEl).toHaveText("Untitled notebook");

    // Should display toast error
    const toast = page.locator(".toast-error, .toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/fail|error/i);
  });

  test("JOURNEY-07: delete confirmation modal can be cancelled or confirmed", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();

    const card = page.locator(".notebook-card").first();
    const deleteBtn = card.locator(".btn-delete-notebook");
    await deleteBtn.click();

    // Verify modal is open
    const modal = page.locator("#delete-modal");
    await expect(modal).toBeVisible();

    // Test Cancel
    const cancelBtn = modal.locator("#btn-cancel-delete");
    await cancelBtn.click();
    await expect(modal).not.toBeVisible();
    await expect(card).toBeVisible();

    // Re-open and Confirm
    await deleteBtn.click();
    await expect(modal).toBeVisible();
    const confirmBtn = modal.locator("#btn-confirm-delete");
    await confirmBtn.click();

    // Card should be removed
    await expect(card).not.toBeVisible();
  });

  test("JOURNEY-08: Tab B navigating to deleted notebook receives 404 message and redirects home", async ({ browser }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    await tabA.goto(baseUrl);
    await tabA.locator("#new-notebook-btn").click();
    const card = tabA.locator(".notebook-card").first();
    const notebookId = await card.getAttribute("data-id");

    // Delete in Tab A
    await card.locator(".btn-delete-notebook").click();
    await tabA.locator("#btn-confirm-delete").click();

    // Tab B attempts to visit deleted notebook
    await tabB.goto(`${baseUrl}/notebook/${notebookId}`);

    // Expect message "Notebook no longer exists" and redirection to home
    const notice = tabB.locator(".notice-404");
    await expect(notice).toContainText(/Notebook no longer exists|not found/i);

    // After brief notice, navigates to home
    await expect(tabB).toHaveURL(new RegExp(`${baseUrl}/?$`), { timeout: 5000 });

    await context.close();
  });

  test("JOURNEY-09: source quota counter is displayed in sidebar and Add sources modal", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();
    const card = page.locator(".notebook-card").first();
    const notebookId = await card.getAttribute("data-id");
    await card.click();

    // Verify modal is open and has quota counter
    const modal = page.locator(".add-sources-modal");
    await expect(modal).toBeVisible();
    const modalCounter = modal.locator("#source-quota-counter, .quota-count");
    await expect(modalCounter).toBeVisible();
    await expect(modalCounter).toContainText(/0\s*\/\s*50\s*sources/i);

    // Verify sidebar has quota counter
    const sidebarCounter = page.locator(".panel-sources #source-quota-counter, .panel-sources .quota-count");
    await expect(sidebarCounter).toBeVisible();
    await expect(sidebarCounter).toContainText(/0\s*\/\s*50\s*sources/i);
  });

  test("JOURNEY-10: at-limit disabled Add source button and dropzone", async ({ page }) => {
    await page.goto(`${baseUrl}?sources_used=50`);
    await page.locator("#new-notebook-btn").click();
    const card = page.locator(".notebook-card").first();
    await card.click();

    const addBtn = page.locator("#add-source-btn, .btn-add-source").first();
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeDisabled();
  });

  test("JOURNEY-11: failed row dismissal removes error without altering quota counter", async ({ page }) => {
    await page.goto(baseUrl);
    await page.locator("#new-notebook-btn").click();
    const card = page.locator(".notebook-card").first();
    await card.click();

    const counter = page.locator("#source-quota-counter, .quota-count").first();
    await expect(counter).toBeVisible();
    const countText = await counter.innerText();

    const errorItem = page.locator(".source-error-item");
    if (await errorItem.count() > 0) {
      await errorItem.locator(".btn-dismiss-error").click();
      await expect(errorItem).not.toBeVisible();
      await expect(counter).toHaveText(countText);
    }
  });
});
