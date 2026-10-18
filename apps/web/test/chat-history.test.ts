import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupMockDOM, MockElement } from "./mock-dom.js";
import { ChatHistoryAdapter } from "../src/chat/history.js";
import type { ChatMessage, Citation } from "@everlast/contracts";

describe("FR-GC-06: Chat History Presentation Adapter (US4)", () => {
  let dom: ReturnType<typeof setupMockDOM>;
  let adapter: ChatHistoryAdapter;
  let chatContainer: MockElement;
  let searchResultsContainer: MockElement;

  const mockCitation: Citation = {
    badge_number: 1,
    source_id: "11111111-1111-4111-8111-111111111111",
    source_title: "Spec.pdf",
    chunk_id: "018f6b40-0001-7000-8000-000000000001",
    snippet: "TLS 1.3 is enforced.",
    locator: { page_number: 1, start_offset: 0, end_offset: 20 },
  };

  const sampleMessages: ChatMessage[] = [
    {
      id: "msg-001",
      thread_id: "th-1",
      notebook_id: "99999999-9999-4999-8999-999999999999",
      user_id: "usr_alice",
      role: "user",
      content: "What encryption protocol is used?",
      active_source_revisions_snapshot: [{ source_id: mockCitation.source_id, revision: 1 }],
      citations: [],
      created_at: new Date(Date.now() - 60000).toISOString(),
    },
    {
      id: "msg-002",
      thread_id: "th-1",
      notebook_id: "99999999-9999-4999-8999-999999999999",
      user_id: "usr_alice",
      role: "assistant",
      content: "TLS 1.3 is enforced [1].",
      active_source_revisions_snapshot: [{ source_id: mockCitation.source_id, revision: 1 }],
      citations: [mockCitation],
      created_at: new Date(Date.now() - 50000).toISOString(),
    },
    {
      id: "msg-003",
      thread_id: "th-1",
      notebook_id: "99999999-9999-4999-8999-999999999999",
      user_id: "usr_alice",
      role: "user",
      content: "Is mTLS required?",
      active_source_revisions_snapshot: [{ source_id: mockCitation.source_id, revision: 1 }],
      citations: [],
      created_at: new Date(Date.now() - 40000).toISOString(),
    },
    {
      id: "msg-004",
      thread_id: "th-1",
      notebook_id: "99999999-9999-4999-8999-999999999999",
      user_id: "usr_alice",
      role: "assistant",
      content: "Yes, mTLS client certificates are required.",
      active_source_revisions_snapshot: [{ source_id: mockCitation.source_id, revision: 1 }],
      citations: [],
      created_at: new Date(Date.now() - 30000).toISOString(),
    },
  ];

  beforeEach(() => {
    dom = setupMockDOM();
    adapter = new ChatHistoryAdapter();
    chatContainer = dom.document.createElement("div") as unknown as MockElement;
    searchResultsContainer = dom.document.createElement("div") as unknown as MockElement;
  });

  it("renders messages chronologically and creates citation badges", () => {
    adapter.renderHistory(
      chatContainer as unknown as HTMLElement,
      sampleMessages
    );

    const turns = chatContainer.querySelectorAll(".chat-turn");
    expect(turns).toHaveLength(4);

    const asstTurn = turns[1]!;
    expect(asstTurn.getAttribute("data-message-id")).toBe("msg-002");
    const badge = asstTurn.querySelector(".citation-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("[1]");
  });

  it("handles Clear Chat when confirmed and resets chat panel", async () => {
    adapter.renderHistory(
      chatContainer as unknown as HTMLElement,
      sampleMessages
    );
    expect(chatContainer.querySelectorAll(".chat-turn")).toHaveLength(4);

    const onClearSuccess = vi.fn();
    const confirmed = await adapter.handleClearChat(
      chatContainer as unknown as HTMLElement,
      () => true,
      onClearSuccess
    );

    expect(confirmed).toBe(true);
    expect(onClearSuccess).toHaveBeenCalledTimes(1);
    expect(chatContainer.querySelectorAll(".chat-turn")).toHaveLength(0);
  });

  it("aborts Clear Chat if user cancels confirmation", async () => {
    adapter.renderHistory(
      chatContainer as unknown as HTMLElement,
      sampleMessages
    );

    const onClearSuccess = vi.fn();
    const confirmed = await adapter.handleClearChat(
      chatContainer as unknown as HTMLElement,
      () => false,
      onClearSuccess
    );

    expect(confirmed).toBe(false);
    expect(onClearSuccess).not.toHaveBeenCalled();
    expect(chatContainer.querySelectorAll(".chat-turn")).toHaveLength(4);
  });

  it("searches chat history: displays matching results and jumps to message on click", () => {
    adapter.renderHistory(
      chatContainer as unknown as HTMLElement,
      sampleMessages
    );

    const onSelect = vi.fn();
    const matches = adapter.searchAndRenderResults(
      sampleMessages,
      "mTLS",
      searchResultsContainer as unknown as HTMLElement,
      chatContainer as unknown as HTMLElement,
      onSelect
    );

    expect(matches).toHaveLength(2); // msg-003 and msg-004
    const resultItems = searchResultsContainer.querySelectorAll(".chat-search-result-item");
    expect(resultItems).toHaveLength(2);

    // Click first match (msg-003)
    resultItems[0]!.click();
    expect(onSelect).toHaveBeenCalledWith("msg-003");

    const targetEl = chatContainer.querySelector('[data-message-id="msg-003"]');
    expect(targetEl?.classList.contains("chat-turn-highlighted")).toBe(true);
  });

  it("searches chat history: displays 'No messages found' when query has no matches", () => {
    adapter.renderHistory(
      chatContainer as unknown as HTMLElement,
      sampleMessages
    );

    const matches = adapter.searchAndRenderResults(
      sampleMessages,
      "QuantumCrypto",
      searchResultsContainer as unknown as HTMLElement,
      chatContainer as unknown as HTMLElement
    );

    expect(matches).toHaveLength(0);
    const emptyEl = searchResultsContainer.querySelector(".chat-search-no-results");
    expect(emptyEl).not.toBeNull();
    expect(emptyEl?.textContent).toBe("No messages found");

    // Chat container remains completely unchanged
    expect(chatContainer.querySelectorAll(".chat-turn")).toHaveLength(4);
  });
});
