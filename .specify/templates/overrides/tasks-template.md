---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`)
**Package Source**: `spec/requirements/v[N]/package_[N]_[M]_[name].md` + `spec/requirements/README.md`
**SRS IDs in Scope**: `[FR-*, NFR-*, C-01..C-03]` | **Release Gate**: `Gate v[N].0`

**Prerequisites**: `plan.md` (with `CC-01`..`CC-08` passing), `spec.md` (with all clarification markers resolved), `research.md`, `data-model.md`, `contracts/`

**Tests**: MANDATORY (Constitution Principle II / `CC-02`). Every requirement, Gherkin acceptance scenario, and numeric/text boundary in scope gets spec-derived test tasks that cite its SRS ID and precede the implementation tasks they cover. Tests MUST fail before implementation (`Red → Green → Refactor`).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. When referencing tasks in commits, PRs, or GitHub issues, always qualify the task ID with the spec path (e.g., `specs/[###-feature-name] T001`) because `T001` is not globally unique across packages.

## Format: `[ID] [P?] [Story?] Description (SRS-ID) in exact/file/path.ts`

- **[P]**: Can run in parallel (disjoint files, no dependencies on incomplete tasks, shared contracts already fixed)
- **[Story]**: Which user story this task belongs to (e.g., `[US1]`, `[US2]`, `[US3]`)
- **SRS ID Citation (`CC-01`)**: Every task MUST cite at least one SRS ID (`FR-*`, `NFR-*`, `C-01..C-03`, or `Gate vN.0`)
- **File Paths**: Use exact `pnpm` TypeScript monorepo paths (`packages/contracts/`, `packages/db/`, `packages/evals/`, `apps/api/`, `apps/worker/`, `apps/web/`, `apps/live/`, `apps/render/`, `infra/`)

<!--
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.

  The /speckit-tasks command MUST replace these with actual tasks based on:
  - User stories and Gherkin scenarios from spec.md (with their priorities P1, P2, P3...)
  - FR cards and binding cross-package rules from spec/requirements/README.md
  - Feature requirements and file boundaries from plan.md
  - Entities from data-model.md and schemas from contracts/

  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Prerequisites & Package Scaffolding)

**Purpose**: Verify or initialize shared monorepo packages and feature boundaries per `plan.md`

- [ ] T001 Verify within-release prerequisites and package structure per implementation plan (`[SRS-ID]`) in `package.json`
- [ ] T002 [P] Define or import shared Zod contract schemas (`[C-01 / C-02 / C-03]`) in `packages/contracts/src/[contract].ts`
- [ ] T003 [P] Configure package test fixtures and schema-valid symbolic IDs (`[SRS-ID]`) in `packages/evals/src/fixtures/[feature].ts`

---

## Phase 2: Foundational (Blocking Package Prerequisites)

**Purpose**: Core schema, authorization, and scope infrastructure that MUST be complete before ANY user story in this package can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Write failing contract and migration tests for foundational schema and scope isolation (`[FR-WM-04, C-02]`) in `packages/db/test/[feature].contract.test.ts`
- [ ] T005 Implement database migration and repository queries with explicit `(source_id, revision)` snapshot checks (`[FR-WM-04, C-02]`) in `packages/db/src/[feature].ts`
- [ ] T006 [P] Implement server-side authorization and role-phasing middleware (`[FR-WM-04, NFR-SEC-02]`) in `apps/api/src/middleware/[auth].ts`

**Checkpoint**: Foundation ready — user story test-first implementation can now begin

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers and its SRS IDs]

**Independent Test**: [How to verify this story works on its own against its Gherkin scenarios]

### Tests for User Story 1 (MANDATORY, test-first — `CC-02`) ⚠️

> **NOTE: Write these spec-derived tests FIRST and observe requirement-related failures before starting implementation**

- [ ] T010 [P] [US1] Contract test for `[endpoint/schema]` including boundary and over-limit rejection (`[SRS-ID]`) in `apps/api/test/contract/[name].contract.test.ts`
- [ ] T011 [P] [US1] Integration test for Gherkin scenarios and explicit `S_aktiv` scope enforcement (`[SRS-ID, NFR-EVAL-04]`) in `apps/api/test/integration/[name].integration.test.ts`

### Implementation for User Story 1

