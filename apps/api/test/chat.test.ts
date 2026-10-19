import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashingTestEmbedder } from "@everlast/cloud";
import { seedReadySource } from "@everlast/db/testing";
import { ChatService } from "../src/chat/service.ts";
import { AdkGroundedModel, ModelUnavailableError, type GroundedModel, type GroundedModelInput } from "../src/chat/model.ts";
import type { GroundedDraft } from "../src/chat/draft.ts";
import { startTestApi, type TestApi } from "./support.ts";

/**
 * T038–T042 — grounded chat over the real API, PostgreSQL and C-02 retrieval (FR-GC-01, FR-GC-02, FR-GC-03,
 * FR-GC-06, NFR-EVAL-04). The model is a scripted TEST DOUBLE so pipeline guarantees (scoping, verification,
 * fencing, persistence) are asserted deterministically; answer quality is measured by the judged eval suite.
 */

type Script = (input: GroundedModelInput) => Promise<GroundedDraft> | GroundedDraft;

class ScriptedModel implements GroundedModel {
  readonly id = "scripted-test-model";
  calls: GroundedModelInput[] = [];
  script: Script = () => ({ status: "not_in_sources", sentences: [] });

  async generate(input: GroundedModelInput): Promise<GroundedDraft> {
    this.calls.push(input);
    return this.script(input);
  }
}

/** Cites every retrieved chunk whose text shares a keyword with the question. */
const citeMatching: Script = ({ question, chunks }) => {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const hits = chunks.filter((c) => words.some((w) => c.text.toLowerCase().includes(w)));
  if (hits.length === 0) return { status: "not_in_sources", missing_topic: question.replace(/\?$/, ""), sentences: [] };
  return { status: "answered", sentences: hits.map((c) => ({ text: c.text, citations: [c.chunk_id], kind: "claim" as const })) };
};

let api: TestApi;
const model = new ScriptedModel();
const embedder = new HashingTestEmbedder({ NODE_ENV: "test" });
const embed = (t: string[]) => embedder.embed(t);

beforeAll(async () => {
  api = await startTestApi({}, (db) => ({ embedder, chat: new ChatService({ pool: db.pool, embedder, model }) }));
});

afterAll(async () => {
  await api?.close();
});

async function userId(as: string): Promise<string> {
  await api.fetch("/api/notebooks", { as });
  return (await api.db.pool.query("SELECT id FROM users WHERE subject = $1", [`local:${as}`])).rows[0].id;
}

async function notebook(as: string): Promise<{ id: string; owner: string }> {
  const res = await api.fetch("/api/notebooks", { method: "POST", as, json: {} });
  return { id: ((await res.json()) as any).notebook.id, owner: await userId(as) };
}

interface SseEvent {
  event: string;
  data: any;
}

async function turn(as: string, nb: string, message: string, sources: string[], requestId = randomUUID()) {
  const res = await api.fetch(`/api/notebooks/${nb}/chat/turns`, {
    method: "POST",
    as,
    json: { message, active_source_ids: sources, request_id: requestId },
  });
  if (res.headers.get("content-type")?.startsWith("application/json")) return { status: res.status, json: (await res.json()) as any, events: [] as SseEvent[] };
  const text = await res.text();
  const events: SseEvent[] = text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.+)$/m.exec(block)![1]!,
      data: JSON.parse(/^data: (.+)$/m.exec(block)![1]!),
    }));
  return { status: res.status, events, final: events.find((e) => e.event === "final")?.data, error: events.find((e) => e.event === "error")?.data };
}

