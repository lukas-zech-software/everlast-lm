import { describe, expect, it, vi } from "vitest";
import { SourceGuideController } from "../src/source-guide.js";
import { ChatControlController, copyResponse, renderResponseActions, scopeSignature, stripCitationBadges } from "../src/chat-control.js";
import { setupMockDOM } from "./mock-dom.js";

const source = "22222222-2222-4222-8222-222222222222";
const notebook = "11111111-1111-4111-8111-111111111111";

describe("Package 2.2 web controls (FR-SI-02, FR-GC-04/05/07/09, FR-NM-02)", () => {
  it("loads source guide without changing scope and routes topic selection to grounded chat callback", async () => {
    const onTopic = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "GuideReady", summary_md: "Summary", key_topics: ["Topic"] }), { status: 200 }));
    const guide = new SourceGuideController({ notebookId: notebook, fetcher: fetcher as typeof fetch, onTopic });
    await guide.load(source, 2);
    expect(guide.getState().status).toBe("GuideReady");
    const dom = setupMockDOM(1440);
    const container = dom.document.createElement("div");
    guide.render(container as any);
    expect(container.querySelector(".source-guide-content")?.getAttribute("hidden")).not.toBeNull();
    container.querySelector(".source-guide-toggle")?.click();
    expect(container.querySelector(".source-guide-content")?.getAttribute("hidden")).toBeNull();
    container.querySelector("[data-topic]")?.click();
    expect(onTopic).toHaveBeenCalledWith("Topic", source);
    expect(fetcher).toHaveBeenCalledWith(`/api/notebooks/${notebook}/sources/${source}/guide?revision=2`);
  });

  it("invalidates overview and follow-up content immediately when the exact scope changes", () => {
    const control = new ChatControlController({ notebookId: notebook, submit: vi.fn(), fetcher: vi.fn() as typeof fetch });
    const first = [{ source_id: source, revision: 2 }];
    control.updateScope(first, "en-US");
    const signature = scopeSignature(first, "en-US");
    control.setOverview({ overview_md: "overview", starter_prompts: ["Start"] });
    control.setFollowUps(["Explore evidence"]);
    control.updateScope([{ source_id: source, revision: 3 }], "en-US");
    expect(control.getOverview()).toBeNull();
    expect(control.getFollowUps()).toEqual([]);
    expect(signature).not.toBe(scopeSignature([{ source_id: source, revision: 3 }], "en-US"));
  });

  it("hides follow-ups while streaming and only removes rendered citation badges from copy text", async () => {
    const submit = vi.fn();
    const control = new ChatControlController({ notebookId: notebook, submit, fetcher: vi.fn() as typeof fetch });
    control.updateScope([{ source_id: source, revision: 2 }], "en-US");
    control.setFollowUps(["Explore evidence"]);
    control.setStreaming(true);
    expect(control.getFollowUps()).toEqual([]);
    expect(stripCitationBadges("Claim [1], bracket [9]", [{ badge_number: 1 }])).toBe("Claim, bracket [9]");
    control.submitStarterPrompt("Start here");
    expect(submit).toHaveBeenCalledWith("Start here");
    const writeText = vi.fn(async () => undefined);
    await copyResponse("Claim [1]", [{ badge_number: 1 }], false, { writeText });
    expect(writeText).toHaveBeenCalledWith("Claim");
  });

  it("retains previous chat settings when validation or API save fails", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 422 }));
    const control = new ChatControlController({ notebookId: notebook, submit: vi.fn(), fetcher: fetcher as typeof fetch });
    expect(await control.saveConfiguration({ style: "custom", custom_instructions: " ".repeat(2), response_length: "default" })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await control.saveConfiguration({ style: "analyst", response_length: "longer" })).toBe(false);
    expect(control.getConfiguration()).toMatchObject({ style: "default", response_length: "default" });
  });


  it("renders copy and idempotent save actions for an assistant response", async () => {
    const dom = setupMockDOM(1440);
    const container = dom.document.createElement("div");
    const writeText = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/note");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ note: { title: "Saved answer" } }), { status: 200 });
    });
    renderResponseActions(container as any, { notebookId: notebook, messageId: "33333333-3333-4333-8333-333333333333", content: "Answer [1]", citations: [{ badge_number: 1 }], fetcher: fetcher as typeof fetch, clipboard: { writeText } });
    container.querySelector('[data-action="copy-plain"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("Answer");
    container.querySelector('[data-action="save-note"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Saved: Saved answer");
  });

});
