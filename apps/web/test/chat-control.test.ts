import { describe, expect, it, vi } from "vitest";
import { renderResponseActions } from "../src/chat-control.ts";
import { createChatPanel } from "../src/chat/panel.ts";
import { SelectionModel } from "../src/lib/selection.ts";
import { setupMockDOM } from "./mock-dom.ts";

const notebook = "11111111-1111-4111-8111-111111111111";
const message = "33333333-3333-4333-8333-333333333333";
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("Package 2.2 response actions (FR-GC-09)", () => {
  it("clicking the active thumb clears the rating, resets aria-pressed and sends the clear request (FR-014)", async () => {
    const dom = setupMockDOM(1440);
    const container = dom.document.createElement("div");
    const requests: { url: string; method: string }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method ?? "GET" });
      return new Response(init?.method === "DELETE" ? null : "{}", { status: init?.method === "DELETE" ? 204 : 200 });
    });
    renderResponseActions(container as any, { notebookId: notebook, messageId: message, content: "Answer", citations: [], fetcher: fetcher as typeof fetch, clipboard: { writeText: vi.fn() } });
    const up = container.querySelector('[data-action="feedback-up"]')!;
    const down = container.querySelector('[data-action="feedback-down"]')!;
    up.click();
    await flush();
    expect(up.getAttribute("aria-pressed")).toBe("true");
    up.click();
    await flush();
    expect(requests.at(-1)).toEqual({ url: `/api/notebooks/${notebook}/chat/messages/${message}/feedback`, method: "DELETE" });
    expect(up.getAttribute("aria-pressed")).toBe("false");
    expect(down.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking an active Thumbs Down clears it instead of reopening the category form", async () => {
    const dom = setupMockDOM(1440);
    const container = dom.document.createElement("div");
    const methods: string[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return new Response(init?.method === "DELETE" ? null : "{}", { status: init?.method === "DELETE" ? 204 : 200 });
    });
    renderResponseActions(container as any, { notebookId: notebook, messageId: message, content: "Answer", citations: [], fetcher: fetcher as typeof fetch, clipboard: { writeText: vi.fn() } });
    const down = container.querySelector('[data-action="feedback-down"]')!;
    down.click();
    const form = container.querySelector("form")!;
    form.querySelector("select")!.value = "wrong_citation";
    form.dispatchEvent({ type: "submit", preventDefault() {} });
    await flush();
    expect(down.getAttribute("aria-pressed")).toBe("true");
    down.click();
    await flush();
    expect(methods).toEqual(["POST", "DELETE"]);
    expect(down.getAttribute("aria-pressed")).toBe("false");
    expect(form.getAttribute("hidden")).not.toBeNull();
  });
});

describe("Follow-up row above the chat input bar (FR-GC-05, US3/AC3)", () => {
  it("mounts the follow-up row directly above the input bar and reports stream start", async () => {
    const dom = setupMockDOM(1440);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "X", message: "x" } }), { status: 500 })) as unknown as typeof fetch;
    try {
      const selection = new SelectionModel(notebook);
      selection.sync([{ id: "22222222-2222-4222-8222-222222222222", status: "Ready" } as any], true);
      const aboveInput = dom.document.createElement("div");
      const onStreamStart = vi.fn();
      const onStreamEnd = vi.fn();
      const panel = createChatPanel({ notebookId: notebook, selection, onCitationClick: vi.fn(), onNotebookMissing: vi.fn(), aboveInput: aboveInput as any, onStreamStart, onStreamEnd });
      const children = (panel.element as any).children as any[];
      const bar = children.findIndex((c) => c.classList.contains("chat-input-bar"));
      expect(bar).toBeGreaterThan(0);
      expect(children[bar - 1]).toBe(aboveInput);
      // FR-GC-01 (GC-E08): nothing is sent before the workspace has loaded sources and history.
      const send = (panel.element as any).querySelector('[data-testid="send"]');
      expect(send.disabled).toBe(true);
      panel.ask("Too early?");
      await flush();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(onStreamStart).not.toHaveBeenCalled();
      panel.markReady();
      expect(send.disabled).toBe(false);
      panel.ask("What is mTLS?");
      await flush();
      expect(onStreamStart).toHaveBeenCalledTimes(1);
      expect(onStreamEnd).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Chat empty states (FR-GC-04, FR-007)", () => {
  it("keeps the select-sources prompt only when sources exist but none is selected", () => {
    setupMockDOM(1440);
    let hasSources = false;
    const selection = new SelectionModel(notebook);
    const panel = createChatPanel({ notebookId: notebook, selection, onCitationClick: vi.fn(), onNotebookMissing: vi.fn(), hasSources: () => hasSources });
    const prompt = () => (panel.element as any).querySelector('[data-testid="select-sources-prompt"]');
    panel.updateSelection();
    expect(prompt().hidden).toBe(true);
    hasSources = true;
    panel.updateSelection();
    expect(prompt().hidden).toBe(false);
  });
});
