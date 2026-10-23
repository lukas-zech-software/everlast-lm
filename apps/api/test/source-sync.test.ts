import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SourceOperationDtoSchema, SourceSyncAcceptedSchema } from "@everlast/contracts";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { registerSyncChannel } from "@everlast/db";
import { seedReadySource } from "@everlast/db/testing";
import { createWorkerHandler } from "@everlast/worker";
import { createWebAdapter, type Transport } from "@everlast/worker/ingestion/web";
import { roadmapHtml } from "@everlast/testkit/multimodal-fixtures";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T035 — manual and webhook re-sync admission (FR-SI-05, NFR-SEC-02; spec FR-011,
 * FR-012, FR-016, SC-008): linked sources only; authenticated provider channels; same-key replay returns the same
 * operation; a distinct overlapping request (manual or webhook) is 409 "Sync already in progress" with nothing queued;
 * a request after completion starts normally; operation status exposes no secrets or fencing internals.
 */

let api: TestApi;
let dir: string;
let drain: () => Promise<unknown>;
let month: "May" | "June" = "May";
const transport: Transport = {
  async request() {
    const body = roadmapHtml(month);
    return { status: 200, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from(body); })() };
  },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-sync-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  api = await startTestApi({}, { embedder, notifyJobs: () => undefined });
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const worker = createWorkerHandler(
    {
      pool: api.db.pool,
      storage,
      embedder,
      ocr: { name: "none", recognize: async () => new Map() },
      adapters: { web: createWebAdapter({ resolver: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } }) },
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

async function linkedSource(as: string) {
  const nb = (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
  month = "May";
  const res = await api.fetch(`/api/notebooks/${nb}/sources/imports`, { method: "POST", as, json: { attempt_id: randomUUID(), kind: "web", url: "https://intranet.example.test/roadmap" } });
  const { source_id } = (await res.json()) as any;
  await drain();
  return { nb, sourceId: source_id as string };
}

const sync = (as: string, nb: string, id: string, attempt = randomUUID()) => api.fetch(`/api/notebooks/${nb}/sources/${id}/sync`, { method: "POST", as, json: { attempt_id: attempt } });

describe("manual re-sync (FR-SI-05)", () => {
  it("SYNC-API-01: 202 {operation_id, source_id, committed_revision}; same-key replay returns the same operation", async () => {
    const as = "sync-1";
    const { nb, sourceId } = await linkedSource(as);
    const attempt = randomUUID();
    const first = await sync(as, nb, sourceId, attempt);
    expect(first.status).toBe(202);
    const accepted = SourceSyncAcceptedSchema.parse(await first.json());
    expect(accepted.committed_revision).toBe(1);
    const replay = await sync(as, nb, sourceId, attempt);
    expect(replay.status).toBe(202);
    expect(((await replay.json()) as any).operation_id).toBe(accepted.operation_id);
    const listed = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { as })).json()) as any).source;
    expect(listed).toMatchObject({ status: "Ready", progress: "Syncing", sync: { operation_id: accepted.operation_id, state: "Queued" } });
  });

  it("SYNC-API-02: a distinct overlapping request is 409 'Sync already in progress'; none is queued; after completion a new one starts", async () => {
    const as = "sync-2";
    const { nb, sourceId } = await linkedSource(as);
    const first = (await (await sync(as, nb, sourceId)).json()) as any;
    const overlap = await sync(as, nb, sourceId);
    expect(overlap.status).toBe(409);
    expect(((await overlap.json()) as any).error).toEqual({ code: "SyncAlreadyInProgress", message: "Sync already in progress" });
    const jobs = await api.db.pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind = 'sync' AND payload->>'source_id' = $1", [sourceId]);
    expect(jobs.rows[0].n).toBe(1);
    month = "June";
    await drain();
    const op = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/operations/${first.operation_id}`, { as })).json()) as any).operation;
    expect(SourceOperationDtoSchema.parse(op)).toMatchObject({ state: "Succeeded", committed_revision: 2 });
    expect(JSON.stringify(op)).not.toMatch(/fencing|secret|token|lease/);
    expect((await sync(as, nb, sourceId)).status).toBe(202);
  });

  it("SYNC-API-03: uploads and non-Ready sources are not re-sync eligible; foreign users are 403", async () => {
    const as = "sync-3";
    const nb = (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
    const { rows } = await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`]);
    const { sourceId } = await seedReadySource(api.db.pool, rows[0].id, nb, { pages: ["Upload"], embed: async (t) => t.map(() => Array.from({ length: 768 }, () => 0.01)) });
    expect((await sync(as, nb, sourceId)).status).toBe(409);
    const linked = await linkedSource("sync-3b");
    expect((await sync("sync-3-stranger", linked.nb, linked.sourceId)).status).toBe(403);
  });
});

describe("webhook re-sync (FR-SI-05, NFR-SEC-02)", () => {
  const hook = (headers: Record<string, string>) => api.fetch("/webhooks/google-drive", { method: "POST", headers });

  it("SYNC-API-04: an authenticated channel maps to the same admission; redelivery is idempotent; overlap with manual is 409", async () => {
    const as = "sync-4";
    const { nb, sourceId } = await linkedSource(as);
    await registerSyncChannel(api.db.pool, { channelId: "chan-4", notebookId: nb, sourceId, token: "secret-channel-token", expiresAt: new Date(Date.now() + 3_600_000) });
    const headers = { "x-goog-channel-id": "chan-4", "x-goog-channel-token": "secret-channel-token", "x-goog-resource-state": "update", "x-goog-message-number": "7" };
    expect((await hook({ ...headers, "x-goog-resource-state": "sync" })).status).toBe(204);
    expect((await hook(headers)).status).toBe(202);
    expect((await hook(headers)).status).toBe(202); // same message number → replay, not a second operation
    const ops = await api.db.pool.query("SELECT trigger, state FROM source_operations WHERE source_id = $1 AND kind = 'sync'", [sourceId]);
    expect(ops.rows).toEqual([{ trigger: "webhook", state: "Queued" }]);
    const manual = await sync(as, nb, sourceId);
    expect(manual.status).toBe(409);
    const nextNotification = await hook({ ...headers, "x-goog-message-number": "8" });
    expect(nextNotification.status).toBe(409);
    expect(((await nextNotification.json()) as any).error.message).toBe("Sync already in progress");
  });

  it("SYNC-API-05: unknown channels, wrong tokens and expired channels are rejected without detail", async () => {
    const as = "sync-5";
    const { nb, sourceId } = await linkedSource(as);
    await registerSyncChannel(api.db.pool, { channelId: "chan-5", notebookId: nb, sourceId, token: "right", expiresAt: new Date(Date.now() + 3_600_000) });
    await registerSyncChannel(api.db.pool, { channelId: "chan-5-old", notebookId: nb, sourceId, token: "right", expiresAt: new Date(Date.now() - 1000) });
    for (const headers of [{ "x-goog-channel-id": "nope", "x-goog-channel-token": "right" }, { "x-goog-channel-id": "chan-5", "x-goog-channel-token": "wrong" }, { "x-goog-channel-id": "chan-5-old", "x-goog-channel-token": "right" }, {}]) {
      const res = await hook({ ...headers, "x-goog-message-number": "1" });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }
    expect((await api.db.pool.query("SELECT count(*)::int AS n FROM source_operations WHERE source_id = $1 AND kind = 'sync'", [sourceId])).rows[0].n).toBe(0);
  });
});
