# Tasks: Studio Text Synthesis & Reports

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [interfaces](contracts/interfaces.md), [quickstart](quickstart.md), [checklist](checklists/studio-reports-gates.md).
**Package Source**: `spec/requirements/v2/package_2_4_studio_text_synthesis_reports.md` + [binding cross-package rules](../../spec/requirements/README.md).
**SRS IDs in scope**: FR-ST-10, FR-ST-11, C-02, C-03, NFR-EVAL-02, NFR-EVAL-04, NFR-SEC-02, FR-NM-03, FR-SI-02, Gate v2.0 #3.

**Tests**: MANDATORY (Constitution II / `CC-02`). Every behavior task waits for its named tests to fail for the expected requirement-related reason (missing export/behavior, not setup errors). Task references in handoffs: `[008-studio-text-reports] T001`.

## Format: `- [ ] [008-studio-text-reports] T### [P?] [Story?] Description (SRS-ID) in path`

## Phase 1: Setup

- [ ] [008-studio-text-reports] T001 Confirm C-01/C-02 exports and the one-line-per-index ownership rule for `packages/contracts/src/index.ts` and `packages/db/src/index.ts` (C-02, C-03) per [plan.md](plan.md)
- [ ] [008-studio-text-reports] T002 [P] Create schema-valid fixtures (UUID v7 chunk IDs, two Ready sources with dated events and definitions, a vendor set, a no-dates source) and fake ports (scoped-context provider, access verifier, guide provider) (FR-ST-10, FR-ST-11, C-02) in `apps/worker/test/studio-fixtures.ts`

## Phase 2: Foundational (blocks all stories)

- [ ] [008-studio-text-reports] T003 [P] Write failing contract tests: lifecycle transitions and terminal immutability, artifact refinements (payload iff Completed, snapshot ≥ 1), create-request scope (empty rejected), custom prompt 1/5,000/5,001 and whitespace boundaries with surrogate pairs, suggestion 3–4 bounds, registry duplicate/unknown (C-03, FR-ST-10, FR-ST-11) in `packages/contracts/test/package-v2-4.test.ts`
- [ ] [008-studio-text-reports] T004 Implement C-03 contract, registry, DTOs and prompt validator (C-03, FR-ST-11) in `packages/contracts/src/package-v2-4.ts` and add the single export line to `packages/contracts/src/index.ts` (depends on T003)
- [ ] [008-studio-text-reports] T005 [P] Write failing repository tests: create Queued, legal/illegal transitions, owner and notebook isolation, list without payload, delete, notebook-cascade delete, retry linkage (C-03, FR-WM-04, FR-ST-10) in `packages/db/test/studio-artifacts.test.ts`
- [ ] [008-studio-text-reports] T006 Implement `StudioArtifactRepository` and `InMemoryStudioArtifactRepository` (C-03) in `packages/db/src/studio-artifacts.ts` and export from `packages/db/src/index.ts` (depends on T004, T005)
- [ ] [008-studio-text-reports] T007 [P] Write failing DDL test for `studio_artifacts` (columns, FK cascade, status/plugin check constraints, payload-iff-completed check) (C-03, FR-ST-10) in `packages/db/test/studio-artifacts-schema.test.ts`
- [ ] [008-studio-text-reports] T008 Add migration (C-03, D4) in `packages/db/migrations/0004_studio_artifacts.sql` (depends on T007)
- [ ] [008-studio-text-reports] T009 [P] Write failing runner tests: Queued→Running→Completed, Failed on replaced revision (SourceChanged) and revoked access, no publish after Cancelled, citation-validation failure → refusal without payload, chunk of unselected source rejected, double-check access before read and publish, plugin crash → GenerationError (C-02, C-03, FR-ST-10, NFR-EVAL-04) in `apps/worker/test/studio-runner.test.ts`
- [ ] [008-studio-text-reports] T010 Implement `StudioJobRunner` (submit, run, cancel, retry attempt) (C-02, C-03, D13) in `apps/worker/src/studio/runner.ts` (depends on T002, T004, T006, T009)

**Checkpoint**: contract, persistence and lifecycle foundation green.

## Phase 3: User Story 1 - Generate a standard report (Priority: P1) 🎯 MVP

