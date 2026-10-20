import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChatConfiguration, persistChatMessage, resetChatStore, resetPackageV22Store, saveSourceGuide } from "@everlast/db";
import { handlePackageV22Route, savedResponseNoteSaver, type PackageV22ApiDependencies } from "../src/routes/package-v2-2.ts";
import { NotesService } from "../src/notes/service.ts";
import { createNoteMarkdownIngestor } from "@everlast/worker/ingestion/note-markdown";
import { listNotes, resetNoteStore } from "@everlast/db";
import { createPackageV22Runtime } from "@everlast/worker/package-v2-2-runtime";
import { getMessageFollowUps } from "@everlast/db";

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
beforeEach(() => { resetPackageV22Store(); resetChatStore(); resetNoteStore(); });
const notesService = () => new NotesService({ ingestor: createNoteMarkdownIngestor() });

describe("Package 2.2 authenticated API routes (FR-SI-02, FR-GC-04/07/09, FR-NM-02)", () => {
  it("returns pending guide status for an authorized Ready source without changing selection", async () => {
    const call = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
    expect(await handlePackageV22Route(call.req, call.res, "owner", deps)).toBe(true);
    expect(call.result()).toMatchObject({ status: 202, body: { status: "GuidePending", source_id: source } });
  });

  it("returns a guide only for the exact authorized Ready revision", async () => {
    await saveSourceGuide({ notebook_id: notebook, source_id: source, revision: 2, output_language: "en-US", status: "GuideReady", source_word_count: 60, summary_md: "A concise source summary.", key_topics: ["a", "b", "c", "d", "e"], supporting_chunk_ids: [chunk] });
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
    const noteDeps = { ...deps, saveNote: savedResponseNoteSaver(notesService()) };
    const save = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/note`, { method: "POST", body: noteReq });
    await handlePackageV22Route(save.req, save.res, "owner", noteDeps);
    expect(save.result().status).toBe(200);
    expect(Object.keys(save.result().body.note).sort()).toEqual(["citations_json", "content_md", "created_at", "id", "notebook_id", "origin_type", "read_only", "source_message_id", "title"].sort());
    const repeat = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/note`, { method: "POST", body: noteReq });
    await handlePackageV22Route(repeat.req, repeat.res, "owner", noteDeps);
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
    const generateFollowUps = vi.fn(async ({ source_revisions }: { source_revisions: { source_id: string; revision: number }[] }) => ({ suggested_followups: [{ text: "What evidence supports it?", supporting_chunk_ids: [chunk] }], source_revisions, output_language: "en-US", generated_at: new Date().toISOString() }));
    const call = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 2 }] } });
    await handlePackageV22Route(call.req, call.res, "owner", { ...deps, generateFollowUps });
    expect(call.result().status).toBe(200);
    expect(generateFollowUps).toHaveBeenCalledTimes(1);
    expect(generateFollowUps).toHaveBeenCalledWith({ notebook_id: notebook, user_id: "owner", answer: "Supported answer", source_revisions: [{ source_id: source, revision: 2 }], output_language: "en-US" });
    const cached = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 2 }] } });
    await handlePackageV22Route(cached.req, cached.res, "owner", { ...deps, generateFollowUps });
    expect(cached.result().status).toBe(200);
    expect(generateFollowUps).toHaveBeenCalledTimes(1);
    const staleScope = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 1 }] } });
    await handlePackageV22Route(staleScope.req, staleScope.res, "owner", { ...deps, generateFollowUps });
    expect(staleScope.result().status).toBe(409);
    expect(generateFollowUps).toHaveBeenCalledTimes(1);
  });

  // Unconfigured grounded chat fails closed with 503 in the v1 chat route (apps/api/test/chat.test.ts).

});

