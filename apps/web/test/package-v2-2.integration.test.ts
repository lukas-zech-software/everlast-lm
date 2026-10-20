import { afterEach, describe, expect, it, vi } from "vitest";
import { renderNotebookOverview } from "../src/chat-control.ts";
import { createWorkspaceFeatures } from "../src/v2/workspace-features.ts";
import { setupMockDOM } from "./mock-dom.ts";

const notebook = "11111111-1111-4111-8111-111111111111";
const sourceA = "22222222-2222-4222-8222-222222222222";
const sourceB = "33333333-3333-4333-8333-333333333333";

type Call = { url: string; method: string; body: any };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.useRealTimers(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Fake API for the v2 workspace features; routes not listed answer 404. */
function fakeApi(routes: Record<string, (call: Call) => Response> = {}) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const call = { url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, suffix] = pattern.split(" ");
      if (m === method && url.split("?")[0]!.endsWith(suffix!)) return handler(call);
    }
    if (url === "/api/preferences") return json({ owner_id: "owner", theme: "system", input_language: "auto", output_language: null });
    if (url.endsWith("/preferences")) return json({ notebook_input_language: null, notebook_output_language: null, is_pinned: false });
    return json({ error: { code: "NotFound", message: "not found" } }, 404);
  }) as unknown as typeof fetch;
  return calls;
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const readySources = [{ id: sourceA, status: "Ready", revision: 2 }, { id: sourceB, status: "Ready", revision: 1 }] as any[];

