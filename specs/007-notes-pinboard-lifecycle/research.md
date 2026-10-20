# Research: Notes & Pinboard Lifecycle

**SRS IDs**: FR-NM-01..04, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02, NFR-EVAL-02, NFR-EVAL-04 | **Plan**: [plan.md](plan.md)

All decisions below are consistent with `docs/solution-architecture.md` (`D1`–`D4`, `D13`) and the constitution. No `NEEDS CLARIFICATION` remains.

## R1 — Note persistence (`D16`, amended 2026-10-20)

- **Decision**: Notes stay in the in-memory repository `packages/db/src/notes.ts` of the single API instance until v3 (`D16`, SRS `DEV-04`); the designed table waits in `packages/db/migrations/v3-draft/notes.sql`. Note-sources are normal v1 PostgreSQL sources (owner decision 2026-10-20) with provenance in `note_source_provenance` (`0004_note_sources.sql`). Notes are **not** linked to `chat_messages` by foreign key (`FR-NM-02`: clearing chat must not cascade).
- **Rationale**: The PoC keeps v2 data in memory (`D16`), but a source must be visible to the v1 chat, the Left Panel and the source limit, which all live in PostgreSQL; a second, in-memory source path would duplicate `C-02` and the quota.
- **Alternatives**: In-memory note-source registry merged into the v1 read paths (rejected by the owner on 2026-10-20: two read paths, two slot counts); notes in PostgreSQL now (deferred to v3 by `D16`).

## R2 — Conversion reuses the v1 ingestion

- **Decision**: `NoteSourceStore.create` (`apps/api/src/notes/note-sources.ts`) reserves a v1 source row (`media_type: note_markdown`), writes the combined Markdown as the raw object, receives it (`acceptReceivedSource`, durable ingest job) and runs the v1 ingest job at once in the API process (`apps/worker/src/ingestion/note-markdown.ts` → `processIngestJob`). `extractPlainText` parses `note_markdown` like `text/markdown`, so the FR-SI-01 Markdown sections, chunker, embeddings, `C-01` chunks and the 200 MB / 500,000-word limits are reused.
- **Rationale**: One ingestion path ("ingestion is the sole writer of C-01"); synchronous conversion meets the 2.0 s target (FR-019) without waiting for a worker wake-up, and the queued job stays as the durable fallback (it finds the settled source and does nothing).
- **Alternatives**: Parallel chunker in the API (violates FR-SI-01 reuse); waiting for the worker (latency depends on Cloud Tasks wake-up).

## R3 — Atomic slot reservation and failure release

- **Decision**: Conversion calls the v1 `reserveSources` (notebook row lock, occupancy of `Uploading`/`Processing`/`Ready` rows) **before** ingestion; any ingestion failure marks the source `Failed` (`failSource`), which releases the slot, and returns `502` with a fixed message. Byte/word limits are pre-checked deterministically on the combined Markdown before reserving, so over-limit content never consumes a slot; the ingest job re-validates.
- **Rationale**: Constitution VI — slots reserved atomically before ingestion across upload and note-to-source paths. Boundary: bytes `200,000,000` and words `500,000` inclusive.
- **Alternatives**: Reserve after ingestion (race can exceed the cap); a separate in-memory note-slot counter (two counts can exceed the cap together).

## R4 — Revisions and snapshots

- **Decision**: Each note carries an integer `revision` incremented on every content/title change. A converted source stores `origin_notes: [{note_id, revision, title}]` and immutable chunks at source revision 1; later note edits never touch it. Reads, revision checks and fencing are the v1 `C-02` functions (`captureScopeSnapshot`, `listSnapshotChunks`, `verifyScopeSnapshot`, `publishTurn`).
- **Rationale**: One `C-02` snapshot/recheck implementation (`CC-03`).

## R5 — Idempotent save-to-note through the shared route

- **Decision**: The shared route `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` is the only save entry point; it calls `NotesService.saveFromMessage`, which is idempotent on `(notebook_id, user_id, source_message_id)` and returns the existing note on repeat. The client disables the button while pending (`FR-GC-09`).
- **Rationale**: Architecture doc §reliability: "Save-to-note uses a `(user_id, message_id)` idempotency key"; `spec/requirements/README.md` v2 row: one shared save-note contract.

## R6 — Sanitization

