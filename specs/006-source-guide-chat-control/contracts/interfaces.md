# Interface Contracts: Package 2.2

Contracts cite `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-02`, `C-02`, `FR-WM-04/05`, `NFR-EVAL-02/04`.

## Shared Zod DTOs (`packages/contracts/src/package-v2-2.ts`)

- `SourceGuideSchema`: source/revision, source word count (for `<50` topic rules), summary, topics, supporting C-01 chunk IDs, guide status.
- `NotebookOverviewSchema`: notebook ID, exact source/revision snapshot, SHA-256 authorization partition key, language/cache parameters, overview and supported starter prompts.
- `ChatConfigurationSchema`: style and response length enums; custom instructions 1–5,000 trimmed Unicode code points only for `custom`.
- `MessageFeedbackInputSchema`: message UUID, up/down rating, negative category when down, optional comment 0–1,000 trimmed code points.
- `SaveResponseNoteRequestSchema`: `{ notebook_id: UUID, message_id: UUID }`.
- `SavedResponseNoteSchema`: `{ id, notebook_id, source_message_id, title, content_md, citations_json, origin_type: "saved_response", read_only: true, created_at }`.
- All object schemas are strict; authenticated `user_id` is derived from bearer identity, never accepted from request body. Cite `FR-GC-09` and `FR-NM-02`.

## C-02 generation boundary

Each source read is performed through the injected existing `ScopedContextProvider` only. Source Guide calls use singleton `[source_id]`; overview and follow-up calls require a nonempty explicit active Ready source-ID list. The provider captures `(source_id, revision)` and authorization. Before persistence/response, recheck the same snapshots and reject on deletion, revision replacement or authorization change (`C-02`, `NFR-EVAL-04`). No fallback to all sources.

## HTTP routes (`apps/api/src/routes/package-v2-2.ts`)

| Method and path | Request / response | Rules |
| :--- | :--- | :--- |
| `GET /api/notebooks/{notebook_id}/sources/{source_id}/guide?revision={revision}` | SourceGuide or pending/failed state | Owner-authenticated; Ready source; guide read does not affect selection (`FR-SI-02`). |
| `GET /api/notebooks/{notebook_id}/sources` | `{ sources: NotebookSourceSelection[] }` → owner-authorized notebook source records | Only notebook owner; Ready status/revision exposed to selection controller; no cross-notebook records (`FR-SI-02`, C-02). |
| `POST /api/notebooks/{notebook_id}/overview` | `{ source_revisions: [{ source_id, revision }], output_language: BCP-47 }` → NotebookOverview | Empty scope rejected; exact scope/cache key; stale result not published (`FR-GC-04`, C-02). |
| `GET/PUT /api/notebooks/{notebook_id}/chat/configuration` | ChatConfiguration → saved ChatConfiguration | Owner only; invalid Custom config retains saved value (`FR-GC-07`). |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/follow-ups` | `{ source_revisions: SourceRevisionPair[] }` → FollowUpSuggestions | Caller-owned completed assistant message; submitted/current scope must equal its exact stored snapshot; re-authorize every Ready revision; persist by user/message and reject stale cached suggestions (`FR-GC-05`, C-02). |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/feedback` | `{ rating, category?, comment? }` → MessageFeedback | Message must be caller's own notebook assistant message; update unique user/message record (`FR-GC-09`). |
| `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` | `{ notebook_id, message_id }` → `{ note: SavedResponseNote }` | Message must be caller's assistant message; owner-only; idempotent per authenticated user/message; citation links preserved (`FR-GC-09`, `FR-NM-02`). |

The route module receives repository/service dependencies and derives user identity from the existing API authentication layer. Responses use stable error codes `ValidationError`, `EmptyScopeError`, `NotFound`, `Forbidden`, `StaleSourceSnapshot`, `GenerationUnavailable`, and `InternalError`.

## Browser modules (`apps/web/src`)

- Notebook shell loads and mounts owner-authorized `GET /sources` records, publishes initial and changed revision snapshots, and immediately clears empty-scope content (C-02).
- Source Inspector renders a collapsible Source Guide before full source text and sends selected topics through the grounded chat turn callback (`FR-SI-02`).
- Overview controller clears prior content synchronously on cache-key/scope change; starter prompts call the existing grounded chat turn callback (`FR-GC-04`).
- Follow-up chips remain hidden while streaming and clear when scope changes; clicks call the next-turn callback (`FR-GC-05`).
- Chat configuration form preserves prior saved config on invalid input and indicates active style/length (`FR-GC-07`).
- Response actions copy with citations by default; without-citations strips only badge tokens; feedback categories and save-to-note use the API contracts (`FR-GC-09`).

## Failure semantics

Invalid model output (unknown chunk IDs, blank/out-of-limit fields, unsupported count padding) is not published. A transient guide failure retries at most twice (3 total attempts; 100 ms then 200 ms); permanent errors and invalid structured output do not retry. Exhausted failure leaves source inspection available. A stale snapshot fails closed. Model/status errors never expose an unvalidated factual draft (`D13`, `NFR-EVAL-02/04`).
