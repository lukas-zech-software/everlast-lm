import { api, ApiError, postEventStream } from "../lib/api.ts";
import { clear, confirmDialog, h, toast } from "../lib/dom.ts";
import { parseAnswer, splitBadgeGroup } from "../lib/badges.ts";
import { sourcesLabel, type SelectionModel } from "../lib/selection.ts";
import { validateMessage } from "../lib/text.ts";
import type { ChatMessage, Citation } from "../lib/types.ts";

/**
 * Chat panel (FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, FR-SI-03). Sends the explicit selection with every turn,
 * shows only progress until the verified answer arrives, renders citation badges with hover/focus previews and
 * click-to-source, and supports clear and search of the persisted thread.
 */

export interface ChatPanelOptions {
  notebookId: string;
  selection: SelectionModel;
  onCitationClick(citation: Citation): void;
  onNotebookMissing(): void;
}

export interface ChatPanel {
  element: HTMLElement;
  load(): Promise<void>;
  updateSelection(): void;
}

const PHASE_LABEL: Record<string, string> = {
  retrieving: "Searching your sources…",
  generating: "Writing a grounded answer…",
  verifying: "Verifying citations…",
};
const GENERATION_ERROR = "An error occurred while generating the response. Please try again.";

let popover: HTMLElement | null = null;

function hidePopover(): void {
  popover?.remove();
  popover = null;
}

/** Positions the popover above the badge, flipping below/left to stay inside the viewport (FR-GC-03). */
function showPopover(anchor: HTMLElement, citation: Citation): void {
  hidePopover();
  const body =
    citation.status === "available"
      ? [h("div", { class: "popover-title", text: citation.source_title ?? "" }), h("div", { class: "popover-snippet", text: citation.snippet ?? "" })]
      : [h("div", { class: "popover-title", text: "Source deleted" })];
  popover = h("div", { class: "citation-popover", "data-testid": "citation-popover", role: "tooltip" }, ...body);
  document.body.append(popover);
  const rect = anchor.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  let top = rect.top - box.height - 8;
  let placement = "top";
  if (top < 8) {
    top = rect.bottom + 8;
    placement = "bottom";
  }
  let left = Math.min(Math.max(8, rect.left + rect.width / 2 - box.width / 2), window.innerWidth - box.width - 8);
  if (top + box.height > window.innerHeight - 8) {
    top = Math.max(8, Math.min(rect.top, window.innerHeight - box.height - 8));
    left = Math.max(8, rect.left - box.width - 8);
    placement = "left";
  }
  popover.style.top = `${top + window.scrollY}px`;
  popover.style.left = `${left + window.scrollX}px`;
  popover.dataset.placement = placement;
}

function badgeButton(citation: Citation | undefined, n: number, onClick: (c: Citation) => void): HTMLElement {
  const deleted = !citation || citation.status === "deleted";
  const button = h("button", {
    class: `citation-badge${deleted ? " deleted" : ""}`,
    "data-testid": "citation-badge",
    "data-badge": n,
    "data-chunk-id": citation?.chunk_id ?? "",
    "aria-label": deleted ? `Citation ${n}: source deleted` : `Citation ${n}: ${citation!.source_title}`,
    "aria-disabled": deleted ? "true" : "false",
    text: String(n),
  });
  if (citation) {
    button.addEventListener("mouseenter", () => showPopover(button, citation));
    button.addEventListener("focus", () => showPopover(button, citation));
    button.addEventListener("mouseleave", hidePopover);
    button.addEventListener("blur", hidePopover);
  }
  button.addEventListener("click", () => {
    if (!deleted) {
      hidePopover();
      onClick(citation!);
    }
  });
  return button;
}

export function renderAnswerContent(message: ChatMessage, onClick: (c: Citation) => void): HTMLElement {
  const container = h("div", { class: "answer-text" });
  if (message.content === null) {
    container.append(h("em", { class: "muted", text: "This answer is unavailable because a cited source was deleted." }));
    return container;
  }
  const byBadge = new Map(message.citations.map((c) => [c.badge_number, c]));
  for (const segment of parseAnswer(message.content)) {
    if (segment.type === "text") {
      container.append(segment.text);
      continue;
    }
    const group = h("span", { class: "badge-group" });
    const { shown, hidden } = splitBadgeGroup(segment.numbers);
    for (const n of shown) group.append(badgeButton(byBadge.get(n), n, onClick));
    if (hidden.length > 0) {
      const more = h("button", { class: "citation-more", "data-testid": "citation-more", text: `+${hidden.length}` });
      more.addEventListener("click", () => {
        more.replaceWith(...hidden.map((n) => badgeButton(byBadge.get(n), n, onClick)));
      });
      group.append(more);
    }
    container.append(group);
  }
  return container;
}

