import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildPdf } from "@everlast/testkit/pdf-builder";
import { createNotebook, signIn, uniqueEmail, uploadSource, waitReady } from "./helpers.ts";

/**
 * [015-studio-visuals-presentations] T022 — Browser E2E Gate v4.0 #3:
 * Slide Deck generation (8 slides across 3 sources), 16:9 carousel & speaker notes drawer,
 * downloadable editable `.pptx` and 8-page 16:9 `.pdf` verification (`pdfjs-dist`),
 * Failed state Retry without partial exports, and crisp D9 SVG + 2x PNG Infographic downloads
 * (`FR-ST-16`, `FR-ST-17`, `D8/DEV-02`, `D9`, `NFR-SEC-02`, `Gate v4.0 #3`).
 */

function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extra = buf.readUInt16LE(offset + 30);
    const comment = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    expect(data.length).toBe(uncompressed);
    out.set(name, data);
    offset += 46 + nameLen + extra + comment;
  }
  return out;
}

const SRC_PLATFORM = [
  "Cloud Platform Architecture centers on regional isolation inside europe-west4 using stateless workers.",
  "API Service handles request admission, JWT authorization, and scoped SSE streaming cleanly.",
  "Worker Service processes durable outbox jobs with SKIP LOCKED PostgreSQL leases and safe retries.",
];

const SRC_METRICS = [
  "Quarterly service availability reached 99.95% in Q3 compared to 99.80% in Q2 across regional endpoints.",
  "P99 tail latency dropped from 420 ms to 280 ms following connection pool tuning and index optimization.",
  "Automated backup retention preserves point-in-time recovery logs for 7 days in europe-west4.",
];

const SRC_SECURITY = [
  "Strict C-02 active source boundaries isolate selected sources before every Studio generation call.",
  "Zero external network resources or active macros are permitted in exported presentation deliverables.",
  "Advisory PostgreSQL locks serialize schema migrations across rolling container updates.",
];

const SRC_INCIDENT = [
  "Stage 1 Detection: Automated telemetry monitors Cloud Run error budgets and latency thresholds continuously.",
  "Stage 2 Containment: On-call automation isolates degraded revisions and prevents noisy retries.",
  "Stage 3 Eradication: Deterministic root-cause patches and automated regressions verify every fix.",
  "Stage 4 Recovery: Progressive traffic shifting restores 100 percent healthy regional capacity.",
];

test("SD-E01: generates an 8-slide deck across 3 sources, toggles speaker notes, and downloads valid PPTX & 16:9 8-page PDF (Gate v4.0 #3)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("sde01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "Platform.pdf", buildPdf([{ kind: "text", lines: SRC_PLATFORM }]));
  await uploadSource(page.request, email, id, "Metrics.pdf", buildPdf([{ kind: "text", lines: SRC_METRICS }]));
  await uploadSource(page.request, email, id, "Security.pdf", buildPdf([{ kind: "text", lines: SRC_SECURITY }]));
  await waitReady(page.request, email, id, 3);

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("3 sources");

  await page.getByTestId("studio-slide-deck-tile").click();
  const modal = page.getByTestId("slide-deck-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("slide-deck-count-input")).toHaveValue("10");
  await modal.getByTestId("slide-deck-count-input").fill("8");
  await modal.getByTestId("slide-deck-focus-prompt").fill("Platform architecture and Q3 reliability");
  await modal.getByTestId("slide-deck-generate").click();

  const row = page.locator('[data-testid="studio-artifact-row"][data-plugin-type="slide_deck"]').first();
  await expect(row).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });
  await row.getByTestId("studio-artifact-open").click();

  const viewer = page.getByTestId("studio-slide-deck-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("slide-deck-counter")).toHaveText("Slide 1 of 8");
  await expect(viewer.getByTestId("slide-export-google-slides")).toHaveCount(0);

  // Toggle speaker notes drawer open
  await expect(viewer.getByTestId("slide-speaker-notes")).toBeHidden();
  await viewer.getByTestId("slide-notes-toggle").click();
  await expect(viewer.getByTestId("slide-speaker-notes")).toBeVisible();

  // Navigate slides via Next & Thumbnail
  await viewer.getByTestId("slide-next").click();
  await expect(viewer.getByTestId("slide-deck-counter")).toHaveText("Slide 2 of 8");
  await viewer.getByTestId("slide-thumb-8").click();
  await expect(viewer.getByTestId("slide-deck-counter")).toHaveText("Slide 8 of 8");

  // Download .pptx and inspect OOXML zip entries
  const [pptxDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("slide-export-pptx").click(),
  ]);
  const pptxPath = await pptxDownload.path();
  expect(pptxPath).toBeTruthy();
  const entries = readZip(readFileSync(pptxPath!));
  for (let k = 1; k <= 8; k++) {
    expect(entries.has(`ppt/slides/slide${k}.xml`)).toBe(true);
    expect(entries.has(`ppt/notesSlides/notesSlide${k}.xml`)).toBe(true);
    expect(entries.get(`ppt/slides/slide${k}.xml`)!.toString("utf8")).toContain("<p:sp>");
  }

  // Download .pdf and inspect 8 pages in 16:9 via pdfjs-dist
  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("slide-export-pdf").click(),
  ]);
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).toBeTruthy();
  const pdfBytes = new Uint8Array(readFileSync(pdfPath!));
  const task = getDocument({ data: pdfBytes, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    expect(doc.numPages).toBe(8);
    const page1 = await doc.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    expect(Math.round(vp.width)).toBe(960);
    expect(Math.round(vp.height)).toBe(540);
  } finally {
    await task.destroy();
  }
});

