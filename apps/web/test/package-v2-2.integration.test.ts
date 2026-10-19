import { describe, expect, it } from "vitest";
import { renderWorkspaceLayout } from "../src/workspace-layout.js";
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
  });
});
