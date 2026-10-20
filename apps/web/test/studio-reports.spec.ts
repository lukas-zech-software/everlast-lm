import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildPdf } from "@everlast/testkit/pdf-builder";
import { createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * [008-studio-text-reports] T049 — Studio reports in the running application (Gate v2.0 #3, Constitution V,
 * FR-ST-10, FR-ST-11, SC-001, SC-006). Real API, PostgreSQL, v1 ingestion, C-02 reads and the C-03 runner with the
 * deterministic report model (the E2E test double); the E2E server has no generation client, so Suggested Format
 * reports "unavailable" (FR-018) while templates and Create Your Own stay usable.
 */

const HISTORY = [
  "The Treaty of Westphalia was signed in 1648 by Axel Oxenstierna.",
  "It ended the Thirty Years War.",
  "In 1815 the Congress of Vienna reorganised Europe under Klemens Metternich.",
  "The settlement lasted for decades.",
];
const TECH = [
  "A hash function is a function that maps data to fixed-size values.",
  "Hash functions are used in data indexing.",
  "Blockchain means a distributed ledger of linked blocks.",
  "Satoshi Nakamoto described Bitcoin in 2008.",
];

const REQUIRED: Record<string, string[]> = {
  "Briefing doc": ["executive_summary", "core_themes", "key_takeaways", "quotes"],
  "Study guide": ["topic_review", "short_answer_questions", "answer_key", "essay_questions", "glossary"],
  FAQ: ["faq"],
  Timeline: ["events", "cast_of_characters"],
};

async function ask(page: Page, question: string) {
  const before = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-input").fill(question);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(before + 1, { timeout: 20_000 });
  return page.getByTestId("message-assistant").nth(before);
}

const row = (page: Page, title: string): Locator => page.getByTestId("studio-artifact-row").filter({ hasText: title });

async function openReport(page: Page, title: string) {
  await row(page, title).getByTestId("studio-artifact-open").click();
  const viewer = page.getByTestId("studio-report-viewer");
  await expect(viewer.getByTestId("studio-report-title")).toHaveText(title);
  return viewer;
}

test("ST-E01: four standard reports while chatting; sections and citations; Copy, Delete and Convert to source", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const email = uniqueEmail("st01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "History.pdf", buildPdf([{ kind: "text", lines: HISTORY }]));
  await uploadSource(page.request, email, id, "Technology.pdf", buildPdf([{ kind: "text", lines: TECH }]));
  await waitReady(page.request, email, id, 2);
  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("2 sources");
  await expect(page.getByTestId("studio-panel")).toBeVisible();
  await expect(page.getByTestId("studio-placeholder")).toHaveCount(0);

  // FR-001 / FR-018: Create report modal; no generation client → suggestions unavailable, templates usable.
  await page.getByTestId("studio-reports-tile").click();
  const modal = page.getByTestId("reports-modal");
  await expect(modal).toContainText("Create report");
  await expect(modal.getByTestId("report-create-own")).toBeEnabled();
  await expect(modal.getByTestId("report-template")).toHaveText(["Briefing doc", "Study guide", "FAQ", "Timeline"]);
  await expect(modal.getByTestId("report-suggestions-unavailable")).toBeVisible();
  await page.getByTestId("reports-modal-close").click();
  await expect(modal).toHaveCount(0);

  // FR-006 / US1/AC3: each template creates a background job shown as "Generating …" while chat keeps working.
  for (const [index, title] of Object.keys(REQUIRED).entries()) {
    await page.getByTestId("studio-reports-tile").click();
    await modal.getByTestId("report-template").filter({ hasText: title }).click();
    await expect(modal).toHaveCount(0);
    await expect(row(page, title).getByTestId("studio-artifact-label")).toHaveText(`Generating ${title}...`);
    if (index === 1) await expect(await ask(page, "When was the Treaty of Westphalia signed?")).toContainText("1648");
  }
  for (const title of Object.keys(REQUIRED)) {
    await expect(row(page, title)).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });
    await expect(row(page, title).getByTestId("studio-artifact-label")).toHaveText(title);
  }

  // SC-001: every report carries its required section keys and citations that open the Source Inspector.
  for (const [title, keys] of Object.entries(REQUIRED)) {
    const viewer = await openReport(page, title);
    const content = viewer.getByTestId("studio-report-content");
    for (const key of keys) await expect(content.locator(`h2[data-section-key="${key}"]`)).toHaveCount(1);
    await expect(content.getByTestId("report-citation").first()).toBeVisible();
    await viewer.getByTestId("studio-viewer-close").click();
  }
  const timeline = await openReport(page, "Timeline");
  await expect(timeline.getByTestId("studio-report-content")).toContainText("1648");
  await timeline.getByTestId("report-citation").first().click();
  await expect(page.getByTestId("inspector-title")).toHaveText(/History\.pdf|Technology\.pdf/);
  await page.getByTestId("inspector-close").click();

  // SC-006: Copy puts the report Markdown on the clipboard.
  await timeline.getByTestId("studio-copy").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("1648");

  // Delete asks for confirmation; Cancel keeps the report, Delete removes it.
  await timeline.getByTestId("studio-delete").click();
  await page.getByTestId("confirm-dialog").locator('[data-action="cancel"]').click();
  await expect(timeline).toBeVisible();
  await timeline.getByTestId("studio-delete").click();
  await page.getByTestId("confirm-dialog").locator('[data-action="confirm"]').click();
  await expect(page.getByTestId("studio-report-viewer")).toHaveCount(0);
  await expect(row(page, "Timeline")).toHaveCount(0);
  await expect(page.getByTestId("studio-artifact-row")).toHaveCount(3);

  // FR-008 / FR-NM-03: Convert to source → a Ready note-source in the Left Panel, selected in this browser.
  const faq = await openReport(page, "FAQ");
  await faq.getByTestId("studio-convert").click();
  await expect(page.getByTestId("studio-status")).toHaveText("Source created: FAQ");
  const converted = page.getByTestId("source-row").filter({ hasText: "FAQ" });
  await expect(converted).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await expect(converted.getByTestId("source-checkbox")).toBeChecked();
  await expect(page.getByTestId("sources-pill")).toHaveText("3 sources");
});

