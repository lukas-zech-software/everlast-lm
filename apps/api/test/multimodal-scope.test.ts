import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder } from "@everlast/cloud";
import { seedReadySource } from "@everlast/db/testing";
import { ChatService } from "../src/chat/service.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T005 — API admission/scope regressions for v3 routes: Owner-only notebook/document
 * access (403 foreign notebook, 404 absent per `requireOwnedNotebook`), explicit Ready scope, trusted-only
 * note_markdown (FR-SI-03/05, FR-WM-04/05/07, FR-NM-03, C-02; spec FR-014, FR-016).
 */

let api: TestApi;
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });

beforeAll(async () => {
  api = await startTestApi({}, (db) => ({
    embedder,
    chat: new ChatService({ pool: db.pool, embedder, model: { id: "refusing-test-model", generate: async () => ({ status: "not_in_sources", sentences: [] }) } as never }),
  }));
});

afterAll(async () => {
  await api?.close();
});

async function notebook(as: string): Promise<string> {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  return ((await res.json()) as any).notebook.id;
}

async function ownerId(as: string): Promise<string> {
  await api.fetch("/api/notebooks", { as });
  const { rows } = await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`]);
  return rows[0].id;
}

describe("v3 source routes are Owner-only (FR-WM-04/05, NFR-SEC-02)", () => {
  it("SCOPE-A01: imports into a foreign notebook are 403, into an absent notebook 404", async () => {
    const nb = await notebook("scope-owner-1");
    const body = { attempt_id: randomUUID(), kind: "web", url: "https://news.example.test/a" };
    expect((await api.fetch(`/api/notebooks/${nb}/sources/imports`, { method: "POST", as: "scope-stranger-1", json: body })).status).toBe(403);
    expect((await api.fetch(`/api/notebooks/${randomUUID()}/sources/imports`, { method: "POST", as: "scope-owner-1", json: body })).status).toBe(404);
    expect((await api.fetch(`/api/notebooks/${nb}/sources/imports`, { method: "POST", json: body })).status).toBe(401);
  });

  it("SCOPE-A02: rename, remove, re-sync and media of a foreign source are 403 and reveal nothing", async () => {
    const nb = await notebook("scope-owner-2");
    const { sourceId } = await seedReadySource(api.db.pool, await ownerId("scope-owner-2"), nb, {
      pages: ["Confidential roadmap."],
      embed: (t) => embedder.embed(t),
    });
    const as = "scope-stranger-2";
    const calls = [
      api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { method: "PATCH", as, json: { title: "Mine" } }),
      api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { method: "DELETE", as }),
      api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/sync`, { method: "POST", as, json: { attempt_id: randomUUID() } }),
      api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/media`, { as }),
      api.fetch(`/api/notebooks/${nb}/sources/${sourceId}/content`, { as }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("Confidential");
    }
    const { rows } = await api.db.pool.query("SELECT title FROM sources WHERE id = $1", [sourceId]);
    expect(rows[0].title).toBe("Fixture.pdf");
  });
});

describe("explicit scope and trusted-only note sources (FR-SI-03, FR-NM-03, C-02)", () => {
  it("SCOPE-A03: chat with an empty or omitted selection is rejected (no server fallback)", async () => {
    const nb = await notebook("scope-owner-3");
    for (const json of [{ message: "hi", active_source_ids: [], request_id: randomUUID() }, { message: "hi", request_id: randomUUID() }]) {
      const res = await api.fetch(`/api/notebooks/${nb}/chat/turns`, { method: "POST", as: "scope-owner-3", json });
      expect([400, 422]).toContain(res.status);
      expect(((await res.json()) as any).error.code).toBe("EmptyScope");
    }
  });

  it("SCOPE-A04: uploads can never claim note_markdown or copied_text", async () => {
    const nb = await notebook("scope-owner-4");
    const res = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as: "scope-owner-4",
      json: {
        files: [
          { attempt_id: randomUUID(), file_name: "notes.note_markdown", declared_bytes: 10 },
          { attempt_id: randomUUID(), file_name: "copied_text", declared_bytes: 10 },
        ],
      },
    });
    const { items } = (await res.json()) as any;
    expect(items.map((i: any) => i.error?.code)).toEqual(["UnsupportedMediaType", "UnsupportedMediaType"]);
  });
});
