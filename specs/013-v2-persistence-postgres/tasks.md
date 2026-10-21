---

description: "Tasks for 013 v2 data persistence in PostgreSQL"
---

# Tasks: v2 Data Persistence (PostgreSQL)

**Input**: Design documents from `specs/013-v2-persistence-postgres/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/v2-store-contract.md`)
**Package Source**: none (technical v3 prerequisite closing `DEV-04` / `D16`); behaviour from `spec/requirements/v2/package_2_1..2_4_*.md` + `spec/requirements/README.md`
**SRS IDs in Scope**: `DEV-04`, `FR-WM-01..04`, `FR-UI-02`, `FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-01..04`, `FR-ST-10/11`, `C-02`, `C-03` | **Release Gate**: before `Gate v3.0`

**Prerequisites**: `plan.md` (`CC-01`..`CC-08` PASS), `spec.md` (no open clarification markers), `research.md`, `data-model.md`, `contracts/`

**Tests**: MANDATORY (Constitution Principle II / `CC-02`). Restart, cascade, concurrency and sweep tests are written first and must fail before the matching implementation. Existing v2 suites (specs/005–008) are the regression net and must pass unchanged (`FR-002`, SC-002).

**Organization**: Grouped by user story. Qualify task IDs as `specs/013-v2-persistence-postgres T001` in commits and PRs.

## Format: `[ID] [P?] [Story?] Description (SRS-ID) in exact/file/path.ts`

---

## Phase 1: Setup

- [X] T001 Add the persistence selector `configureV2Persistence(pool: Pool | null)` and `v2Pool()` (R1) and export it from `packages/db/src/index.ts` (`DEV-04`) in `packages/db/src/v2-persistence.ts`

---

## Phase 2: Foundational (blocking)

**⚠️ No user story work starts before this phase is complete.**

