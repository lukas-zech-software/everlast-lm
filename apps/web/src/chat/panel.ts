import { api, ApiError, authFetch, postEventStream } from "../lib/api.ts";
import { clear, confirmDialog, h, toast } from "../lib/dom.ts";
import { parseAnswer, splitBadgeGroup } from "../lib/badges.ts";
import { sourcesLabel, type SelectionModel } from "../lib/selection.ts";
import { validateMessage } from "../lib/text.ts";
import type { ChatMessage, Citation } from "../lib/types.ts";
import { NOTE_SOURCE_MEDIA_TYPE } from "../lib/v2-contracts.ts";
import { disposeCodeExecution, renderCodeExecution, renderTextWithComputed, RUNNING_CODE_LABEL } from "./code-execution.ts";

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
  /** Release v2 additions (FR-GC-04/05/07/09): extra tools, an intro block and per-answer actions. */
  tools?: HTMLElement[];
  intro?: HTMLElement;
  decorateAnswer?(bubble: HTMLElement, message: ChatMessage, fresh: boolean): void;
  /** One row directly above the chat input bar (FR-GC-05 follow-up chips). */
  aboveInput?: HTMLElement;
  /** Called when a turn starts streaming and when it ends (FR-GC-05: chips are hidden while streaming). */
  onStreamStart?(): void;
  onStreamEnd?(): void;
  /** Whether the notebook has any source; without one the overview shows "Add a source to get started" (FR-GC-04). */
  hasSources?(): boolean;
}

export interface ChatPanel {
  element: HTMLElement;
  load(): Promise<void>;
  destroy(): void;
  updateSelection(): void;
  /**
   * Enables sending once the workspace has loaded its sources and this chat's history (FR-GC-01). Until then Send
   * is disabled: an early turn would be dropped (no selection yet) or wiped when the history replaces the list.
   */
  markReady(): void;
  /** Sends a prompt as if typed (starter prompts, guide topics, follow-ups). */
  ask(text: string): void;
  /** Appends already-published messages, e.g. a Note Assistant turn (FR-NM-04 FR-017). */
  append(messages: ChatMessage[]): void;
}

const PHASE_LABEL: Record<string, string> = {
  retrieving: "Searching your sources…",
  generating: "Writing a grounded answer…",
  verifying: "Verifying citations…",
  // FR-GC-08 FR-004: shown only once code is actually submitted to the sandbox.
  running_code: RUNNING_CODE_LABEL,
};

