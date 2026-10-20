# Interface Contracts: Package 2.2

Contracts cite `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-02`, `C-02`, `FR-WM-04/05`, `NFR-EVAL-02/04`.

## Shared Zod DTOs (`packages/contracts/src/package-v2-2.ts`)

- `SourceGuideSchema`: source/revision, `output_language`, source word count (for `<50` topic rules), summary, topics, supporting C-01 chunk IDs, guide status, optional `ready_at` and `generated_at`.
- `NotebookOverviewSchema`: notebook ID, exact source/revision snapshot, SHA-256 authorization partition key, language/cache parameters, overview and 0–5 supported starter prompts (target 3–5 when the evidence supports them); at least one in-scope supporting chunk ID is required.
- `ChatConfigurationSchema`: style and response length enums; custom instructions 1–5,000 trimmed Unicode code points only for `custom`.
- `MessageFeedbackInputSchema`: message UUID, up/down rating, negative category when down, optional comment 0–1,000 trimmed code points.
- `FollowUpSuggestionsSchema`: 0–3 unique chips `{ text (≤100 code points), supporting_chunk_ids (≥1) }`, source/revision snapshot, `output_language`, `generated_at`.
- `SaveResponseNoteRequestSchema`: `{ notebook_id: UUID, message_id: UUID }`.
- `SavedResponseNoteSchema`: `{ id, notebook_id, source_message_id, title, content_md, citations_json, origin_type: "saved_response", read_only: true, created_at }`.
- All object schemas are strict; authenticated `user_id` is derived from bearer identity, never accepted from request body. Cite `FR-GC-09` and `FR-NM-02`.

## C-02 generation boundary

Each source read is performed through the injected existing `ScopedContextProvider` only. Source Guide calls use singleton `[source_id]`; overview and follow-up calls require a nonempty explicit active Ready source-ID list. The provider captures `(source_id, revision)` and authorization. Before persistence/response, recheck the same snapshots and reject on deletion, revision replacement or authorization change (`C-02`, `NFR-EVAL-04`). No fallback to all sources.

## HTTP routes (`apps/api/src/routes/package-v2-2.ts`)

| Method and path | Request / response | Rules |
| :--- | :--- | :--- |
| `GET /api/notebooks/{notebook_id}/sources/{source_id}/guide?revision={revision}[&language={tag}]` | SourceGuide or `202 GuidePending` | Owner-authenticated; Ready source; language defaults to the notebook's effective output language; a missing guide for that language starts on-demand generation; guide read does not affect selection (`FR-SI-02`, FR-UI-02). |
| `GET /api/notebooks/{notebook_id}/sources` | `{ sources: NotebookSourceSelection[] }` → owner-authorized notebook source records | Only notebook owner; Ready status/revision exposed to selection controller; no cross-notebook records (`FR-SI-02`, C-02). |
| `POST /api/notebooks/{notebook_id}/overview` | `{ source_revisions: [{ source_id, revision }], output_language: BCP-47 }` → NotebookOverview | Empty scope rejected; exact scope/cache key; zero to five evidence-supported prompts (target 3–5), no padding, nonempty in-scope support IDs, stale result not published (`FR-GC-04`, FR-020, C-02). |
| `GET/PUT /api/notebooks/{notebook_id}/chat/configuration` | ChatConfiguration → saved ChatConfiguration | Owner only; invalid Custom config retains saved value (`FR-GC-07`). |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/follow-ups` | `{ source_revisions: SourceRevisionPair[] }` → FollowUpSuggestions | Caller-owned completed assistant message; submitted/current scope must equal its exact stored snapshot; re-authorize every Ready revision; generated in and cached under the effective output language; chips with out-of-scope support IDs dropped before persistence; reject stale cached suggestions (`FR-GC-05`, C-02). |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/feedback` | `{ rating, category?, comment? }` → MessageFeedback | Message must be caller's own notebook assistant message; replaces the unique user/message record (`FR-GC-09`). |
| `DELETE /api/notebooks/{notebook_id}/chat/messages/{message_id}/feedback` | → `204` | Owner-authorized; clears the caller's rating for that message (`FR-GC-09`, FR-014). |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` | `{ notebook_id, message_id }` → `{ note: SavedResponseNote }` | Shared with Package 2.3 (`FR-NM-02`); writes the single 2.3 notes store, so `GET /api/notebooks/{id}/notes` lists the same note. Message must be caller's assistant message; owner-only; idempotent per authenticated user/message (including notes saved through 2.3); title = preceding user question trimmed to 200 code points or `Saved response`; body IDs ≠ path IDs or invalid body → `400 ValidationError`; citation links preserved (`FR-GC-09`). |

The route module receives repository/service dependencies and derives user identity from the existing API authentication layer. Responses use stable error codes `ValidationError`, `EmptyScopeError`, `NotFound`, `Forbidden`, `StaleSourceSnapshot`, `GenerationUnavailable`, and `InternalError`.

## Browser modules (`apps/web/src`)

- Notebook shell loads and mounts owner-authorized `GET /sources` records, publishes initial and changed revision snapshots, and immediately clears empty-scope content (C-02).
- Source Inspector renders a collapsible Source Guide before full source text and sends selected topics through the grounded chat turn callback (`FR-SI-02`).
- Overview controller clears prior content synchronously on cache-key/scope change; starter prompts call the existing grounded chat turn callback (`FR-GC-04`).
- Follow-up chips render in one row above the chat input bar, not inside the answer bubble; the row clears synchronously on stream start and on selection, revision or output-language change, and only chips whose scope signature matches the current scope can be clicked into a new turn (`FR-GC-05`, C-02).
- Source Guide topic chips send through the grounded chat callback only when the inspected source is selected; otherwise they show a select-sources prompt and never change the selection (`FR-SI-02`).
- Chat configuration form preserves prior saved config on invalid input and indicates active style/length (`FR-GC-07`).
- Response actions copy with citations by default; without-citations strips only badge tokens; clicking the active thumb clears the rating; save-to-note shows `"Saved to notes"` and hands the note to the notes panel (`FR-GC-09`).
- With no sources the chat panel shows `"Add a source to get started"`; the overview hero uses the notebook's `icon_emoji` (`FR-GC-04`).

## Failure semantics

Invalid model output (unknown chunk IDs, blank/out-of-limit fields, unsupported count padding) is not published; for follow-ups only the offending chip is dropped. The Vertex client marks 429, 5xx and timeouts `transient` and invalid or non-schema JSON permanent. A transient guide failure retries at most twice (3 total attempts; 100 ms then 200 ms); permanent errors and invalid structured output do not retry. Exhausted failure leaves source inspection available. A stale snapshot fails closed. Model/status errors never expose an unvalidated factual draft (`D13`, `NFR-EVAL-02/04`).
