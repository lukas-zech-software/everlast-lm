import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createWorkerHandler } from "@everlast/worker";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * T034/T032/T011/T025 — source routes end to end: real API + PostgreSQL + local versioned storage +
 * in-process worker drain (FR-SI-01, FR-SI-03, FR-SI-04, FR-WM-07, C-02).
 */

let api: TestApi;
let dir: string;
let drain: () => Promise<unknown>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-api-src-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  let storage!: LocalObjectStorage;
  let pending: Promise<unknown> = Promise.resolve();
  api = await startTestApi({}, {
    embedder,
    notifyJobs: () => {
      pending = pending.then(() => drain());
    },
  });
  storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const worker = createWorkerHandler(
    { pool: api.db.pool, storage, embedder, ocr: { name: "none", recognize: async () => new Map() } },
    { NODE_ENV: "test" }
  );
  drain = () => worker.drain();
});

afterAll(async () => {
  await api?.close();
  await rm(dir, { recursive: true, force: true });
});

async function notebook(as: string): Promise<string> {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  return ((await res.json()) as any).notebook.id;
}

async function waitForStatus(as: string, nb: string, sourceId: string, status: string) {
  for (let i = 0; i < 100; i++) {
    await drain();
    const res = await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { as });
    const source = ((await res.json()) as any).source;
    if (source.status === status) return source;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`source ${sourceId} never reached ${status}`);
}

async function uploadFile(as: string, nb: string, fileName: string, bytes: Buffer) {
  const attempt = randomUUID();
  const res = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
    method: "POST",
    as,
    json: { files: [{ attempt_id: attempt, file_name: fileName, declared_bytes: bytes.length }] },
  });
  const item = ((await res.json()) as any).items[0];
  expect(item.admitted, JSON.stringify(item)).toBe(true);
  const put = await fetch(item.upload.url, { method: "PUT", headers: item.upload.headers, body: bytes });
  expect(put.status).toBe(204);
  const done = await api.fetch(`/api/notebooks/${nb}/sources/${item.source.id}/complete`, { method: "POST", as, json: { attempt_id: attempt } });
  expect(done.status).toBe(200);
  return { attempt, source: ((await done.json()) as any).source };
}

