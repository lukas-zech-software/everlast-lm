import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder } from "@everlast/cloud";
import { persistChatMessage, resetPackageV22Store } from "@everlast/db";
import { seedReadySource } from "@everlast/db/testing";
import type { StructuredGenerationClient } from "@everlast/worker/package-v2-2";
import { VertexStructuredGenerationClient } from "@everlast/worker/package-v2-2-gemini";
import { createV2Generation } from "../src/server.ts";
import { createV2Runtime } from "../src/v2/runtime.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * Package 2.2 in the composed API (FR-SI-02, FR-GC-04/05, D16): the structured model is wired whenever Vertex is
 * configured, so guide, overview and follow-ups stop answering 503.
 */

const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });

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