- [X] T002 Write failing migration tests: `0005`–`0008` apply in order after `0004`; tables `notebook_v2_metadata`, `user_preferences`, `notebook_user_preferences`, `source_guides`, `notebook_overviews`, `chat_configurations`, `message_feedback`, `message_followups`, `notes`, `studio_artifacts` exist; deleting a notebook cascades to every one of them (`DEV-04`, `FR-WM-01`, `FR-008`) in `packages/db/test/v2-schema.integration.test.ts`
- [X] T003 Create `0005_v2_workspace.sql` per data-model: `notebook_v2_metadata(notebook_id UUID PK → notebooks ON DELETE CASCADE, icon_emoji TEXT NOT NULL DEFAULT '📓' (= DEFAULT_NOTEBOOK_ICON), icon_source TEXT NOT NULL DEFAULT 'default' CHECK IN ('default','topic','custom'), topic_selection_attempted BOOLEAN NOT NULL DEFAULT false, note_order_counter INTEGER NOT NULL DEFAULT 0)`, `user_preferences(user_id UUID PK → users, record JSONB NOT NULL, updated_at)`, `notebook_user_preferences((user_id → users, notebook_id → notebooks) PK, record JSONB NOT NULL, updated_at)` (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `packages/db/migrations/0005_v2_workspace.sql`
- [X] T004 [P] Create `0006_v2_context.sql` per data-model: `source_guides` PK `(source_id → sources, revision, output_language)` + `notebook_id → notebooks`, `status CHECK IN ('GuidePending','GuideReady','GuideFailed')`; `notebook_overviews` PK `cache_key` + `notebook_id`, `authorization_key`; `chat_configurations` PK `(notebook_id, user_id)`; `message_feedback` PK `(notebook_id, user_id, message_id → chat_messages)`; `message_followups` PK `(notebook_id, user_id, message_id → chat_messages, output_language)`; each with `record JSONB NOT NULL`, `updated_at`, all FKs `ON DELETE CASCADE` (`FR-SI-02`, `FR-GC-04/05/07/09`) in `packages/db/migrations/0006_v2_context.sql`
- [X] T005 [P] Create `0007_notes.sql` from `v3-draft/notes.sql` with `owner_id UUID → users ON DELETE CASCADE`, `UNIQUE (notebook_id, owner_id, source_message_id)`, index `(notebook_id, owner_id, display_order)`, no FK on `source_message_id` or `origin_note_id` (`FR-NM-01..04`) in `packages/db/migrations/0007_notes.sql`
- [X] T006 [P] Create `0008_studio_artifacts.sql` from `v3-draft/studio_artifacts.sql` with `owner_id UUID → users ON DELETE CASCADE`, `seq BIGINT GENERATED ALWAYS AS IDENTITY`, `retry_of → studio_artifacts ON DELETE SET NULL`, checks "payload iff Completed" and "snapshot non-empty" kept, index `(notebook_id, owner_id, seq)` (`FR-ST-10/11`, `C-03`) in `packages/db/migrations/0008_studio_artifacts.sql`
- [X] T007 Delete `packages/db/migrations/v3-draft/` and repoint `packages/db/test/notes-schema.test.ts` and `packages/db/test/studio-artifacts-schema.test.ts` to the real migrations (`DEV-04`, `FR-013`) in `packages/db/test/notes-schema.test.ts`
- [X] T008 Write failing tests for the PostgreSQL notebook bridge: `getNotebookOwner`/`getNotebookRecord` read `notebooks`; `getReadySourceCount` counts Ready sources with an active revision; `touchNotebookModified` bumps `notebooks.updated_at` monotonically (two calls in the same millisecond give strictly increasing values) (`FR-007`, `FR-WM-03`) in `packages/db/test/v2-bridge.integration.test.ts`
- [X] T009 Implement the PostgreSQL mode of `poc-bridge.ts` (`getNotebookOwner`, `getNotebookRecord`, `getReadySourceCount`; `rememberNotebook`/`setReadySourceCount` no-ops in PG mode) and of `touchNotebookModified` (R3) (`FR-007`, `FR-WM-03`) in `packages/db/src/poc-bridge.ts`
- [X] T010 Configure persistence in `createV2Runtime` (`configureV2Persistence(pool)`), make `ownerOf` async via `getNotebookOwner`, drop notebook mirroring in the Ready watcher and `syncNotebook`/`notebookModified`/`syncSources`, and switch `routes/notebooks.ts`, `routes/workspace-preferences.ts`, `services/workspace-preferences.ts` to the async lookups (`FR-007`, `FR-WM-04`) in `apps/api/src/v2/runtime.ts`

**Checkpoint**: schema in place; v2 access reads v1 tables only.

---

## Phase 3: User Story 1 — Notes and Studio reports survive a restart (P1) 🎯 MVP

**Goal**: `FR-NM-01..04`, `FR-ST-10/11` records are durable (`DEV-04`).
**Independent Test**: create notes, a saved response and a completed report via the API; start a second API on the same DB; read them back unchanged.

### Tests (write first, observe failing)

- [X] T011 [P] [US1] Restart scenarios US1-1..US1-4: notes (ids, titles, content, revisions, order, citations) equal after restart; revision-3 edit → 4, revision-2 edit → conflict; completed report equal after restart; unchanged note reuses its note-source (`FR-NM-01`, `FR-NM-02`, `FR-NM-03`, `FR-NM-04`, `FR-ST-10`) in `apps/api/test/v2-restart.integration.test.ts`
- [X] T012 [P] [US1] Notes store PG suite: CRUD, display order never reused after delete, saved-response idempotency under 2 concurrent saves (exactly one created), concurrent updates on the same base revision (exactly one wins, other `RevisionConflictError`), read-only saved responses, convert-to-editable (`FR-NM-01`, `FR-NM-02`, `FR-009`) in `packages/db/test/notes.pg.integration.test.ts`
- [X] T013 [P] [US1] Studio repository PG suite mirroring the in-memory repository behaviour: insertion-order list without payload, legal/illegal transitions, retry rules, scoped get/delete, `deleteForNotebook` (`FR-ST-10`, `FR-ST-11`, `C-03`) in `packages/db/test/studio-artifacts.pg.integration.test.ts`

### Implementation

- [X] T014 [US1] Implement the PostgreSQL path of every exported function in `notes.ts` (R4: `FOR UPDATE` transactions, `ON CONFLICT` saved responses, `note_order_counter` from `notebook_v2_metadata`; sanitized Markdown on every write as today) keeping the memory path (`FR-NM-01..04`, `FR-009`) in `packages/db/src/notes.ts`
- [X] T015 [US1] Implement `PostgresStudioArtifactRepository` (same errors and `canTransitionStudioStatus` checks, `SELECT … FOR UPDATE` transitions, list by `seq`) and use it in `createV2Runtime` (`FR-ST-10/11`, `C-03`) in `packages/db/src/studio-artifacts.ts`

**Checkpoint**: US1 tests green; notes/Studio API suites pass unchanged.

---

## Phase 4: User Story 2 — Workspace preferences and notebook metadata survive a restart (P2)

**Goal**: `FR-WM-02`, `FR-WM-03`, `FR-UI-02` records are durable.
**Independent Test**: set icon, pin, theme, languages; restart; overview and preferences unchanged.

### Tests (write first)

- [ ] T016 [P] [US2] Restart scenarios US2-1..US2-4 (custom/topic icon kept and not replaced; pin + last opened order kept, opening does not change `updated_at`; theme/languages and effective output language kept; content modified time kept) (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `apps/api/test/v2-restart.integration.test.ts`
- [X] T017 [P] [US2] Workspace store PG suite: defaults for absent rows, preference round trips, owner scoping (`NotebookPreferenceScopeError` for another owner's or a missing notebook), topic-icon claim with 2 concurrent claims (exactly one true) and never over a custom icon (`FR-WM-02`, `FR-WM-04`, `FR-009`) in `packages/db/test/workspace-preferences.pg.integration.test.ts`

### Implementation

- [X] T018 [US2] Implement the PostgreSQL path of `workspace-preferences.ts` (metadata upserts, JSONB records parsed with `OwnerWorkspacePreferencesSchema` / `OwnerNotebookPreferencesSchema`, conditional topic claim, batched overview reads) keeping the memory path (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `packages/db/src/workspace-preferences.ts`

---

## Phase 5: User Story 3 — Source Guides, overviews, chat settings and feedback survive a restart (P2)

**Goal**: `FR-SI-02`, `FR-GC-04/05/07/09` records are durable; a restart never regenerates an existing guide.
**Independent Test**: guide, overview, follow-ups, configuration and feedback read back after restart with zero new model calls.

### Tests (write first)

- [ ] T019 [P] [US3] Restart scenarios US3-1..US3-5 (Ready guide returned, no generation started even when sources are listed again; rev-1 guide not shown for rev 2; chat configuration used by next turn; feedback and follow-ups unchanged; cached overview served) (`FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`) in `apps/api/test/v2-restart.integration.test.ts`
- [ ] T020 [P] [US3] Package 2.2 store PG suite: guide key `(source, revision, language)` and any-language lookup preferring Ready; overview per-user authorization key; feedback set/clear; follow-up snapshot check; source deletion removes its guides; chat clear removes feedback/follow-ups (`FR-SI-02`, `FR-GC-04/05/07/09`, `CC-04`) in `packages/db/test/package-v2-2.pg.integration.test.ts`

### Implementation

- [ ] T021 [US3] Implement the PostgreSQL path of `package-v2-2.ts` (JSONB records parsed with their contract schemas) keeping the memory path (`FR-SI-02`, `FR-GC-04/05/07/09`) in `packages/db/src/package-v2-2.ts`
- [ ] T022 [US3] Skip Source Guide generation in the Ready hook when a guide for `(source, revision, effective language)` already exists (R5) (`FR-SI-02`) in `apps/worker/src/package-v2-2-runtime.ts`

---

## Phase 6: User Story 4 — Interrupted background work is never left hanging (P3)

**Goal**: `FR-010`, `FR-011`.
**Independent Test**: seed `Running`/`Queued` reports and a `GuidePending` guide, start the runtime, observe `Failed` and regeneration.

### Tests (write first)

- [ ] T023 [P] [US4] Sweep scenarios US4-1, US4-2: pre-start `Queued`/`Running` reports become `Failed` with `GenerationError` and the interrupted message, no payload, Retry allowed; reports created after start untouched; pre-start `GuidePending` guide is deleted and the next open returns `202 GuidePending` and starts generation (`FR-ST-10`, `FR-SI-02`, `C-03`) in `apps/api/test/v2-restart.integration.test.ts`

### Implementation

- [ ] T024 [US4] Implement `sweepInterruptedStudioArtifacts(pool)` and `sweepOrphanedSourceGuides(pool)` (R5, `updated_at < now()`) and run both at `createV2Runtime` start (`FR-ST-10/11`, `FR-SI-02`) in `apps/api/src/v2/runtime.ts`

---

## Phase 7: Polish & Cross-Cutting

- [ ] T025 Flow-back (`CC-01`, `DEV-04`): mark `DEV-04` closed in SRS §5.5 and update the §5.6 v2.0 PoC paragraphs in `spec/System_Requirements_Specification_Gemeni_Notebook.md`; amend `D16` in `docs/solution-architecture.md` (v2 data persisted; one API instance and in-process background work remain; restart sweeps); update the "v2.0 proof of concept" notes in `spec/requirements/v2/package_2_1..2_4_*.md`; update the PoC comments in `packages/db/src/index.ts`, `poc-bridge.ts` and `apps/api/src/v2/runtime.ts`
- [ ] T026 Regression (`FR-002`, SC-002): run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `node scripts/check-spec-integrity.mjs`; record results in `specs/013-v2-persistence-postgres/quickstart.md` (Validation results section)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → user stories. US1, US2, US3 are independent after Phase 2 (different store modules; they share `v2-restart.integration.test.ts`, so its sections are written sequentially). US4 depends on US1 (Studio repo) and US3 (guide store). Polish last.
- Within each story: tests (fail) → implementation → story checkpoint.

## Parallel Opportunities

- T004–T006 (separate migration files).
- Per story, the PG store suite and the restart scenarios are separate files: e.g. US1 T012 ∥ T013, then T014 ∥ T015.

## Implementation Strategy

MVP = Phase 1–3 (notes and Studio durable). Then US2, US3, US4, polish. One PR for the feature (owner decision 2026-10-21).