describe("FR-SI-01 source routes", () => {
  it("SRC-01: PDF upload: admission → signed upload → complete → worker → Ready with valid C-01 chunks", async () => {
    const nb = await notebook("src01");
    const pdf = buildPdf([{ kind: "text", lines: wrapLines("Quarterly report. Revenue grew 12 percent.") }]);
    const { source } = await uploadFile("src01", nb, "Report.pdf", pdf);
    expect(source.status).toBe("Processing");
    const ready = await waitForStatus("src01", nb, source.id, "Ready");
    expect(ready).toMatchObject({ title: "Report.pdf", media_type: "application/pdf", byte_size: pdf.length, revision: 1, error: null });
    const list = ((await (await api.fetch(`/api/notebooks/${nb}/sources`, { as: "src01" })).json()) as any).sources;
    expect(list.map((s: any) => s.id)).toEqual([source.id]);
    const quota = ((await (await api.fetch(`/api/notebooks/${nb}/quota`, { as: "src01" })).json()) as any);
    expect(quota.sources_used).toBe(1);
  });

  it("SRC-02: copied text becomes 'Pasted text' via the same reservation and worker path", async () => {
    const nb = await notebook("src02");
    const res = await api.fetch(`/api/notebooks/${nb}/sources/text`, { method: "POST", as: "src02", json: { attempt_id: randomUUID(), text: "  Meeting notes: ship v1 on Friday.  " } });
    expect(res.status).toBe(201);
    const source = ((await res.json()) as any).source;
    expect(source).toMatchObject({ title: "Pasted text", media_type: "copied_text" });
    const ready = await waitForStatus("src02", nb, source.id, "Ready");
    expect(ready.word_count).toBe(6);
    const blank = await api.fetch(`/api/notebooks/${nb}/sources/text`, { method: "POST", as: "src02", json: { attempt_id: randomUUID(), text: " \n\t " } });
    expect(blank.status).toBe(422);
  });

  it("SRC-03 (API-11/15): batch at 49/50 admits one; per-item errors identify the exceeded limit", async () => {
    const nb = await notebook("src03");
    await api.db.pool.query(
      `INSERT INTO sources (id, notebook_id, attempt_id, title, media_type, status, declared_bytes, actual_bytes, word_count, active_revision)
       SELECT gen_random_uuid(), $1, gen_random_uuid(), 'seed', 'text/plain', 'Ready', 1, 1, 1, 1 FROM generate_series(1, 49)`,
      [nb]
    );
    const files = [
      { attempt_id: randomUUID(), file_name: "ok.pdf", declared_bytes: 10 },
      { attempt_id: randomUUID(), file_name: "full.pdf", declared_bytes: 10 },
      { attempt_id: randomUUID(), file_name: "big.pdf", declared_bytes: 215_000_000 },
      { attempt_id: randomUUID(), file_name: "slides.ppt", declared_bytes: 10 }, // .pptx is supported since v3 (FR-SI-01 Subset B)
    ];
    const items = ((await (await api.fetch(`/api/notebooks/${nb}/sources/uploads`, { method: "POST", as: "src03", json: { files } })).json()) as any).items;
    expect(items.map((i: any) => i.admitted)).toEqual([true, false, false, false]);
    expect(items.map((i: any) => i.error?.code ?? null)).toEqual([null, "SourceQuotaExceeded", "SourceOversized", "UnsupportedMediaType"]);
    expect(items[0].upload.url).toContain("/dev-storage/upload/");
    expect(items[2].upload).toBeUndefined();
  });

  it("SRC-04 (PERF-03): declared >200,000,000 bytes is rejected within 200 ms without a capability", async () => {
    const nb = await notebook("src04");
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const res = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
        method: "POST",
        as: "src04",
        json: { files: [{ attempt_id: randomUUID(), file_name: "huge.pdf", declared_bytes: 200_000_001 }] },
      });
      const item = ((await res.json()) as any).items[0];
      samples.push(performance.now() - started);
      expect(item).toMatchObject({ admitted: false, error: { code: "SourceOversized" } });
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ case: "PERF-03", p95_ms: Math.round(samples[18]!), max_ms: Math.round(samples[19]!) }));
    expect(samples[18]!).toBeLessThanOrEqual(200);
    const quota = ((await (await api.fetch(`/api/notebooks/${nb}/quota`, { as: "src04" })).json()) as any);
    expect(quota.sources_used).toBe(0);
  });

  it("SRC-05 (API-12): a tampered client cannot bypass quota, ownership or the upload capability", async () => {
    const nb = await notebook("src05");
    const foreign = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as: "src05-intruder",
      json: { files: [{ attempt_id: randomUUID(), file_name: "x.pdf", declared_bytes: 1 }] },
    });
    expect(foreign.status).toBe(403);
    const items = ((await (await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as: "src05",
      json: { files: [{ attempt_id: randomUUID(), file_name: "x.pdf", declared_bytes: 1 }] },
    })).json()) as any).items;
    const tampered = items[0].upload.url.replace(/.$/, (c: string) => (c === "a" ? "b" : "a"));
    const put = await fetch(tampered, { method: "PUT", headers: items[0].upload.headers, body: Buffer.from("%PDF") });
    expect(put.status).toBe(403);
    const wrongType = await fetch(items[0].upload.url, { method: "PUT", headers: { "content-type": "text/plain" }, body: "x" });
    expect(wrongType.status).toBe(400);
  });

  it("SRC-06: completion verifies actual bytes; completing before upload or with a wrong attempt is rejected", async () => {
    const nb = await notebook("src06");
    const attempt = randomUUID();
    const items = ((await (await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as: "src06",
      json: { files: [{ attempt_id: attempt, file_name: "empty.txt", declared_bytes: 100 }] },
    })).json()) as any).items;
    const sourceId = items[0].source.id;
    const early = await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/complete`, { method: "POST", as: "src06", json: { attempt_id: attempt } });
    expect(early.status).toBe(409);
    const wrong = await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/complete`, { method: "POST", as: "src06", json: { attempt_id: randomUUID() } });
    expect(wrong.status).toBe(409);
    await fetch(items[0].upload.url, { method: "PUT", headers: items[0].upload.headers, body: Buffer.alloc(0) });
    const done = await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/complete`, { method: "POST", as: "src06", json: { attempt_id: attempt } });
    expect(((await done.json()) as any).source).toMatchObject({ status: "Failed", error: { message: "File is empty" } });
  });

  it("SRC-07: a late completion after notebook deletion returns 404 and never publishes", async () => {
    const nb = await notebook("src07");
    const attempt = randomUUID();
    const items = ((await (await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as: "src07",
      json: { files: [{ attempt_id: attempt, file_name: "late.txt", declared_bytes: 5 }] },
    })).json()) as any).items;
    await api.fetch(`/api/notebooks/${nb}`, { method: "DELETE", as: "src07" });
    await fetch(items[0].upload.url, { method: "PUT", headers: items[0].upload.headers, body: Buffer.from("hello") });
    const late = await api.fetch(`/api/notebooks/${nb}/sources/${items[0].source.id}/complete`, { method: "POST", as: "src07", json: { attempt_id: attempt } });
    expect(late.status).toBe(404);
    expect((await api.db.pool.query("SELECT 1 FROM chunks WHERE source_id = $1", [items[0].source.id])).rowCount).toBe(0);
  });
});

describe("FR-SI-04 inspector content route", () => {
  it("SRC-08: content endpoint returns canonical pages/chunks with an optional highlight; other owners get 403", async () => {
    const nb = await notebook("src08");
    const { source } = await uploadFile("src08", nb, "Architecture_Spec.md", Buffer.from("# Spec\n\nThe API uses native HTTP.\n\n# Data\n\nPostgres stores chunks."));
    await waitForStatus("src08", nb, source.id, "Ready");
    const content = (await (await api.fetch(`/api/notebooks/${nb}/sources/${source.id}/content`, { as: "src08" })).json()) as any;
    expect(content.pages).toHaveLength(1);
    expect(content.chunks).toHaveLength(2);
    expect(content.highlight).toBeNull();
    const target = content.chunks[1].chunk_id;
    const focused = (await (await api.fetch(`/api/notebooks/${nb}/sources/${source.id}/content?chunk_id=${target}`, { as: "src08" })).json()) as any;
    expect(focused.highlight.chunk_id).toBe(target);
    expect((await api.fetch(`/api/notebooks/${nb}/sources/${source.id}/content`, { as: "src08-x" })).status).toBe(403);
    expect((await api.fetch(`/api/notebooks/${nb}/sources/${randomUUID()}/content`, { as: "src08" })).status).toBe(403);
  });
});
