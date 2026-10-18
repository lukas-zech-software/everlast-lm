import type { ChatMessage, Citation } from "@everlast/contracts";

export interface RenderTurnOptions {
  isStreaming?: boolean;
  statusMessage?: string;
  isRefusal?: boolean;
}

/**
 * Presentation adapter for rendering chat turns in the web interface (FR-GC-01, FR-GC-02).
 */
export function renderChatTurn(
  message: ChatMessage,
  options?: RenderTurnOptions
): HTMLElement {
  const container = document.createElement("div");
  container.className = `chat-turn chat-turn-${message.role}`;
  container.setAttribute("data-message-id", message.id);

  const header = document.createElement("div");
  header.className = "chat-turn-header";
  header.textContent = message.role === "user" ? "You" : "Everlast";
  container.appendChild(header);

  const body = document.createElement("div");
  body.className = "chat-turn-content";

  if (options?.isRefusal) {
    body.classList.add("chat-turn-refusal");
  }

  body.textContent = message.content;
  container.appendChild(body);

  // Render citations if present
  if (message.citations && message.citations.length > 0) {
    const citationsContainer = document.createElement("div");
    citationsContainer.className = "chat-turn-citations";

    for (const citation of message.citations) {
      const badge = document.createElement("span");
      badge.className = "citation-badge";
      badge.textContent = `[${citation.badge_number}]`;
      badge.setAttribute("data-badge-number", String(citation.badge_number));
      badge.setAttribute("data-chunk-id", citation.chunk_id);
      badge.setAttribute("data-source-id", citation.source_id);
      citationsContainer.appendChild(badge);
    }
    container.appendChild(citationsContainer);
  }

  return container;
}

/**
 * Renders a progress/status indicator during streaming/buffering.
 * Status-only streaming: emits progress events while the complete factual draft is buffered.
 */
export function renderStatusIndicator(statusMessage: string): HTMLElement {
  const statusEl = document.createElement("div");
  statusEl.className = "chat-turn-status";
  statusEl.setAttribute("role", "status");
  statusEl.textContent = statusMessage;
  return statusEl;
}
