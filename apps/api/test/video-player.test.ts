import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createWorkerHandler } from "@everlast/worker";
import { createVideoAdapter } from "@everlast/worker/ingestion/media";
import type { Transport } from "@everlast/worker/ingestion/web";
import { VIDEO_CAPTIONS_VTT, m4aFixture, videoPageHtml } from "@everlast/testkit/multimodal-fixtures";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T056 — seekable players for video sources (FR-SI-01/04, FR-GC-03; spec FR-005):
 * a transcribed video stream is played back through the authorized media proxy (seek to start_ms in the Inspector);
 * a captions-only video keeps a link to the original page (the Inspector adds the cited `#t=` timestamp).
 */

let api: TestApi;
let dir: string;
let drain: () => Promise<unknown>;
const pages: Record<string, { type: string; body: string | Buffer }> = {
  "https://media.example.test/v/stream": { type: "text/html", body: videoPageHtml(null, "/v/stream.mp4") },
  "https://media.example.test/v/stream.mp4": { type: "video/mp4", body: m4aFixture() },
  "https://media.example.test/v/captions": { type: "text/html", body: videoPageHtml("/v/captions.vtt") },
  "https://media.example.test/v/captions.vtt": { type: "text/vtt", body: VIDEO_CAPTIONS_VTT },
};
const transport: Transport = {
  async request(req) {
    const page = pages[req.url.toString()]!;
    return { status: 200, headers: { "content-type": page.type }, body: (async function* () { yield Buffer.from(page.body); })() };
  },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-video-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  api = await startTestApi({}, { embedder, notifyJobs: () => undefined });
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const transcriber = { name: "fixture-asr", transcribe: async () => ({ words: [{ text: "Safety", start_ms: 0, end_ms: 600 }, { text: "first.", start_ms: 700, end_ms: 1200 }] }) };
  const worker = createWorkerHandler(
    {
      pool: api.db.pool,
      storage,
      embedder,
      ocr: { name: "none", recognize: async () => new Map() },
      adapters: { video: createVideoAdapter({ transcriber, storage, web: { resolver: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } } }) },
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

async function video(as: string, url: string) {
  const nb = (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
  const { source_id } = (await (await api.fetch(`/api/notebooks/${nb}/sources/imports`, { method: "POST", as, json: { attempt_id: randomUUID(), kind: "video", url } })).json()) as any;
  await drain();
  return (await (await api.fetch(`/api/notebooks/${nb}/sources/${source_id}/content`, { as })).json()) as any;
}

describe("video players (FR-005)", () => {
  it("VIDEO-01: a transcribed stream gets a proxied, rangeable video player", async () => {
    const content = await video("video-1", "https://media.example.test/v/stream");
    expect(content.player).toMatchObject({ type: "video" });
    expect(content.player.url).toMatch(/^\/media\//);
    const res = await api.fetch(content.player.url, { headers: { range: "bytes=0-3" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("audio/mp4");
  });

  it("VIDEO-02: a captions-only video keeps a link player to the original page", async () => {
    const content = await video("video-2", "https://media.example.test/v/captions");
    expect(content.player).toEqual({ type: "link", url: "https://media.example.test/v/captions" });
    expect(content.transcript.map((s: any) => s.display_time)).toEqual(["00:00", "00:04", "01:05"]);
  });
});
