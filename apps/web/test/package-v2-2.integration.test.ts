import { describe, expect, it } from "vitest";
import { renderNotebookOverview } from "../src/chat-control.ts";
import { setupMockDOM } from "./mock-dom.ts";

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

});
