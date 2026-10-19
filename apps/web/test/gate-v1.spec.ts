import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { apiCall, createNotebook, signIn, uniqueEmail, waitReady } from "./helpers.ts";

/**
 * Gate v1.0 #1 and #3 (SRS §5.4) — browser-level evidence.
 * #1: end-to-end PDF and Markdown uploads through the UI produce valid C-01 UnifiedDocumentChunk records.
 * #3: clicking citation [n] deterministically scrolls the Source Inspector to the correct DOM element.
 * Each test records its outcome in reports/gate-v1-ui.json, which the eval report folds into the gate state.
 */

const EVIDENCE = `${process.env.EVAL_REPORT_DIR ?? "reports"}/gate-v1-ui.json`;

function record(key: "gate1_upload_schema" | "gate3_citation_navigation", status: "pass" | "fail", detail: string): void {
  mkdirSync(EVIDENCE.replace(/\/[^/]+$/, ""), { recursive: true });
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(EVIDENCE, "utf8"));
  } catch {
    current = {};
  }
  current[key] = { status, detail, at: new Date().toISOString() };
  writeFileSync(EVIDENCE, `${JSON.stringify(current, null, 2)}\n`);
}

test.afterEach(async ({}, info) => {
  const key = info.title.startsWith("GATE-1") ? "gate1_upload_schema" : info.title.startsWith("GATE-3") ? "gate3_citation_navigation" : null;
  if (key) record(key, info.status === "passed" ? "pass" : "fail", `${info.title} (${info.status}, ${Math.round(info.duration)} ms)`);
});

test("GATE-1: PDF and MD uploaded through the UI yield only valid C-01 chunks", async ({ page }) => {
  const email = uniqueEmail("gate1");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("add-source").click();
  await page.getByTestId("file-input").setInputFiles([
    {
      name: "Gate_Report.pdf",
      mimeType: "application/pdf",
      buffer: buildPdf(Array.from({ length: 4 }, (_, i) => ({ kind: "text" as const, lines: wrapLines(`Gate page ${i + 1}. ${"Measured evidence sentence. ".repeat(60)}`) }))),
    },
    { name: "Gate_Notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Gate notes\n\nFirst section.\n\n## Details\n\nSecond section with ümlauts and emoji 🚀.\n") },
  ]);
  await waitReady(page.request, email, id, 2);
  await expect(page.locator('[data-testid="source-row"][data-status="Ready"]')).toHaveCount(2);
  const { sources } = await apiCall<{ sources: { id: string; media_type: string }[] }>(page.request, email, "GET", `/api/notebooks/${id}/sources`);
  let total = 0;
  for (const source of sources) {
    const content = await apiCall<{ chunks: unknown[]; pages: { page_number: number; text: string }[] }>(
      page.request,
      email,
      "GET",
      `/api/notebooks/${id}/sources/${source.id}/content`
    );
    expect(content.chunks.length).toBeGreaterThan(0);
    const pages = new Map(content.pages.map((p) => [p.page_number, Array.from(p.text)]));
    for (const raw of content.chunks) {
      const chunk = UnifiedDocumentChunkSchema.parse(raw);
      expect(chunk.source_id).toBe(source.id);
      const locator = chunk.locator as { page_number: number; physical_page?: number; start_offset: number; end_offset: number };
      expect(pages.get(locator.page_number)!.slice(locator.start_offset, locator.end_offset).join("")).toBe(chunk.text);
      expect(locator.physical_page !== undefined).toBe(source.media_type === "application/pdf");
      total++;
    }
  }
  console.log(JSON.stringify({ case: "GATE-1", sources: sources.length, valid_chunks: total }));
});

test("GATE-3: citation click scrolls to and highlights the exact chunk element in 20/20 repetitions", async ({ page }) => {
  const email = uniqueEmail("gate3");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const pages = Array.from({ length: 12 }, (_, i) => ({
    kind: "text" as const,
    lines: wrapLines(i === 8 ? "The emergency generator is tested every first Monday of the month." : `Background page ${i + 1}. ${"Unrelated operational detail. ".repeat(70)}`),
  }));
  const attempt = crypto.randomUUID();
  const bytes = buildPdf(pages);
  const { items } = await apiCall<{ items: { source: { id: string }; upload: { url: string; headers: Record<string, string> } }[] }>(
    page.request,
    email,
    "POST",
    `/api/notebooks/${id}/sources/uploads`,
    { files: [{ attempt_id: attempt, file_name: "Report.pdf", declared_bytes: bytes.length }] }
  );
  await page.request.fetch(items[0]!.upload.url, { method: "PUT", headers: items[0]!.upload.headers, data: bytes });
  await apiCall(page.request, email, "POST", `/api/notebooks/${id}/sources/${items[0]!.source.id}/complete`, { attempt_id: attempt });
  await waitReady(page.request, email, id, 1);
  await page.goto(`/notebook/${id}`);
  await page.getByTestId("chat-input").fill("When is the emergency generator tested?");
  await page.getByTestId("send").click();
  const badge = page.getByTestId("citation-badge").first();
  await expect(badge).toBeVisible({ timeout: 20_000 });
  const chunkId = (await badge.getAttribute("data-chunk-id"))!;
  const timings: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (await page.getByTestId("source-inspector").isVisible()) await page.getByTestId("inspector-close").click();
    const started = Date.now();
    await badge.click();
    const target = page.locator(`[data-testid="inspector-scroll"] [data-chunk-id="${chunkId}"]`);
    await expect(target).toHaveClass(/chunk-highlight/);
    await expect(target).toBeInViewport();
    timings.push(Date.now() - started);
    await expect(target).toContainText("emergency generator is tested");
    await expect(page.locator(".chunk-highlight")).toHaveCount(1);
  }
  timings.sort((a, b) => a - b);
  console.log(JSON.stringify({ case: "GATE-3", repetitions: 20, p95_ms: timings[18], max_ms: timings[19] }));
  expect(timings[18]!).toBeLessThanOrEqual(300);
});
