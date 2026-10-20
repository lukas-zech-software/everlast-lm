# Tasks: Notes & Pinboard Lifecycle

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [interfaces](contracts/interfaces.md), [quickstart](quickstart.md), [checklist](checklists/ux.md).
**Package Source**: `spec/requirements/v2/package_2_3_notes_pinboard_lifecycle.md` + [binding cross-package rules](../../spec/requirements/README.md).
**SRS IDs in scope**: FR-NM-01, FR-NM-02, FR-NM-03, FR-NM-04, FR-GC-09, FR-SI-01, FR-WM-07, C-01, C-02, NFR-EVAL-02, NFR-EVAL-04, Gate v2.0 #2.
**Branch / worktree**: `007-notes-pinboard-lifecycle` (`../wt/007`).

Tests are mandatory (constitution II/CC-02): each story's `### Tests` fail for behavior reasons before its `### Implementation`. Tasks are qualified as `[007-notes-pinboard-lifecycle] T###` in handoffs. `[P]` means disjoint files. Runners that do not exist (Playwright E2E, judged evals) are reported `UNAVAILABLE`, never passed.

## Phase 1: Setup and shared contracts

- [X] T001 Write failing contract tests in `packages/contracts/test/package-v2-3.test.ts` (FR-NM-01..04, C-01): title 1–200 code points, body ≤100,000 words, assistant selection 1–50, action enum, sanitizer behavior, save-note DTO, error codes.
- [X] T002 Implement Zod schemas, constants, sanitizer in `packages/contracts/src/package-v2-3.ts` and the single export line in `packages/contracts/src/index.ts` (FR-NM-01..04); pass T001. Note reconciliation with 2.2 save-note schema in plan.md.
- [X] T003 [P] Write failing DDL test `packages/db/test/notes-schema.test.ts` (FR-NM-01..03) and add `packages/db/migrations/0007_notes.sql`; follow `package-v1-3-schema.test.ts`.

## Phase 2: User Story 1 - Create and maintain research notes (Priority: P1)

**Independent Test**: Create, auto-save, reopen, delete notes; offline draft recovery.

### Tests (mandatory Red before implementation)

- [X] T004 [US1] Write failing in-memory repo tests in `packages/db/test/notes.test.ts` (FR-NM-01): default title "New note", revision increment, display_order, delete, boundary 200/201 title and 100,000/100,001 words, owner isolation.
- [X] T005 [P] [US1] Write failing API tests in `apps/api/test/notes.test.ts` (FR-NM-01): create/list/get/patch/delete routes, `confirm=true`, 403/404/409/422.
- [X] T006 [P] [US1] Write failing web tests in `apps/web/test/notes-editor.test.ts` (FR-NM-01): 500 ms debounce, flush on close, pending/error/saved states, local draft recovery, pinboard ordering.

### Implementation (Green → Refactor)

- [X] T007 [US1] Implement `packages/db/src/notes.ts`, export from `packages/db/src/index.ts`, and cascade cleanup in `packages/db/src/notebooks.ts` (FR-NM-01); pass T004.
- [X] T008 [US1] Implement `apps/api/src/notes/service.ts` and `apps/api/src/routes/notes.ts` (FR-NM-01); pass T005.
- [X] T009 [P] [US1] Implement `apps/web/src/notes/editor-session.ts` and `apps/web/src/notes/pinboard.ts` (FR-NM-01); pass T006.

## Phase 3: User Story 2 - Preserve a grounded chat answer (Priority: P1)

**Independent Test**: Save an answer, clear chat, note and citations remain; repeat save is idempotent.

### Tests (mandatory Red before implementation)

- [X] T010 [US2] Write failing repo tests in `packages/db/test/notes.test.ts` (FR-NM-02, FR-GC-09): saved_response read-only, idempotent `(notebook, owner, source_message_id)`, survival after `clearChatThread`, convert-to-editable strips verified badges.
- [X] T011 [P] [US2] Write failing API tests in `apps/api/test/notes-saved-response.test.ts` (FR-NM-02, FR-GC-09): from-message 201/200, "Saved to notes", PATCH 409 NoteReadOnly, convert-to-editable, 404 MessageNotFound.
- [X] T012 [P] [US2] Write failing web tests in `apps/web/test/notes-saved-response.test.ts` (FR-NM-02): read-only render, badge navigation reuse, convert action.

