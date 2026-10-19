import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPocNotebook } from "@everlast/db";
import { createV2Runtime } from "../src/v2/runtime.ts";
import { WorkspacePreferencesService } from "../src/services/workspace-preferences.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * Package 2.1 over the real API: PostgreSQL notebooks and ownership, locally signed tokens, release v2 PoC
 * stores in memory (D16). Each test uses its own owner, so module-level v2 stores never leak between cases.
 */

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({}, (db) => ({ v2: createV2Runtime({ pool: db.pool, sourceLimit: 50 }) }));
});

afterAll(async () => {
  await api?.close();
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
    expect(defaults.data).toMatchObject({ theme: "system", input_language: "auto", view_mode: "grid", sort_order: "recent" });
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
    await request(owner, `/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", body: { is_pinned: true, output_language_override: "fr-FR" } });
    expect((await request(other, "/api/preferences")).data.theme).toBe("system");
    expect((await request(other, `/api/notebooks/${notebook.id}/preferences`)).status).toBe(403);
  });
});

describe("Effective language preference resolution (FR-UI-02)", () => {
  it("applies job, personal, notebook, user and supported browser precedence", async () => {
    const service = new WorkspacePreferencesService();
    const owner = "language-owner";
    const notebook = createPocNotebook(owner, "Languages");
    await service.patchOwnerPreferences(owner, { input_language: "it-IT", output_language: "ja-JP" });
    await service.patchNotebookPreferences(owner, notebook.id, {
      input_language_override: "fr-FR",
      output_language_override: "de-DE",
      notebook_input_language: "es-ES",
      notebook_output_language: "fr-FR",
    });

    expect(await service.resolveLanguagePreferences(owner, notebook.id, "it-IT", "pt-BR", "zh-TW")).toEqual({
      input_language: "pt-BR",
      output_language: "zh-TW",
    });
    expect(await service.resolveLanguagePreferences(owner, notebook.id, "it-IT")).toEqual({
      input_language: "fr-FR",
      output_language: "de-DE",
    });
    await service.patchNotebookPreferences(owner, notebook.id, { input_language_override: null, output_language_override: null });
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
});