it("lists only owner-scoped source selection data and rejects cross-notebook records (FR-SI-02, C-02)", async () => {
  const id = "66666666-6666-4666-8666-666666666666";
  const listSources = vi.fn(async () => [{ id, notebook_id: notebook, title: "Brief", media_type: "application/pdf", status: "Ready", revision_id: 2 }]);
  const good = invoke(`/api/notebooks/${notebook}/sources`);
  await handlePackageV22Route(good.req, good.res, "owner", { ...deps, listSources });
  expect(good.result()).toMatchObject({ status: 200, body: { sources: [{ id, status: "Ready", revision_id: 2 }] } });
  expect(listSources).toHaveBeenCalledWith("owner", notebook);
  const unavailable = invoke(`/api/notebooks/${notebook}/sources`);
  await handlePackageV22Route(unavailable.req, unavailable.res, "owner", deps);
  expect(unavailable.result()).toMatchObject({ status: 503, body: { error: { code: "Unavailable" } } });
  const bad = invoke(`/api/notebooks/${notebook}/sources`);
  await handlePackageV22Route(bad.req, bad.res, "owner", { ...deps, listSources: vi.fn(async () => [{ id, notebook_id: "77777777-7777-4777-8777-777777777777", title: "Leak", media_type: "application/pdf", status: "Ready", revision_id: 2 }]) });
  expect(bad.result().status).toBe(403);
});

describe("Package 2.2 output-language keyed guide and follow-ups (FR-SI-02, FR-GC-05, FR-UI-02, SRS §5.6)", () => {
  it("serves the guide for the effective or requested language and starts on-demand generation for a missing one", async () => {
    await saveSourceGuide({ notebook_id: notebook, source_id: source, revision: 2, output_language: "de-DE", status: "GuideReady", source_word_count: 60, summary_md: "Eine kurze Zusammenfassung.", key_topics: ["a", "b", "c", "d", "e"], supporting_chunk_ids: [chunk] });
    const startGuide = vi.fn();
    const languageDeps = { ...deps, resolveOutputLanguage: vi.fn(async () => "de-DE"), startGuide };
    const effective = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
    await handlePackageV22Route(effective.req, effective.res, "owner", languageDeps);
    expect(call(effective)).toMatchObject({ status: 200, body: { output_language: "de-DE", summary_md: "Eine kurze Zusammenfassung." } });
    expect(languageDeps.resolveOutputLanguage).toHaveBeenCalledWith("owner", notebook);
    expect(startGuide).not.toHaveBeenCalled();
    const missing = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2&language=fr-FR`);
    await handlePackageV22Route(missing.req, missing.res, "owner", languageDeps);
    expect(call(missing)).toMatchObject({ status: 202, body: { status: "GuidePending", output_language: "fr-FR" } });
    expect(startGuide).toHaveBeenCalledWith({ notebook_id: notebook, user_id: "owner", source_id: source, revision: 2, output_language: "fr-FR" });
    const invalid = invoke(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2&language=xx-unknown`);
    await handlePackageV22Route(invalid.req, invalid.res, "owner", languageDeps);
    expect(call(invalid).status).toBe(400);
  });

  it("generates follow-ups in and caches them under the effective output language", async () => {
    const message = "88888888-8888-4888-8888-888888888888";
    await persistChatMessage(undefined, { id: message, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "assistant", content: "Supported answer", active_source_revisions_snapshot: [{ source_id: source, revision: 2 }] });
    let language = "de-DE";
    const generateFollowUps = vi.fn(async (input: { source_revisions: { source_id: string; revision: number }[]; output_language?: string }) => ({ suggested_followups: [{ text: `Frage ${input.output_language}`, supporting_chunk_ids: [chunk] }], source_revisions: input.source_revisions, output_language: input.output_language!, generated_at: new Date().toISOString() }));
    const languageDeps = { ...deps, generateFollowUps, resolveOutputLanguage: vi.fn(async () => language) };
    const body = { source_revisions: [{ source_id: source, revision: 2 }] };
    const first = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body });
    await handlePackageV22Route(first.req, first.res, "owner", languageDeps);
    expect(call(first)).toMatchObject({ status: 200, body: { output_language: "de-DE" } });
    expect(generateFollowUps).toHaveBeenLastCalledWith(expect.objectContaining({ output_language: "de-DE" }));
    const cached = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body });
    await handlePackageV22Route(cached.req, cached.res, "owner", languageDeps);
    expect(generateFollowUps).toHaveBeenCalledTimes(1);
    language = "fr-FR";
    const other = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body });
    await handlePackageV22Route(other.req, other.res, "owner", languageDeps);
    expect(call(other)).toMatchObject({ status: 200, body: { output_language: "fr-FR" } });
    expect(generateFollowUps).toHaveBeenCalledTimes(2);
  });
});

