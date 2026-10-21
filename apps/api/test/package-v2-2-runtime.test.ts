import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder } from "@everlast/cloud";
import { getSourceGuide, persistChatMessage, resetPackageV22Store, runWithV2Persistence } from "@everlast/db";
import { seedReadySource } from "@everlast/db/testing";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { VertexStructuredGenerationClient } from "@everlast/worker/package-v2-2-gemini";
import { createV2Generation } from "../src/server.ts";
import { createV2Runtime, type V2Runtime } from "../src/v2/runtime.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * Package 2.2 in the composed API (FR-SI-02, FR-GC-04/05, D16): the structured model is wired whenever Vertex is
 * configured, so guide, overview and follow-ups stop answering 503.
 */

const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });

/** specs/013: guides live in the API's PostgreSQL database; read them in that app's store scope. */
const storedGuide = (target: TestApi, ...args: Parameters<typeof getSourceGuide>) => runWithV2Persistence(target.db.pool, () => getSourceGuide(...args));

/** Deterministic fake model: cites the first chunk of the scope it was given. */
const fakeGeneration: StructuredGenerationClient = {
  async generateSourceGuide({ source }) {
    return { summary_md: "Water freezes at zero degrees.", key_topics: ["Freezing point"], supporting_chunk_ids: [source.chunks[0]!.chunk_id] };
  },
  async generateOverview({ sources }) {
    return { overview_md: "The notebook covers freezing.", starter_prompts: ["When does water freeze?"], supporting_chunk_ids: [sources[0]!.chunks[0]!.chunk_id] };
  },
  async generateFollowUps({ sources }) {
    return { suggested_followups: [{ text: "What happens below zero?", supporting_chunk_ids: [sources[0]!.chunks[0]!.chunk_id] }] };
  },
};

