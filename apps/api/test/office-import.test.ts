import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE, SourceDtoSchema, SourceImportAcceptedSchema, UNSUPPORTED_UPLOAD_MESSAGE } from "@everlast/contracts";
import { HashingTestEmbedder, LocalObjectStorage } from "@everlast/cloud";
import { createDelegatedConnection, revokeDelegatedConnection } from "@everlast/db";
import { createWorkerHandler } from "@everlast/worker";
import { createOfficeAdapter } from "@everlast/worker/ingestion/office";
import { createDriveAdapter, type DriveApi } from "@everlast/worker/ingestion/drive";
import { buildDocx } from "@everlast/testkit/ooxml-builder";
import { docxFixture, driveSlidesExportFixture, pptxFixture } from "@everlast/testkit/multimodal-fixtures";
import { startTestApi, type TestApi } from "./support.ts";
import type { DelegationBroker } from "../src/routes/connections.ts";

/**
 * [009-multimodal-ingestion-sync] T012 — Office upload and delegated Drive import admission through the real API,
 * PostgreSQL and worker (FR-SI-01/04/05, FR-WM-07, C-01; spec FR-001, FR-002, FR-006, FR-007, FR-016, SC-003,
 * SC-005): existing 200 `{items}` / 200 `{source}` envelopes stay, new imports answer 202, MIME admission never
 * admits client note_markdown, both inclusive limits hold, Owner-only.
 */

