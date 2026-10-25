import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomPathLocatorSchema, WEB_EXTRACTION_FAILED_MESSAGE } from "@everlast/contracts";
import { admitLinkedImport, getSourceById } from "@everlast/db";
import { EMPTY_ARTICLE_HTML, JS_SHELL_HTML, WEB_GOLDEN, articleHtml, webPdfFixture } from "@everlast/testkit/multimodal-fixtures";
import { createWebAdapter, extractArticle, type Resolver, type Transport, type TransportRequest } from "../src/ingestion/web.ts";
import { processIngestJob } from "../src/ingestion/pipeline.ts";
import type { ContentScreener } from "../src/ingestion/screening.ts";
import { FixtureOcr, createWorkerHarness, prose, type WorkerHarness } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T019 — Web URL ingestion (FR-SI-01, C-01; spec FR-003, FR-007, FR-008, SC-005,
 * SC-006): Readability main text on an inert DOM, canonical URL, sanitized sections with `dom_path` locators,
 * "Unable to extract content from URL" for 403/paywall/empty/JS-only pages, PDF destinations routed to the PDF
 * parser, byte/word limits, and no remote subresource is ever fetched.
 */

const PUBLIC = "93.184.216.34";
const clean: ContentScreener = { name: "clean", screen: async () => ({ verdict: "clean" }) };
const resolver: Resolver = { lookup: async () => [{ address: PUBLIC, family: 4 }] };

function site(pages: Record<string, { status?: number; type?: string; body: string | Buffer }>): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      const page = pages[req.url.toString()];
      if (!page) return { status: 404, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from("missing"); })() };
      return { status: page.status ?? 200, headers: { "content-type": page.type ?? "text/html; charset=utf-8" }, body: (async function* () { yield Buffer.from(page.body); })() };
    },
  };
}

let h: WorkerHarness;
beforeAll(async () => {
  h = await createWorkerHarness();
});
afterAll(async () => {
  await h?.close();
});

async function importUrl(url: string, transport: Transport, options: { maxBytes?: number } = {}) {
  const nb = await h.newNotebook();
  const admitted = await admitLinkedImport(h.db.pool, h.ownerId, nb, { attempt_id: randomUUID(), kind: "web", url });
  const outcome = await processIngestJob(
    {
      pool: h.db.pool,
      storage: h.storage,
      embedder: h.embedder,
      ocr: new FixtureOcr(),
      adapters: { web: createWebAdapter({ resolver, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] }, ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}) }) },
      screener: clean,
    },
    { source_id: admitted.source.id, attempt_id: admitted.source.attempt_id, operation_id: admitted.operation.operation_id },
    8
  );
  return { outcome, source: (await getSourceById(h.db.pool, admitted.source.id))! };
}

describe("article extraction (FR-SI-01)", () => {
  it("WEB-01: main article text and canonical URL are kept; navigation, ads, scripts and footer are dropped", () => {
    const article = extractArticle(articleHtml(), "https://news.example.test/articles/depot-automation?utm=1");
    const text = article.sections.map((s) => s.text).join("\n");
    for (const p of WEB_GOLDEN.paragraphs) expect(text).toContain(p);
    expect(text).not.toContain(WEB_GOLDEN.navigation);
    expect(text).not.toContain(WEB_GOLDEN.advert);
    expect(text).not.toContain("tracker.example.test");
    expect(text).not.toContain("Copyright Example News");
    expect(article.canonicalUrl).toBe(WEB_GOLDEN.canonical);
    expect(article.title).toBe(WEB_GOLDEN.title);
    article.sections.forEach((s, i) => expect(s.selector).toBe(`section:nth-of-type(${i + 1})`));
  });

  it("WEB-02: a canonical link to another scheme is ignored (final URL kept) and never fetched", () => {
    const html = articleHtml().replace(WEB_GOLDEN.canonical, "javascript:alert(1)");
    expect(extractArticle(html, "https://news.example.test/a").canonicalUrl).toBe("https://news.example.test/a");
  });

  it("WEB-03: empty and JavaScript-only shells fail with the exact message", () => {
    for (const html of [EMPTY_ARTICLE_HTML, JS_SHELL_HTML]) expect(() => extractArticle(html, "https://x.example.test/")).toThrow(WEB_EXTRACTION_FAILED_MESSAGE);
  });
});