- [ ] T012 [P] [US1] Implement domain validation and Unicode code-point / byte / word limit checks (`[SRS-ID]`) in `apps/api/src/domain/[entity].ts`
- [ ] T013 [US1] Implement service / pipeline logic through `C-02 ScopedContextProvider` (`[SRS-ID, C-02]`) in `apps/api/src/services/[service].ts` (depends on T010, T011, T012)
- [ ] T014 [US1] Implement API route handler with server-side auth and error handling (`[SRS-ID]`) in `apps/api/src/routes/[route].ts`
- [ ] T015 [US1] Implement UI state and user interaction flow (`[SRS-ID]`) in `apps/web/src/features/[feature]/[component].tsx`

**Checkpoint**: User Story 1 spec-derived tests pass (`Green`) and story is independently verifiable

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers and its SRS IDs]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 (MANDATORY, test-first — `CC-02`) ⚠️

- [ ] T016 [P] [US2] Contract test for `[endpoint/schema]` (`[SRS-ID]`) in `apps/api/test/contract/[name].contract.test.ts`
- [ ] T017 [P] [US2] Integration test for Gherkin scenarios including mid-flight source deletion/revocation (`[SRS-ID]`) in `apps/api/test/integration/[name].integration.test.ts`

### Implementation for User Story 2

- [ ] T018 [P] [US2] Implement domain model and state transitions (`[SRS-ID]`) in `apps/api/src/domain/[entity].ts`
- [ ] T019 [US2] Implement service / worker handler (`[SRS-ID]`) in `apps/worker/src/handlers/[handler].ts` (depends on T016, T017, T018)
- [ ] T020 [US2] Integrate UI and API endpoints (`[SRS-ID]`) in `apps/web/src/features/[feature]/[component].tsx`

**Checkpoint**: User Stories 1 AND 2 both pass all spec-derived tests independently

---

[Add more user story phases as needed, following the same test-first pattern]

---

## Phase N: Polish, Eval Gates & Cross-Cutting Concerns

**Purpose**: Package-wide deterministic/LLM eval verification, upstream spec flow-back synchronization, and release-gate readiness

- [ ] TXXX [P] Verify deterministic citation-ID (`NFR-EVAL-02` = 1.0) and zero-leakage (`NFR-EVAL-04` = 0) eval suites in `packages/evals/test/[feature].eval.test.ts`
- [ ] TXXX [P] Verify LLM-judged faithfulness (`NFR-EVAL-01` < 5 %) and refusal (`NFR-EVAL-03` ≥ 99 %) suites (if touching retrieval, prompt, or chat) in `packages/evals/test/[feature].judged.test.ts`
- [ ] TXXX Verify Flow-back spec synchronization (`CC-01`): confirm any clarifications, contract/limit refinements, or implementation/convergence edge cases are flowed back into `specs/[###-feature-name]/spec.md` and upstream into `spec/requirements/v[N]/package_[N]_[M]_[name].md`, the SRS, `docs/solution-architecture.md` (`Dn`), and GitHub issues
- [ ] TXXX Run `quickstart.md` end-to-end validation and `node scripts/check-spec-integrity.mjs` (`Gate v[N].0`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Depends on within-release prerequisites from `spec/requirements/README.md`
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories in this package
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - Within each story: **Spec-derived tests MUST be written and observed failing (`Red`) before implementation (`Green → Refactor`)**
- **Flow-Back on Reality Gaps (`/speckit-implement` & `/speckit-converge`)**: When implementation or convergence uncovers reality gaps, unstated edge cases, or feasibility constraints, flow the resolution back to `spec.md` AND upstream to the FR card / SRS / `docs/solution-architecture.md` (`Dn`), then rerun `/speckit-analyze` before completing implementation rather than only patching code or appending unbacked tasks
- **Polish & Eval Gates (Final Phase)**: Depends on all user stories and any upstream spec flow-back updates in the package being complete

### Parallel Opportunities (`[P]`)

- `[P]` is permission to parallelize only after prerequisites and shared contracts (`C-01..C-03`) are fixed and file ownership is disjoint
- Pass failing spec-derived tests to the implementation owner before implementation starts
- Qualify all task references by spec path (`specs/[###-feature-name] T001`) in handoffs, commits, and GitHub issues
