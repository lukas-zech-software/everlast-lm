import type { ChatMessage, Citation } from "@everlast/contracts";
import { renderChatTurn } from "./turn.js";

export interface RenderChatHistoryOptions {
  onCitationClick?: (citation: Citation) => void;
  autoScroll?: boolean;
}

/**
 * Chat History Presentation & Navigation Adapter (FR-GC-06, C-02).
 */
export class ChatHistoryAdapter {
  private highlightedElement: HTMLElement | null = null;

  /**
   * Render chronological chat history into the given container and scroll to latest (FR-GC-06).
   */
  public renderHistory(
    container: HTMLElement,
    messages: ChatMessage[],
    options: RenderChatHistoryOptions = { autoScroll: true }
  ): void {
    if (typeof container.replaceChildren === "function") {
      container.replaceChildren();
    } else {
      container.innerHTML = "";
    }

    for (const msg of messages) {
      const turnEl = renderChatTurn(msg);
      container.appendChild(turnEl);
    }

    if (options.autoScroll && messages.length > 0) {
      this.scrollToLatest(container);
    }
  }

  /**
   * Scroll container to the latest message.
   */
  public scrollToLatest(container: HTMLElement): void {
    container.scrollTop = container.scrollHeight;
    const lastChild = container.lastElementChild;
    if (lastChild && typeof (lastChild as any).scrollIntoView === "function") {
      (lastChild as any).scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }

  /**
   * Handle user action to clear chat history (FR-GC-06).
   * Confirms action, clears the chat container, and resets to initial state.
   */
  public async handleClearChat(
    container: HTMLElement,
    confirmFn: () => Promise<boolean> | boolean,
    onClearSuccess: () => Promise<void> | void
  ): Promise<boolean> {
    const confirmed = await confirmFn();
    if (!confirmed) {
      return false;
    }

    if (typeof container.replaceChildren === "function") {
      container.replaceChildren();
    } else {
      container.innerHTML = "";
    }

    await onClearSuccess();
    return true;
  }

  /**
   * Search persisted conversation messages and render search results panel (FR-GC-06).
   * If matches found: lists matching messages. Clicking jumps to and highlights target message.
   * If no matches: shows exact text "No messages found" and leaves chat panel unchanged.
   */
  public searchAndRenderResults(
    messages: ChatMessage[],
    query: string,
    resultsContainer: HTMLElement,
    chatContainer?: HTMLElement,
    onSelect?: (messageId: string) => void
  ): ChatMessage[] {
    if (typeof resultsContainer.replaceChildren === "function") {
      resultsContainer.replaceChildren();
    } else {
      resultsContainer.innerHTML = "";
    }

    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const lowerQuery = trimmed.toLowerCase();
    const matched = messages.filter((m) =>
      m.content.toLowerCase().includes(lowerQuery)
    );

    if (matched.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "chat-search-no-results";
      emptyEl.textContent = "No messages found";
      resultsContainer.appendChild(emptyEl);
      return [];
    }

    for (const msg of matched) {
      const resultItem = document.createElement("div");
      resultItem.className = "chat-search-result-item";
      resultItem.setAttribute("data-result-id", msg.id);

      const roleBadge = document.createElement("span");
      roleBadge.className = "chat-search-result-role";
      roleBadge.textContent = msg.role === "user" ? "You: " : "Everlast: ";
      resultItem.appendChild(roleBadge);

      const snippet = document.createElement("span");
      snippet.className = "chat-search-result-snippet";
      snippet.textContent = msg.content;
      resultItem.appendChild(snippet);

      resultItem.addEventListener("click", () => {
        if (chatContainer) {
          this.jumpToMessage(chatContainer, msg.id);
        }
        if (onSelect) {
          onSelect(msg.id);
        }
      });

      resultsContainer.appendChild(resultItem);
    }

    return matched;
  }

  /**
   * Jump to and highlight a specific message in the chat panel (FR-GC-06).
   */
  public jumpToMessage(chatContainer: HTMLElement, messageId: string): boolean {
    const targetEl = chatContainer.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement | null;

    if (!targetEl) {
      return false;
    }

    if (this.highlightedElement) {
      this.highlightedElement.classList.remove("chat-turn-highlighted");
    }

    targetEl.classList.add("chat-turn-highlighted");
    this.highlightedElement = targetEl;

    if (typeof (targetEl as any).scrollIntoView === "function") {
      (targetEl as any).scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return true;
  }
}