describe("FR-GC-01 strict grounding", () => {
  it("CHAT-01: negative rejection — world-knowledge question gets the explicit refusal and no badges", async () => {
    const nb = await notebook("chat01");
    const guide = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Python_Style.md", pages: ["Use four spaces per indentation level.\n\nPrefer f-strings."], embed, mediaType: "text/markdown" });
    model.script = () => ({ status: "not_in_sources", missing_topic: "the FIFA World Cup", sentences: [] });
    const { final } = await turn("chat01", nb.id, "Who won the FIFA World Cup in 2022?", [guide.sourceId]);
    const answer = final.messages[1];
    expect(answer).toMatchObject({ role: "assistant", kind: "refusal", content: "The selected sources do not contain information about the FIFA World Cup.", citations: [] });
  });

  it("CHAT-02: grounded synthesis across two sources cites both", async () => {
    const nb = await notebook("chat02");
    const s1 = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Servers.pdf", pages: ["Server Alpha runs on port 8080."], embed });
    const s2 = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Security.pdf", pages: ["Port 8080 requires mTLS client certificates."], embed });
    model.script = ({ chunks }) => {
      const a = chunks.find((c) => c.text.includes("Server Alpha"))!;
      const b = chunks.find((c) => c.text.includes("mTLS"))!;
      return {
        status: "answered",
        sentences: [
          { text: "Server Alpha runs on port 8080.", citations: [a.chunk_id], kind: "claim" },
          { text: "Port 8080 requires mTLS client certificates.", citations: [b.chunk_id], kind: "claim" },
        ],
      };
    };
    const { final } = await turn("chat02", nb.id, "What security requirement applies to Server Alpha?", [s1.sourceId, s2.sourceId]);
    const answer = final.messages[1];
    expect(answer.kind).toBe("answer");
    expect(answer.content).toBe("Server Alpha runs on port 8080.[[1]] Port 8080 requires mTLS client certificates.[[2]]");
    expect(answer.citations.map((c: any) => [c.badge_number, c.source_id, c.source_title, c.status])).toEqual([
      [1, s1.sourceId, "Servers.pdf", "available"],
      [2, s2.sourceId, "Security.pdf", "available"],
    ]);
    expect(answer.citations[0].snippet).toBe("Server Alpha runs on port 8080.");
    expect(answer.citations[1].locator).toEqual({ page_number: 1, physical_page: 1, start_offset: 0, end_offset: 44 });
  });

  it("CHAT-03: an uncited historical turn that used a now-deselected source is excluded with its content", async () => {
    const nb = await notebook("chat03");
    const a = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "A.pdf", pages: ["Alpha budget is 3M."], embed });
    const b = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "B.pdf", pages: ["Beta secret codename is ORCHID."], embed });
    model.script = ({ chunks }) => {
      const alpha = chunks.find((c) => c.text.includes("Alpha"))!;
      return { status: "answered", sentences: [{ text: "Alpha budget is 3M.", citations: [alpha.chunk_id], kind: "claim" }] };
    };
    await turn("chat03", nb.id, "Tell me about alpha and beta", [a.sourceId, b.sourceId]);
    model.calls = [];
    model.script = citeMatching;
    await turn("chat03", nb.id, "What is the alpha budget?", [a.sourceId]);
    const call = model.calls.at(-1)!;
    expect(call.history).toEqual([]); // turn 1 used B (even though uncited) → both halves excluded
    expect(call.chunks.every((c) => c.source_id === a.sourceId)).toBe(true);
    expect(JSON.stringify(call)).not.toContain("ORCHID");
    // Turn 2 itself only used A, so it becomes eligible history for the next A-only question.
    await turn("chat03", nb.id, "And again the alpha budget?", [a.sourceId]);
    expect(model.calls.at(-1)!.history).toHaveLength(1);
  });

  it("CHAT-04: empty/omitted scope 400, foreign source 403, non-Ready 409, message bounds 1..10,000 code points", async () => {
    const nb = await notebook("chat04");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Some text."], embed });
    expect((await turn("chat04", nb.id, "hi", [])).status).toBe(400);
    const other = await notebook("chat04");
    const foreign = await seedReadySource(api.db.pool, other.owner, other.id, { pages: ["Other notebook."], embed });
    const cross = await turn("chat04", nb.id, "hi", [s.sourceId, foreign.sourceId]);
    expect(cross.status).toBe(403);
    expect(cross.json.error.code).toBe("InvalidScope");
    expect((await turn("chat04-x", nb.id, "hi", [s.sourceId])).status).toBe(403);
    await api.db.pool.query("UPDATE sources SET status = 'Processing' WHERE id = $1", [s.sourceId]);
    expect((await turn("chat04", nb.id, "hi", [s.sourceId])).status).toBe(409);
    await api.db.pool.query("UPDATE sources SET status = 'Ready' WHERE id = $1", [s.sourceId]);
    model.script = citeMatching;
    expect((await turn("chat04", nb.id, "   ", [s.sourceId])).status).toBe(422);
    expect((await turn("chat04", nb.id, "ü".repeat(10_001), [s.sourceId])).status).toBe(422);
    expect((await turn("chat04", nb.id, ` ${"ü".repeat(10_000)} `, [s.sourceId])).status).toBe(200);
    expect((await turn("chat04", nb.id, "?", [s.sourceId])).status).toBe(200);
  });
});

