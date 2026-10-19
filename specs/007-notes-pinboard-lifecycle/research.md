# Research: Notes & Pinboard Lifecycle

**SRS IDs**: FR-NM-01..04, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02, NFR-EVAL-02, NFR-EVAL-04 | **Plan**: [plan.md](plan.md)

All decisions below are consistent with `docs/solution-architecture.md` (`D1`–`D4`, `D13`) and the constitution. No `NEEDS CLARIFICATION` remains.

## R1 — Note persistence mirrors existing repository pattern

- **Decision**: `packages/db/src/notes.ts` keeps an in-memory repository (like `chat-history.ts`/`quota.ts`) for tests, and `0007_notes.sql` defines the Postgres tables (`notes`, `note_source_origins`) for production. Notes cascade-delete with the notebook; they are **not** linked to `chat_messages` by foreign key (`FR-NM-02`: clearing chat must not cascade).
- **Rationale**: Existing packages already test against in-memory stores plus a DDL test; reusing the pattern avoids a new datastore (`CC-08`).
- **Alternatives**: Real Postgres in tests (no runner provisioned in repo — rejected); FK from note to chat message (violates FR-NM-02 independence).

## R2 — Conversion reuses ingestion through a port

- **Decision**: The API depends on a `NoteSourceIngestor` port (`ingest({attempt_id, notebook_id, source_id, revision_id, title, markdown}) → IngestionResult`). `apps/worker/src/ingestion/note-markdown.ts` implements it by calling the existing `IngestionPipeline.process` with `media_type: "text/markdown"`, so the FR-SI-01 Markdown parser, chunker, `C-01` chunks, and 200 MB / 500,000-word limits are reused. The source record is stored with `media_type: 'note_markdown'`.
- **Rationale**: `apps/api` and `apps/worker` are separate Cloud Run services with isolated `tsconfig` roots; cross-app imports are impossible, and the real call is a job boundary (`D2`, Cloud Tasks). A port keeps the API testable and prevents a second chunker.
- **Alternatives**: Duplicate chunker in API (violates "ingestion is the sole writer of C-01" and FR-SI-01 reuse); import worker from API (breaks `tsc` roots).

## R3 — Atomic slot reservation and failure release

- **Decision**: Conversion calls the existing `reserveSourceSlot` (under the notebook lock) **before** ingestion; on ingestion failure or limit violation it calls `failSource` (slot released, `FR-WM-07`). Byte/word limits are pre-checked deterministically on the combined Markdown before reserving so over-limit content never consumes a slot; the ingestor re-validates.
- **Rationale**: Constitution VI — slots reserved atomically before ingestion for note conversion. Boundary: bytes `200,000,000` and words `500,000` inclusive.
- **Alternatives**: Reserve after ingestion (race can exceed the cap).

## R4 — Revisions and snapshots

- **Decision**: Each note carries an integer `revision` incremented on every content/title change. A converted source stores `origin_notes: [{note_id, revision, title}]` and immutable chunks at source `revision 1`; later note edits never touch it. The source registry (`source-registry.ts`) exposes `getSource`, `replaceSource` (revision+1 for tests), `deleteSource`, and `getScopedContext(notebook_id, active_source_ids)` → `C-01` chunks for the **current** revision only.
- **Rationale**: Provides the `C-02` snapshot/recheck semantics (`CC-03`) in the harness without inventing a second read path.

## R5 — Idempotent save-to-note

- **Decision**: Unique key `(notebook_id, user_id, source_message_id)`; a repeat returns the existing note with `created: false` (HTTP 200) instead of 201. The client disables the button while pending (`FR-GC-09`).
- **Rationale**: Architecture doc §reliability: "Save-to-note uses a `(user_id, message_id)` idempotency key".

## R6 — Sanitization

- **Decision**: Server and client share `sanitizeNoteMarkdown` from contracts: strips raw HTML tags, `<script>/<style>` blocks with content, event-handler attributes, and rewrites Markdown links whose scheme is not `http`, `https`, or `mailto` to plain text. Markdown syntax (headings, emphasis, lists, links) is preserved. Word limit counts whitespace-delimited tokens after sanitization.
- **Rationale**: FR-NM-01 "Markdown / sanitized HTML"; avoids stored XSS in the Right Panel.

## R7 — Auto-save and draft recovery (web)

- **Decision**: `NoteEditorSession` debounces 500 ms after the last keystroke (budget ≤ 1.0 s including the request), flushes on `close()` and awaits the result before resolving success, mirrors every edit to a `DraftStore` (localStorage-shaped port) keyed by `notebook:note`, and clears the draft only after a successful save of that exact revision. Status is one of `idle | pending | saving | saved | error`; offline/failed saves keep `pending|error` and never report `saved`. On reopen, a draft newer than the server `updated_at` is offered/restored.
- **Alternatives**: Save on every keystroke (rate/cost), periodic interval (can exceed 1.0 s).

## R8 — Note Assistant orchestration

- **Decision**: `NoteAssistant.run` (1) validates `1 ≤ k ≤ 50` and enum; (2) for `related_ideas`/`critique` requires ≥ 1 explicitly selected existing Ready source, else returns `ComparisonSourceRequired` before anything else; (3) converts the exact selection through the FR-NM-03 path (quota/limit/ingestion failure → error, **no model call**); (4) snapshots `(source_id, revision)` for the note-source plus (for related/critique) the selected sources; (5) reads chunks only through the `ScopedContextProvider.getScopedContext`; (6) rechecks that every captured revision is still current/authorized; (7) calls `GroundedChatAgent.generateTurn` with an action prompt that labels note-source chunks as "user note assertions"; (8) rechecks again before publishing and persists the validated assistant `ChatMessage`; the result flags which citations point to the note-source (`note_assertion` vs `source_fact`).
- **Rationale**: Exactly the FR-NM-04 text; reuses grounded agent and citation validation (`D13`).
- **Alternatives**: A separate grounding path (explicitly forbidden: "without inventing a separate grounding path").

## R9 — Convert saved response to editable

- **Decision**: Creates a new `manual` note with `origin_note_id`, `origin_message_id` preserved; citation badge tokens `[n]` that correspond to the saved note's `citations_json` badge numbers are removed from the prose (with the single preceding space); the original is untouched. A saved response is read-only: update/PATCH returns `409 NoteReadOnly`.

## R10 — Route wiring and server entrypoint

- **Decision**: Export `handleNotesRoute(req, res, deps, userId)`; do not edit `server.ts` (shared, still a stub that does not mount chat routes either). Ownership via `verifyOwnership` dependency defaulting to `getNotebookById(ownerId)`.

## Flow-back items identified during planning (applied in `/speckit-analyze`)

| # | Item | Upstream target |
| :--- | :--- | :--- |
| F1 | "Displayed order" is undefined → define `display_order` (ascending creation sequence, returned by list API); selection order does not matter. | `spec.md` Edge Cases; FR card FR-NM-03 edge cases |
| F2 | Note title limit (200) exceeds the source title limit (100, `SourceTitleSchema`) → single-note source title is the note title clamped to 100 code points (metadata only; full title kept as the first Markdown heading in content). | `spec.md`; FR card FR-NM-03 |
| F3 | "Convert all notes" has no note-count cap, while the assistant caps at 50 → conversion is bounded only by source limits. | `spec.md` |
| F4 | Shared save-note contract reconciliation with Package 2.2. | `plan.md` (done), merge-time note |
