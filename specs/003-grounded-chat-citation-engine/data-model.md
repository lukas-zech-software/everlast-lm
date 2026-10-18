# Data Model: Grounded Chat & Citation Engine

Trace: FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, C-01, C-02. No migrations are executed by this document.

| Entity | Invariants / ownership |
| :--- | :--- |
| ChatThread | UUID, notebook/user identity, generation epoch and timestamps; unique single thread per user/notebook. Clear advances epoch and removes messages. |
| ChatMessage | UUID, thread/notebook/user, role, content, ordered sequence/created_at, complete source/revision provenance, request ID and citations. Invalid draft never persisted as an assistant answer. |
| Citation | Badge number, source_id/title, chunk_id, exact snippet and locator; map first-appearance order per response, reuse repeated chunk numbers. Reads reauthorize before exposing cached snippet. |
| Pending turn | Immutable scope/revisions, thread epoch, cancellation and generation state Idle/Retrieving/Streaming/Completed/Error. Streaming means progress until validated factual content may publish. |
| Search result | Message ID and safe highlighted excerpt from this user's one thread; deleted/revoked generated content stays unavailable and cannot leak through search. |

## FR-GC-01 — Strict Grounding Policy

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| User message | UTF-8 text | $1$ to $10,000$ Unicode code points after outer trim | — |
| `active_source_ids` | Array of UUIDs | $\lvert S_{\text{aktiv}}\rvert \ge 1$ | All `Ready` sources |
| Conversation history | Array of turns | Persisted thread; only turns whose complete source/revision provenance remains active and authorized (including summaries, tool output and imported artifact text); missing provenance excludes the turn | — |

- Visible: Citation-validated assistant Markdown message (buffered until the complete answer passes verification; status events may stream) in the center chat panel (or polite refusal message when ungrounded).
- Persisted: `ChatMessage` record (`id`, `thread_id`, `notebook_id`, `user_id`, `role`, `content`, `active_source_revisions_snapshot`, `created_at`).
- States: `Idle` $\rightarrow$ `Retrieving` $\rightarrow$ `Streaming` $\rightarrow$ `Completed` (or `Error`).

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## FR-GC-02 — Precise Inline Citations

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Grounded context chunks | Array of `UnifiedDocumentChunk` (`C-01`) | Each chunk has a unique `chunk_id` | — |
| Inline citation marker | Structured LLM output / tag `<cite id="chunk_id">` | Must resolve to a valid `chunk_id` in $S_{\text{aktiv}}$ | — |

- Visible: Interactive numbered badge `[n]` inline within the rendered markdown text.
- Persisted: `citations` JSON array stored alongside the `ChatMessage` entity (`[{ badge_number, source_id, source_title, chunk_id, snippet, locator }]`).
- States: `Verified` (rendered as active badge).

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## FR-GC-03 — Interactive Citation Verification (Hover & Click)

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Pointer `mouseenter` / `click` on `[n]` | DOM Event | Mapped to `citation` metadata (`badge_number`, `source_id`, `source_title`, `chunk_id`, `snippet`, `locator`) | — |
| Tooltip snippet length | UTF-8 text | Full text of the cited chunk (structure-aware chunk targeting 300–600 tokens per architecture; scrollable inside the popover if long) | — |

- Visible: Floating tooltip on hover; opened and scrolled Source Inspector with highlighted text on click.
- Persisted: None (reads persisted citation metadata from `FR-GC-02`).
- States: `BadgeIdle` $\rightarrow$ `TooltipVisible` $\rightarrow$ `InspectorFocused`.

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## FR-GC-06 — Persistent Conversation History

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `notebook_id` | UUID | Valid notebook | — |
| Clear chat action | Button click + confirmation | Clears only `ChatMessage` records for the user's thread | — |

- Visible: Scrollable list of historical user and assistant turns; `"Clear chat"` button in chat header.
- Persisted: `ChatThread` and ordered `ChatMessage` entities in the database.
- States: `EmptyThread` $\leftrightarrow$ `ActiveThread` $\rightarrow$ `Cleared (EmptyThread)`.

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## Consistency boundaries (C-01/C-02, FR-WM-04)

All persistent children carry notebook identity and parent constraints. Database revision/embedding/epoch data never expands C-01's five-field projection. Keep long-running extraction/model/network operations outside row locks, then recheck parent authorization and captured revision under the shared publication fence before atomic success. A canceled/deleted parent or stale revision cannot be recreated by retries. Use immutable attempt/request IDs and deterministic idempotency. Cascading parent deletion invalidates content, cached snippets and in-flight jobs; no retained copy leaks through search/export/view state.