describe("FR-GC-02 / D13 verification and transport", () => {
  it("CHAT-05: draft citing non-existent 'chk_99999' is withheld; refusal published; no badges", async () => {
    const nb = await notebook("chat05");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Revenue was 10M."], embed });
    model.script = ({ chunks }) => ({
      status: "answered",
      sentences: [
        { text: "Revenue was 10M.", citations: [chunks[0]!.chunk_id], kind: "claim" },
        { text: "Profit was 99M.", citations: ["chk_99999"], kind: "claim" },
      ],
    });
    const { events, final } = await turn("chat05", nb.id, "Revenue?", [s.sourceId]);
    expect(final.messages[1]).toMatchObject({ kind: "refusal", citations: [] });
    expect(JSON.stringify(events)).not.toContain("Profit was 99M");
    const stored = await api.db.pool.query("SELECT content FROM chat_messages WHERE notebook_id = $1 AND role = 'assistant'", [nb.id]);
    expect(stored.rows.map((r) => r.content).join()).not.toContain("99M");
  });

  it("CHAT-06: the stream carries only status events before the single final event", async () => {
    const nb = await notebook("chat06");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Kubernetes cluster has 12 nodes."], embed });
    model.script = citeMatching;
    const { events } = await turn("chat06", nb.id, "How many nodes does the kubernetes cluster have?", [s.sourceId]);
    expect(events.map((e) => e.event)).toEqual(["status", "status", "status", "final"]);
    expect(events.slice(0, 3).map((e) => Object.keys(e.data))).toEqual([["phase"], ["phase"], ["phase"]]);
  });

  it("CHAT-07: model timeout/rate-limit yields the exact retry message and persists nothing", async () => {
    const nb = await notebook("chat07");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Text."], embed });
    model.script = () => {
      throw new ModelUnavailableError("429");
    };
    const { error } = await turn("chat07", nb.id, "Text?", [s.sourceId]);
    expect(error.error).toEqual({ code: "RetryableFailure", message: "An error occurred while generating the response. Please try again." });
    expect((await api.db.pool.query("SELECT 1 FROM chat_messages WHERE notebook_id = $1", [nb.id])).rowCount).toBe(0);
  });

  it("CHAT-08: a revision replaced during generation fails without publishing stale output", async () => {
    const nb = await notebook("chat08");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Stale fact."], embed });
    model.script = async ({ chunks }) => {
      await api.db.pool.query("UPDATE sources SET active_revision = 2 WHERE id = $1", [s.sourceId]);
      return { status: "answered", sentences: [{ text: "Stale fact.", citations: [chunks[0]!.chunk_id], kind: "claim" }] };
    };
    const { error } = await turn("chat08", nb.id, "Stale fact?", [s.sourceId]);
    expect(error.error.code).toBe("SourceSnapshotInvalid");
    expect((await api.db.pool.query("SELECT 1 FROM chat_messages WHERE notebook_id = $1", [nb.id])).rowCount).toBe(0);
  });

  it("CHAT-09: replaying a request_id returns the same turn without duplicating messages", async () => {
    const nb = await notebook("chat09");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Replay safe."], embed });
    model.script = citeMatching;
    const rid = randomUUID();
    const first = await turn("chat09", nb.id, "replay safe?", [s.sourceId], rid);
    const second = await turn("chat09", nb.id, "replay safe?", [s.sourceId], rid);
    expect(second.final.replayed).toBe(true);
    expect(second.final.messages.map((m: any) => m.id)).toEqual(first.final.messages.map((m: any) => m.id));
    expect((await api.db.pool.query("SELECT 1 FROM chat_messages WHERE notebook_id = $1", [nb.id])).rowCount).toBe(2);
  });
});