function call(invocation: ReturnType<typeof invoke>) {
  return invocation.result();
}

it("persists only the in-scope follow-up chips on the assistant message (FR-GC-05, FR-008, C-02)", async () => {
  const message = "99999999-9999-4999-8999-999999999999";
  const outside = "018f6b40-0009-7000-8000-000000000009";
  await persistChatMessage(undefined, { id: message, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "assistant", content: "Supported answer", active_source_revisions_snapshot: [{ source_id: source, revision: 2 }] });
  const runtime = createPackageV22Runtime({
    provider: { getScopedContext: async () => [{ chunk_id: chunk, text: "Evidence", source_id: source, revision: 2, token_count: 1, locator: { page_number: 1, start_offset: 0, end_offset: 8 } }] },
    validateScope: async (_user, envelope) => ({ snapshot: envelope.source_revisions ?? [] }),
    getSourceMetadata: async () => [{ source_id: source, revision: 2, title: "Brief", word_count: 60 }],
    model: {
      generateSourceGuide: async () => { throw new Error("unused"); },
      generateOverview: async () => { throw new Error("unused"); },
      generateFollowUps: async () => ({ suggested_followups: [
        { text: "What evidence supports it?", supporting_chunk_ids: [chunk] },
        { text: "What is outside the scope?", supporting_chunk_ids: [outside] },
      ] }),
    },
    resolveOwner: async () => "owner",
  });
  const req = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 2 }] } });
  await handlePackageV22Route(req.req, req.res, "owner", { ...deps, generateFollowUps: runtime.generateFollowUps });
  expect(req.result()).toMatchObject({ status: 200, body: { suggested_followups: [{ text: "What evidence supports it?", supporting_chunk_ids: [chunk] }] } });
  expect(req.result().body.suggested_followups).toHaveLength(1);
  expect((await getMessageFollowUps(notebook, "owner", message, "en-US"))?.suggested_followups.map((c) => c.text)).toEqual(["What evidence supports it?"]);
});

it("never returns upstream generation error text in overview or follow-up responses (NFR-SEC-01)", async () => {
  const message = "77777777-7777-4777-8777-777777777777";
  await persistChatMessage(undefined, { id: message, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "assistant", content: "Answer", active_source_revisions_snapshot: [{ source_id: source, revision: 2 }] });
  const leak = vi.fn(async () => { throw new Error("secret-detail from upstream"); });
  const overview = invoke(`/api/notebooks/${notebook}/overview`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 2 }], output_language: "en-US" } });
  await handlePackageV22Route(overview.req, overview.res, "owner", { ...deps, generateOverview: leak });
  expect(overview.result().status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(overview.result().body)).not.toContain("secret-detail");
  const followUps = invoke(`/api/notebooks/${notebook}/chat/messages/${message}/follow-ups`, { method: "POST", body: { source_revisions: [{ source_id: source, revision: 2 }] } });
  await handlePackageV22Route(followUps.req, followUps.res, "owner", { ...deps, generateFollowUps: leak });
  expect(followUps.result().status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(followUps.result().body)).not.toContain("secret-detail");
});

