import { expect, test } from "@playwright/test";
import { createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * [009-multimodal-ingestion-sync] T055 — authorized Google Picker entry (FR-SI-01, D11; spec FR-002). Google's
 * Picker and Identity Services scripts are replaced by labelled in-test fakes (network routes); the app's own picker
 * integration, the delegated server import, PostgreSQL and the worker are real. The browser-side picker token is the
 * user's own short-lived token and is never sent to the API; the import uses the stored delegation server-side.
 */

const FAKE_GOOGLE = `
  window.gapi = { load: (_name, cb) => (typeof cb === "function" ? cb() : cb.callback()) };
  window.google = window.google || {};
  window.google.accounts = { oauth2: { initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: "browser-picker-token" }) }) } };
  class Builder {
    constructor() { this.cfg = {}; }
    addView(v) { this.cfg.view = v; return this; }
    setOAuthToken(t) { this.cfg.token = t; return this; }
    setDeveloperKey(k) { this.cfg.key = k; return this; }
    setAppId(a) { this.cfg.app = a; return this; }
    setCallback(cb) { this.cfg.cb = cb; return this; }
    build() { const c = this.cfg; window.__pickerConfig = { token: c.token, key: c.key, app: c.app }; return { setVisible: () => c.cb({ action: "picked", docs: [{ id: "1SlidesFile", name: "Steering deck" }] }) }; }
  }
  class DocsView { constructor(id) { this.id = id; } setMimeTypes(m) { this.mimes = m; return this; } }
  window.google.picker = { PickerBuilder: Builder, DocsView, ViewId: { DOCS: "docs" }, Action: { PICKED: "picked", CANCEL: "cancel" } };
`;

test("PICKER-E01: Choose from Google Drive imports the picked Slides file through the delegated server import", async ({ page }) => {
  await page.route("https://apis.google.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_GOOGLE }));
  await page.route("https://accounts.google.com/gsi/**", (route) => route.fulfill({ contentType: "text/javascript", body: "/* identity services loaded via apis fake */" }));
  const apiBodies: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) apiBodies.push(req.postData() ?? "");
  });
  const email = uniqueEmail("picker-e01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-drive").click();
  await page.getByTestId("drive-connect").click();
  await page.waitForURL(`**/notebook/${id}**`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-drive").click();
  await page.getByTestId("drive-picker").click();
  const row = page.getByTestId("source-row");
  await expect(row).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await expect(row.getByTestId("source-title")).toHaveText("Steering deck");
  expect(await page.evaluate(() => (window as unknown as { __pickerConfig: unknown }).__pickerConfig)).toEqual({ token: "browser-picker-token", key: "e2e-public-picker-key", app: "000000000000" });
  expect(apiBodies.join("\\n")).not.toContain("browser-picker-token");
});
