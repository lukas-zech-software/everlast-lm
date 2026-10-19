import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChatConfiguration, persistChatMessage, resetChatStore, resetPackageV22Store, saveSourceGuide } from "@everlast/db";
import { handlePackageV22Route, type PackageV22ApiDependencies } from "../src/routes/package-v2-2.js";

const notebook = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const chunk = "018f6b40-0001-7000-8000-000000000001";
function invoke(url: string, options: { method?: string; body?: unknown } = {}) {
  const req = Readable.from(options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]) as any;
  req.url = url;
  req.method = options.method ?? "GET";
  req.headers = { host: "localhost" };
  let status = 0;
  let payload = "";
  const res = { writeHead: (code: number) => { status = code; }, end: (body?: string) => { payload = body ?? ""; } } as any;
  return { req, res, result: () => ({ status, body: payload ? JSON.parse(payload) : undefined }) };
}
const deps: PackageV22ApiDependencies = {
  authorizeNotebook: vi.fn(async () => true),
  authorizeSource: vi.fn(async () => ({ exists: true, ready: true, revision: 2 })),
};
beforeEach(() => { resetPackageV22Store(); resetChatStore(); });

describe("Package 2.2 authenticated API routes (FR-SI-02, FR-GC-04/07/09, FR-NM-02)", () => {
  it("returns pending guide status for an authorized Ready source without changing selection", async () => {
    const call = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
    expect(await handlePackageV22Route(call.req, call.res, "owner", deps)).toBe(true);
    expect(call.result()).toMatchObject({ status: 202, body: { status: "GuidePending", source_id: source } });
  });

  it("returns a guide only for the exact authorized Ready revision", async () => {
    await saveSourceGuide({ notebook_id: notebook, source_id: source, revision: 2, status: "GuideReady", source_word_count: 60, summary_md: "A concise source summary.", key_topics: ["a", "b", "c", "d", "e"], supporting_chunk_ids: [chunk] });
    const call = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
    await handlePackageV22Route(call.req, call.res, "owner", deps);
    expect(call.result()).toMatchObject({ status: 200, body: { status: "GuideReady", revision: 2 } });
    const staleDeps = { ...deps, authorizeSource: vi.fn(async () => ({ exists: true, ready: true, revision: 3 })) };
    const stale = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
    await handlePackageV22Route(stale.req, stale.res, "owner", staleDeps);
    expect(stale.result().status).toBe(409);
  });

  it("persists valid per-owner chat settings and keeps old settings after invalid input", async () => {
    const save = invoke(`/api/notebooks/${notebook}/chat/configuration`, { method: "PUT", body: { style: "custom", custom_instructions: "Be concise", response_length: "shorter" } });
    await handlePackageV22Route(save.req, save.res, "owner", deps);
    expect(save.result().status).toBe(200);
    const invalid = invoke(`/api/notebooks/${notebook}/chat/configuration`, { method: "PUT", body: { style: "custom", custom_instructions: " ".repeat(2), response_length: "default" } });
    await handlePackageV22Route(invalid.req, invalid.res, "owner", deps);
    expect(invalid.result().status).toBe(422);
    expect(await getChatConfiguration(notebook, "owner")).toMatchObject({ style: "custom", custom_instructions: "Be concise", response_length: "shorter" });
    expect(await getChatConfiguration(notebook, "other-owner")).toMatchObject({ style: "default" });
  });

  it("saves assistant feedback and returns the stable idempotent note response", async () => {
    const message = "44444444-4444-4444-8444-444444444444";
    await persistChatMessage(undefined, { id: message, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "assistant", content: "Supported answer [1]", active_source_revisions_snapshot: [{ source_id: source, revision: 2 }], citations: [{ badge_number: 1, source_id: source, source_title: "Brief", chunk_id: chunk, snippet: "supported", locator: { page_number: 1, start_offset: 0, end_offset: 9 } }] });
    const feedback = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/feedback`, { method: "POST", body: { rating: "down", category: "wrong_citation" } });
    await handlePackageV22Route(feedback.req, feedback.res, "owner", deps);
    expect(feedback.result().status).toBe(200);
    const noteReq = { notebook_id: notebook, message_id: message };
    const save = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/note`, { method: "POST", body: noteReq });
    await handlePackageV22Route(save.req, save.res, "owner", deps);
    expect(save.result().status).toBe(200);
    expect(Object.keys(save.result().body.note).sort()).toEqual(["citations_json", "content_md", "created_at", "id", "notebook_id", "origin_type", "read_only", "source_message_id", "title"].sort());
    const repeat = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/note`, { method: "POST", body: noteReq });
    await handlePackageV22Route(repeat.req, repeat.res, "owner", deps);
    expect(repeat.result().body.note.id).toBe(save.result().body.note.id);
  });

  it("returns overview generation output and verifies the exact current source snapshot", async () => {
    const generateOverview = vi.fn(async () => ({ notebook_id: notebook, source_revisions: [{ source_id: source, revision: 2 }], authorization_key: createHash("sha256").update("owner").digest("hex"), output_language: "en-US", generation_parameters: {}, cache_key: "cache", overview_md: "Notebook overview", starter_prompts: ["one", "two", "three"], supporting_chunk_ids: [chunk], generated_at: new Date().toISOString() }));
    const call = invoke(`/api/notebooks/${notebook}/overview`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 2 }], output_language: "en-US" } });
    await handlePackageV22Route(call.req, call.res, "owner", { ...deps, generateOverview });
    expect(call.result().status).toBe(200);
    expect(generateOverview).toHaveBeenCalledWith({ notebook_id: notebook, user_id: "owner", source_revisions: [{ source_id: source, revision: 2 }], output_language: "en-US" });
  });

  it("fails closed for foreign notebooks and empty overview scopes", async () => {
    const deniedDeps = { ...deps, authorizeNotebook: vi.fn(async () => false) };
    const denied = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
    await handlePackageV22Route(denied.req, denied.res, "foreign", deniedDeps);
    expect(denied.result().status).toBe(404);
    const empty = invoke(`/api/notebooks/${notebook}/overview`, { method: "POST", body: { source_revisions: [] } });
    await handlePackageV22Route(empty.req, empty.res, "owner", { ...deps, generateOverview: vi.fn() });
    expect(empty.result().status).toBe(400);
  });

  it("generates follow-ups only from the owning assistant message snapshot", async () => {
    const message = "55555555-5555-4555-8555-555555555555";
    await persistChatMessage(undefined, { id: message, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "assistant", content: "Supported answer", active_source_revisions_snapshot: [{ source_id: source, revision: 2 }] });
    const generateFollowUps = vi.fn(async ({ source_revisions }: { source_revisions: { source_id: string; revision: number }[] }) => ({ suggested_followups: ["What evidence supports it?"], supporting_chunk_ids: [chunk], source_revisions, generated_at: new Date().toISOString() }));
    const call = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST" });
    await handlePackageV22Route(call.req, call.res, "owner", { ...deps, generateFollowUps });
    expect(call.result().status).toBe(200);
    expect(generateFollowUps).toHaveBeenCalledWith({ notebook_id: notebook, user_id: "owner", answer: "Supported answer", source_revisions: [{ source_id: source, revision: 2 }] });
  });

});