test("IG-E01: generates a 4-stage process_flow D9 SVG infographic, supports zoom, and downloads SVG & PNG", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("ige01");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  await uploadSource(page.request, email, id, "IncidentPlaybook.pdf", buildPdf([{ kind: "text", lines: SRC_INCIDENT }]));
  await waitReady(page.request, email, id, 1);

  await page.goto(`/notebook/${id}`);
  await expect(page.getByTestId("sources-pill")).toHaveText("1 source");

  await page.getByTestId("studio-infographic-tile").click();
  const modal = page.getByTestId("infographic-modal");
  await expect(modal).toBeVisible();
  await modal.getByTestId("infographic-style-select").selectOption("process_flow");
  await modal.getByTestId("infographic-focus-prompt").fill("4-stage incident response workflow");
  await modal.getByTestId("infographic-generate").click();

  const row = page.locator('[data-testid="studio-artifact-row"][data-plugin-type="infographic"]').first();
  await expect(row).toHaveAttribute("data-status", "Completed", { timeout: 30_000 });
  await row.getByTestId("studio-artifact-open").click();

  const viewer = page.getByTestId("studio-infographic-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("infographic-ai-label")).toContainText("AI-generated");
  await expect(viewer.locator("[data-testid=infographic-canvas] svg")).toBeVisible();
  await expect(viewer.locator("[data-testid=infographic-canvas] script")).toHaveCount(0);

  await viewer.getByTestId("infographic-zoom-in").click();
  await expect(viewer.getByTestId("infographic-zoom-value")).toHaveText("120%");

  const [svgDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("infographic-export-svg").click(),
  ]);
  const svgPath = await svgDownload.path();
  expect(svgPath).toBeTruthy();
  const svgText = readFileSync(svgPath!, "utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain("Detection");
  expect(svgText).toContain("Recovery");

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByTestId("infographic-export-png").click(),
  ]);
  const pngPath = await pngDownload.path();
  expect(pngPath).toBeTruthy();
  const pngBytes = readFileSync(pngPath!);
  expect(Array.from(pngBytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("SD-E02: Failed slide deck offers Retry and displays zero partial export buttons", async ({ page }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail("sde02");
  await signIn(page, email);
  const id = await createNotebook(page.request, email);
  const srcId = await uploadSource(
    page.request,
    email,
    id,
    "Brief.pdf",
    buildPdf([{ kind: "text", lines: SRC_PLATFORM }])
  );
  await waitReady(page.request, email, id, 1);

  const failedArtifactId = "42000000-eeee-4000-8000-000000000001";
  let interceptActive = true;
  await page.route(`**/api/notebooks/${id}/studio/artifacts`, async (route) => {
    if (interceptActive && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          artifacts: [
            {
              id: failedArtifactId,
              notebook_id: id,
              plugin_type: "slide_deck",
              subtype: "default",
              status: "Failed",
              title: "Slide Deck",
              params_json: { slide_count: 8 },
              payload_json: null,
              source_revisions_snapshot: [{ source_id: srcId, revision: 1 }],
              output_language: "en-US",
              progress: null,
              failure: { code: "ModelTimeout", message: "Slide generation timed out." },
              attempt: 1,
              retry_of: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/notebook/${id}`);
  const failedRow = page.locator('[data-testid="studio-artifact-row"][data-plugin-type="slide_deck"]').first();
  await expect(failedRow).toHaveAttribute("data-status", "Failed");
  await expect(failedRow.getByTestId("studio-retry")).toBeVisible();
  await expect(page.getByTestId("slide-export-pptx")).toHaveCount(0);
  await expect(page.getByTestId("slide-export-pdf")).toHaveCount(0);

  interceptActive = false;
  await page.unroute(`**/api/notebooks/${id}/studio/artifacts`);
});