describe("FR-GC-03 / FR-GC-06 history, citations, clear and search", () => {
  it("CHAT-10: conversation and hydrated citations persist across reloads in order", async () => {
    const nb = await notebook("chat10");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Security_Policy.pdf", pages: ["Passwords rotate every 90 days.", "Badges are required on page three."], embed });
    model.script = citeMatching;
    await turn("chat10", nb.id, "How often do passwords rotate?", [s.sourceId]);
    await turn("chat10", nb.id, "Are badges required?", [s.sourceId]);
    const { messages } = (await (await api.fetch(`/api/notebooks/${nb.id}/chat`, { as: "chat10" })).json()) as any;
    expect(messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[1].citations[0]).toMatchObject({ badge_number: 1, source_title: "Security_Policy.pdf", snippet: "Passwords rotate every 90 days.", status: "available" });
    expect(messages[3].citations[0].locator.page_number).toBe(2);
    expect((await api.fetch(`/api/notebooks/${nb.id}/chat`, { as: "chat10-x" })).status).toBe(403);
  });

  it("CHAT-11: clear chat removes only messages; sources stay Ready; a generation in flight is aborted", async () => {
    const nb = await notebook("chat11");
    const sources = await Promise.all([1, 2, 3].map((i) => seedReadySource(api.db.pool, nb.owner, nb.id, { pages: [`Doc ${i} content.`], embed })));
    model.script = citeMatching;
    await turn("chat11", nb.id, "Doc content?", sources.map((s) => s.sourceId));
    await turn("chat11", nb.id, "Doc content again?", sources.map((s) => s.sourceId));
    let release!: () => void;
    model.script = (input) =>
      new Promise((resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal!.reason));
        release = () => resolve(citeMatching(input) as GroundedDraft);
      });
    const inflight = turn("chat11", nb.id, "Doc content late?", sources.map((s) => s.sourceId));
    await new Promise((r) => setTimeout(r, 100));
    const cleared = await api.fetch(`/api/notebooks/${nb.id}/chat`, { method: "DELETE", as: "chat11" });
    expect(cleared.status).toBe(200);
    release?.();
    const late = await inflight;
    expect(late.error.error.code).toBe("GenerationCancelled");
    const { messages } = (await (await api.fetch(`/api/notebooks/${nb.id}/chat`, { as: "chat11" })).json()) as any;
    expect(messages).toEqual([]);
    const list = ((await (await api.fetch(`/api/notebooks/${nb.id}/sources`, { as: "chat11" })).json()) as any).sources;
    expect(list.map((s: any) => s.status)).toEqual(["Ready", "Ready", "Ready"]);
  });

  it("CHAT-12: a stale epoch cannot publish even without in-process abort (cross-instance clear)", async () => {
    const nb = await notebook("chat12");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Epoch fact."], embed });
    model.script = async (input) => {
      await api.db.pool.query("UPDATE chat_threads SET generation_epoch = generation_epoch + 1 WHERE notebook_id = $1", [nb.id]);
      return citeMatching(input);
    };
    const { error } = await turn("chat12", nb.id, "epoch fact?", [s.sourceId]);
    expect(error.error.code).toBe("GenerationCancelled");
    expect((await api.db.pool.query("SELECT 1 FROM chat_messages WHERE notebook_id = $1", [nb.id])).rowCount).toBe(0);
  });

  it("CHAT-13: search finds exactly the one message containing 'mTLS'; no match returns []", async () => {
    const nb = await notebook("chat13");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Port 8080 requires mTLS.", "Logs rotate weekly."], embed });
    model.script = () => ({ status: "not_in_sources", sentences: [] });
    for (let i = 0; i < 10; i++) {
      await turn("chat13", nb.id, i === 1 ? "Explain mTLS please" : `Question number ${i}`, [s.sourceId]);
    }
    const hits = ((await (await api.fetch(`/api/notebooks/${nb.id}/chat/search?q=mtls`, { as: "chat13" })).json()) as any).results;
    expect(hits).toHaveLength(1);
    const { messages } = (await (await api.fetch(`/api/notebooks/${nb.id}/chat`, { as: "chat13" })).json()) as any;
    expect(messages.findIndex((m: any) => m.id === hits[0].message_id)).toBe(2);
    expect(((await (await api.fetch(`/api/notebooks/${nb.id}/chat/search?q=kubernetes`, { as: "chat13" })).json()) as any).results).toEqual([]);
  });

  it("CHAT-14: a deleted source shows 'Source deleted' (no snippet), hides dependent answers and search hits", async () => {
    const nb = await notebook("chat14");
    const s = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Old_Draft.pdf", pages: ["Draft budget is 7M."], embed });
    const keep = await seedReadySource(api.db.pool, nb.owner, nb.id, { title: "Keep.pdf", pages: ["Unrelated."], embed });
    model.script = citeMatching;
    await turn("chat14", nb.id, "What is the draft budget?", [s.sourceId, keep.sourceId]);
    await api.db.pool.query("DELETE FROM sources WHERE id = $1", [s.sourceId]);
    const { messages } = (await (await api.fetch(`/api/notebooks/${nb.id}/chat`, { as: "chat14" })).json()) as any;
    expect(messages[1]).toMatchObject({ content: null, unavailable_reason: "source_deleted" });
    expect(messages[1].citations[0]).toMatchObject({ status: "deleted", snippet: null, source_title: null });
    expect(JSON.stringify(messages)).not.toContain("7M");
    expect(((await (await api.fetch(`/api/notebooks/${nb.id}/chat/search?q=budget%20is`, { as: "chat14" })).json()) as any).results).toEqual([]);
  });

  it("CHAT-15: mere deselection keeps history viewable with working citations", async () => {
    const nb = await notebook("chat15");
    const a = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Alpha visible fact."], embed });
    const b = await seedReadySource(api.db.pool, nb.owner, nb.id, { pages: ["Beta other."], embed });
    model.script = citeMatching;
    await turn("chat15", nb.id, "alpha visible?", [a.sourceId]);
    await turn("chat15", nb.id, "beta other?", [b.sourceId]);
    const { messages } = (await (await api.fetch(`/api/notebooks/${nb.id}/chat`, { as: "chat15" })).json()) as any;
    expect(messages[1].content).toContain("Alpha visible fact.");
    expect(messages[1].citations[0].status).toBe("available");
  });
});

describe("NFR-SEC-01 enterprise endpoint", () => {
  it("CHAT-16: the ADK adapter targets Vertex AI with ADC even when a developer API key is in the environment", () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "developer-key-must-not-be-used";
    try {
      const adapter = new AdkGroundedModel({ project: "p", location: "europe-west4", model: "gemini-2.5-flash" });
      const client = adapter.llm.apiClient as unknown as { vertexai: boolean; apiKey?: string; location?: string };
      expect(client.vertexai).toBe(true);
      expect(client.apiKey).toBeUndefined();
      expect(client.location).toBe("europe-west4");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