- **Decision**: `sanitizeNoteMarkdown` from contracts runs inside every repository write of `packages/db/src/notes.ts` (create, update, saved response, editable copy, Studio-created notes), so no write path can store raw HTML: strips raw HTML tags, `<script>/<style>` blocks with content, event-handler attributes, and rewrites Markdown links whose scheme is not `http`, `https`, or `mailto` to plain text. Markdown syntax (headings, emphasis, lists, links) is preserved. Word limit counts whitespace-delimited tokens after sanitization.
- **Rationale**: FR-NM-01 "Markdown / sanitized HTML"; avoids stored XSS in the Right Panel.

## R7 — Auto-save and draft recovery (web)

- **Decision**: `NoteEditorSession` debounces 500 ms after the last keystroke (budget ≤ 1.0 s including the request), flushes on `close()` and awaits the result before resolving success, mirrors every edit to a `DraftStore` (localStorage-shaped port) keyed by `notebook:note`, and clears the draft only after a successful save of that exact revision. Status is one of `idle | pending | saving | saved | error`; offline/failed saves keep `pending|error` and never report `saved`. On reopen, a draft newer than the server `updated_at` is offered/restored.
- **Alternatives**: Save on every keystroke (rate/cost), periodic interval (can exceed 1.0 s).

## R8 — Note Assistant orchestration

- **Decision**: `NotesService.runAssistant` (1) validates `1 ≤ k ≤ 50` and enum; (2) for `related_ideas`/`critique` requires ≥ 1 explicitly selected existing Ready source, else returns `ComparisonSourceRequired` before anything else; (3) reuses a Ready note-source with the same `(note_id, revision)` set or converts the exact selection through the FR-NM-03 path (quota/limit/ingestion failure → error, **no model call**); (4) captures the `C-02` snapshot of the note-source alone for `summarize`/`create_outline`, plus the selected sources for `related_ideas`/`critique`; (5) reads the snapshot's chunks (bounded); (6) rechecks authorization; (7) asks the grounded model and verifies citations with the v1 verifier (`D13`); (8) rechecks authorization and revisions and publishes question and answer as one turn of the caller's PostgreSQL chat thread under the v1 fence. The result marks which citations point to the note-source (`note_assertion` vs `source_fact`) and every history citation carries `source_media_type` for the `Note` label.
- **Rationale**: Exactly the FR-NM-04 text; reuses grounded model, verifier and chat persistence (`D13`, `FR-GC-06`).
- **Alternatives**: A separate grounding path (explicitly forbidden: "without inventing a separate grounding path"); in-memory assistant turns (not visible in `GET /chat`, not removed by Clear chat).

## R9 — Convert saved response to editable

- **Decision**: Creates a new `manual` note with `origin_note_id`, `origin_message_id` preserved; citation badge tokens `[n]` that correspond to the saved note's `citations_json` badge numbers are removed from the prose (with the single preceding space); the original is untouched. A saved response is read-only: update/PATCH returns `409 NoteReadOnly`.

## R10 — Route wiring

- **Decision**: `handleNotesRoute` and the shared save-note route are mounted by the v2 runtime (`apps/api/src/v2/runtime.ts`), which runs only after the v1 app authenticated the caller and checked notebook ownership in PostgreSQL (`apps/api/src/app.ts`). The runtime receives storage, embedder and job notifier from `apps/api/src/server.ts` (and `apps/web/test/e2e-server.ts`).

## R11 — Right Panel pinboard UI

- **Decision**: `apps/web/src/notes/panel.ts` renders the list, the Note Editor (title, Markdown toolbar, debounced auto-save, local draft in `localStorage`), the saved-response viewer (badges open the Source Inspector), convert actions gated by `source_slots`, and the Note Assistant bar. The bar runs the snapshot phase (`convert-to-source` with `reuse: true`) and the synthesis phase (`/notes/assistant`, which reuses that snapshot) as two requests, so both progress phases are shown separately (FR-019).

## Flow-back items identified during planning (applied in `/speckit-analyze`)

| # | Item | Upstream target |
| :--- | :--- | :--- |
| F1 | "Displayed order" is undefined → define `display_order` (ascending creation sequence, returned by list API); selection order does not matter. | `spec.md` Edge Cases; FR card FR-NM-03 edge cases |
| F2 | Note title limit (200) exceeds the source title limit (100, `SourceTitleSchema`) → single-note source title is the note title clamped to 100 code points (metadata only; full title kept as the first Markdown heading in content). | `spec.md`; FR card FR-NM-03 |
| F3 | "Convert all notes" has no note-count cap, while the assistant caps at 50 → conversion is bounded only by source limits. | `spec.md` |
| F4 | Shared save-note contract reconciliation with Package 2.2. | `plan.md` (done), merge-time note |
