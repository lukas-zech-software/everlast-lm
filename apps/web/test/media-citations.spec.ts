import { expect, test } from "@playwright/test";
import { INTERVIEW_CITED_MS, VIDEO_CAPTIONS_VTT, interviewMp3, shortWav, videoPageHtml } from "@everlast/testkit/multimodal-fixtures";
import { createNotebook, signIn, uniqueEmail } from "./helpers.ts";

/**
 * [009-multimodal-ingestion-sync] T027 — Gate v3.0 #1 in the browser (FR-SI-01, FR-SI-04, FR-GC-03; spec FR-004,
 * FR-005, FR-006, SC-001): audio upload progress (Uploading → Processing/Transcribing → Ready), audio/video icons,
 * and a chat citation into the 10-minute Interview.mp3 at 04:15 that opens the transcript, highlights and scrolls to
 * the segment and seeks the player to 255000 ms. Speech-to-Text is a labelled transcript double (e2e-v3-doubles).
 */

test("MEDIA-E01: Interview.mp3 citation [1] at 04:15 highlights the transcript segment and seeks the player to 04:15", async ({ page }) => {
  const email = uniqueEmail("media-e01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([{ name: "Interview.mp3", mimeType: "audio/mpeg", buffer: interviewMp3() }]);
  const row = page.getByTestId("source-row");
  await expect(row).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await expect(row.locator('[data-testid="source-icon"][data-kind="audio"]')).toHaveCount(1);

  await page.getByTestId("chat-input").fill("When does the budget review move to Thursday?");
  await page.getByTestId("send").click();
  const badge = page.getByTestId("citation-badge").first();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await badge.click();

  const inspector = page.getByTestId("source-inspector");
  await expect(inspector.getByTestId("inspector-title")).toHaveText("Interview.mp3");
  const highlighted = inspector.locator(".chunk-highlight");
  await expect(highlighted).toHaveAttribute("data-start-ms", String(INTERVIEW_CITED_MS));
  await expect(highlighted).toContainText("04:15");
  await expect(highlighted).toBeInViewport();
  await expect(inspector.getByTestId("media-player")).toHaveAttribute("data-seek-ms", String(INTERVIEW_CITED_MS));
});

test("MEDIA-E02: clicking a transcript time seeks a playable WAV to that position", async ({ page }) => {
  const email = uniqueEmail("media-e02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([{ name: "Interview.wav", mimeType: "audio/wav", buffer: shortWav(270_000) }]);
  await expect(page.getByTestId("source-row")).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await page.getByTestId("source-title").click();
  const segment = page.locator(`[data-start-ms="${INTERVIEW_CITED_MS}"]`);
  await segment.getByTestId("transcript-time").click();
  const player = page.getByTestId("media-player").locator("audio");
  await expect.poll(async () => player.evaluate((a: HTMLAudioElement) => Math.round(a.currentTime)), { timeout: 10_000 }).toBe(255);
});

test("MEDIA-E03: a video URL without accessible captions or audio fails with the exact message", async ({ page }) => {
  const email = uniqueEmail("media-e03");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-video").click();
  await page.getByTestId("url-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByTestId("url-import").click();
  await expect(page.getByTestId("source-error")).toHaveText("No transcript available for this video", { timeout: 30_000 });
});

test("MEDIA-E04 (T056): a captions-only enterprise video opens with a link that jumps to the clicked timestamp", async ({ page }) => {
  const email = uniqueEmail("media-e04");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const url = `https://media.example.test/v/${Date.now()}`;
  await page.request.post("/__e2e/web-page", { data: { url, html: videoPageHtml(`${new URL(url).pathname}.vtt`) } });
  await page.request.post("/__e2e/web-page", { data: { url: `${url}.vtt`, html: VIDEO_CAPTIONS_VTT, contentType: "text/vtt" } });
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-video").click();
  await page.getByTestId("url-input").fill(url);
  await page.getByTestId("url-import").click();
  const row = page.getByTestId("source-row");
  await expect(row).toHaveAttribute("data-status", "Ready", { timeout: 30_000 });
  await expect(row.locator('[data-testid="source-icon"][data-kind="video"]')).toHaveCount(1);
  await row.getByTestId("source-title").click();
  await page.locator('[data-start-ms="65000"]').getByTestId("transcript-time").click();
  await expect(page.getByTestId("original-video-link")).toHaveAttribute("href", `${url}#t=65`);
  await expect(page.getByTestId("media-player")).toHaveAttribute("data-seek-ms", "65000");
});
