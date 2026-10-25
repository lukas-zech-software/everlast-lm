import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TranscriptSegmentViewSchema, UnifiedDocumentChunkSchema } from "@everlast/contracts";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createWorkerHandler } from "@everlast/worker";
import { createAudioAdapter } from "@everlast/worker/ingestion/media";
import { INTERVIEW_CITED_MS, INTERVIEW_CITED_STATEMENT, interviewWords, shortWav } from "@everlast/testkit/multimodal-fixtures";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T026 — transcript Inspector DTO and authorized media delivery (FR-SI-01/04/05,
 * FR-GC-03, C-01/C-02; spec FR-004, FR-005, FR-013, FR-014, FR-016, SC-001, SC-006): `display_time` is derived
 * (floor minutes, zero-padded seconds) in the view DTO only, the Inspector reads a singleton C-02 scope, and media is
 * streamed by a revision-bound proxy that re-checks authorization on every (range) request — deletion or a new
 * revision invalidates an issued player URL immediately; no reusable bearer URL bypasses the check.
 */

let api: TestApi;
let dir: string;
let drain: () => Promise<unknown>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-media-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  let pending: Promise<unknown> = Promise.resolve();
  api = await startTestApi({}, { embedder, notifyJobs: () => void (pending = pending.then(() => drain())) });
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const transcriber = { name: "fixture-asr", transcribe: async () => ({ words: interviewWords().filter((w) => w.end_ms <= 270_000) }) };
  const worker = createWorkerHandler(
    { pool: api.db.pool, storage, embedder, ocr: { name: "none", recognize: async () => new Map() }, adapters: { audio: createAudioAdapter({ transcriber }) } },
    { NODE_ENV: "test" }
  );
  drain = () => worker.drain();
});

afterAll(async () => {
  await api?.close();
  await rm(dir, { recursive: true, force: true });
});

async function audioSource(as: string) {
  const nb = (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
  const bytes = shortWav(270_000);
  const attempt = randomUUID();
  const admitted = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, { method: "POST", as, json: { files: [{ attempt_id: attempt, file_name: "Interview.wav", declared_bytes: bytes.length }] } });
  const item = ((await admitted.json()) as any).items[0];
  await fetch(item.upload.url, { method: "PUT", headers: item.upload.headers, body: bytes });
  await api.fetch(`/api/notebooks/${nb}/sources/${item.source.id}/complete`, { method: "POST", as, json: { attempt_id: attempt } });
  for (let i = 0; i < 200; i++) {
    await drain();
    const s = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${item.source.id}`, { as })).json()) as any).source;
    if (s.status === "Ready") return { nb, sourceId: item.source.id as string, bytes };
    if (s.status === "Failed") throw new Error(JSON.stringify(s.error));
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("not ready");
}

describe("transcript Inspector (FR-SI-04, Gate v3.0 #1)", () => {
  it("MEDIA-API-01: content returns time_span chunks, transcript segments with derived display_time and an audio player", async () => {
    const as = "media-1";
    const { nb, sourceId } = await audioSource(as);
    const content = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/content`, { as })).json()) as any;
    expect(content.source).toMatchObject({ id: sourceId, viewer_kind: "transcript", media_type: "audio/wav" });
    expect(content.transcript.length).toBeGreaterThan(0);
    for (const seg of content.transcript) TranscriptSegmentViewSchema.parse(seg);
    for (const chunk of content.chunks) {
      expect(UnifiedDocumentChunkSchema.parse(chunk).locator).not.toHaveProperty("display_time");
    }
    expect(content.player).toMatchObject({ type: "audio", duration_ms: 270_000 });
    expect(content.player.url).toMatch(/^\/media\/[A-Za-z0-9_.-]+$/);
  });

  it("MEDIA-API-02: opening via the 04:15 citation highlights the segment at 255000 ms with display_time 04:15", async () => {
    const as = "media-2";
    const { nb, sourceId } = await audioSource(as);
    const all = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/content`, { as })).json()) as any;
    const cited = all.chunks.find((c: any) => c.text.includes(INTERVIEW_CITED_STATEMENT));
    const content = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/content?chunk_id=${cited.chunk_id}`, { as })).json()) as any;
    expect(content.highlight).toMatchObject({ chunk_id: cited.chunk_id, start_ms: INTERVIEW_CITED_MS, end_ms: cited.locator.end_ms, display_time: "04:15" });
    expect(content.transcript.some((s: any) => s.page_number === content.highlight.page_number && s.start_ms === INTERVIEW_CITED_MS)).toBe(true);
  });
});

describe("authorized media proxy (FR-SI-05, NFR-SEC-02)", () => {
  it("MEDIA-API-03: the player URL streams full and ranged bytes; tampered tokens and other users' capabilities are refused", async () => {
    const as = "media-3";
    const { nb, sourceId, bytes } = await audioSource(as);
    const { player } = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/content`, { as })).json()) as any;
    const full = await api.fetch(player.url);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/wav");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("cache-control")).toMatch(/no-store/);
    expect(Buffer.from(await full.arrayBuffer()).length).toBe(bytes.length);
    const ranged = await api.fetch(player.url, { headers: { range: "bytes=10-19" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 10-19/${bytes.length}`);
    expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(10, 20));
    expect((await api.fetch(`${player.url}x`)).status).toBe(403);
    expect((await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/media`, { as: "media-3-stranger" })).status).toBe(403);
  });

  it("MEDIA-API-04: removing the source revokes an issued player URL on the very next (range) request", async () => {
    const as = "media-4";
    const { nb, sourceId } = await audioSource(as);
    const { url } = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/media`, { as })).json()) as any;
    expect((await api.fetch(url, { headers: { range: "bytes=0-3" } })).status).toBe(206);
    expect((await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { method: "DELETE", as })).status).toBe(204);
    expect([403, 404, 410]).toContain((await api.fetch(url, { headers: { range: "bytes=4-7" } })).status);
  });

  it("MEDIA-API-05: a capability is bound to the revision it was issued for", async () => {
    const as = "media-5";
    const { nb, sourceId } = await audioSource(as);
    const { url } = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/media`, { as })).json()) as any;
    await api.db.pool.query("UPDATE sources SET active_revision = active_revision + 1 WHERE id = $1", [sourceId]).catch(() => undefined);
    await api.db.pool.query("UPDATE sources SET status = 'Processing' WHERE id = $1", [sourceId]);
    expect([403, 404, 410]).toContain((await api.fetch(url)).status);
  });
});

// PR #160: storage I/O must not outlive source authorization (FR-SI-05, NFR-SEC-02).
it.each([false, true])("revokes buffered media after source deletion during storage read (range=%s)", async (ranged) => {
  const as = `media-race-${ranged}`;
  const { nb, sourceId } = await audioSource(as);
  const { url } = await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/media`, { as })).json() as any;
  const storage = api.deps.storage!;
  const method = ranged ? "readRange" : "read";
  const original = storage[method]!;
  (storage as any)[method] = async (...args: any[]) => {
    const bytes = await (original as any).apply(storage, args);
    await api.db.pool.query("DELETE FROM sources WHERE id = $1", [sourceId]);
    return bytes;
  };
  try {
    const response = await api.fetch(url, ranged ? { headers: { range: "bytes=0-3" } } : {});
    expect([403, 404, 410]).toContain(response.status);
    expect(response.headers.get("content-type")).not.toBe("audio/wav");
  } finally {
    (storage as any)[method] = original;
  }
});