export function createChatPanel(options: ChatPanelOptions): ChatPanel {
  const search = h("input", { type: "search", class: "chat-search", placeholder: "Search chat", "data-testid": "chat-search", "aria-label": "Search chat history" });
  const results = h("div", { class: "search-results", "data-testid": "search-results", hidden: true });
  const clearButton = h("button", { class: "icon-btn", "data-testid": "clear-chat", "aria-label": "Clear chat", title: "Clear chat", text: "⟲" });
  const messages = h("div", { class: "chat-messages", "data-testid": "chat-messages", role: "log", "aria-live": "polite" });
  const status = h("div", { class: "chat-status", "data-testid": "chat-status", hidden: true });
  const errorLine = h("div", { class: "chat-error", "data-testid": "chat-error", hidden: true });
  const input = h("textarea", { class: "chat-input", "data-testid": "chat-input", rows: 2, placeholder: "Ask about your sources", "aria-label": "Chat message" });
  const pill = h("span", { class: "sources-pill", "data-testid": "sources-pill" });
  const send = h("button", { class: "btn btn-primary send-btn", "data-testid": "send", "aria-label": "Send", text: "➤" });
  const prompt = h("div", { class: "select-prompt", "data-testid": "select-sources-prompt", hidden: true, text: "Select at least one source to ask a question." });
  const element = h(
    "div",
    { class: "chat-panel" },
    h("div", { class: "chat-tools" }, search, clearButton),
    results,
    messages,
    status,
    errorLine,
    prompt,
    h("div", { class: "chat-input-bar" }, input, h("div", { class: "chat-input-meta" }, pill, send))
  );

  let inflight: AbortController | null = null;

  const scrollToEnd = () => {
    messages.scrollTop = messages.scrollHeight;
  };

  const renderMessage = (message: ChatMessage): HTMLElement => {
    const bubble = h("div", {
      class: `message message-${message.role} kind-${message.kind}`,
      "data-testid": `message-${message.role}`,
      "data-message-id": message.id,
    });
    if (message.role === "user") bubble.append(h("div", { class: "question-text", text: message.content ?? "" }));
    else bubble.append(renderAnswerContent(message, options.onCitationClick));
    return bubble;
  };

  const appendMessages = (list: ChatMessage[]) => {
    for (const message of list) messages.append(renderMessage(message));
    scrollToEnd();
  };

  const updateSelection = () => {
    const count = options.selection.count();
    pill.textContent = sourcesLabel(count);
    const empty = count === 0;
    send.disabled = empty || inflight !== null;
    prompt.hidden = !empty;
  };

  const submit = async () => {
    if (inflight) return;
    const ids = options.selection.ids();
    if (ids.length === 0) return;
    const check = validateMessage(input.value);
    if (!check.ok) {
      toast(check.message);
      return;
    }
    errorLine.hidden = true;
    const draft = input.value;
    input.value = "";
    const pending = h("div", { class: "message message-user pending", "data-testid": "message-pending", text: check.value });
    messages.append(pending);
    scrollToEnd();
    inflight = new AbortController();
    updateSelection();
    status.hidden = false;
    status.textContent = PHASE_LABEL.retrieving!;
    try {
      let final: ChatMessage[] | null = null;
      for await (const event of postEventStream(
        `/api/notebooks/${options.notebookId}/chat/turns`,
        { message: check.value, active_source_ids: ids, request_id: crypto.randomUUID() },
        inflight.signal
      )) {
        if (event.event === "status") status.textContent = PHASE_LABEL[(event.data as { phase: string }).phase] ?? "Working…";
        if (event.event === "final") final = (event.data as { messages: ChatMessage[] }).messages;
        if (event.event === "error") {
          const { error } = event.data as { error: { code: string; message: string } };
          throw new ApiError(500, error.code, error.message);
        }
      }
      pending.remove();
      if (final) appendMessages(final);
    } catch (err) {
      pending.remove();
      if (inflight?.signal.aborted || (err instanceof ApiError && err.code === "GenerationCancelled")) return;
      input.value = draft;
      errorLine.hidden = false;
      errorLine.textContent =
        err instanceof ApiError && ["EmptyScope", "InvalidScope", "SourceNotReady", "SourceSnapshotInvalid", "ValidationFailed"].includes(err.code)
          ? err.message
          : GENERATION_ERROR;
      if (err instanceof ApiError && err.status === 404) options.onNotebookMissing();
    } finally {
      inflight = null;
      status.hidden = true;
      updateSelection();
    }
  };

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  });

  clearButton.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Clear chat?", body: "All messages in this chat will be deleted. Sources and notes are not affected.", confirm: "Clear chat", danger: true });
    if (!ok) return;
    inflight?.abort();
    try {
      await api(`/api/notebooks/${options.notebookId}/chat`, { method: "DELETE" });
      clear(messages);
      results.hidden = true;
    } catch {
      toast("Could not clear the chat.");
    }
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = search.value.trim();
      clear(results);
      if (!q) {
        results.hidden = true;
        return;
      }
      const { results: hits } = await api<{ results: { message_id: string; excerpt: string }[] }>(
        `/api/notebooks/${options.notebookId}/chat/search?q=${encodeURIComponent(q)}`
      );
      results.hidden = false;
      if (hits.length === 0) {
        results.append(h("div", { class: "muted", "data-testid": "no-search-results", text: "No messages found" }));
        return;
      }
      for (const hit of hits) {
        const item = h("button", { class: "search-hit", "data-testid": "search-hit", text: hit.excerpt });
        item.addEventListener("click", () => {
          const target = messages.querySelector<HTMLElement>(`[data-message-id="${hit.message_id}"]`);
          if (!target) return;
          messages.querySelectorAll(".search-highlight").forEach((el) => el.classList.remove("search-highlight"));
          target.classList.add("search-highlight");
          target.scrollIntoView({ block: "center" });
          results.hidden = true;
        });
        results.append(item);
      }
    }, 200);
  });

  return {
    element,
    async load() {
      try {
        const { messages: list } = await api<{ messages: ChatMessage[] }>(`/api/notebooks/${options.notebookId}/chat`);
        clear(messages);
        appendMessages(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) options.onNotebookMissing();
      }
      updateSelection();
    },
    updateSelection,
  };
}