/** Authorized chart bytes (FR-GC-08): bearer-authenticated fetch, never a public or signed storage URL. */
async function fetchChart(url: string): Promise<Blob> {
  const res = await authFetch(url);
  if (!res.ok) throw new ApiError(res.status, "ChartUnavailable", "Chart unavailable");
  return res.blob();
}
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
      ? [h("div", { class: "popover-title", text: `${citation.source_media_type === NOTE_SOURCE_MEDIA_TYPE ? "Note · " : ""}${citation.source_title ?? ""}` }), h("div", { class: "popover-snippet", text: citation.snippet ?? "" })]
      : citation.status === "updated"
        ? // FR-SI-05: the cited revision was replaced by a re-sync; the saved snippet is historical, not the current text.
          [
            h("div", { class: "popover-title", text: `Source updated · ${citation.source_title ?? ""}` }),
            h("div", { class: "popover-snippet", text: citation.snippet ?? "" }),
            h("div", { class: "popover-action muted", text: "Click to open the current source" }),
          ]
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
  // FR-NM-04 FR-017: citations of note-sources carry a "Note" label, so note assertions stay distinguishable.
  const note = !deleted && citation!.source_media_type === NOTE_SOURCE_MEDIA_TYPE;
  const button = h(
    "button",
    {
      class: `citation-badge${deleted ? " deleted" : ""}${citation?.status === "updated" ? " updated" : ""}${note ? " citation-note" : ""}`,
      "data-testid": "citation-badge",
      "data-badge": n,
      "data-chunk-id": citation?.chunk_id ?? "",
      "aria-label": deleted
        ? `Citation ${n}: source deleted`
        : citation!.status === "updated"
          ? `Citation ${n}: source updated — open the current version of ${citation!.source_title}`
          : `Citation ${n}: ${note ? "Note · " : ""}${citation!.source_title}`,
      "aria-disabled": deleted ? "true" : "false",
    },
    String(n),
    note ? h("span", { class: "citation-kind", "data-testid": "citation-note-label", text: "Note" }) : null
  );
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
  // FR-GC-08: "Computed" pills only for a succeeded execution trace (the server is the only author of the marker).
  const computed = message.code_execution_trace?.state === "Succeeded";
  for (const segment of parseAnswer(message.content)) {
    if (segment.type === "text") {
      if (computed) container.append(...renderTextWithComputed(segment.text));
      else container.append(segment.text);
      continue;
    }
    // Only badges the verifier issued (present in citations) become citation buttons (security review fix).
    const issued = segment.numbers.filter((n) => byBadge.has(n));
    if (issued.length === 0) continue;
    const group = h("span", { class: "badge-group" });
    const { shown, hidden } = splitBadgeGroup(issued);
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
  const send = h("button", { class: "btn btn-primary send-btn", "data-testid": "send", "aria-label": "Send", text: "➤", disabled: true });
  const prompt = h("div", { class: "select-prompt", "data-testid": "select-sources-prompt", hidden: true, text: "Select at least one source to ask a question." });
  const element = h(
    "div",
    { class: "chat-panel" },
    h("div", { class: "chat-tools" }, search, ...(options.tools ?? []), clearButton),
    results,
    ...(options.intro ? [options.intro] : []),
    messages,
    status,
    errorLine,
    prompt,
    ...(options.aboveInput ? [options.aboveInput] : []),
    h("div", { class: "chat-input-bar" }, input, h("div", { class: "chat-input-meta" }, pill, send))
  );

  let inflight: AbortController | null = null;
  let ready = false;

  const clearMessages = () => {
    messages.querySelectorAll<HTMLElement>("[data-testid=code-execution]").forEach(disposeCodeExecution);
    clear(messages);
  };
  const scrollToEnd = () => {
    messages.scrollTop = messages.scrollHeight;
  };

  const renderMessage = (message: ChatMessage, fresh = false): HTMLElement => {
    const bubble = h("div", {
      class: `message message-${message.role} kind-${message.kind}`,
      "data-testid": `message-${message.role}`,
      "data-message-id": message.id,
    });
    if (message.role === "user") bubble.append(h("div", { class: "question-text", text: message.content ?? "" }));
    else {
      bubble.append(renderAnswerContent(message, options.onCitationClick));
      const execution = renderCodeExecution(message, { fetchChart });
      if (execution) bubble.append(execution);
      if (message.kind === "answer" && message.content !== null) options.decorateAnswer?.(bubble, message, fresh);
    }
    return bubble;
  };

  const appendMessages = (list: ChatMessage[], fresh = false) => {
    for (const message of list) messages.append(renderMessage(message, fresh));
    scrollToEnd();
  };

  const updateSelection = () => {
    const count = options.selection.count();
    pill.textContent = sourcesLabel(count);
    const empty = count === 0;
    send.disabled = !ready || empty || inflight !== null;
    prompt.hidden = !empty || options.hasSources?.() === false;
  };

  const submit = async () => {
    if (!ready || inflight) return;
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
    options.onStreamStart?.();
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
      if (final) appendMessages(final, true);
    } catch (err) {
      pending.remove();
      if (inflight?.signal.aborted || (err instanceof ApiError && err.code === "GenerationCancelled")) return;
      input.value = draft;
      errorLine.hidden = false;
      errorLine.textContent =
        err instanceof ApiError && ["EmptyScope", "InvalidScope", "SourceNotReady", "SourceSnapshotInvalid", "ValidationFailed", "ExecutionInProgress"].includes(err.code)
          ? err.message
          : GENERATION_ERROR;
      if (err instanceof ApiError && err.status === 404) options.onNotebookMissing();
    } finally {
      inflight = null;
      status.hidden = true;
      options.onStreamEnd?.();
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
      clearMessages();
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
      // Remove old protected bytes immediately while fetching fresh authorization.
      clearMessages();
      try {
        const { messages: list } = await api<{ messages: ChatMessage[] }>(`/api/notebooks/${options.notebookId}/chat`);
        clearMessages();
        appendMessages(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) options.onNotebookMissing();
      }
      updateSelection();
    },
    updateSelection,
    destroy() {
      inflight?.abort();
      if (searchTimer) clearTimeout(searchTimer);
      clearMessages();
    },
    markReady() {
      ready = true;
      updateSelection();
    },
    ask(text) {
      input.value = text;
      void submit();
    },
    append(list) {
      appendMessages(list);
    },
  };
}
