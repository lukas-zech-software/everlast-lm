import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createWorkerHandler } from "@everlast/worker";
import { createWebAdapter, type Transport } from "@everlast/worker/ingestion/web";
import { roadmapHtml } from "@everlast/testkit/multimodal-fixtures";
import { ChatService } from "../src/chat/service.ts";
import type { GroundedModelInput } from "../src/chat/model.ts";
import { startTestApi, readJson, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T037 (API) — removal and re-sync through the real API, worker and chat
 * (FR-SI-03/05, FR-GC-02/03/06, FR-WM-07, C-02, NFR-EVAL-02/04; spec FR-010, FR-013..FR-016, SC-004, SC-007): the next
 * chat turn after removal cannot use the source (0 ms staleness), objects are purged by the durable cleanup, a re-sync
 * answers "June" with the new revision while the old turn is excluded from the prompt and its citation says
 * "Source updated", and mere deselection keeps history visible.
 */

interface HistoryMessage {
  role: string;
  content: string | null;
  unavailable_reason?: string | null;
  citations: Array<{
    status: string;
    locator: unknown;
    snippet: string | null;
  }>;
}

let api: TestApi;
let dir: string;
let storage: LocalObjectStorage;
let drain: () => Promise<unknown>;
let month: "May" | "June" = "May";
const inputs: GroundedModelInput[] = [];
const transport: Transport = {
  request() {
    const body = roadmapHtml(month);
    return Promise.resolve({
      status: 200,
      headers: { "content-type": "text/html" },
      body: (async function* () {
        await Promise.resolve();
        yield Buffer.from(body);
      })(),
    });
  },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-life-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  api = await startTestApi({}, (db) => ({
    embedder,
    notifyJobs: () => undefined,
    chat: new ChatService({
      pool: db.pool,
      embedder,
      model: {
        id: "citing",
        generate: (input: GroundedModelInput) => {
          inputs.push(input);
          const hit = input.chunks.find((c) => c.text.includes("Release v1")) ?? input.chunks[0]!;
          return Promise.resolve({
            status: "answered",
            sentences: [
              { text: `${hit.text.split(".")[0]!}.`, citations: [hit.chunk_id], kind: "claim" },
            ],
          });
        },
      } as never,
    }),
  }));
  storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const worker = createWorkerHandler(
    {
      pool: api.db.pool,
      storage,
      embedder,
      ocr: { name: "none", recognize: () => Promise.resolve(new Map()) },
      adapters: {
        web: createWebAdapter({
          resolver: {
            lookup: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
          },
          transport,
          policy: { privateNetworks: [], allowedPrivateHosts: [] },
        }),
      },
      screener: { name: "clean", screen: () => Promise.resolve({ verdict: "clean" }) },
    },
    { NODE_ENV: "test" },
  );
  drain = () => worker.drain();
});

afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

async function roadmap(as: string) {
  const nb = (
    await readJson<{ notebook: { id: string } }>(
      await api.fetch("/api/notebooks", { method: "POST", as, json: {} }),
    )
  ).notebook.id;
  month = "May";
  const { source_id } = await readJson<{ source_id: string }>(
    await api.fetch(`/api/notebooks/${nb}/sources/imports`, {
      method: "POST",
      as,
      json: { attempt_id: randomUUID(), kind: "web", url: "https://intranet.example.test/roadmap" },
    }),
  );
  await drain();
  return { nb, sourceId: source_id };
}

async function ask(as: string, nb: string, ids: string[], message = "When is Release v1?") {
  const res = await api.fetch(`/api/notebooks/${nb}/chat/turns`, {
    method: "POST",
    as,
    json: { message, active_source_ids: ids, request_id: randomUUID() },
  });
  const text = await res.text();
  return { status: res.status, text };
}

const history = async (as: string, nb: string): Promise<HistoryMessage[]> =>
  (
    await readJson<{ messages: HistoryMessage[] }>(
      await api.fetch(`/api/notebooks/${nb}/chat`, { as }),
    )
  ).messages;

describe("re-sync and history (FR-SI-05, FR-GC-03/06)", () => {
  it("LIFE-API-01: after May→June the new answer says June; the old turn is excluded from the prompt; its citation is 'Source updated'", async () => {
    const as = "life-1";
    const { nb, sourceId } = await roadmap(as);
    expect((await ask(as, nb, [sourceId])).text).toContain("May");
    month = "June";
    expect(
      (
        await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/sync`, {
          method: "POST",
          as,
          json: { attempt_id: randomUUID() },
        })
      ).status,
    ).toBe(202);
    await drain();
    inputs.length = 0;
    const second = await ask(as, nb, [sourceId]);
    expect(second.text).toContain("June");
    expect(inputs[0]!.history).toEqual([]);
    expect(inputs[0]!.chunks.every((c) => c.revision === 2)).toBe(true);
    const msgs = await history(as, nb);
    const oldAnswer = msgs.find((m) => m.role === "assistant")!;
    expect(oldAnswer.content).toContain("May");
    expect(oldAnswer.citations[0]).toMatchObject({ status: "updated", locator: null });
    expect(oldAnswer.citations[0]!.snippet).toContain("May");
  });
});

describe("removal (FR-SI-05, NFR-EVAL-04, SC-004)", () => {
  it("LIFE-API-02: the next turn cannot use a removed source; history shows 'Source deleted'; objects are purged", async () => {
    const as = "life-2";
    const { nb, sourceId } = await roadmap(as);
    await ask(as, nb, [sourceId]);
    const del = await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, {
      method: "DELETE",
      as,
    });
    expect(del.status).toBe(204);
    const after = await ask(as, nb, [sourceId]);
    expect(after.status).toBeGreaterThanOrEqual(400);
    expect(after.text).not.toContain("May");
    const answer = (await history(as, nb)).find((m) => m.role === "assistant")!;
    expect(answer).toMatchObject({ content: null, unavailable_reason: "source_deleted" });
    expect(answer.citations[0]).toMatchObject({ status: "deleted", snippet: null });
    expect(
      (
        await readJson<{ sources_used: number }>(
          await api.fetch(`/api/notebooks/${nb}/quota`, { as }),
        )
      ).sources_used,
    ).toBe(0);
    await drain();
    expect(await storage.listVersions(`notebooks/${nb}/sources/${sourceId}/`)).toEqual([]);
  });

  it("LIFE-API-03: mere deselection keeps history visible with available citations", async () => {
    const as = "life-3";
    const { nb, sourceId } = await roadmap(as);
    await ask(as, nb, [sourceId]);
    const { source_id: other } = await readJson<{ source_id: string }>(
      await api.fetch(`/api/notebooks/${nb}/sources/imports`, {
        method: "POST",
        as,
        json: { attempt_id: randomUUID(), kind: "web", url: "https://intranet.example.test/other" },
      }),
    );
    await drain();
    // Ask with only the other source selected: the first source is merely deselected, not removed.
    await ask(as, nb, [other]);
    const answer = (await history(as, nb)).find((m) => m.role === "assistant")!;
    expect(answer.citations[0]).toMatchObject({ status: "available" });
    expect(answer.content).toContain("May");
  });
});