describe("web import pipeline (FR-SI-01, C-01)", () => {
  it("WEB-04: an article becomes Ready with dom_path chunks indexing sanitized section text; only the page itself is fetched", async () => {
    const url = "https://news.example.test/articles/depot-automation";
    const t = site({ [url]: { body: articleHtml() } });
    const { outcome, source } = await importUrl(url, t);
    expect(outcome.status).toBe("ready");
    expect(source).toMatchObject({ status: "Ready", link_kind: "web", media_type: "text/html", title: WEB_GOLDEN.title, canonical_url: WEB_GOLDEN.canonical, external_url: url });
    expect(t.requests.map((r) => r.url.toString())).toEqual([url]);
    const pages = await h.db.pool.query<{ page_number: number; dom_selector: string; text: string }>("SELECT page_number, dom_selector, text FROM source_pages WHERE source_id = $1 ORDER BY page_number", [source.id]);
    const chunks = await h.db.pool.query<{ locator: any; text: string; anchor_page: number }>("SELECT locator, text, anchor_page FROM chunks WHERE source_id = $1 ORDER BY sequence", [source.id]);
    expect(chunks.rows.length).toBeGreaterThan(0);
    for (const c of chunks.rows) {
      const loc = DomPathLocatorSchema.parse(c.locator);
      const page = pages.rows.find((p) => p.dom_selector === loc.selector)!;
      expect(page.page_number).toBe(c.anchor_page);
      expect(Array.from(page.text).slice(loc.start_offset, loc.end_offset).join("")).toBe(c.text);
    }
    expect(pages.rows.map((p) => p.text).join(" ")).not.toContain("<");
  });

  it("WEB-05: HTTP 403, paywall/empty and JS-only pages fail with 'Unable to extract content from URL' and release the slot", async () => {
    const cases = [
      { status: 403, body: "<html><body>Forbidden</body></html>" },
      { body: EMPTY_ARTICLE_HTML },
      { body: JS_SHELL_HTML },
      { type: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ];
    for (const page of cases) {
      const url = `https://news.example.test/${randomUUID()}`;
      const { source } = await importUrl(url, site({ [url]: page }));
      expect(source).toMatchObject({ status: "Failed", failure_message: WEB_EXTRACTION_FAILED_MESSAGE });
      const occupied = await h.db.pool.query("SELECT count(*)::int AS n FROM sources WHERE notebook_id = $1 AND status <> 'Failed'", [source.notebook_id]);
      expect(occupied.rows[0].n).toBe(0);
    }
  });

  it("WEB-06: a URL that serves a PDF is routed to the existing PDF parser (page_span locators)", async () => {
    const url = "https://reports.example.test/annual.pdf";
    const { outcome, source } = await importUrl(url, site({ [url]: { type: "application/pdf", body: webPdfFixture() } }));
    expect(outcome.status).toBe("ready");
    expect(source).toMatchObject({ media_type: "application/pdf", link_kind: "web" });
    const chunks = await h.db.pool.query("SELECT locator FROM chunks WHERE source_id = $1", [source.id]);
    expect(chunks.rows[0].locator).toHaveProperty("page_number", 1);
  });

  it("WEB-07: inclusive byte and word limits apply to fetched pages without truncation", async () => {
    const url = "https://news.example.test/huge";
    const big = await importUrl(url, site({ [url]: { body: articleHtml() } }), { maxBytes: 100 });
    expect(big.source).toMatchObject({ status: "Failed", failure_code: "SourceOversized" });
    const wordy = `<html><body><article><p>${prose(500_001, "depot")}</p></article></body></html>`;
    const url2 = "https://news.example.test/wordy";
    const many = await importUrl(url2, site({ [url2]: { body: wordy } }));
    expect(many.source).toMatchObject({ status: "Failed", failure_message: "Exceeds 500,000 words limit" });
  });
});
