# Tasks: Workspace & UI Comfort

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [interfaces](contracts/interfaces.md), [quickstart](quickstart.md), [UX checklist](checklists/ux.md).
**Package Source**: `spec/requirements/v2/package_2_1_workspace_ui_comfort.md` + `spec/requirements/README.md`.
**SRS IDs in scope**: `FR-WM-02`, `FR-WM-03`, `FR-UI-02`, `FR-GC-03` | **Release**: v2.0 contribution only.
**Task reference qualification**: In all handoffs and commits, qualify each ID as `[005-workspace-ui-comfort] Tnnn`.
**Prerequisites**: Plan/design complete; no unresolved clarification markers; package prerequisites FR-WM-01, FR-SI-01 and FR-UI-01 exist. Analyze must pass before implementation.

Tests are mandatory under CC-02 and the explicit TDD request. Each test task is executed and its expected requirement-related Red is recorded before the implementation task(s) it gates. Setup failures are not Red. Tasks are ordered and scoped so the API remains behind existing auth and owner checks. No new cloud product, framework, migration, C-01/C-02/C-03 change, or downstream generator implementation is in scope. Add the architecture-approved `@google/genai` client to the worker only if needed for architecture-approved topic-emoji selection.

## Phase 1: Setup and package boundaries

- [X] T001 [005-workspace-ui-comfort] Confirm the active branch, pinned feature directory, package prerequisites, existing Vitest scripts, and clean ownership boundaries; record only feature-owned files and do not stage pre-existing worktree changes (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `specs/005-workspace-ui-comfort/plan.md`.
- [X] T002 [005-workspace-ui-comfort] Reserve the new `package-v2-1.ts` contract module and single serialized barrel export; confirm the only possible dependency addition is the architecture-approved `@google/genai` worker client for architecture-approved topic-emoji selection, with no new cloud product, migration, C-01/C-02/C-03 change, or infrastructure (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `packages/contracts/src/index.ts`.

## Phase 2: Foundational Red tests (blocking)

**Purpose**: Specify shared package-level contracts and repository isolation before either story's behavior is implemented. No feature implementation starts until the tests report assertion-level Red.

- [X] T003 [P] [005-workspace-ui-comfort] Write and run failing shared contract tests for notebook icon state (`📓`, `topic`, sticky `custom`), exactly one valid emoji grapheme including ZWJ/flag/skin-tone sequences, view `grid|list`, sort `recent|title_asc|created_desc`, and deterministic pinned-first sort enums; cite `FR-WM-02`, `FR-WM-03` in `packages/contracts/test/package-v2-1.test.ts`.
- [X] T004 [P] [005-workspace-ui-comfort] Write and run failing repository tests for per-owner/per-notebook pin isolation, `last_opened_at` fallback without changing `updated_at`, pinned-first sort, deterministic ties, Ready-only count, icon custom-over-topic precedence, and timestamps for source/note/artifact changes; cite `FR-WM-02`, `FR-WM-03` in `packages/db/test/workspace-preferences.test.ts`.
- [X] T005 Record the exact assertion failures and commands for T003–T004, verify failures are requirement-related (not missing imports/setup), and run the existing focused baseline to ensure no unrelated regression (`CC-02`) in `specs/005-workspace-ui-comfort/validation.md`.

**Checkpoint**: T003–T005 show genuine Red. Existing prerequisites and all tests remain runnable.

## Phase 3: User Story 1 — Recognize and organize notebooks (P2)

**Goal**: Provide notebook visual metadata and the home overview grid/list, sorting, pinning, empty state, and persisted view/sort choices (`FR-WM-02`, `FR-WM-03`).

**Independent Test**: With owner-scoped notebook/source fixtures, the overview shows icon/title/creation and modification dates/Ready count, correctly orders pinned notebooks for all three sorts, retains list/sort choices, shows the specified empty state, and supports icon persistence and source-driven metadata changes.

### Tests (mandatory Red before implementation)

- [X] T006 [P] [US1] Write and run failing API contract tests for notebook metadata fields, icon selection persistence, HTTP 400 for invalid/multiple graphemes without mutation, owner isolation, Ready-only counts and the opened event; cover scenarios 1–2, 6–8 and FR-001–FR-004/FR-006 (`FR-WM-02`, `FR-WM-03`) in `apps/api/test/workspace-preferences.test.ts`.
- [X] T007 [US1] Write and run failing API/repository acceptance and boundary tests for pin/unpin owner scope, pinned-first behavior under `recent|title_asc|created_desc`, last-opened fallback/ties, and non-mutating open timestamp; cover scenarios 3, 8–9 and FR-005–FR-008 (`FR-WM-03`) in `apps/api/test/workspace-preferences.test.ts`.
- [X] T008 [P] [US1] Write and run failing overview tests for grid/list switch, all metadata, owner role in list rows, pin controls, empty call-to-action with sorting hidden/disabled, preference reload persistence, and ordering across all sort modes; include 500 notebooks and assert sorting/view updates ≤100 ms and metadata availability ≤200 ms (`FR-WM-02`, `FR-WM-03`) in `apps/web/test/workspace-preferences.test.ts`.
- [X] T009 [P] [US1] Write and run failing notebook metadata/topic tests for default `📓`, first Ready source topic selection versus sticky custom icon, selector failure leaving the icon unchanged without failing ingestion, invalid model output rejection, failed-source count unchanged, source add/remove/rename and note/artifact timestamp mutations, and invalid icon server responses preserving current UI state (`FR-WM-02`, Solution Architecture §2.1, D3, NFR-SEC-01) in `packages/db/test/workspace-preferences.test.ts` and `apps/worker/test/topic-emoji.test.ts`.
- [X] T010 Record exact Red case names/results for T006–T009 and establish the 500-notebook timing fixture; verify no test fails only from infrastructure or missing dependencies (`CC-02`, `FR-WM-02`, `FR-WM-03`) in `specs/005-workspace-ui-comfort/validation.md`.

### Implementation (Green → Refactor)

- [ ] T011 [US1] Implement the shared notebook metadata, overview, owner-notebook preference and icon validation Zod schemas/types; enforce icon exactly one Unicode emoji grapheme, defaults `📓`, `grid`, `recent`, and `false`, plus strict enumerations (`FR-WM-02`, `FR-WM-03`) in `packages/contracts/src/package-v2-1.ts`.
- [ ] T012 [US1] Implement in-memory owner-preference repository operations for `icon_emoji`, `icon_source`, `is_pinned`, `last_opened_at`, Ready count, stable pinned-first sorting, a shared `touchNotebookModified()` operation for source/note/artifact writers, and timestamp updates; do not modify `updated_at` when opening; pass T004/T007/T009 (`FR-WM-02`, `FR-WM-03`) in `packages/db/src/workspace-preferences.ts`.
- [ ] T013 [US1] Add exactly one export for Package 2.1 contract schemas and expose preference repository operations through the existing DB package barrel only when required by consumers (`FR-WM-02`, `FR-WM-03`) in `packages/contracts/src/index.ts` and `packages/db/src/index.ts`.
- [ ] T014 [US1] Integrate owner-scoped metadata, icon update (400 for invalid emoji), open tracking, pinning, sort parameters and Ready-source counts into existing notebook services/routes while preserving all existing title/create/delete responses and auth behavior; pass T006/T007 (`FR-WM-02`, `FR-WM-03`) in `apps/api/src/services/workspace.ts` and `apps/api/src/routes/notebooks.ts`.
- [ ] T015 [US1] Implement home overview Grid/List controls, icon/title/date/count metadata, Owner role row, per-user pin control, all pinned-first sort orders, empty CTA, local persisted mode/sort, and immediate rendering; pass T008 (`FR-WM-02`, `FR-WM-03`) in `apps/web/src/notebooks.ts` and `apps/web/src/workspace-preferences.ts`.
- [ ] T016 [US1] Implement the injectable Flash-Lite topic-emoji selector through the enterprise Vertex AI endpoint (`europe-west4`, keyless auth) using only source title and media type; wire it on the first Ready transition, preserve custom icons, and treat selector errors as non-fatal. Wire Ready-only metadata and the workspace header icon without changing source selection (`FR-WM-02`, `FR-SI-01`, Solution Architecture §2.1, D3, NFR-SEC-01) in `apps/worker/src/ingestion/topic-emoji.ts`, `apps/worker/src/ingestion/pipeline.ts`, `apps/worker/package.json`, and `apps/web/src/main.ts`.
- [ ] T017 [US1] Run targeted tests Green, refactor without behavior change, and record exact commands/case IDs and timings for FR-WM-02/03 acceptance and boundaries (`CC-02`, `FR-WM-02`, `FR-WM-03`) in `specs/005-workspace-ui-comfort/validation.md`.

**Checkpoint**: User Story 1 tests pass independently; owner isolation and Ready-only counts hold.

## Phase 4: User Story 2 — Set display and language preferences (P2)

**Goal**: Provide owner global/notebook input/output language settings, exact preference precedence, and a persistent Light/Dark/System theme applied without reload (`FR-UI-02`, `FR-GC-03`).

**Independent Test**: Change global and notebook preference fixtures, reload, and verify language-choice coverage, `auto` behavior, output resolution, system/light/dark application across panels, citation-quote language preservation and preference isolation.

### Tests (mandatory Red before implementation)

- [X] T018 [P] [US2] Extend failing contract tests for global and notebook language preferences: input language defaults to `auto`; output selection offers exactly the 40 supported BCP-47 tags enumerated in FR-012; reject unsupported tags; resolve explicit job > personal notebook override > notebook default > user default > supported browser locale > `en-US` (`FR-UI-02`) in `packages/contracts/test/package-v2-1.test.ts`.
- [X] T019 [P] [US2] Write and run failing API/repository tests for owner global theme/input/output settings, notebook language defaults/overrides, theme default `system`, preference precedence, malformed/unsupported preference rejection, and owner isolation (`FR-UI-02`) in `apps/api/test/workspace-preferences.test.ts`.
- [X] T020 [P] [US2] Write and run failing web tests for Light/Dark/System change without reload, system media preference, initial-load theme without prior-theme flash, all-panel theme coverage, settings persistence/reload, the exact 40 visible language choices, and input `auto` without source translation (`FR-UI-02`) in `apps/web/test/workspace-preferences.test.ts`.
- [X] T021 [US2] Write and run failing chat-boundary tests proving effective input/output language reaches the existing model adapter, non-default response language does not translate verbatim source-language citation quotations, and preference changes do not mutate selected sources (`FR-UI-02`, `FR-GC-03`, `FR-SI-03`) in `apps/api/test/chat-language.test.ts` and `apps/web/test/workspace-preferences.test.ts`.
- [X] T022 Record expected assertion-related Red for T018–T021 and baseline theme/language timing fixtures (`CC-02`, `FR-UI-02`, `FR-GC-03`) in `specs/005-workspace-ui-comfort/validation.md`.

### Implementation (Green → Refactor)

- [ ] T023 [US2] Extend Package 2.1 schemas with the versioned list of exactly the 40 supported output languages enumerated in FR-012, input `auto`/BCP-47 tags, owner global/notebook settings and exact effective output-language resolver (`FR-UI-02`) in `packages/contracts/src/package-v2-1.ts`.
- [ ] T024 [US2] Extend owner preference repository and service operations for global theme/language and notebook language defaults/overrides; enforce output tag support and required precedence without modifying notebook content timestamps (`FR-UI-02`) in `packages/db/src/workspace-preferences.ts` and `apps/api/src/services/workspace.ts`.
- [ ] T025 [US2] Add authenticated GET/PATCH API operations for owner global and notebook-scoped preferences, strict unknown-field validation, defaults and invalid-setting errors; retain owner-only access (`FR-UI-02`) in `apps/api/src/routes/workspace-preferences.ts` and `apps/api/src/server.ts`.
- [ ] T026 [US2] Implement settings UI and versioned validated browser preference hydration; apply `data-theme`/color-scheme and shared CSS variables before first visible paint, update all workspace panels without reload, and persist preference state (`FR-UI-02`) in `apps/web/src/workspace-preferences.ts`, `apps/web/src/workspace-preferences.css`, `apps/web/src/index.html`, and `apps/web/src/main.ts`.
- [ ] T027 [US2] Pass the resolved input/output language from authenticated chat request preferences into the existing grounded-chat model adapter and its system instructions; preserve original-language source/citation text and expose the same resolver to future consumers without implementing their generators (`FR-UI-02`, `FR-GC-03`) in `apps/api/src/routes/chat.ts`, `apps/api/src/chat/agent.ts`, and `apps/api/src/services/workspace.ts`.
- [ ] T028 [US2] Run focused story tests Green, refactor safely, and record all language-precedence, locale-fallback, original-quote and theme timing outcomes (`CC-02`, `FR-UI-02`, `FR-GC-03`) in `specs/005-workspace-ui-comfort/validation.md`.

**Checkpoint**: User Story 1 and User Story 2 acceptance and boundary tests pass independently; no generator behavior is claimed.

## Phase 5: Polish, quality gates and flow-back

- [ ] T029 [P] Run all feature-focused Vitest tests, including the worker topic-emoji suite, and relevant existing notebook/workspace regression tests; retain exact outputs and timing evidence (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `specs/005-workspace-ui-comfort/validation.md`.
- [ ] T030 Verify all requirements, scenarios, card limits, source prerequisites, owner-only release rule and any implementation discoveries are synchronized across `spec.md`, `plan.md`, FR card/SRS/architecture as applicable; rerun analyze after any flow-back (`CC-01`, `FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `specs/005-workspace-ui-comfort/analysis.md`.
- [ ] T031 Run final `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs`, `git diff --check`, relevant `pnpm exec vitest run ...` (including `apps/worker/test/topic-emoji.test.ts`) and `pnpm test:unit`; document exact results and any `UNAVAILABLE` gate without claiming full Gate v2.0 (`FR-WM-02`, `FR-WM-03`, `FR-UI-02`) in `specs/005-workspace-ui-comfort/validation.md`.

## Dependencies & Execution Order

- Setup T001–T002 is prerequisite validation and ownership only; it does not implement behavior.
- Foundational T003–T005 specifies and demonstrates shared-contract/repository Red before feature implementation.
- User Story 1 tests T006–T010 precede T011–T017. Implementation order: schemas → repository → serialized exports → API → web → source-ready/header integration → Green/refactor.
- User Story 2 tests T018–T022 precede T023–T028. It depends on US1's shared schema/repository/API/UI files, but keeps all new language/theme tests Red before its behavior extension.
- Polish T029–T031 depends on both stories. A reality gap flows to feature spec and upstream source, then analyze must be rerun before implementation/convergence is complete.
- All references above are qualified in handoffs as `[005-workspace-ui-comfort] Tnnn`; commit messages should cite the same qualified ID when referring to a task.

## Parallel Opportunities

- T003 and T004 are disjoint contract/repository tests and can be prepared in parallel; do not implement before Red is recorded.
- Within US1, T006 API tests, T008 web tests, and T009 DB/worker topic tests can be written in parallel. T007 shares T006’s API test file and must be edited serially. Implementations are sequential due shared module/export ownership.
- Within US2, T018, T019, and T020 are separate contract/API/web test files and may be developed in parallel; T021 shares the web test file with T020 and must be edited serially. US2 implementation is sequential across shared contract/repository/API and web files.
- No concurrent changes to `packages/contracts/src/index.ts`, app server dispatch, manifests, CI, migrations, or shared upstream documents; single owner only.

## Implementation Strategy

First complete the shared Red tests and then deliver User Story 1 as the first demonstrable increment (overview metadata and organization). Next add User Story 2 settings and effective language preferences. Do not claim production database durability, model-backed topic classification, generator integration, or full Gate v2.0 unless those adapters and release criteria are actually present and verified.

## Phase 6: Convergence

- [ ] T032 [US2] Add failing browser-module tests proving saved global and notebook input/output language preferences hydrate after reload and expose the notebook-specific controls from the active workspace; cite `FR-011`, `FR-012` in `apps/web/test/workspace-preferences.test.ts`.
- [ ] T033 [US2] Implement global preference hydration in the home settings and mount notebook-scoped language settings in the active workspace, persisting changes through owner-scoped preference APIs; pass T032 (`FR-011`, `FR-012`) in `apps/web/src/notebooks.ts`, `apps/web/src/workspace-layout.ts`, and `apps/web/src/workspace-preferences.ts`.
- [ ] T034 [US1] Add failing coverage that opening a notebook renders its saved title and icon in the workspace header; cite `FR-003` and Scenario 1 in `apps/web/test/workspace-preferences.test.ts`.
- [ ] T035 [US1] Load notebook title/icon from the authenticated notebook response and render them in the active workspace header; pass T034 (`FR-003`, Scenario 1) in `apps/web/src/main.ts` and `apps/web/src/workspace-layout.ts`.
- [ ] T036 [US2] Add failing coverage proving System theme updates when the browser `prefers-color-scheme` changes after initial render; cite `FR-010` in `apps/web/test/workspace-preferences.test.ts`.
- [ ] T037 [US2] Subscribe to `prefers-color-scheme` changes while System is selected and update the root theme without reload; pass T036 (`FR-010`) in `apps/web/src/workspace-preferences.ts` and `apps/web/src/main.ts`.
- [ ] T038 [US1] Add Chromium acceptance tests for metadata visibility, 500-record sort/view latency, theme-change latency, and saved notebook icon/header behavior; cite `SC-001`, `SC-002`, `SC-003`, and `SC-005` in `apps/web/test/workspace-comfort.spec.ts`.
- [ ] T039 [US1] Run the new Chromium acceptance tests, fix any feature regressions they expose, and record exact measured results or an explicit `UNAVAILABLE` result for the browser runtime (`SC-001`, `SC-002`, `SC-003`, `SC-005`) in `specs/005-workspace-ui-comfort/validation.md`.
