import { expect, test } from "@playwright/test";
import { addTextSource, createNotebook, signIn, uniqueEmail, waitReady } from "./helpers.ts";

/** T025/T026 — FR-UI-01 adaptive 3-column workspace (exact breakpoints, collapse, persistence). */

async function openNotebook(page: import("@playwright/test").Page, sources = 3) {
  const email = uniqueEmail("ui");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  for (let i = 0; i < sources; i++) await addTextSource(page.request, email, id, `Section ${i + 1} explains topic ${i + 1}.`);
  await waitReady(page.request, email, id, sources);
  await page.goto(`/notebook/${id}`);
  return { email, id };
}

test("UI-E01: 1440x900 shows Sources, Chat and Studio together with '3 sources'", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotebook(page);
  for (const panel of ["panel-sources", "panel-chat", "panel-studio"]) await expect(page.getByTestId(panel)).toBeVisible();
  await expect(page.getByTestId("sources-pill")).toHaveText("3 sources");
  await expect(page.getByTestId("studio-placeholder")).toHaveText("Notes and Studio tools will appear here");
  await expect(page.getByTestId("workspace-tabs")).toBeHidden();
  await expect(page.getByTestId("notebook-title")).toBeVisible();
  await expect(page.getByTestId("user-profile")).toBeVisible();
});

test("UI-E02: collapsing both side panels widens Chat and keeps the draft; preference persists", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotebook(page, 1);
  const chat = page.getByTestId("panel-chat");
  const before = (await chat.boundingBox())!.width;
  await page.getByTestId("chat-input").fill("Summarize section 2");
  await page.getByTestId("collapse-left").click();
  await page.getByTestId("collapse-right").click();
  const after = (await chat.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 400);
  await expect(page.getByTestId("chat-input")).toHaveValue("Summarize section 2");
  await page.reload();
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-left-collapsed", "");
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-right-collapsed", "");
  await page.getByTestId("expand-left").click();
  await expect(page.getByTestId("source-list")).toBeVisible();
});

for (const [width, expected] of [
  [1023, { tabs: true, right: false }],
  [1024, { tabs: false, right: true }],
  [1279, { tabs: false, right: true }],
  [1280, { tabs: false, right: false }],
] as const) {
  test(`UI-E03: at ${width}px the default layout is ${expected.tabs ? "tabbed" : expected.right ? "3 columns, Studio collapsed" : "3 columns, both expanded"}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openNotebook(page, 1);
    const workspace = page.getByTestId("workspace");
    if (expected.tabs) {
      await expect(page.getByTestId("workspace-tabs")).toBeVisible();
      await expect(page.getByTestId("panel-chat")).toBeVisible();
      await expect(page.getByTestId("panel-sources")).toBeHidden();
      await page.getByTestId("chat-input").fill("draft kept across tabs");
      await page.getByTestId("tab-sources").click();
      await expect(page.getByTestId("panel-sources")).toBeVisible();
      await page.getByTestId("tab-chat").click();
      await expect(page.getByTestId("chat-input")).toHaveValue("draft kept across tabs");
    } else {
      await expect(page.getByTestId("workspace-tabs")).toBeHidden();
      await expect(page.getByTestId("panel-sources")).toBeVisible();
      if (expected.right) await expect(workspace).toHaveAttribute("data-right-collapsed", "");
      else await expect(workspace).not.toHaveAttribute("data-right-collapsed", "");
      await expect(workspace).not.toHaveAttribute("data-left-collapsed", "");
    }
  });
}

test("UI-E04: a citation click while Sources is collapsed un-collapses it and highlights the passage", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNotebook(page, 2);
  await page.getByTestId("chat-input").fill("Explain topic 2");
  await page.getByTestId("send").click();
  const badge = page.getByTestId("citation-badge").first();
  await expect(badge).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("collapse-left").click();
  await expect(page.getByTestId("source-list")).toBeHidden();
  await badge.click();
  await expect(page.getByTestId("source-inspector")).toBeVisible();
  await expect(page.locator(".chunk-highlight")).toBeInViewport();
  await expect(page.getByTestId("panel-chat")).toBeVisible();
});

test("UI-E05: on narrow screens a citation click switches to the Sources tab and keeps the chat state", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openNotebook(page, 1);
  await page.getByTestId("chat-input").fill("Explain topic 1");
  await page.getByTestId("send").click();
  const badge = page.getByTestId("citation-badge").first();
  await expect(badge).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("chat-input").fill("follow-up draft");
  await badge.click();
  await expect(page.getByTestId("panel-sources")).toBeVisible();
  await expect(page.locator(".chunk-highlight")).toBeInViewport();
  await page.getByTestId("tab-chat").click();
  await expect(page.getByTestId("chat-input")).toHaveValue("follow-up draft");
  await expect(page.getByTestId("message-assistant")).toHaveCount(1);
});