test("ST-E02: Create Your Own boundaries and an empty selection disables every report action", async ({ page }) => {
  const email = uniqueEmail("st02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "Technology.pdf", buildPdf([{ kind: "text", lines: TECH }]));
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("1 source");

  await page.getByTestId("studio-reports-tile").click();
  const modal = page.getByTestId("reports-modal");
  await modal.getByTestId("report-create-own").click();
  const prompt = modal.getByTestId("report-prompt");
  const generate = modal.getByTestId("report-generate");
  await expect(generate).toBeDisabled();
  await prompt.fill("   ");
  await expect(generate).toBeDisabled();
  await prompt.fill("x".repeat(5001));
  await expect(generate).toBeDisabled();
  await prompt.fill("A short glossary for new engineers, friendly tone.");
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(modal).toHaveCount(0);
  await expect(row(page, "Custom report")).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });

  // FR-012: no selection → templates, Create Your Own and suggestions are unavailable; no all-sources fallback.
  await page.getByTestId("source-row").filter({ hasText: "Technology.pdf" }).getByTestId("source-checkbox").uncheck();
  await expect(page.getByTestId("sources-pill")).toHaveText("0 sources");
  await page.getByTestId("studio-reports-tile").click();
  for (const button of await modal.getByTestId("report-template").all()) await expect(button).toBeDisabled();
  await expect(modal.getByTestId("report-create-own")).toBeDisabled();
  await expect(modal.getByTestId("report-scope-hint")).toBeVisible();
});
