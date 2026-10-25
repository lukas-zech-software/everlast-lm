import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SourceImportAcceptedSchema, WEB_EXTRACTION_FAILED_MESSAGE } from "@everlast/contracts";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createWorkerHandler } from "@everlast/worker";
import { createWebAdapter, type Transport, type TransportRequest } from "@everlast/worker/ingestion/web";
import { WEB_GOLDEN, articleHtml } from "@everlast/testkit/multimodal-fixtures";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T021 — Website import through the real API/PostgreSQL/worker (FR-SI-01,
 * FR-WM-04/05, NFR-SEC-02; spec FR-003, FR-006, FR-008, FR-016): 202 admission, Owner-only, progress, canonical URL,
 * exact failure text, and forbidden destinations never contacted. The network is a labelled transport double.
 */

let api: TestApi;
let dir: string;
let drain: () => Promise<unknown>;
const requests: TransportRequest[] = [];
const transport: Transport = {
  async request(req) {
    requests.push(req);
    const url = req.url.toString();
    const page = url.endsWith("/forbidden") ? { status: 403, body: "no" } : { status: 200, body: articleHtml() };
    return { status: page.status, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from(page.body); })() };
  },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-web-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  let pending: Promise<unknown> = Promise.resolve();
  api = await startTestApi({}, { embedder, notifyJobs: () => void (pending = pending.then(() => drain())) });
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const resolver = { lookup: async (host: string) => [{ address: host === "loopback.example.test" ? "127.0.0.1" : "93.184.216.34", family: 4 }] };
  const worker = createWorkerHandler(
    {
      pool: api.db.pool,
      storage,
      embedder,
      ocr: { name: "none", recognize: async () => new Map() },
      adapters: { web: createWebAdapter({ resolver, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } }) },
      screener: { name: "clean", screen: async () => ({ verdict: "clean" }) },
    },
    { NODE_ENV: "test" }
  );
  drain = () => worker.drain();
});

afterAll(async () => {
  await api?.close();
  await rm(dir, { recursive: true, force: true });
});

async function notebook(as: string) {
  return (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
}

async function importWeb(as: string, nb: string, url: string) {
  const res = await api.fetch(`/api/notebooks/${nb}/sources/imports`, { method: "POST", as, json: { attempt_id: randomUUID(), kind: "web", url } });
  return { res, body: (await res.json()) as any };
}

async function settle(as: string, nb: string, id: string) {
  for (let i = 0; i < 200; i++) {
    await drain();
    const s = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${id}`, { as })).json()) as any).source;
    if (s.status === "Ready" || s.status === "Failed") return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("not settled");
}

describe("Website import (FR-SI-01)", () => {
  it("WEB-API-01: 202 admission with Processing/Fetching progress, then Ready with canonical URL and web kind", async () => {
    const as = "web-1";
    const nb = await notebook(as);
    const { res, body } = await importWeb(as, nb, "https://news.example.test/articles/depot-automation");
    expect(res.status).toBe(202);
    SourceImportAcceptedSchema.parse(body);
    const first = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${body.source_id}`, { as })).json()) as any).source;
    // The in-process worker may already have finished; while Processing a progress substate is always shown.
    expect(first.link_kind).toBe("web");
    if (first.status === "Processing") expect(["Fetching", "Parsing"]).toContain(first.progress);
    else expect(first.status).toBe("Ready");
    const ready = await settle(as, nb, body.source_id);
    expect(ready).toMatchObject({ status: "Ready", title: WEB_GOLDEN.title, canonical_url: WEB_GOLDEN.canonical, media_type: "text/html", progress: null });
    expect(ready.last_synced_at).not.toBeNull();
  });

  it("WEB-API-02: an HTTP 403 page fails with exactly 'Unable to extract content from URL'", async () => {
    const as = "web-2";
    const nb = await notebook(as);
    const { body } = await importWeb(as, nb, "https://news.example.test/forbidden");
    expect(await settle(as, nb, body.source_id)).toMatchObject({ status: "Failed", error: { message: WEB_EXTRACTION_FAILED_MESSAGE } });
  });

  it("WEB-API-03: forbidden destinations fail without any connection; malformed URLs are 422; foreign notebooks 403", async () => {
    const as = "web-3";
    const nb = await notebook(as);
    const before = requests.length;
    const { body } = await importWeb(as, nb, "https://loopback.example.test/admin");
    const failed = await settle(as, nb, body.source_id);
    expect(failed).toMatchObject({ status: "Failed", error: { code: "DestinationBlocked" } });
    expect(requests.length).toBe(before);
    expect((await importWeb(as, nb, "file:///etc/passwd")).res.status).toBe(422);
    expect((await importWeb("web-3-other", nb, "https://news.example.test/a")).res.status).toBe(403);
  });
});