**Goal**: Four 1-click templates produce validated, grounded Markdown artifacts through the shared lifecycle (FR-ST-10, C-02, C-03, Gate v2.0 #3).
**Independent Test**: Quickstart scenarios 1, 2 and 5.

### Tests for User Story 1 (MANDATORY, test-first — `CC-02`) ⚠️

- [ ] [008-studio-text-reports] T011 [P] [US1] Failing batching tests: all chunks covered exactly once in order, token/chunk bounds, oversized chunk isolated, empty input (D12, C-03) in `apps/worker/test/studio-batching.test.ts`
- [ ] [008-studio-text-reports] T012 [P] [US1] Failing pipeline tests per template: Briefing sections + verbatim quotes, Study Guide glossary + short-answer answer key + essay questions, FAQ, Timeline chronological order + Cast of Characters, Timeline without dates states so and invents none, insufficient evidence → refusal, model called once per batch (FR-ST-10, FR-015) in `apps/worker/test/studio-pipeline.test.ts`
- [ ] [008-studio-text-reports] T013 [P] [US1] Failing validation tests: unknown chunk, wrong revision, quote not in chunk, date not in chunk, no citations, foreign-source chunk (leakage) (FR-014, NFR-EVAL-02, NFR-EVAL-04) in `apps/worker/test/studio-validation.test.ts`
- [ ] [008-studio-text-reports] T014 [P] [US1] Failing integration test for Gherkin scenarios: four templates reach Completed over 2 active sources with zero leakage; replaced revision fails with source-changed explanation, nothing published, retry needs explicit scope (FR-ST-10, C-02/03, NFR-EVAL-04) in `apps/worker/test/studio-reports.integration.test.ts`
- [ ] [008-studio-text-reports] T015 [P] [US1] Failing API tests: empty/omitted scope → 400, invalid subtype → 422, 202 Queued with snapshot and dispatcher called without awaiting generation (non-blocking, FR-006), list, get with payload, unavailable placeholder after source change, cancel, retry requires explicit scope, convert-to-source, delete, foreign owner → 404 (FR-ST-10, FR-NM-03, NFR-SEC-02) in `apps/api/test/studio-artifacts.test.ts`
- [ ] [008-studio-text-reports] T016 [P] [US1] Failing web tests: template buttons disabled for empty scope, `Generating Briefing doc...` row for Queued/Running, completed open → Markdown HTML (escaped), copy, convert, delete, Failed row shows explanation (FR-ST-10, FR-008) in `apps/web/test/studio-artifact-list.test.ts`

### Implementation for User Story 1

- [ ] [008-studio-text-reports] T017 [P] [US1] Template definitions (required/core blocks, titles) (FR-ST-10) in `apps/worker/src/studio/reports/templates.ts`
- [ ] [008-studio-text-reports] T018 [P] [US1] `batchChunks` (D12) in `apps/worker/src/studio/reports/batching.ts` (depends on T011)
- [ ] [008-studio-text-reports] T019 [P] [US1] `ReportModelClient` interface and `DeterministicReportModel` fake (C-03) in `apps/worker/src/studio/reports/model.ts`, `apps/worker/src/studio/reports/deterministic-model.ts`
- [ ] [008-studio-text-reports] T020 [US1] Markdown renderer with badge numbering and `validateReportCitations` (D13, FR-014) in `apps/worker/src/studio/reports/render.ts`, `apps/worker/src/studio/reports/validation.ts` (depends on T013)
- [ ] [008-studio-text-reports] T021 [US1] Map-reduce `generateReport` pipeline with core-block checks (FR-ST-10, FR-015, D12) in `apps/worker/src/studio/reports/pipeline.ts` (depends on T012, T017–T020)
- [ ] [008-studio-text-reports] T022 [US1] `ReportGeneratorPlugin` (`triggerJob`, `generate`) for the four template subtypes (C-03, FR-ST-10) in `apps/worker/src/studio/reports/plugin.ts` (depends on T014, T021)
- [ ] [008-studio-text-reports] T023 [US1] API service and routes (create, list, get, cancel, retry, convert, delete) with Owner-only checks (FR-ST-10, FR-NM-03, NFR-SEC-02) in `apps/api/src/studio/service.ts`, `apps/api/src/routes/studio.ts` (depends on T015)
- [ ] [008-studio-text-reports] T024 [US1] Web API client, list controller, safe Markdown renderer (FR-ST-10, FR-008) in `apps/web/src/studio/api.ts`, `apps/web/src/studio/artifact-list.ts`, `apps/web/src/studio/markdown.ts` (depends on T016)

**Checkpoint**: US1 independently verifiable.

## Phase 4: User Story 2 - Domain-relevant or custom report (Priority: P2)

**Goal**: Suggested formats from Source Guides, editable prompt, Create Your Own (FR-ST-11, FR-SI-02, C-03).
**Independent Test**: Quickstart scenarios 3 and 4.

### Tests for User Story 2 (MANDATORY, test-first — `CC-02`) ⚠️

- [ ] [008-studio-text-reports] T025 [P] [US2] Failing suggestion-service tests: 3–4 vendor-specific cards, ≤ 3.0 s, cache hit for same identity and miss on revision/scope/language change, Pending → loading (not cached), Failed → unavailable, model timeout/invalid count → unavailable (FR-ST-11, FR-009, FR-018) in `apps/worker/test/studio-suggestions.test.ts`
- [ ] [008-studio-text-reports] T026 [P] [US2] Failing generation tests: edited suggestion with "Include a risk matrix" yields a cited risk-matrix table over 3 vendor sources; custom prompt report; unselected-source content absent (FR-ST-11, FR-011, NFR-EVAL-04) in `apps/worker/test/studio-custom-reports.test.ts`
- [ ] [008-studio-text-reports] T027 [P] [US2] Failing API tests: prompt 1 and 5,000 accepted, 0/whitespace/5,001 rejected 422 without truncation, `dynamic`/`custom` require prompt, suggestions endpoint explicit scope (FR-ST-11) in `apps/api/test/studio-suggestions.test.ts`
- [ ] [008-studio-text-reports] T028 [P] [US2] Failing web tests: suggestion state machine, pencil edit pre-fills prompt, Generate enabled at one non-whitespace character and disabled at 0/5,001, templates/custom stay usable while Loading/Unavailable (FR-ST-11, FR-018) in `apps/web/test/studio-reports-modal.test.ts`

### Implementation for User Story 2

- [ ] [008-studio-text-reports] T029 [US2] `ReportSuggestionService` with cache and timeout; deterministic `suggest` in the fake (FR-ST-11, FR-009) in `apps/worker/src/studio/reports/suggestions.ts` (depends on T025)
- [ ] [008-studio-text-reports] T030 [US2] Dynamic/custom subtypes in plugin, pipeline and fake model (FR-ST-11, FR-011) in `apps/worker/src/studio/reports/plugin.ts`, `apps/worker/src/studio/reports/pipeline.ts` (depends on T026)
- [ ] [008-studio-text-reports] T031 [US2] Suggestions route and prompt validation in `apps/api/src/routes/studio.ts` (FR-ST-11) (depends on T027)
- [ ] [008-studio-text-reports] T032 [US2] `ReportsModalController` in `apps/web/src/studio/reports-modal.ts` (FR-ST-11, FR-018) (depends on T028)

## Phase 5: Polish, Eval Gates & Cross-Cutting

- [ ] [008-studio-text-reports] T033 [P] Deterministic eval test: citation-ID precision = 1.0, leakage = 0 across all six subtypes, P95 generation time ≤ 25.0 s on the declared fixture (NFR-EVAL-02, NFR-EVAL-04, FR-017, Gate v2.0 #3) in `apps/worker/test/studio-reports.eval.test.ts`
- [ ] [008-studio-text-reports] T034 Verify flow-back (CC-01): spec §Plan Refinements and FR card edge cases match the implementation; record any gap in `spec.md` and the FR card
- [ ] [008-studio-text-reports] T035 Run `pnpm typecheck`, `pnpm lint`, the feature vitest files and `node scripts/check-spec-integrity.mjs`; report Playwright and LLM-judged evals (`NFR-EVAL-01/03`) as `UNAVAILABLE` (Gate v2.0 #3)

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T003→T004→T006→T010; T007→T008) → US1 → US2 → Polish. US2 tasks depend on T017–T022 (plugin and pipeline) and T023–T024 for UI/API files they extend.
- Within every phase, Red test tasks precede their implementation tasks (`CC-02`).
- `[P]` only for disjoint files after shared contracts (T004) are fixed.