### Implementation (Green → Refactor)

- [X] T013 [US2] Extend `packages/db/src/notes.ts` and `apps/api/src/notes/service.ts` + routes with save-from-message and convert-to-editable (FR-NM-02, FR-GC-09); pass T010/T011.
- [X] T014 [P] [US2] Implement `apps/web/src/notes/saved-response.ts` (FR-NM-02); pass T012.

## Phase 4: User Story 3 - Convert notes into citable sources (Priority: P1)

**Independent Test**: Gate v2.0 #2 round trip and limit cases.

### Tests (mandatory Red before implementation)

- [X] T015 [US3] Write failing registry tests `packages/db/test/source-registry.test.ts` (C-02, FR-NM-03): register, replace (revision+1), delete, current-revision-only scoped read.
- [X] T016 [P] [US3] Write failing API tests `apps/api/test/notes-convert.test.ts` (FR-NM-03, FR-WM-07, FR-SI-01): one/selected/all, order, title clamp, 50/50 "Source limit reached", 200,000,000 bytes and 500,000 words inclusive and +1 rejected, whitespace-only rejected, cross-notebook ids, ingest failure releases slot, originals preserved.
- [X] T017 [P] [US3] Write failing worker adapter test `apps/worker/test/note-markdown.test.ts` (FR-SI-01, C-01): real `IngestionPipeline` produces C-01 chunks for `text/markdown`.
- [X] T018 [P] [US3] Write failing roundtrip test `apps/api/test/notes-roundtrip.integration.test.ts` and `packages/evals/test/notes-roundtrip.eval.test.ts` (Gate v2.0 #2, NFR-EVAL-02, NFR-EVAL-04): TITAN-77 cited from converted source, zero deselected leakage, ≤2.0 s for 5,000 words.

### Implementation (Green → Refactor)

- [X] T019 [US3] Implement `packages/db/src/source-registry.ts` and exports (C-02); pass T015.
- [X] T020 [US3] Implement conversion in `apps/api/src/notes/service.ts` and route `convert-to-source` with the `NoteSourceIngestor` port (FR-NM-03); pass T016.
- [X] T021 [P] [US3] Implement `apps/worker/src/ingestion/note-markdown.ts` (FR-SI-01, C-01); pass T017.
- [X] T022 [US3] Run roundtrip Green and refactor (T018).

## Phase 5: User Story 4 - Note Assistant (Priority: P2)

**Independent Test**: Four actions over selected notes; comparison source required; failed conversion makes no model call.

### Tests (mandatory Red before implementation)

- [X] T023 [US4] Write failing tests `apps/api/test/notes-assistant.test.ts` (FR-NM-04, C-02): 1/50/51 selection, action enum, ComparisonSourceRequired, snapshot revisions, stale revision/authorization fail without publish, no model call on conversion failure, note_assertion vs source_fact marking, citation validation refusal.
- [X] T024 [P] [US4] Write failing web tests `apps/web/test/notes-saved-response.test.ts` (FR-NM-04): action availability, disclosure text, selection cap.

### Implementation (Green → Refactor)

- [X] T025 [US4] Implement `apps/api/src/notes/assistant.ts` and the `assistant` route (FR-NM-04); pass T023.
- [X] T026 [P] [US4] Implement `apps/web/src/notes/assistant.ts` (FR-NM-04); pass T024.

## Phase 6: Polish and verification

- [X] T027 Run `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs`, `git diff --check` and the quickstart vitest command; record UNAVAILABLE runners (NFR-EVAL-02, NFR-EVAL-04).
- [X] T028 Resolve [checklist](checklists/ux.md) items against the implemented spec and record the gate decision (proceed).

## Phase 7: Converge (gap assessment)

- [X] T029 Converge assessment of spec/plan/tasks against code (FR-NM-01..04): all FR-001..FR-019 are implemented and tested. Recorded caveats: the exact 200,000,000-byte boundary is enforced in `apps/api/src/notes/service.ts` but not exercised by a test (a 200 MB fixture is impractical; the word boundary is tested); `server.ts` remains an unmounted stub as in earlier packages, so `handleNotesRoute` is exported for mounting; Playwright E2E and judged evals are `UNAVAILABLE`.

## Phase 8: Convergence

Assessed on 2026-10-20 against the revised Package 2.3 card (PR #127), `spec/requirements/README.md` (v2 row: one shared save-note route), SRS §5.4 (Gate v2.0 #2), §5.5 DEV-04 and §5.6 (card review 2026-10-20: note-source reuse), `docs/solution-architecture.md` (D16, model routing, D3) and the constitution. In-memory v2 storage in the single API process is the accepted v2 PoC store (D16 / DEV-04) and is not a gap; no PostgreSQL migration work is planned here (`packages/db/migrations/v3-draft/` stays as is). The Note Assistant is wired to the v1 grounded model (`createGroundedModelFromEnv`: ADK `Gemini`, `vertexai: true`, `europe-west4`, `gemini-2.5-flash`, keyless ADC) in `apps/api/src/server.ts` and answers `503` only when Vertex is not configured; that is not a gap. Tests precede their implementation tasks (Constitution II / `CC-02`); task references outside this file use `[007-notes-pinboard-lifecycle] Tnnn`.

**Owner decision 2026-10-20 (overrides the storage parts of this phase):** note-sources are normal v1 PostgreSQL sources (`media_type: note_markdown`, migration `packages/db/migrations/0004_note_sources.sql`); notes stay in memory (`D16`). Conversion uses the v1 `reserveSources` and the v1 Markdown ingestion, so T045/T046 are implemented through the v1 paths instead of an in-memory registry, and the registry is removed. Recorded in `D16`, SRS §5.5 `DEV-04`, SRS §5.6 and the Package 2.3 card.

### Flow-back (before any code task)

- [X] T030 CRITICAL: Flow the revised Package 2.3 card back into `specs/007-notes-pinboard-lifecycle/spec.md`, citing the SRS IDs on each change. FR-002: the body is Markdown only, and raw HTML and unsafe link targets (such as `javascript:`) are removed on save on every write path (drop "or equivalent rich text"). FR-006/FR-009: the one shared save-note route `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note` with the card's request/response DTO; title = preceding user question trimmed to 200 code points, or `Saved response`; body IDs must equal the path IDs, else `400`. FR-013: the client that requested the conversion adds the new source to its own browser-local selection; inline citation markers such as `[1]` are removed from the converted source text and kept only as provenance metadata. FR-015: an action on the same notes at the same revisions reuses the existing note-source, and only new or changed note content takes a new slot (SRS §5.6, 2026-10-20). FR-017: citations that point to note-sources carry a `Note` label. Add the D16 PoC note (kept by the running API; "after reload" means within one API instance), Owner-only actors in v2, and the Gate v2.0 #2 round trip as an end-to-end test in the running application. Per Constitution I / `CC-01` (`FR-NM-01..04`, `FR-GC-09`) (partial)
- [X] T031 Flow the same refinements into `specs/007-notes-pinboard-lifecycle/plan.md`, `data-model.md`, `contracts/interfaces.md`, `research.md` and `quickstart.md`. Replace `POST /api/notebooks/:id/notes/from-message` as "the single server entry point" with the shared chat-message route and one shared DTO defined once in `packages/contracts`. Replace "Cloud SQL via `0007_notes.sql`", "`server.ts` intentionally not edited" and "Playwright UNAVAILABLE (no runnable page)" with D16 (notes and note sources in the single API process until v3; drafts in `packages/db/migrations/v3-draft/`), the mounted v2 runtime (`apps/api/src/v2/runtime.ts`) and the new pinboard UI and E2E test. Add the model routing (v1 grounded Flash model on Vertex AI, `europe-west4`, keyless ADC; never `GEMINI_API_KEY`/`GOOGLE_API_KEY`). Add how note-sources join the Left Panel list, the atomic slot count and the v1 chat `C-02` read (T045/T046), the note-source reuse key `{(note_id, revision)}`, the provenance citations field and the `Note` citation label. Per plan: storage/route/model decisions, D16, D3, `CC-01` (contradicts)

### Tests (Red first)

- [ ] T032 CRITICAL: Write failing integration tests in `apps/api/test/notes-quota.integration.test.ts` (real PostgreSQL via `TEST_DATABASE_URL`, else report `UNAVAILABLE`). With 49 of 50 slots used, two concurrent conversions produce exactly one source and one `409 SourceLimitReached`; an in-flight conversion already holds its slot while the ingestor is still running. With PostgreSQL uploads plus note-sources at the limit, v1 upload admission (`POST /api/notebooks/:id/sources/uploads` and `/sources/text`) rejects with `SourceQuotaExceeded`, and a conversion at the limit is rejected as well. A failed ingestion releases its slot. `GET /notes` `source_slots.used` equals uploads plus note-sources plus in-flight reservations. Per Constitution VI (slots reserved atomically before ingestion across upload and note-to-source paths), `FR-WM-07`, FR-012, SC-004 (contradicts)
- [ ] T033 CRITICAL: Rewrite `apps/api/test/notes-roundtrip.integration.test.ts` so the round trip runs through the v1 routes with the real `createNoteMarkdownIngestor`, a scripted `GroundedModel` and the production verifier. Save the cited TITAN-77 answer through the shared save-note route, then convert it. The converted source must appear in `GET /api/notebooks/:id/sources` as `Ready` (`media_type: "note_markdown"`). A v1 chat turn (`POST /api/notebooks/:id/chat/turns`) with only that source selected must answer TITAN-77 citing a chunk of the converted source. The turn provenance must hold `(note_source_id, revision)`, and the decoy upload must never be retrieved. `GET /api/notebooks/:id/chat` shows that citation as available with the note-source title. Per Gate v2.0 #2, `FR-NM-03`, FR-013, US3/AC1, AC3, `C-02`, `NFR-EVAL-04` (missing; blocks P1 US3)
- [ ] T034 CRITICAL: Write failing DOM tests in `apps/web/test/notes-pinboard.test.ts` for the Right Panel notes pinboard. `+ Add note` creates a note and opens the Note Editor with title `New note` and the focused content area. The toolbar (H1, H2, Bold, Italic, bulleted/numbered list, link) inserts Markdown. A typing pause saves within 1.0 s. Closing flushes pending saves before the list shows the note. Offline or failed saves keep a browser-local draft, show pending/error status, never show "saved", and recover the draft on reopening. The list follows `display_order`, and Delete asks for confirmation and then removes the note permanently. Per `FR-NM-01`, FR-001..FR-005, US1/AC1..AC4, SC-001 (missing; blocks P1 US1)
- [ ] T035 CRITICAL: Extend `apps/web/test/notes-pinboard.test.ts` with saved responses and conversion. Save to note in chat inserts the saved response into the pinboard within 300 ms, showing `Saved to notes`. The saved-response viewer is read-only, and its `[n]` badges open the Source Inspector. Convert to editable opens the manual copy without badges. `Convert to source`, `Convert selected to source` and `Convert all notes to source` are disabled with tooltip `Source limit reached` at the limit and disabled for empty bodies. After a conversion the new source appears in the Left Panel as `Ready` and is added to this browser's selection only (`SelectionModel.markImported`), and the originals stay. Per `FR-NM-02`, `FR-NM-03`, FR-006..FR-013, US2/AC1..AC5, US3/AC2..AC5, SC-002 (missing; blocks P1 US2/US3)
- [ ] T036 Write failing DOM tests in `apps/web/test/notes-assistant-bar.test.ts`. Note checkboxes allow 1–50 selected notes, and selecting notes or opening one note shows the bar with Summarize, Create outline, Suggest related ideas and Critique, each labelled as creating a source snapshot. Related ideas and Critique with no selected existing source show `Select a comparison source first` and send nothing. Conversion progress is shown as its own phase before synthesis. The validated result appears in the Chat panel as a ChatMessage with Save to note. Citations to the note-source carry a `Note` label, distinct from other sources (`citation_kinds`). Failures show an error. Per `FR-NM-04`, FR-014..FR-017, US4/AC1..AC4 (missing)
- [ ] T037 CRITICAL: Write the Playwright test `apps/web/test/notes-roundtrip.spec.ts` against `apps/web/test/e2e-server.ts` (fixture model). In the browser: upload `Raw_Data` stating "Project codename is TITAN-77", ask for the codename, click Save to note, open the saved note and click Convert to source. The new source is `Ready` and checked in the Left Panel. Select only it, ask "What is the project codename?" and see TITAN-77 with a citation `[1]` that opens the converted note source. Report `UNAVAILABLE` without `TEST_DATABASE_URL`. Per Gate v2.0 #2, Constitution V (runnable application), `FR-NM-02/03`, SC-006 (missing)
- [ ] T038 Write failing tests for the single shared save-note contract. `packages/contracts/test/package-v2-3.test.ts`: one request schema `{notebook_id, message_id}` and one response schema (`note` with `source_message_id`, 1–200 code-point `title`, `content_md`, `citations_json`, `origin_type: "saved_response"`, `read_only: true`, `created_at`), and `package-v2-2.ts` re-exports the same schema objects. `apps/api/test/notes-saved-response.test.ts`: `POST /notes/from-message` no longer creates notes (404, or an alias that returns exactly the shared route's result and status codes). The shared route's note is listed by `GET /notes`. Title = preceding user question trimmed to 200 code points, or `Saved response` with no question. Body IDs different from the path, or an invalid body, return `400`. Idempotent per (user, message). `packages/db/test/notes.test.ts` covers the title rule in `saveResponseAsNote`. Per `FR-NM-02`, `FR-GC-09`, shared save-note contract (`spec/requirements/README.md` v2 row), FR-006, FR-009 (contradicts)
- [ ] T039 Write failing tests in `apps/api/test/notes-assistant.test.ts`. Repeating an action on the same notes at the same revisions reuses the existing Ready note-source (same `note_source.id`, slot count unchanged), and it still succeeds at `50/50`. Editing one note, or adding a note to the selection, creates one new note-source and takes one slot. A deleted reused note-source is not reused. Per `FR-NM-04`, FR-015, SRS §5.6 card review 2026-10-20 (missing)
- [ ] T040 Write failing tests in `apps/api/test/notes-assistant.test.ts`. `summarize` and `create_outline` with non-empty `selected_source_ids` read only the note-source: chunks passed to the model, `snapshot` and citations contain no other source. `related_ideas`/`critique` still add the selected existing sources. Per `FR-NM-04`, FR-016, Constitution III (explicit scope) (contradicts)
- [ ] T041 Write failing tests in `apps/api/test/notes-assistant.test.ts` (PostgreSQL integration, else `UNAVAILABLE`). The action's question and validated answer are written to the caller's PostgreSQL chat thread with the `(source_id, revision)` provenance, and appear in `GET /api/notebooks/:id/chat`. They are removed by Clear chat (`DELETE /api/notebooks/:id/chat`). The answer can be saved through the shared save-note route. A refusal is stored as a refusal. Per `FR-NM-04`, FR-017, `FR-GC-06`, D16 (chat stays in PostgreSQL) (partial)
- [ ] T042 Write failing tests in `apps/api/test/notes-convert.test.ts` and `apps/worker/test/note-markdown.test.ts`. Converting a saved-response note removes its verified inline markers (`[1]`, `[2]`) from the source Markdown and the C-01 chunk text. Unverified bracketed text stays. The `NoteSource` keeps the copied citations as provenance metadata (`origin_citations`), while new answers cite the note-source's own chunks. Per `FR-NM-03`, FR-013 (missing)
- [ ] T043 Write failing tests in `packages/db/test/notes.test.ts`. Every note write path removes raw HTML and unsafe link targets before storing: `createNote`, `updateNote`, `saveResponseAsNote` (assistant content containing `<script>` or `[x](javascript:alert(1))`), `convertToEditable`, and the repository call used by the Studio convert path. Safe Markdown, headings, lists and `https`/`mailto` links are kept. Per `FR-NM-01`, FR-002 (partial)
- [ ] T044 Write a failing timing test in `apps/api/test/notes-roundtrip.integration.test.ts`. A 5,000-word note becomes a citable `Ready` source within 2.0 s through the full route with the real `createNoteMarkdownIngestor`, including slot reservation and registration, not the stub ingestor. Per `FR-NM-03`, FR-019, SC-003 (partial)

### Implementation (Green → Refactor)

- [ ] T045 CRITICAL: Pass T032 with one per-notebook source admission in the API process (D16, one instance). In `apps/api/src/v2/runtime.ts`, `reserveSlot` takes a real reservation, and keeps it until the note-source is registered or ingestion fails, instead of only counting. Give v1 `reserveSources` (`packages/db/src/quota.ts`, via a `ReserveOptions` hook used by `apps/api/src/routes/sources.ts`) the count of note-sources plus in-flight note reservations. Serialize both paths per notebook, so uploads plus note-sources never exceed `sourceLimit`. Per Constitution VI, `FR-WM-07`, FR-012 (contradicts)
- [ ] T046 CRITICAL: Pass T033 by making note-sources first-class sources in the v1 paths, within D16 (the in-memory note-source registry is a `C-02` read path). Merge Ready note-sources into `GET /api/notebooks/:id/sources` (`apps/api/src/routes/sources.ts`). Extend the v1 chat scope capture and retrieval (`RequestScopedContextProvider` in `apps/api/src/chat/`) to accept note-source IDs, snapshot their revisions, append their chunks (not embedded; read whole, bounded), and include them in `lastRetrieved` for the verifier. Make the history projection resolve note-source titles and availability. Owner option: storing note-sources as PostgreSQL `sources`/`chunks` rows instead would need a D16/DEV-04 amendment first. Per Gate v2.0 #2, `FR-NM-03`, FR-013, `C-02`, Constitution III (missing)
- [ ] T047 CRITICAL: Pass T034 by adding the Right Panel notes pinboard in `apps/web/src/notes/panel.ts` (new), mounted from `apps/web/src/workspace/index.ts` / `apps/web/src/v2/workspace-features.ts` in place of the Studio placeholder text for notes. Reuse `NoteEditorSession` (`editor-session.ts`), `orderNotes`/`togglePinboardSelection` (`pinboard.ts`) and the `/api/notebooks/:id/notes` routes. Add a Markdown toolbar, a `localStorage`-backed `DraftStore` (wrapped in try/catch), save-status display, flush on close, and delete with confirmation (`?confirm=true`). Per `FR-NM-01`, FR-001..FR-005 (missing)
- [ ] T048 CRITICAL: Pass T035 by adding the saved-response viewer (`savedResponseView`/`citationForBadge` from `apps/web/src/notes/saved-response.ts`, badges call `openCitation`), Convert to editable, and the three convert actions gated by `conversionState` with the `source_slots` from `GET /notes`. After a conversion, refresh the Sources panel and call `SelectionModel.markImported(source.id)` for this browser only. Route `onSavedNote` in `apps/web/src/v2/workspace-features.ts` into the pinboard list instead of `renderSavedResponseNote`, and show `Saved to notes`. Per `FR-NM-02`, `FR-NM-03`, FR-006..FR-013 (missing)
- [ ] T049 Pass T036 by adding note checkboxes and the 4-action bar using `assistantActions`/`ASSISTANT_DISCLOSURE` (`apps/web/src/notes/assistant.ts`). Send `POST /api/notebooks/:id/notes/assistant` with the selected notes and, for Related ideas/Critique, the current Left Panel selection. Show conversion and synthesis as separate progress phases, append the returned ChatMessage to the chat panel with the response actions (Save to note), and label citations whose `citation_kinds` value is `note_assertion` as `Note`. Per `FR-NM-04`, FR-014..FR-017 (missing)
- [ ] T050 Pass T038 after `[006-source-guide-chat-control] T077`/`T078`. Define the shared save-note request/response schemas once in `packages/contracts/src/package-v2-3.ts` and re-export them from `package-v2-2.ts`. Delete `SaveNoteFromMessageInputSchema` and the duplicate `SaveResponseNoteRequestSchema`/`SavedResponseNoteSchema` definitions. Remove the `from-message` branch from `apps/api/src/routes/notes.ts` (or make it a thin alias of the shared handler). Replace `savedResponseTitle` (first content line) in `packages/db/src/notes.ts` with the preceding-user-question rule in `NotesService.saveFromMessage`/`saveResponseAsNote`, unless `[006] T078` already moved it there. Per `FR-NM-02`, `FR-GC-09`, FR-006, FR-009 (contradicts)
- [ ] T051 Pass T039 in `apps/api/src/notes/service.ts` (`runAssistant`) and `packages/db/src/source-registry.ts`. Before converting, look up a Ready note-source of the notebook whose `origin_notes` set of `(note_id, revision)` equals the selection's, and reuse it without reserving a slot. Otherwise convert as before. Per `FR-NM-04`, FR-015, SRS §5.6 (missing)
- [ ] T052 Pass T040 by making `runAssistant` read only the note-source for `summarize`/`create_outline` and add `selected_source_ids` only for `related_ideas`/`critique` (`apps/api/src/notes/service.ts`). Per `FR-NM-04`, FR-016 (contradicts)
- [ ] T053 Pass T041 by writing Note Assistant turns to the PostgreSQL chat thread through the v1 chat repository (a chat-writer port injected from `apps/api/src/v2/runtime.ts` into `NotesService`) instead of the in-memory `persistChatMessage` in `packages/db/src/poc-bridge.ts`, with question and answer in one turn and the snapshot as provenance. Per `FR-NM-04`, FR-017, `FR-GC-06`, D16 (partial)
- [ ] T054 Pass T042 by stripping the saved response's verified `[n]` markers in `composeNoteMarkdown` (`apps/api/src/notes/service.ts`), and adding `origin_citations` (Package 1.3 `Citation[]`) to `NoteSourceSchema` (`packages/contracts/src/package-v2-3.ts`) and the registered `NoteSource`. Per `FR-NM-03`, FR-013 (missing)
- [ ] T055 Pass T043 by applying `sanitizeNoteMarkdown` inside the repository write paths of `packages/db/src/notes.ts` (`insert`, `updateNote`), so saved responses, editable copies and Studio-created notes are sanitized as well as route input. Per `FR-NM-01`, FR-002 (partial)
- [ ] T056 Pass T044, refactoring the conversion path in `apps/api/src/notes/service.ts` / `apps/worker/src/ingestion/note-markdown.ts` only if the real-ingestor timing misses 2.0 s. Per `FR-NM-03`, FR-019 (partial)

### Verification

- [ ] T057 Run the focused Package 2.3 Vitest suites, `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs`, `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic` and Playwright `notes-roundtrip.spec.ts` (T037). Record the exact results in `specs/007-notes-pinboard-lifecycle/validation.md`. Replace "Not built: the pinboard UI" and "Note sources … are not visible to the v1 chat" with the current state, and supersede the T029 caveats. Record live Note Assistant TTFT ≤ 2.5 s against Vertex AI `europe-west4` and the LLM-judged gate evals as `UNAVAILABLE` until a deployed run exists. Mark Gate v2.0 #2 as passed only when T037 passes. Per `CC-02`, Gate v2.0 #2, `NFR-EVAL-02/04`, FR-019 (partial)

### Dependencies and execution order (Phase 8)

- T030 and T031 precede every other Phase 8 task. Each test task precedes its implementation: T032→T045, T033→T046, T034→T047, T035→T048, T036→T049, T038→T050, T039→T051, T040→T052, T041→T053, T042→T054, T043→T055, T044→T056. T037 is written with the tests and turns green after T046, T048 and T050.
- Package 2.2 first: `[006-source-guide-chat-control] T077` and `T078` (shared save-note route writes through `NotesService`, title and `400` rules) must land before T038/T050. T050 then only removes the 2.3 duplicate route and schemas, and does not redo 006 work. `[006] T077` hands the saved note to the notes panel; T048 is the 2.3 side of that hand-off.
- T045 precedes T046 (both edit the v2 runtime and source routes). T046 precedes T048, T049 and T037, because the Left Panel and the chat must see note-sources. T053 follows T046, because the PostgreSQL chat provenance must accept note-source revisions. T051 precedes T049.
- T047 → T048 → T049 edit the same `apps/web/src/notes/panel.ts`; serialize them. T054 and T051 both edit the conversion path in `service.ts`; serialize them. T054 and T055 also change the note-to-source path that the Package 2.4 Studio "convert to source" (`apps/api/src/v2/runtime.ts`) reuses, so re-run the 008 Studio tests after them.
- T057 runs last.