describe("Package 2.2 workspace integration (FR-SI-02, FR-GC-04/05/07/09)", () => {
  it("shows notebook identity and source count with an actionable overview", () => {
    const dom = setupMockDOM(1440);
    const container = dom.document.createElement("section");
    let called = false;
    const onPrompt = () => { called = true; };
    renderNotebookOverview(container as any, { notebookTitle: "Field Notes", sourceCount: 2, overview: "Overview", starterPrompts: ["Ask a question"], onPrompt });
    expect(container.querySelector("h3")?.textContent).toBe("📓 Field Notes · 2 sources");
    container.querySelector("button")?.click();
    expect(called).toBe(true);
  });

  it("topic chips ask with the current selection and otherwise prompt to select the source (FR-SI-02, Constitution III)", async () => {
    const dom = setupMockDOM(1440);
    const calls = fakeApi({ [`GET /sources/${sourceA}/guide`]: () => json({ status: "GuideReady", summary_md: "Summary", key_topics: ["Zero Trust Architecture"] }) });
    const features = createWorkspaceFeatures({ notebookId: notebook, notebookTitle: "Field Notes" });
    const ask = vi.fn();
    features.bind({ ask, studio: dom.document.createElement("aside") as any, openCitation: vi.fn() });
    features.onSelectionChange(readySources, [sourceB]);
    const slot = dom.document.createElement("div");
    features.onSourceOpened({ id: sourceA, revision: 2 }, slot as any, false);
    await flush();
    slot.querySelector(".source-guide-toggle")?.click();
    slot.querySelector("[data-topic]")?.click();
    expect(ask).not.toHaveBeenCalled();
    expect(slot.querySelector('[data-testid="source-guide-select-prompt"]')?.getAttribute("hidden")).toBeNull();
    expect(calls.some((c) => c.method !== "GET" && c.url.includes("/chat"))).toBe(false);
    features.onSelectionChange(readySources, [sourceA, sourceB]);
    slot.querySelector("[data-topic]")?.click();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toContain("Zero Trust Architecture");
  });

  it("Save to note shows Saved to notes and hands the note to the notes panel (FR-GC-09, FR-NM-02)", async () => {
    const dom = setupMockDOM(1440);
    const messageId = "44444444-4444-4444-8444-444444444444";
    const note = { id: "55555555-5555-4555-8555-555555555555", notebook_id: notebook, source_message_id: messageId, title: "Which port needs mTLS?", content_md: "Port 8080 [1]", citations_json: [], origin_type: "saved_response", read_only: true, created_at: "2026-10-20T00:00:00.000Z" };
    const calls = fakeApi({ [`POST /chat/messages/${messageId}/note`]: () => json({ note }) });
    const features = createWorkspaceFeatures({ notebookId: notebook, notebookTitle: "Field Notes" });
    const studio = dom.document.createElement("aside");
    const saved: unknown[] = [];
    studio.addEventListener("everlast:note-saved", (event: any) => saved.push(event.detail));
    features.bind({ ask: vi.fn(), studio: studio as any, openCitation: vi.fn() });
    const bubble = dom.document.createElement("div");
    features.decorateAnswer(bubble as any, { id: messageId, role: "assistant", kind: "answer", content: "Port 8080 [1]", citations: [] } as any, false);
    bubble.querySelector('[data-action="save-note"]')?.click();
    await flush();
    expect(calls.find((c) => c.url.endsWith("/note"))?.body).toEqual({ notebook_id: notebook, message_id: messageId });
    expect(bubble.querySelector('[role="status"]')?.textContent).toBe("Saved to notes");
    expect(studio.querySelector(`[data-saved-note-id="${note.id}"]`)).not.toBeNull();
    expect(saved).toEqual([{ note_id: note.id }]);
  });

  it("renders follow-up chips in one row above the input, never in the bubble, and drops stale scopes (FR-GC-05, Constitution III)", async () => {
    const dom = setupMockDOM(1440);
    const messageId = "66666666-6666-4666-8666-666666666666";
    let release: (() => void) | null = null;
    let hold = false;
    const calls = fakeApi({
      [`POST /chat/messages/${messageId}/follow-ups`]: () => json({ suggested_followups: [{ text: "What needs mTLS?", supporting_chunk_ids: ["018f6b40-0001-7000-8000-000000000001"] }, { text: "Which port?", supporting_chunk_ids: ["018f6b40-0001-7000-8000-000000000001"] }] }),
    });
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (hold && String(input).endsWith("/follow-ups")) await new Promise<void>((resolve) => { release = resolve; });
      return baseFetch(input, init);
    }) as typeof fetch;
    const features = createWorkspaceFeatures({ notebookId: notebook, notebookTitle: "Field Notes" });
    const ask = vi.fn();
    features.bind({ ask, studio: dom.document.createElement("aside") as any, openCitation: vi.fn() });
    features.onSelectionChange(readySources, [sourceA]);
    const answer = { id: messageId, role: "assistant", kind: "answer", content: "Port 8080 needs mTLS.", citations: [] } as any;
    const bubble = dom.document.createElement("div");
    features.onStreamStart();
    features.onStreamEnd();
    features.decorateAnswer(bubble as any, answer, true);
    await flush();
    const bar = features.followUpBar as any;
    expect(bar.querySelectorAll(".follow-up-chip").map((c: any) => c.textContent)).toEqual(["What needs mTLS?", "Which port?"]);
    expect(bubble.querySelector(".follow-up-chip")).toBeNull();
    expect(calls.find((c) => c.url.endsWith("/follow-ups"))?.body).toEqual({ source_revisions: [{ source_id: sourceA, revision: 2 }] });

    // A new stream removes the row immediately.
    features.onStreamStart();
    expect(bar.querySelectorAll(".follow-up-chip")).toHaveLength(0);
    features.onStreamEnd();
    features.decorateAnswer(dom.document.createElement("div") as any, answer, true);
    await flush();
    expect(bar.querySelectorAll(".follow-up-chip")).toHaveLength(2);

    // A selection change clears synchronously.
    features.onSelectionChange(readySources, [sourceA, sourceB]);
    expect(bar.querySelectorAll(".follow-up-chip")).toHaveLength(0);

    // Chips from an earlier scope that arrive late are never shown or clickable.
    hold = true;
    features.decorateAnswer(dom.document.createElement("div") as any, answer, true);
    await flush();
    features.onSelectionChange(readySources, [sourceB]);
    release!();
    await flush();
    expect(bar.querySelectorAll(".follow-up-chip")).toHaveLength(0);
    expect(ask).not.toHaveBeenCalled();

    // Current-scope chips submit the next turn.
    hold = false;
    features.decorateAnswer(dom.document.createElement("div") as any, answer, true);
    await flush();
    bar.querySelector(".follow-up-chip").click();
    expect(ask).toHaveBeenCalledWith("What needs mTLS?");
    expect(bar.querySelectorAll(".follow-up-chip")).toHaveLength(0);
  });
});