let api: TestApi;
let dir: string;
let drain: () => Promise<unknown>;
const drive: DriveApi = {
  getMetadata: async (_t, id) => ({ id, name: "Steering deck", mimeType: "application/vnd.google-apps.presentation", version: "1", canDownload: true }),
  exportFile: async () => driveSlidesExportFixture(),
  downloadLongRunning: async () => driveSlidesExportFixture(),
  downloadContent: async () => driveSlidesExportFixture(),
};
let lastVerifier: string | null = null;
const broker: DelegationBroker = {
  authorizationUrl: (state, challenge) =>
    `https://accounts.example.test/o/oauth2/auth?state=${encodeURIComponent(state)}&code_challenge=${challenge}&code_challenge_method=S256`,
  exchangeAndStore: async (_userId, code, verifier) => {
    if (code !== "good-code") throw new Error("bad code");
    lastVerifier = verifier;
    return { secretRef: `secret-for-${code}`, scopes: ["https://www.googleapis.com/auth/drive.readonly"], accountLabel: "owner@example.test" };
  },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "everlast-office-"));
  const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
  let pending: Promise<unknown> = Promise.resolve();
  api = await startTestApi({}, { embedder, delegationBroker: broker, notifyJobs: () => void (pending = pending.then(() => drain())) });
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: api.baseUrl });
  api.deps.storage = storage;
  const worker = createWorkerHandler(
    {
      pool: api.db.pool,
      storage,
      embedder,
      ocr: { name: "none", recognize: async () => new Map() },
      adapters: { office: createOfficeAdapter({}), drive: createDriveAdapter({ api: drive, tokens: { accessToken: async () => "user-token" }, office: {} }) },
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

async function notebook(as: string): Promise<string> {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  return ((await res.json()) as any).notebook.id;
}

async function userId(as: string): Promise<string> {
  const { rows } = await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`]);
  return rows[0].id;
}

async function settle(as: string, nb: string, sourceId: string) {
  for (let i = 0; i < 200; i++) {
    await drain();
    const source = ((await (await api.fetch(`/api/notebooks/${nb}/sources/${sourceId}`, { as })).json()) as any).source;
    if (source.status === "Ready" || source.status === "Failed") return source;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("source did not settle");
}

async function upload(as: string, nb: string, fileName: string, bytes: Buffer) {
  const attempt = randomUUID();
  const res = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, { method: "POST", as, json: { files: [{ attempt_id: attempt, file_name: fileName, declared_bytes: bytes.length }] } });
  expect(res.status).toBe(200);
  const item = ((await res.json()) as any).items[0];
  expect(item.admitted, JSON.stringify(item)).toBe(true);
  expect(item.upload.headers["content-type"]).toBe(item.source.media_type);
  const put = await fetch(item.upload.url, { method: "PUT", headers: item.upload.headers, body: new Uint8Array(bytes) });
  expect(put.status).toBe(204);
  const done = await api.fetch(`/api/notebooks/${nb}/sources/${item.source.id}/complete`, { method: "POST", as, json: { attempt_id: attempt } });
  expect(done.status).toBe(200);
  return ((await done.json()) as any).source;
}

describe("Office uploads (FR-SI-01, C-01)", () => {
  it("OFFICE-API-01: DOCX and PPTX keep the 200 {items}/{source} envelopes and become Ready with their media types", async () => {
    const as = "office-1";
    const nb = await notebook(as);
    const docx = await upload(as, nb, "Falcon.docx", docxFixture());
    const pptx = await upload(as, nb, "Falcon.pptx", pptxFixture());
    expect(SourceDtoSchema.parse(docx).status).toBe("Processing");
    const [d, p] = [await settle(as, nb, docx.id), await settle(as, nb, pptx.id)];
    expect(d).toMatchObject({ status: "Ready", media_type: DOCX_MEDIA_TYPE, link_kind: null });
    expect(p).toMatchObject({ status: "Ready", media_type: PPTX_MEDIA_TYPE });
    const content = (await (await api.fetch(`/api/notebooks/${nb}/sources/${pptx.id}/content`, { as })).json()) as any;
    expect(content.pages.map((page: any) => page.text).join("\n")).toContain("Speaker notes:");
  });

  it("OFFICE-API-02: unsupported, macro-enabled and trusted-only types are rejected before any slot is reserved", async () => {
    const as = "office-2";
    const nb = await notebook(as);
    const res = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as,
      json: { files: ["deck.ppt", "macro.docm", "run.exe", "n.note_markdown"].map((file_name) => ({ attempt_id: randomUUID(), file_name, declared_bytes: 5 })) },
    });
    const items = ((await res.json()) as any).items;
    for (const item of items) expect(item.error).toEqual({ code: "UnsupportedMediaType", message: UNSUPPORTED_UPLOAD_MESSAGE });
    const quota = (await (await api.fetch(`/api/notebooks/${nb}/quota`, { as })).json()) as any;
    expect(quota.sources_used).toBe(0);
  });

  it("OFFICE-API-03: declared 200,000,000 bytes is admitted, 200,000,001 is rejected without a slot", async () => {
    const as = "office-3";
    const nb = await notebook(as);
    const res = await api.fetch(`/api/notebooks/${nb}/sources/uploads`, {
      method: "POST",
      as,
      json: { files: [{ attempt_id: randomUUID(), file_name: "max.pptx", declared_bytes: 200_000_000 }, { attempt_id: randomUUID(), file_name: "over.pptx", declared_bytes: 200_000_001 }] },
    });
    const [max, over] = ((await res.json()) as any).items;
    expect(max.admitted).toBe(true);
    expect(over).toMatchObject({ admitted: false, error: { code: "SourceOversized" } });
  });

  it("OFFICE-API-04: extracted words above 500,000 fail with the exact message and release the slot", async () => {
    const as = "office-4";
    const nb = await notebook(as);
    const words = Array.from({ length: 500_001 }, (_, i) => `w${i % 97}`).join(" ");
    const source = await upload(as, nb, "Huge.docx", buildDocx([{ kind: "paragraph", text: words }]));
    const settled = await settle(as, nb, source.id);
    expect(settled).toMatchObject({ status: "Failed", error: { message: "Exceeds 500,000 words limit" } });
    const quota = (await (await api.fetch(`/api/notebooks/${nb}/quota`, { as })).json()) as any;
    expect(quota.sources_used).toBe(0);
  });
});

describe("delegated Drive import (D11, FR-SI-01)", () => {
  it("OFFICE-API-05: POST /imports (drive) answers 202 {source_id, operation_id, status} and becomes Ready", async () => {
    const as = "office-5";
    const nb = await notebook(as);
    const connection = await createDelegatedConnection(api.db.pool, { userId: await userId(as), secretRef: "ref", scopes: ["drive.readonly"] });
    const res = await api.fetch(`/api/notebooks/${nb}/sources/imports`, {
      method: "POST",
      as,
      json: { attempt_id: randomUUID(), kind: "drive", external_document_id: "1SlidesFile", connection_id: connection.id },
    });
    expect(res.status).toBe(202);
    const accepted = SourceImportAcceptedSchema.parse(await res.json());
    const op = (await (await api.fetch(`/api/notebooks/${nb}/sources/${accepted.source_id}/operations/${accepted.operation_id}`, { as })).json()) as any;
    expect(["Queued", "Running", "Succeeded"]).toContain(op.operation.state);
    const ready = await settle(as, nb, accepted.source_id);
    expect(ready).toMatchObject({ status: "Ready", link_kind: "drive", title: "Steering deck", media_type: PPTX_MEDIA_TYPE });
    expect(JSON.stringify(ready)).not.toContain("ref");
  });

  it("OFFICE-API-06: another user's or a revoked connection is 403 and reserves nothing", async () => {
    const as = "office-6";
    const nb = await notebook(as);
    await api.fetch("/api/notebooks", { as: "office-6-other" });
    const foreign = await createDelegatedConnection(api.db.pool, { userId: await userId("office-6-other"), secretRef: "ref", scopes: [] });
    const own = await createDelegatedConnection(api.db.pool, { userId: await userId(as), secretRef: "ref", scopes: [] });
    await revokeDelegatedConnection(api.db.pool, await userId(as), own.id);
    for (const connection_id of [foreign.id, own.id]) {
      const res = await api.fetch(`/api/notebooks/${nb}/sources/imports`, { method: "POST", as, json: { attempt_id: randomUUID(), kind: "drive", external_document_id: "x1", connection_id } });
      expect(res.status).toBe(403);
    }
    expect(((await (await api.fetch(`/api/notebooks/${nb}/quota`, { as })).json()) as any).sources_used).toBe(0);
  });

  it("OFFICE-API-07: OAuth connection flow binds the delegation to the browser and user that started it (nonce cookie, single use, PKCE)", async () => {
    const as = "office-7";
    await api.fetch("/api/notebooks", { as });
    const startRes = await api.fetch("/api/connections/google/authorize", { method: "POST", as, json: { return_to: "/" } });
    const start = (await startRes.json()) as any;
    const setCookie = startRes.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^everlast_oauth_nonce=[A-Za-z0-9_-]{32,};/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/oauth\/google/);
    const cookie = setCookie.split(";")[0]!;
    const authUrl = new URL(start.authorization_url);
    const state = authUrl.searchParams.get("state")!;
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const challenge = authUrl.searchParams.get("code_challenge")!;
    const cb = (st: string, headers: Record<string, string> = {}) =>
      api.fetch(`/oauth/google/callback?code=good-code&state=${encodeURIComponent(st)}`, { redirect: "manual", headers });

    // Tampered state, missing cookie (CSRF / login confusion) and a foreign nonce cookie are all refused.
    expect((await cb(state + "x", { cookie })).status).toBe(400);
    expect((await cb(state)).status).toBe(400);
    expect((await cb(state, { cookie: "everlast_oauth_nonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(400);
    // Another user's state presented with this browser's cookie is refused as well.
    const otherStart = await api.fetch("/api/connections/google/authorize", { method: "POST", as: "office-7-attacker", json: {} });
    const attackerState = new URL(((await otherStart.json()) as any).authorization_url).searchParams.get("state")!;
    expect((await cb(attackerState, { cookie })).status).toBe(400);

    const ok = await cb(state, { cookie });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("set-cookie") ?? "").toMatch(/everlast_oauth_nonce=;.*Max-Age=0/i);
    expect(lastVerifier && createHash("sha256").update(lastVerifier).digest("base64url")).toBe(challenge);
    // Single use: the same state + cookie cannot be replayed.
    expect((await cb(state, { cookie })).status).toBe(400);

    const list = (await (await api.fetch("/api/connections", { as })).json()) as any;
    expect(list.connections).toHaveLength(1);
    expect(list.connections[0]).toMatchObject({ provider: "google", account_label: "owner@example.test" });
    expect(JSON.stringify(list)).not.toContain("secret-for");
    expect(((await (await api.fetch("/api/connections", { as: "office-7-attacker" })).json()) as any).connections).toEqual([]);
    const del = await api.fetch(`/api/connections/${list.connections[0].id}`, { method: "DELETE", as });
    expect(del.status).toBe(204);
    expect(((await (await api.fetch("/api/connections", { as })).json()) as any).connections).toEqual([]);
  });


  it("OFFICE-API-08 (T055, FR-002): the picker is offered only when configured and exposes public identifiers only", async () => {
    const as = "office-8";
    await api.fetch("/api/notebooks", { as });
    const off = (await (await api.fetch("/api/connections", { as })).json()) as any;
    expect(off.picker).toBeNull();
    api.deps.pickerConfig = { developerKey: "public-browser-key", appId: "123456789", clientId: "client.apps.example.test" };
    const on = (await (await api.fetch("/api/connections", { as })).json()) as any;
    expect(on.picker).toEqual({ developer_key: "public-browser-key", app_id: "123456789", client_id: "client.apps.example.test", scope: "https://www.googleapis.com/auth/drive.file" });
    expect(JSON.stringify(on)).not.toMatch(/secret|refresh|secret_ref/i);
    expect((await api.fetch("/api/connections")).status).toBe(401);
    api.deps.pickerConfig = undefined;
  });
});
