import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createServer } from "../src/server.js";
import { WorkspaceService } from "../src/services/workspace.js";
import { resetNotebookStore, resetQuotaStore, resetWorkspacePreferenceStore } from "@everlast/db";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(ownerId: string): string {
  const payload = {
    aud: "everlast-test-project",
    iss: "https://securetoken.google.com/everlast-test-project",
    sub: ownerId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}

let server: http.Server;
let baseUrl = "";
const owner = token("workspace-owner");
const otherOwner = token("another-owner");

async function request(path: string, options: { method?: string; body?: unknown; authorization?: string } = {}) {
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      ...(options.authorization ? { Authorization: `Bearer ${options.authorization}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

beforeEach(async () => {
  resetNotebookStore();
  resetQuotaStore();
  resetWorkspacePreferenceStore();
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, () => {
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  }));
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function createNotebook(title = "Workspace") {
  const response = await request("/api/notebooks", { method: "POST", authorization: owner, body: { title } });
  expect(response.status).toBe(201);
  return response.data.notebook as { id: string; updated_at: string };
}

describe("Notebook metadata and overview API (FR-WM-02, FR-WM-03)", () => {
  it("returns icon, Ready count and owner pin/open metadata with list rows", async () => {
    const notebook = await createNotebook();
    const response = await request("/api/notebooks", { authorization: owner });
    expect(response.status).toBe(200);
    expect(response.data.notebooks[0]).toMatchObject({
      id: notebook.id,
      icon_emoji: "📓",
      icon_source: "default",
      ready_source_count: 0,
      is_pinned: false,
      last_opened_at: null,
    });
  });

  it("persists a valid custom emoji and rejects invalid/multiple graphemes without mutation", async () => {
    const notebook = await createNotebook();
    const invalid = await request(`/api/notebooks/${notebook.id}/icon`, { method: "PATCH", authorization: owner, body: { icon_emoji: "🧬🧬" } });
    expect(invalid.status).toBe(400);
    const unchanged = await request("/api/notebooks", { authorization: owner });
    expect(unchanged.data.notebooks[0].icon_emoji).toBe("📓");
    const valid = await request(`/api/notebooks/${notebook.id}/icon`, { method: "PATCH", authorization: owner, body: { icon_emoji: "👩🏽‍🔬" } });
    expect(valid.status).toBe(200);
    expect(valid.data.notebook.icon_emoji).toBe("👩🏽‍🔬");
    expect(valid.data.notebook.icon_source).toBe("custom");
  });

  it("rejects chat access to another owner's notebook", async () => {
    const notebook = await createNotebook();
    expect((await request(`/api/notebooks/${notebook.id}/chat`, { authorization: otherOwner })).status).toBe(403);
    expect((await request(`/api/notebooks/${notebook.id}/chat`, { authorization: owner })).status).toBe(200);
  });

  it("rejects icon, pin and language changes on another owner's notebook", async () => {
    const notebook = await createNotebook();
    expect((await request(`/api/notebooks/${notebook.id}/icon`, { method: "PATCH", authorization: otherOwner, body: { icon_emoji: "🧬" } })).status).toBe(403);
    expect((await request(`/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", authorization: otherOwner, body: { is_pinned: true } })).status).toBe(403);
  });

  it("records opened time without changing notebook content updated_at", async () => {
    const notebook = await createNotebook();
    const opened = await request(`/api/notebooks/${notebook.id}/opened`, { method: "POST", authorization: owner });
    expect(opened.status).toBe(204);
    const list = await request("/api/notebooks", { authorization: owner });
    expect(list.data.notebooks[0].last_opened_at).toBeTruthy();
    expect(list.data.notebooks[0].updated_at).toBe(notebook.updated_at);
  });

  it("keeps pinned notebooks first for each supported sort with stable title order", async () => {
    const alpha = await createNotebook("Alpha");
    const beta = await createNotebook("Beta");
    const zeta = await createNotebook("Zeta");
    expect((await request(`/api/notebooks/${beta.id}/preferences`, { method: "PATCH", authorization: owner, body: { is_pinned: true } })).status).toBe(200);
    const response = await request("/api/notebooks?sort_order=title_asc", { authorization: owner });
    expect(response.data.notebooks.map((nb: any) => nb.title)).toEqual(["Beta", "Alpha", "Zeta"]);
    expect(response.data.notebooks.map((nb: any) => nb.id)).toContain(alpha.id);
    expect(response.data.notebooks.map((nb: any) => nb.id)).toContain(zeta.id);
  });
});