describe("shared save-note route writes the Package 2.3 notes store (FR-GC-09, FR-NM-02)", () => {
  const assistant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const question = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const citation = { badge_number: 1, source_id: source, source_title: "Brief", chunk_id: chunk, snippet: "supported", locator: { page_number: 1, start_offset: 0, end_offset: 9 } };
  const save = async (service: NotesService, body: unknown, path = assistant) => {
    const req = invoke(`/api/notebooks/${notebook}/chat/messages/${path}/note`, { method: "POST", body });
    await handlePackageV22Route(req.req, req.res, "owner", { ...deps, saveNote: savedResponseNoteSaver(service) });
    return req.result();
  };
  const seed = async (prompt: string | null) => {
    if (prompt !== null) await persistChatMessage(undefined, { id: question, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "user", content: prompt, created_at: "2026-10-20T00:00:00.000Z" });
    await persistChatMessage(undefined, { id: assistant, thread_id: notebook, notebook_id: notebook, user_id: "owner", role: "assistant", content: "Port 8080 requires mTLS [1]", citations: [citation], active_source_revisions_snapshot: [{ source_id: source, revision: 2 }], created_at: "2026-10-20T00:00:01.000Z" });
  };

  it("creates the same record the notes list returns, with the stable 2.2 DTO", async () => {
    await seed("Which port needs mTLS?");
    const service = notesService();
    const result = await save(service, { notebook_id: notebook, message_id: assistant });
    expect(result.status).toBe(200);
    expect(Object.keys(result.body.note).sort()).toEqual(["citations_json", "content_md", "created_at", "id", "notebook_id", "origin_type", "read_only", "source_message_id", "title"]);
    expect(result.body.note).toMatchObject({ origin_type: "saved_response", read_only: true, source_message_id: assistant, content_md: "Port 8080 requires mTLS [1]", citations_json: [citation] });
    const listed = await listNotes(notebook, "owner");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: result.body.note.id, origin_type: "saved_response", source_message_id: assistant });
  });

  it("is idempotent per user and message, including a note saved through the 2.3 store", async () => {
    await seed("Which port needs mTLS?");
    const service = notesService();
    const viaNotes = await service.saveFromMessage(notebook, "owner", assistant);
    const first = await save(service, { notebook_id: notebook, message_id: assistant });
    const second = await save(service, { notebook_id: notebook, message_id: assistant });
    expect(first.body.note.id).toBe(viaNotes.note.id);
    expect(second.body.note.id).toBe(viaNotes.note.id);
    expect(await listNotes(notebook, "owner")).toHaveLength(1);
  });

  it("titles the note with the preceding user question trimmed to 200 code points, else Saved response", async () => {
    await seed(`   ${"🌱".repeat(250)}   `);
    const long = await save(notesService(), { notebook_id: notebook, message_id: assistant });
    expect(long.body.note.title).toBe("🌱".repeat(200));
    resetChatStore();
    resetNoteStore();
    await seed("  Which port needs mTLS?  ");
    expect((await save(notesService(), { notebook_id: notebook, message_id: assistant })).body.note.title).toBe("Which port needs mTLS?");
    resetChatStore();
    resetNoteStore();
    await seed(null);
    expect((await save(notesService(), { notebook_id: notebook, message_id: assistant })).body.note.title).toBe("Saved response");
  });

  it("rejects body IDs that differ from the path and invalid bodies with 400 ValidationError", async () => {
    await seed("Which port needs mTLS?");
    const service = notesService();
    const otherNotebook = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(await save(service, { notebook_id: otherNotebook, message_id: assistant })).toMatchObject({ status: 400, body: { error: { code: "ValidationError" } } });
    expect(await save(service, { notebook_id: notebook, message_id: question })).toMatchObject({ status: 400, body: { error: { code: "ValidationError" } } });
    expect(await save(service, { notebook_id: notebook })).toMatchObject({ status: 400, body: { error: { code: "ValidationError" } } });
    expect(await save(service, { notebook_id: notebook, message_id: assistant, user_id: "intruder" })).toMatchObject({ status: 400 });
    expect(await listNotes(notebook, "owner")).toHaveLength(0);
  });
});
