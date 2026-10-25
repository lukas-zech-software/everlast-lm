import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { addTextSource, apiCall, createNotebook, signIn, uniqueEmail, waitReady } from "./helpers.ts";

/**
 * [009-multimodal-ingestion-sync] T033/T038 — source identity, re-sync and removal in the browser (FR-SI-05,
 * FR-GC-03, FR-WM-07; spec FR-009..FR-013, SC-004, SC-005, SC-008). Real API/PostgreSQL/worker; the intranet page is
 * a fixture served through the real SSRF guard and Readability (labelled transport double, changed via a test hook).
 */

const ROADMAP = "https://intranet.example.test/roadmap";

async function setPage(request: APIRequestContext, page: { month?: "May" | "June"; status?: number; delayMs?: number; url?: string }) {
  const res = await request.post("/__e2e/web-page", { data: { url: page.url ?? ROADMAP, ...page } });
  expect(res.status()).toBe(204);
}

async function importRoadmap(page: Page, email: string, id: string, url = ROADMAP) {
  await apiCall(page.request, email, "POST", `/api/notebooks/${id}/sources/imports`, { attempt_id: randomUUID(), kind: "web", url });
  await waitReady(page.request, email, id, 1);
}

test("SM-E01: Rename source updates the sidebar, the Inspector and citation tooltips; invalid titles are refused", async ({ page }) => {
  const email = uniqueEmail("sm-e01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "The depot opens in May after the safety audit.");
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("When does the depot open?");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("citation-badge").first()).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("source-menu").click();
  await page.getByTestId("source-rename").click();
  await page.getByTestId("rename-input").fill("   ");
  await expect(page.getByTestId("rename-save")).toBeDisabled();
  await page.getByTestId("rename-input").fill("x".repeat(201));
  await expect(page.getByTestId("rename-error")).toBeVisible();
  await page.getByTestId("rename-input").fill("  Depot opening plan  ");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("source-title")).toHaveText("Depot opening plan");
  await page.getByTestId("citation-badge").first().hover();
  await expect(page.getByTestId("citation-popover")).toContainText("Depot opening plan");
  await page.getByTestId("source-title").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Depot opening plan");
});

test("SM-E02: Re-sync shows Syncing... while the old revision stays readable, then the new answer says June", async ({ page }) => {
  const email = uniqueEmail("sm-e02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await setPage(page.request, { month: "May" });
  await importRoadmap(page, email, id);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("When is Release v1?");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant").last()).toContainText("May", { timeout: 30_000 });

  await setPage(page.request, { month: "June", delayMs: 2500 });
  await page.getByTestId("source-title").click();
  await page.getByTestId("inspector-resync").click();
  await expect(page.getByTestId("inspector-syncing")).toBeVisible();
  // The committed May revision stays in the Inspector while the refresh runs.
  await expect(page.getByTestId("inspector-scroll")).toContainText("Release v1 in May");
  // A second request while active is rejected without a queued follow-up.
  const overlap = await page.request.fetch(`/api/notebooks/${id}/sources/${await sourceId(page, email, id)}/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${await bearer(page, email)}` },
    data: { attempt_id: randomUUID() },
  });
  expect(overlap.status()).toBe(409);
  expect(await overlap.json()).toMatchObject({ error: { message: "Sync already in progress" } });
  await expect(page.getByTestId("inspector-scroll")).toContainText("Release v1 in June", { timeout: 30_000 });
  await expect(page.getByTestId("inspector-syncing")).toHaveCount(0);

  await page.getByTestId("chat-input").fill("When is Release v1?");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant").last()).toContainText("June", { timeout: 30_000 });
  // The May answer's citation is now "Source updated" (historical snippet, no exact jump).
  await page.getByTestId("citation-badge").first().hover();
  await expect(page.getByTestId("citation-popover")).toContainText("Source updated");
  await expect(page.getByTestId("citation-popover")).toContainText("May");
});

test("SM-E03: a failing upstream (HTTP 503) shows a sync error toast and keeps the committed revision", async ({ page }) => {
  const email = uniqueEmail("sm-e03");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const url = `https://intranet.example.test/roadmap-${Date.now()}`;
  await setPage(page.request, { url, month: "June" });
  await importRoadmap(page, email, id, url);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("source-title").click();
  await setPage(page.request, { url, status: 503 });
  await page.getByTestId("inspector-resync").click();
  await expect(page.getByTestId("toast").last()).toContainText("Sync failed", { timeout: 30_000 });
  await expect(page.getByTestId("inspector-scroll")).toContainText("Release v1 in June");
  await expect(page.locator('[data-testid="source-row"][data-status="Ready"]')).toHaveCount(1);
});

test("SM-E04: Remove source asks for confirmation, decrements the counter and turns citations into 'Source deleted'", async ({ page }) => {
  const email = uniqueEmail("sm-e04");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await addTextSource(page.request, email, id, "The depot opens in May after the safety audit.");
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("When does the depot open?");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("citation-badge").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("source-quota")).toHaveText("1 / 50 sources");
  await page.getByTestId("source-menu").click();
  await page.getByTestId("source-remove").click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("source-row")).toHaveCount(0);
  await expect(page.getByTestId("source-quota")).toHaveText("0 / 50 sources");
  // The dependent answer is hidden (no stale snippet or clickable citation remains readable).
  await expect(page.getByTestId("message-assistant").last()).toContainText("unavailable because a cited source was deleted");
  await expect(page.getByTestId("citation-badge")).toHaveCount(0);
});

async function bearer(page: Page, email: string): Promise<string> {
  const res = await page.request.post("/auth/local/login", { data: { email } });
  return ((await res.json()) as { id_token: string }).id_token;
}

async function sourceId(page: Page, email: string, id: string): Promise<string> {
  const { sources } = await apiCall<{ sources: { id: string }[] }>(page.request, email, "GET", `/api/notebooks/${id}/sources`);
  return sources[0]!.id;
}
