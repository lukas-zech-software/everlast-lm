import { describe, expect, it, vi } from "vitest";
import { renderResponseActions } from "../src/chat-control.ts";
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
