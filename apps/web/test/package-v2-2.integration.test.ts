import { describe, expect, it } from "vitest";
import { renderWorkspaceLayout } from "../src/workspace-layout.js";
import { renderNotebookOverview } from "../src/chat-control.js";
import { setupMockDOM } from "./mock-dom.js";

describe("Package 2.2 workspace integration (FR-SI-02, FR-GC-04/05/07/09)", () => {
  it("provides reachable source-guide, overview, settings and chat message mounts in the application shell", () => {
    const dom = setupMockDOM(1440);
    const root = dom.document.createElement("div");
    renderWorkspaceLayout(root as any, { activeNotebookId: "11111111-1111-4111-8111-111111111111" });
    expect(root.querySelector("#source-guide-panel")).not.toBeNull();
    expect(root.querySelector("#notebook-overview")).not.toBeNull();
    expect(root.querySelector("#chat-config-dialog")).not.toBeNull();
    expect(root.querySelector("#chat-messages")).not.toBeNull();
    expect(root.querySelector(".notebook-title")?.textContent).toBe("Research Notebook");
    expect(root.querySelector(".overview-empty-state")?.textContent).toBe("Add a source to get started.");
  });

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

  it("renders the owner-authorized notebook title in the workspace header", () => {
    const dom = setupMockDOM(1440);
    const root = dom.document.createElement("div");
    renderWorkspaceLayout(root as any, { activeNotebookId: "11111111-1111-4111-8111-111111111111", notebookTitle: "Field Notes" });
    expect(root.querySelector(".notebook-title")?.textContent).toBe("Field Notes");
  });
});
