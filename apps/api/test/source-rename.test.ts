import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { seedReadySource } from "@everlast/db/testing";
import { ChatService } from "../src/chat/service.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T033 — Rename source (FR-SI-05, FR-GC-03; spec FR-009, SC-005): 1–200 Unicode code
 * points after trimming (0/whitespace-only/201 rejected, never truncated), copied-text creation keeps 100, and the
 * new title appears in the source list, the Inspector and every citation tooltip projection.
 */

let api: TestApi;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });

beforeAll(async () => {
  api = await startTestApi({}, (db) => ({
    embedder,
    chat: new ChatService({
      pool: db.pool,
      embedder,
      model: {
        id: "citing-test-model",
        generate: async ({ chunks }: { chunks: { chunk_id: string; text: string }[] }) => ({ status: "answered", sentences: [{ text: chunks[0]!.text, citations: [chunks[0]!.chunk_id], kind: "claim" }] }),
      } as never,
    }),
  }));
  api.deps.storage = new LocalObjectStorage({ root: await mkdtemp(join(tmpdir(), "everlast-rename-")), publicBaseUrl: api.baseUrl });
});

afterAll(async () => {
  await api?.close();
});

async function setup(as: string) {
  const nb = (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
  const { rows } = await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`]);
  const { sourceId } = await seedReadySource(api.db.pool, rows[0].id, nb, { title: "Old title.pdf", pages: ["The depot opens in May."], embed: (t) => embedder.embed(t) });
  return { nb, sourceId };
}

const rename = (as: string, nb: string, id: string, title: unknown) => api.fetch(`/api/notebooks/${nb}/sources/${id}`, { method: "PATCH", as, json: { title } });

describe("Rename source (FR-SI-05)", () => {
  it("RENAME-01: 1 and 200 code points (after trim) are accepted and stored trimmed", async () => {
    const as = "rename-1";
    const { nb, sourceId } = await setup(as);
    const one = await rename(as, nb, sourceId, "  Q  ");
    expect(one.status).toBe(200);
    expect(((await one.json()) as any).source.title).toBe("Q");
    const max = "😀".repeat(200);
    const res = await rename(as, nb, sourceId, max);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).source.title).toBe(max);
  });

  it("RENAME-02: empty, whitespace-only and 201 code points are rejected without truncation; title unchanged", async () => {
    const as = "rename-2";
    const { nb, sourceId } = await setup(as);
    for (const title of ["", " \t ", "x".repeat(201), "😀".repeat(201), 42]) {
      const res = await rename(as, nb, sourceId, title);
      expect(res.status).toBe(422);
    }
    const source = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { as })).json()) as any).source;
    expect(source.title).toBe("Old title.pdf");
  });

  it("RENAME-03: copied-text creation keeps its own 100-code-point default-title rule (unchanged)", async () => {
    const as = "rename-3";
    const nb = (((await (await api.fetch("/api/notebooks", { method: "POST", as, json: {} })).json()) as any).notebook.id) as string;
    const res = await api.fetch(`/api/notebooks/${nb}/sources/text`, { method: "POST", as, json: { attempt_id: randomUUID(), text: "body" } });
    expect(((await res.json()) as any).source.title).toBe("Pasted text");
  });

  it("RENAME-04: the new title shows in the list, the Inspector and history citations; the evidence revision is unchanged", async () => {
    const as = "rename-4";
    const { nb, sourceId } = await setup(as);
    const turn = await api.fetch(`/api/notebooks/${nb}/chat/turns`, { method: "POST", as, json: { message: "When does the depot open?", active_source_ids: [sourceId], request_id: randomUUID() } });
    expect(turn.status).toBe(200);
    await turn.text();
    expect((await rename(as, nb, sourceId, "Depot opening plan")).status).toBe(200);
    const list = ((await (await api.fetch(`/api/notebooks/${nb}/sources`, { as })).json()) as any).sources;
    expect(list[0]).toMatchObject({ title: "Depot opening plan", revision: 1 });
    const content = (await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/content`, { as })).json()) as any;
    expect(content.source.title).toBe("Depot opening plan");
    const chat = (await (await api.fetch(`/api/notebooks/${nb}/chat`, { as })).json()) as any;
    const citation = chat.messages.find((m: any) => m.role === "assistant").citations[0];
    expect(citation).toMatchObject({ status: "available", source_title: "Depot opening plan" });
  });
});
