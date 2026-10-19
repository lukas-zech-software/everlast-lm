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
});
