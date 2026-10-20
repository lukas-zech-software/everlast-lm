import { expect, test, type Page } from "@playwright/test";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * [007-notes-pinboard-lifecycle] T037 — Gate v2.0 #2 round trip in the running application (FR-NM-02, FR-NM-03,
 * SC-006, Constitution V): chat answer → Save to note → Convert to source → the new source is cited in the next
 * chat turn. Real API, PostgreSQL, v1 ingestion and C-02 retrieval; the E2E fixture model is the only test double.
 */

async function ask(page: Page, question: string) {
  const before = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-input").fill(question);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(before + 1, { timeout: 20_000 });
  return page.getByTestId("message-assistant").nth(before);
}

test("NM-E01: chat answer → Save to note → Convert to source → TITAN-77 cited from the converted note-source", async ({ page }) => {
  const email = uniqueEmail("nm01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "Raw_Data.pdf", buildPdf([{ kind: "text", lines: wrapLines("Project codename is TITAN-77.") }]));
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("notes-panel")).toBeVisible();

  // 1. Grounded answer citing Raw_Data.pdf, saved to notes.
  const first = await ask(page, "What is the project codename?");
  await expect(first).toContainText("TITAN-77");
  await first.locator('[data-action="save-note"]').click();
  await expect(first.getByRole("status")).toHaveText("Saved to notes");
  const card = page.getByTestId("note-card").filter({ hasText: "What is the project codename?" });
  await expect(card).toHaveAttribute("data-origin", "saved_response");

  // 2. Open the saved response (read-only) and convert it to a source.
  await card.getByTestId("note-open").click();
  await expect(page.getByTestId("saved-response-viewer")).toBeVisible();
  await page.getByTestId("convert-note").click();
  await expect(page.getByTestId("notes-status")).toHaveText("Source created: What is the project codename?");

  // 3. The new source is Ready and checked in the Left Panel; select only it.
  const converted = page.getByTestId("source-row").filter({ hasText: "What is the project codename?" });
  await expect(converted).toHaveAttribute("data-status", "Ready");
  await expect(converted.getByTestId("source-checkbox")).toBeChecked();
  await expect(converted.getByTestId("source-kind-note")).toHaveText("Note");
  const raw = page.getByTestId("source-row").filter({ hasText: "Raw_Data.pdf" });
  await raw.getByTestId("source-checkbox").uncheck();
  await expect(page.getByTestId("sources-pill")).toHaveText("1 source");

  // 4. The next turn answers TITAN-77 citing the converted note-source, labelled Note.
  const second = await ask(page, "What is the project codename?");
  await expect(second).toContainText("TITAN-77");
  const badge = second.getByTestId("citation-badge").first();
  await expect(badge).toHaveAttribute("data-badge", "1");
  await expect(badge.getByTestId("citation-note-label")).toHaveText("Note");
  await badge.click();
  await expect(page.getByTestId("inspector-title")).toHaveText("What is the project codename?");
});