describe("Owner display and notebook preference API (FR-UI-02, FR-WM-03)", () => {
  it("returns system/auto defaults and persists valid theme/language settings", async () => {
    const defaults = await request("/api/preferences", { authorization: owner });
    expect(defaults.status).toBe(200);
    expect(defaults.data).toMatchObject({ theme: "system", input_language: "auto", view_mode: "grid", sort_order: "recent" });
    expect((await request("/api/preferences", { method: "PATCH", authorization: owner, body: { theme: "dark", output_language: "de-DE" } })).status).toBe(200);
    const saved = await request("/api/preferences", { authorization: owner });
    expect(saved.data).toMatchObject({ theme: "dark", output_language: "de-DE" });
  });

  it("rejects unsupported language tags and unknown fields without changing settings", async () => {
    const invalid = await request("/api/preferences", { method: "PATCH", authorization: owner, body: { output_language: "xx-XX", forged: true } });
    expect(invalid.status).toBe(400);
    const saved = await request("/api/preferences", { authorization: owner });
    expect(saved.data).toMatchObject({ theme: "system", output_language: null });
  });

  it("keeps user and notebook preference scopes isolated", async () => {
    const notebook = await createNotebook();
    await request("/api/preferences", { method: "PATCH", authorization: owner, body: { theme: "light" } });
    await request(`/api/notebooks/${notebook.id}/preferences`, { method: "PATCH", authorization: owner, body: { is_pinned: true, output_language_override: "fr-FR" } });
    const otherGlobal = await request("/api/preferences", { authorization: otherOwner });
    const otherNotebook = await request(`/api/notebooks/${notebook.id}/preferences`, { authorization: otherOwner });
    expect(otherGlobal.data.theme).toBe("system");
    expect(otherNotebook.status).toBe(403);
  });
});


describe("Effective language preference resolution (FR-UI-02)", () => {
  it("applies job, personal, notebook, user and supported browser precedence", async () => {
    const service = new WorkspaceService();
    const notebook = await service.createNotebook("language-owner", { title: "Languages" });
    await service.patchOwnerPreferences("language-owner", { input_language: "it-IT", output_language: "ja-JP" });
    await service.patchNotebookPreferences("language-owner", notebook.id, {
      input_language_override: "fr-FR",
      output_language_override: "de-DE",
      notebook_input_language: "es-ES",
      notebook_output_language: "fr-FR",
    });

    expect(await service.resolveLanguagePreferences("language-owner", notebook.id, "it-IT", "pt-BR", "zh-TW"))
      .toEqual({ input_language: "pt-BR", output_language: "zh-TW" });
    expect(await service.resolveLanguagePreferences("language-owner", notebook.id, "it-IT"))
      .toEqual({ input_language: "fr-FR", output_language: "de-DE" });

    await service.patchNotebookPreferences("language-owner", notebook.id, {
      input_language_override: null,
      output_language_override: null,
    });
    expect(await service.resolveLanguagePreferences("language-owner", notebook.id, "it-IT"))
      .toEqual({ input_language: "es-ES", output_language: "fr-FR" });
    await service.patchNotebookPreferences("language-owner", notebook.id, {
      notebook_input_language: null,
      notebook_output_language: null,
    });
    expect(await service.resolveLanguagePreferences("language-owner", notebook.id, "it-IT"))
      .toEqual({ input_language: "it-IT", output_language: "ja-JP" });
    await service.patchOwnerPreferences("language-owner", { output_language: null });
    expect(await service.resolveLanguagePreferences("language-owner", notebook.id, "it-IT"))
      .toEqual({ input_language: "it-IT", output_language: "it-IT" });
    expect(await service.resolveLanguagePreferences("language-owner", notebook.id, "xx-XX"))
      .toEqual({ input_language: "it-IT", output_language: "en-US" });
  });
});
