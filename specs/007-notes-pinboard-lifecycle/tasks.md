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
