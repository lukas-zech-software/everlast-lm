import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createPocNotebook } from "@everlast/db";
import { createV2Runtime } from "../src/v2/runtime.ts";
import { WorkspacePreferencesService } from "../src/services/workspace-preferences.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * Package 2.1 over the real API: PostgreSQL notebooks and ownership, locally signed tokens, release v2 PoC
 * stores in memory (D16). Each test uses its own owner, so module-level v2 stores never leak between cases.
 */

let api: TestApi;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-api-wc-"));
  // Note-sources run the v1 ingestion (owner decision 2026-10-20), so the runtime gets storage and an embedder.
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://127.0.0.1:9" });
  api = await startTestApi({}, (db) => ({ embedder, v2: createV2Runtime({ pool: db.pool, sourceLimit: 50, storage, embedder }) }));
  api.deps.storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
});

afterAll(async () => {
  await api?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const newOwner = () => `owner-${randomUUID().slice(0, 8)}`;

async function request(as: string, path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await api.fetch(path, {
    method: options.method ?? "GET",
    as,
    ...(options.body !== undefined ? { json: options.body } : {}),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

async function createNotebook(as: string, title = "Workspace") {
  const response = await request(as, "/api/notebooks", { method: "POST", body: { title } });
  expect(response.status).toBe(201);
  return response.data.notebook as { id: string; updated_at: string };
}

describe("Notebook metadata and overview API (FR-WM-02, FR-WM-03)", () => {
  it("returns icon, Ready count and owner pin/open metadata with list rows", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    const response = await request(owner, "/api/notebooks");
    expect(response.status).toBe(200);
    expect(response.data.notebooks[0]).toMatchObject({
      id: notebook.id,
      icon_emoji: "📓",
      icon_source: "default",
      ready_source_count: 0,
      is_pinned: false,
      last_opened_at: null,
    });
    expect(response.data.notebooks[0].owner_id).toBeUndefined();
  });

  it("persists a valid custom emoji and rejects invalid/multiple graphemes without mutation", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    const invalid = await request(owner, `/api/notebooks/${notebook.id}/icon`, { method: "PATCH", body: { icon_emoji: "🧬🧬" } });
    expect(invalid.status).toBe(400);
    const unchanged = await request(owner, "/api/notebooks");
    expect(unchanged.data.notebooks[0].icon_emoji).toBe("📓");
    const valid = await request(owner, `/api/notebooks/${notebook.id}/icon`, { method: "PATCH", body: { icon_emoji: "👩🏽‍🔬" } });
    expect(valid.status).toBe(200);
    expect(valid.data.notebook.icon_emoji).toBe("👩🏽‍🔬");
    expect(valid.data.notebook.icon_source).toBe("custom");
  });

  it("rejects icon, pin and preference access to another owner's notebook", async () => {
    const owner = newOwner();
    const other = newOwner();
    const notebook = await createNotebook(owner);
    expect((await request(other, `/api/notebooks/${notebook.id}/icon`, { method: "PATCH", body: { icon_emoji: "🧬" } })).status).toBe(403);
    expect((await request(other, `/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", body: { is_pinned: true } })).status).toBe(403);
    expect((await request(other, `/api/notebooks/${notebook.id}/preferences`)).status).toBe(403);
    expect((await request(other, `/api/notebooks/${notebook.id}/opened`, { method: "POST" })).status).toBe(403);
  });

  it("records opened time without changing notebook content updated_at", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    const opened = await request(owner, `/api/notebooks/${notebook.id}/opened`, { method: "POST" });
    expect(opened.status).toBe(204);
    const list = await request(owner, "/api/notebooks");
    expect(list.data.notebooks[0].last_opened_at).toBeTruthy();
    expect(list.data.notebooks[0].updated_at).toBe(notebook.updated_at);
  });

  it("keeps pinned notebooks first for each supported sort with stable title order", async () => {
    const owner = newOwner();
    const alpha = await createNotebook(owner, "Alpha");
    const beta = await createNotebook(owner, "Beta");
    const zeta = await createNotebook(owner, "Zeta");
    expect((await request(owner, `/api/notebooks/${beta.id}/preferences`, { method: "PATCH", body: { is_pinned: true } })).status).toBe(200);
    const response = await request(owner, "/api/notebooks?sort_order=title_asc");
    expect(response.data.notebooks.map((nb: any) => nb.title)).toEqual(["Beta", "Alpha", "Zeta"]);
    expect(response.data.notebooks.map((nb: any) => nb.id)).toEqual(expect.arrayContaining([alpha.id, zeta.id]));
    expect((await request(owner, "/api/notebooks?sort_order=bogus")).status).toBe(400);
  });

  it("forgets v2 metadata when the notebook is deleted", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    await request(owner, `/api/notebooks/${notebook.id}/icon`, { method: "PATCH", body: { icon_emoji: "🧬" } });
    expect((await request(owner, `/api/notebooks/${notebook.id}`, { method: "DELETE" })).status).toBe(202);
    expect((await request(owner, `/api/notebooks/${notebook.id}/preferences`)).status).toBe(404);
  });
});

describe("Owner display and notebook preference API (FR-UI-02, FR-WM-03)", () => {
  it("returns system/auto defaults and persists valid theme/language settings", async () => {
    const owner = newOwner();
    const defaults = await request(owner, "/api/preferences");
    expect(defaults.status).toBe(200);
    expect(defaults.data).toMatchObject({ theme: "system", input_language: "auto", output_language: null });
    expect((await request(owner, "/api/preferences", { method: "PATCH", body: { theme: "dark", output_language: "de-DE" } })).status).toBe(200);
    const saved = await request(owner, "/api/preferences");
    expect(saved.data).toMatchObject({ theme: "dark", output_language: "de-DE" });
  });

  it("rejects unsupported language tags and unknown fields without changing settings", async () => {
    const owner = newOwner();
    const invalid = await request(owner, "/api/preferences", { method: "PATCH", body: { output_language: "xx-XX", forged: true } });
    expect(invalid.status).toBe(400);
    const saved = await request(owner, "/api/preferences");
    expect(saved.data).toMatchObject({ theme: "system", output_language: null });
  });

  it("keeps user and notebook preference scopes isolated", async () => {
    const owner = newOwner();
    const other = newOwner();
    const notebook = await createNotebook(owner);
    await request(owner, "/api/preferences", { method: "PATCH", body: { theme: "light" } });
    await request(owner, `/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", body: { is_pinned: true, notebook_output_language: "fr-FR" } });
    expect((await request(other, "/api/preferences")).data.theme).toBe("system");
    expect((await request(other, `/api/notebooks/${notebook.id}/preferences`)).status).toBe(403);
  });
});

describe("Effective language preference resolution (FR-UI-02, FR-013, FR-015)", () => {
  it("applies job, notebook language, user default, supported browser locale and en-US precedence", async () => {
    const service = new WorkspacePreferencesService();
    const owner = "language-owner";
    const notebook = createPocNotebook(owner, "Languages");
    await service.patchOwnerPreferences(owner, { input_language: "it-IT", output_language: "ja-JP" });
    await service.patchNotebookPreferences(owner, notebook.id, { notebook_input_language: "es-ES", notebook_output_language: "fr-FR" });

    expect(await service.resolveLanguagePreferences(owner, notebook.id, "it-IT", "pt-BR", "zh-TW")).toEqual({
      input_language: "pt-BR",
      output_language: "zh-TW",
    });
    expect(await service.resolveLanguagePreferences(owner, notebook.id, "it-IT")).toEqual({
      input_language: "es-ES",
      output_language: "fr-FR",
    });
    await service.patchNotebookPreferences(owner, notebook.id, { notebook_input_language: null, notebook_output_language: null });
    expect(await service.resolveLanguagePreferences(owner, notebook.id, "it-IT")).toEqual({
      input_language: "it-IT",
      output_language: "ja-JP",
    });
    await service.patchOwnerPreferences(owner, { output_language: null });
    expect(await service.resolveLanguagePreferences(owner, notebook.id, "it-IT")).toEqual({
      input_language: "it-IT",
      output_language: "it-IT",
    });
    expect(await service.resolveLanguagePreferences(owner, notebook.id, "xx-XX")).toEqual({
      input_language: "it-IT",
      output_language: "en-US",
    });
  });

  it("rejects personal per-notebook overrides in v2 and lets the Owner set the notebook language", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    for (const body of [{ input_language_override: "fr-FR" }, { output_language_override: "de-DE" }]) {
      const rejected = await request(owner, `/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", body });
      expect(rejected.status).toBe(400);
      expect(rejected.data.error.code).toBe("InvalidPreference");
    }
    const saved = await request(owner, `/api/notebooks/${notebook.id}/preferences`, {
      method: "PATCH",
      body: { notebook_input_language: "auto", notebook_output_language: "de-DE" },
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ notebook_input_language: "auto", notebook_output_language: "de-DE" });
    expect(saved.data).not.toHaveProperty("input_language_override");
    expect(saved.data).not.toHaveProperty("output_language_override");
    // Chat receives the Owner-set notebook language (the API's internal user id is the notebook's owner_id).
    const ownerId = (await api.db.pool.query("SELECT owner_id FROM notebooks WHERE id = $1", [notebook.id])).rows[0].owner_id as string;
    const languages = await api.deps.v2!.chatPreferences(ownerId, notebook.id, "fr-FR");
    expect(languages).toMatchObject({ input_language: "auto", output_language: "de-DE" });
  });
});

describe("View mode and sort order are browser-local only (FR-WM-03, FR-008)", () => {
  it("rejects view_mode and sort_order on the server and lists by recent when no sort_order is given", async () => {
    const owner = newOwner();
    for (const body of [{ view_mode: "list" }, { sort_order: "title_asc" }]) {
      expect((await request(owner, "/api/preferences", { method: "PATCH", body })).status).toBe(400);
    }
    const prefs = await request(owner, "/api/preferences");
    expect(prefs.data).not.toHaveProperty("view_mode");
    expect(prefs.data).not.toHaveProperty("sort_order");

    await createNotebook(owner, "Alpha");
    const zeta = await createNotebook(owner, "Zeta");
    expect((await request(owner, `/api/notebooks/${zeta.id}/opened`, { method: "POST" })).status).toBe(204);
    const list = await request(owner, "/api/notebooks");
    expect(list.data.notebooks.map((nb: any) => nb.title)).toEqual(["Zeta", "Alpha"]);
  });
});

describe("Content writes advance the notebook updated_at (FR-WM-02, FR-004, US1 Scenarios 2 and 7)", () => {
  async function updatedAt(owner: string, notebookId: string): Promise<string> {
    const list = await request(owner, "/api/notebooks");
    return list.data.notebooks.find((nb: any) => nb.id === notebookId).updated_at;
  }

  async function expectAdvanced(owner: string, notebookId: string, write: () => Promise<unknown>) {
    const before = await updatedAt(owner, notebookId);
    await write();
    const after = await updatedAt(owner, notebookId);
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  }

  async function upload(owner: string, notebookId: string, fileName: string, bytes: Buffer) {
    const attempt = randomUUID();
    const admitted = await request(owner, `/api/notebooks/${notebookId}/sources/uploads`, {
      method: "POST",
      body: { files: [{ attempt_id: attempt, file_name: fileName, declared_bytes: bytes.length }] },
    });
    const item = admitted.data.items[0];
    expect(item.admitted).toBe(true);
    const put = await fetch(item.upload.url, { method: "PUT", headers: item.upload.headers, body: bytes });
    expect(put.status).toBe(204);
    const done = await request(owner, `/api/notebooks/${notebookId}/sources/${item.source.id}/complete`, {
      method: "POST",
      body: { attempt_id: attempt },
    });
    expect(done.status).toBe(200);
    return done.data.source as { id: string; status: string };
  }

  it("advances when a source is added by upload or as copied text, and when a failed source is removed", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    await expectAdvanced(owner, notebook.id, () => upload(owner, notebook.id, "notes.txt", Buffer.from("Quarterly revenue grew.")));
    await expectAdvanced(owner, notebook.id, async () => {
      const res = await request(owner, `/api/notebooks/${notebook.id}/sources/text`, { method: "POST", body: { attempt_id: randomUUID(), text: "Pasted text" } });
      expect(res.status).toBe(201);
    });
    let failed!: { id: string; status: string };
    await expectAdvanced(owner, notebook.id, async () => {
      failed = await upload(owner, notebook.id, "empty.txt", Buffer.alloc(0));
    });
    expect(failed.status).toBe("Failed");
    await expectAdvanced(owner, notebook.id, async () => {
      expect((await request(owner, `/api/notebooks/${notebook.id}/sources/${failed.id}/error`, { method: "DELETE" })).status).toBe(204);
    });
  });

  it("advances when a note is created, changed or deleted, and when a Studio artifact is created or deleted", async () => {
    const owner = newOwner();
    const notebook = await createNotebook(owner);
    let note!: { id: string; revision: number };
    await expectAdvanced(owner, notebook.id, async () => {
      const res = await request(owner, `/api/notebooks/${notebook.id}/notes`, { method: "POST", body: { title: "Idea", content_md: "Revenue grew 12 percent." } });
      expect(res.status).toBe(201);
      note = res.data.note;
    });
    await expectAdvanced(owner, notebook.id, async () => {
      const res = await request(owner, `/api/notebooks/${notebook.id}/notes/${note.id}`, {
        method: "PATCH",
        body: { content_md: "Revenue grew 13 percent.", base_revision: note.revision },
      });
      expect(res.status).toBe(200);
    });
    let sourceId!: string;
    await expectAdvanced(owner, notebook.id, async () => {
      const res = await request(owner, `/api/notebooks/${notebook.id}/notes/convert-to-source`, { method: "POST", body: { note_ids: [note.id] } });
      expect(res.status).toBe(201);
      sourceId = res.data.source.id;
    });
    let artifactId!: string;
    await expectAdvanced(owner, notebook.id, async () => {
      const res = await request(owner, `/api/notebooks/${notebook.id}/studio/artifacts`, {
        method: "POST",
        body: { plugin_type: "report", subtype: "briefing_doc", active_source_ids: [sourceId] },
      });
      expect(res.status).toBe(202);
      artifactId = res.data.artifact.id;
    });
    await expectAdvanced(owner, notebook.id, async () => {
      expect((await request(owner, `/api/notebooks/${notebook.id}/studio/artifacts/${artifactId}`, { method: "DELETE" })).status).toBe(204);
    });
    await expectAdvanced(owner, notebook.id, async () => {
      expect((await request(owner, `/api/notebooks/${notebook.id}/notes/${note.id}?confirm=true`, { method: "DELETE" })).status).toBe(200);
    });

    const before = await updatedAt(owner, notebook.id);
    expect((await request(owner, `/api/notebooks/${notebook.id}/opened`, { method: "POST" })).status).toBe(204);
    expect(await updatedAt(owner, notebook.id)).toBe(before);
  });
});