async function setup(target: TestApi, as: string) {
  const res = await target.fetch("/api/notebooks", { method: "POST", as, json: {} });
  const notebookId = ((await res.json()) as any).notebook.id as string;
  const owner = (await target.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id as string;
  const source = await seedReadySource(target.db.pool, owner, notebookId, {
    title: "Physics.md",
    pages: ["Water freezes at zero degrees Celsius."],
    embed: (t) => embedder.embed(t),
    mediaType: "text/markdown",
  });
  return { notebookId, owner, sourceId: source.sourceId };
}

describe("startApiServer wiring of the structured model (FR-SI-02, FR-GC-04/05, D3)", () => {
  it("creates the Vertex client under the same condition as the grounded chat model", () => {
    expect(createV2Generation({ VERTEX_PROJECT: "everlast-eu" }, true)).toBeInstanceOf(VertexStructuredGenerationClient);
    expect(createV2Generation({ VERTEX_PROJECT: "everlast-eu" }, false)).toBeUndefined();
    expect(createV2Generation({}, true)).toBeUndefined();
  });
});

describe("composed v2 runtime with a structured model (FR-SI-02, FR-GC-04/05)", () => {
  let api: TestApi;
  let unconfigured: TestApi;
  beforeAll(async () => {
    resetPackageV22Store();
    // The v2 chat-message reader is process-wide (D16: one API instance), so the configured runtime is created last.
    unconfigured = await startTestApi({}, (db) => ({ embedder, v2: createV2Runtime({ pool: db.pool, sourceLimit: 50 }) }));
    api = await startTestApi({}, (db) => ({ embedder, v2: createV2Runtime({ pool: db.pool, sourceLimit: 50, generation: fakeGeneration }) }));
  });
  afterAll(async () => {
    await api?.close();
    await unconfigured?.close();
  });

  it("answers guide, overview and follow-ups instead of 503", async () => {
    const { notebookId, owner, sourceId } = await setup(api, "wired-a");
    const scope = { source_revisions: [{ source_id: sourceId, revision: 1 }] };
    const overview = await api.fetch(`/api/notebooks/${notebookId}/overview`, { method: "POST", as: "wired-a", json: { ...scope, output_language: "en-US" } });
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({ overview_md: "The notebook covers freezing.", starter_prompts: ["When does water freeze?"] });

    const guideUrl = `/api/notebooks/${notebookId}/sources/${sourceId}/guide?revision=1`;
    let guide = await api.fetch(guideUrl, { as: "wired-a" });
    expect([200, 202]).toContain(guide.status);
    await expect.poll(async () => ((await (await api.fetch(guideUrl, { as: "wired-a" })).json()) as any).status, { timeout: 5_000 }).toBe("GuideReady");
    guide = await api.fetch(guideUrl, { as: "wired-a" });
    expect(await guide.json()).toMatchObject({ status: "GuideReady", output_language: "en-US", key_topics: ["Freezing point"] });

    const message = await persistChatMessage(undefined, { thread_id: notebookId, notebook_id: notebookId, user_id: owner, role: "assistant", content: "Water freezes at zero degrees [1].", active_source_revisions_snapshot: [{ source_id: sourceId, revision: 1 }] });
    const followUps = await api.fetch(`/api/notebooks/${notebookId}/chat/messages/${message.id}/follow-ups`, { method: "POST", as: "wired-a", json: scope });
    expect(followUps.status).toBe(200);
    expect(await followUps.json()).toMatchObject({ suggested_followups: [{ text: "What happens below zero?" }] });
  });

  it("still fails closed with 503 when no structured model is configured", async () => {
    const { notebookId, sourceId } = await setup(unconfigured, "unwired-a");
    const overview = await unconfigured.fetch(`/api/notebooks/${notebookId}/overview`, { method: "POST", as: "unwired-a", json: { source_revisions: [{ source_id: sourceId, revision: 1 }], output_language: "en-US" } });
    expect(overview.status).toBe(503);
  });
});

describe("Ready-transition watcher in the API process (Gate v2.0 #1, FR-SI-02, FR-018, D16)", () => {
  let api: TestApi;
  let v2: V2Runtime;
  let fail = false;
  const guideCalls: string[] = [];
  const watched: StructuredGenerationClient = {
    ...fakeGeneration,
    async generateSourceGuide(input) {
      guideCalls.push(input.source.source_id);
      if (fail) throw Object.assign(new Error("permanent model failure"), { transient: false });
      return fakeGeneration.generateSourceGuide(input);
    },
  };
  beforeAll(async () => {
    resetPackageV22Store();
    api = await startTestApi({}, (db) => {
      v2 = createV2Runtime({ pool: db.pool, sourceLimit: 50, generation: watched, readyWatch: { intervalMs: 50 } });
      return { embedder, v2 };
    });
  });
  afterAll(async () => {
    v2?.close();
    await api?.close();
  });

  it("generates the guide after Ready without any source listing, once per revision, timed from Ready", async () => {
    const { notebookId, sourceId } = await setup(api, "watch-a");
    await expect.poll(async () => (await storedGuide(api, notebookId, sourceId, 1, "en-US"))?.status, { timeout: 5_000 }).toBe("GuideReady");
    const guide = (await storedGuide(api, notebookId, sourceId, 1, "en-US"))!;
    expect(guide.ready_at).toBeDefined();
    const fromReady = Date.parse(guide.generated_at!) - Date.parse(guide.ready_at!);
    expect(fromReady).toBeGreaterThan(-50);
    expect(fromReady).toBeLessThan(10_000);
    // The listing-time dispatch is only an idempotent fallback.
    expect((await api.fetch(`/api/notebooks/${notebookId}/sources`, { as: "watch-a" })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(guideCalls.filter((id) => id === sourceId)).toHaveLength(1);
  });

  it("a failed guide never blocks reading the source", async () => {
    fail = true;
    const { notebookId, sourceId } = await setup(api, "watch-b");
    await expect.poll(async () => (await storedGuide(api, notebookId, sourceId, 1, "en-US"))?.status, { timeout: 5_000 }).toBe("GuideFailed");
    const content = await api.fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/content`, { as: "watch-b" });
    expect(content.status).toBe(200);
  });
});

describe("Ready watcher pages past full batches (Gate v2.0 #1, FR-SI-02; security review: no starvation)", () => {
  let api: TestApi;
  let v2: V2Runtime;
  const guideCalls: string[] = [];
  const counting: StructuredGenerationClient = {
    ...fakeGeneration,
    async generateSourceGuide(input) {
      guideCalls.push(input.source.source_id);
      return fakeGeneration.generateSourceGuide(input);
    },
  };
  beforeAll(async () => {
    resetPackageV22Store();
    // Interval far beyond the test, so only explicit polls run; batch of 2 forces paging.
    api = await startTestApi({}, (db) => {
      v2 = createV2Runtime({ pool: db.pool, sourceLimit: 50, generation: counting, readyWatch: { intervalMs: 600_000, batchSize: 2 } });
      return { embedder, v2 };
    });
  });
  afterAll(async () => {
    v2?.close();
    await api?.close();
  });

  it("dispatches every one of more than batchSize sources that became Ready at the same instant, exactly once", async () => {
    const first = await setup(api, "batch-a");
    const owner = first.owner;
    const ids = [first.sourceId];
    for (let i = 0; i < 4; i += 1) {
      const seeded = await seedReadySource(api.db.pool, owner, first.notebookId, { title: `Doc${i}.md`, pages: [`Fact number ${i} about water.`], embed: (t) => embedder.embed(t), mediaType: "text/markdown" });
      ids.push(seeded.sourceId);
    }
    await api.db.pool.query("UPDATE sources SET updated_at = now() WHERE notebook_id = $1", [first.notebookId]);
    expect(await v2.pollReadySources()).toBe(5);
    for (const id of ids) {
      await expect.poll(async () => (await storedGuide(api, first.notebookId, id, 1, "en-US"))?.status, { timeout: 5_000 }).toBe("GuideReady");
    }
    expect(await v2.pollReadySources()).toBe(0);
    expect([...guideCalls].sort()).toEqual([...ids].sort());
  });
});
