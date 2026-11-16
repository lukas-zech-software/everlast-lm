# Implementation Plan: Studio Active Learning Suite (Package 4.1)

**Branch**: `feat/v4-014-studio-active-learning-suite` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v4/package_4_1_studio_active_learning_suite.md`
**SRS IDs in Scope**: `FR-ST-13`, `FR-ST-14`, `FR-ST-15`, `FR-ST-12`, `C-01`, `C-02`, `C-03`, `FR-SI-03`, `FR-SI-05`, `FR-GC-01`, `FR-GC-02`, `FR-GC-06`, `FR-UI-02`, `NFR-SEC-01`, `NFR-SEC-02`, `NFR-EVAL-01`, `NFR-EVAL-02`, `NFR-EVAL-03`, `NFR-EVAL-04`, `Gate v4.0` | **Release Gate**: `Gate v4.0 #1`, `Gate v4.0 #2`
**Input**: Feature specification from `/specs/014-studio-active-learning-suite/spec.md`

## Summary

Deliver Stage 1 of Release `v4.0` (Package 4.1) by adding three independent `C-03` Studio plugins (`flashcards`, `quiz`, `learning_overview`), server-side per-user `LearningProgress` persistence in PostgreSQL (`0013_studio_active_learning.sql`), rubric-guarded deterministic + Flash-Lite semantic quiz grading, `S_aktiv`-guarded `"Explain"` chat handoff (`409 SupportingSourcesRequired` when supporting sources are missing), deterministic `D9` SVG concept diagrams inside `learning_overview` (failing atomically if any required block fails), and interactive Right Panel viewers (`flashcards-viewer`, `quiz-viewer`, `learning-overview-viewer`) without modifying existing `report`, `mindmap`, or `data_table` plugins or touching Package 4.2 (`FR-ST-16`, `FR-ST-17`).

## Technical Context

**Language/Version**: TypeScript (strict ESM) on Node.js 26 (`pnpm` workspaces); browser-native DOM/SVG compiled via `tsc` (`apps/web/tsconfig.build.json`) with type-only contract imports.
**Primary Dependencies**: Zod (`packages/contracts`), `@everlast/cloud` (`StructuredGenerator` for Flash / Flash-Lite), Cloud Run services, PostgreSQL 16 + `pgvector` (`packages/db`). No new third-party frameworks or dependencies added.
**Storage**: Single Cloud SQL / PostgreSQL 16 instance (`studio_artifacts` widened via additive `0013_studio_active_learning.sql` + new `learning_progress` table with `(user_id, artifact_id)` primary key and cascade deletes).
**Authentication & Residency**: Identity Platform generic OIDC/SAML (`D6`); strictly Owner-only in `v4.0` (`FR-WM-04`, `NFR-SEC-02`); `europe-west4` storage/compute and EU (`europe-west4` / `eu`) enterprise no-training Gemini endpoints (`D3`, `D23`, `NFR-SEC-01`).
**Execution Model**: Deterministic worker pipelines (`flashcards`, `quizzes`, `learning-overview`) over all original `C-02` chunks (`D12`), rubric-guarded semantic grading in `apps/api/src/studio/quiz-grader.ts`, and `S_aktiv`-guarded `"Explain"` chat persistence via `apps/api/src/studio/explain.ts`.
**Performance Goals**: Flashcards 20-card deck `<= 15.0 s` P95 (`FR-ST-13`), deterministic MC/MS grading `<= 50 ms` elapsed, semantic free-text grading `<= 1,500 ms` (`<= 1.5 s`) elapsed (`FR-ST-14`), composite Learning Overview `<= 30.0 s` P95 (`FR-ST-12`), calibrated under `D24` / `DEV-07`; passes `node scripts/check-kpi-sanity.mjs --include-specs --strict`.
**Constraints**: `focus_prompt` `0..1,000` trimmed Unicode code points; `short_answer`/`fill_in_the_blank` `1..1,000` trimmed Unicode code points (over-limit rejected, never truncated); `flashcards` targets `10`/`20`/`35` (`fewer`/`standard`/`more`); `quiz` targets `5..25` (default `10`); `learning_overview` targets `3..6` modules; evidence-limited outputs explain gaps via `insufficient_evidence_note` or refuse (`InsufficientEvidence`); `learning_overview` fails atomically on any missing/invalid block.
**Within-Release Prerequisites**: Consumes existing `C-01` multimodal chunks, `C-02` snapshot/scope provider, `FR-UI-02` output language resolution, and `C-03` durable Studio outbox/lease/fence infrastructure from `v1`–`v3`. Package 4.2 (`FR-ST-16`, `FR-ST-17`) runs subsequently as Stage 2.

## Constitution Check (`CC-01`..`CC-09`)

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | `PASS` | `PASS` | Every spec requirement, plan boundary, task (`T001`–`T039`), and test cites `FR-ST-12..15`, `C-01..03`, `NFR-EVAL-01..04`, or `Gate v4.0`; `Session 2026-11-16` clarifications synced to `package_4_1_studio_active_learning_suite.md`. |
| `CC-02` | **II. Test-First** | `PASS` | `PASS` | `tasks.md` schedules Red spec-derived unit, contract, DB integration, API, web, eval, and Playwright tests before every implementation task (`### Tests` precedes `### Implementation` in every User Story). |
| `CC-03` | **III. Scope & Snapshot** | `PASS` | `PASS` | Generation reads exclusively via `C-02` captured `(source_id, revision)` snapshots; `"Explain"` verifies current `active_source_ids` before prompt construction (`409 SupportingSourcesRequired`); zero `"All Ready"` server fallback. |
| `CC-04` | **III. Citations & Leakage** | `PASS` | `PASS` | Pre-publication validators (`flashcards`, `quizzes`, `learning-overview`) verify every `chunk_id` and substring snippet against scoped chunks (`D13`, `NFR-EVAL-02 = 1.0`); invalid citations refuse immediately; zero deselected-source leakage (`NFR-EVAL-04 = 0`). |
| `CC-05` | **IV. Contracts & Pipelines** | `PASS` | `PASS` | Shared Zod schemas and deterministic SVG renderer live once in `packages/contracts/src/package-v4-1.ts`; worker generators use deterministic structured pipelines without touching `report`, `mindmap`, or `data_table` plugins. |
| `CC-06` | **V. Release & Package Order** | `PASS` | `PASS` | Honors `v1`–`v3` foundations and Package 4.1 Stage 1 boundary; leaves Package 4.2 (`FR-ST-16`, `FR-ST-17`) and deferred items (`D5`, `D8`, `D10`) untouched. |
| `CC-07` | **VI. Security, RBAC & Residency** | `PASS` | `PASS` | Owner-only server-side checks on all artifact, grade, explain, and `learning_progress` endpoints; prompt-injection grading rejection; EU enterprise `StructuredGenerator` routing (`europe-west4` / `eu`); zero API key usage. |
| `CC-08` | **Platform & Cost** | `PASS` | `PASS` | Reuses pnpm TS workspace, PostgreSQL, existing Flash/Flash-Lite `StructuredGenerator`, and `StudioPluginRegistry`; zero new dependencies or fixed-idle services; passes `check-kpi-sanity --include-specs --strict`. |
| `CC-09` | **IV. Architectural Boundaries & Evidence** | `PASS` | `PASS` | Boundary table populated below; `scripts/architecture-policy.json` (88 legacy exceptions) untouched; zero new `@everlast/worker/*` imports in `apps/api/`; `@everlast/contracts` purity and `@everlast/web` browser-safety preserved. |

## Architecture Boundary Evidence (mandatory; CC-09)

Follow `docs/agent-architecture-guardrails.md`. Cite the assigned SRS IDs for every row.

| SRS / contract | Module path and owner | Responsibility | Public exports / ports | Allowed consumers / dependencies | Composition root | Regression evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `FR-ST-12..15`, `C-03`, `D9` | `packages/contracts/src/package-v4-1.ts` (plus additive extensions in `package-v3-3.ts`, `package-v2-4.ts`, `index.ts`); Stage 1 Package 4.1 | Shared Contracts, Evaluators & SVG Diagram Renderer | `StudioFlashcardsPayloadSchema`, `StudioQuizPayloadSchema`, `StudioLearningOverviewPayloadSchema`, `LearningProgressDtoSchema`, `GradeQuizQuestionRequestSchema`, `StudioExplainRequestSchema`, `renderDeterministicConceptDiagramSvg`, `validateSafeDeterministicSvg`, `verifyStudioCitations`, `validateFlashcardsPayload`, `validateQuizPayload`, `validateLearningOverviewPayload`, `gradeQuizQuestionDeterministic`, `isPromptInjectionAttempt`, `verifyExplainSupportingSources` | Imports only `zod` and `./...` contract modules (`contracts-only`); consumed by `db`, `worker`, `api`, `evals`, and type-only by `web` | `packages/contracts/src/index.ts` | `packages/contracts/test/package-v4-1.test.ts`, `packages/evals/test/studio-active-learning.eval.test.ts` |
| `FR-ST-12..15`, `C-03` | `packages/db/migrations/0013_studio_active_learning.sql`, `packages/db/src/studio-artifacts.ts`, `packages/db/src/index.ts`; Stage 1 Package 4.1 | Schema Migration & Studio Artifact Adapter | Widened `studio_artifacts` plugin check + `learning_progress` DDL; existing `PostgresStudioArtifactRepository` / `sweepInterruptedStudioArtifacts` | Imports `pg`, `@everlast/contracts`; consumed by `api` and `worker` | `packages/db/src/index.ts` | `packages/db/test/studio-active-learning.integration.test.ts` (0013 migration, atomic outbox, lease fencing, sweep exclusion) |
| `FR-ST-15`, `NFR-SEC-02` | `packages/db/src/learning-progress.ts`, `packages/db/src/index.ts`; Stage 1 Package 4.1 | Persistence Adapter (`LearningProgress`) | `LearningProgressRepository`, `PostgresLearningProgressRepository`, `InMemoryLearningProgressRepository`, `extractArtifactLearningItemIds` | Imports `pg`, `@everlast/contracts`; consumed by `apps/api/src/studio/service.ts` and `apps/api/src/v2/runtime.ts` | `apps/api/src/v2/runtime.ts` | `packages/db/test/studio-active-learning.integration.test.ts` (per-user isolation, upsert, reset, cascade delete) |
| `FR-ST-12..14`, `C-02`, `C-03`, `NFR-EVAL-02/04` | `apps/worker/src/studio/{flashcards,quizzes,learning-overview}/{model,pipeline,plugin,validation}.ts`, `apps/worker/src/studio/{registry,runner}.ts`; Stage 1 Package 4.1 | Job / Worker Pipelines & Validation Adapters | `FlashcardsGeneratorPlugin`, `QuizGeneratorPlugin`, `LearningOverviewGeneratorPlugin`, `createStudioPluginRegistry`, `DEFAULT_VALIDATORS` | Imports `@everlast/contracts`, `@everlast/cloud` (`StructuredGenerator`), `@everlast/db`, and `apps/worker/src/studio/evidence.ts`; zero app-to-app imports | `apps/worker/src/studio/registry.ts`, `apps/worker/src/server.ts`, existing `apps/api/src/v2/runtime.ts` edge | `apps/worker/test/{flashcards,quiz,learning-overview}.test.ts` |
| `FR-ST-13..15`, `FR-GC-01/02`, `NFR-SEC-02`, `NFR-EVAL-04` | `apps/api/src/studio/{explain,quiz-grader,service}.ts`, `apps/api/src/routes/studio.ts`, `apps/api/src/v2/runtime.ts`; Stage 1 Package 4.1 | Transport Handler & Application Workflows | `gradeQuizQuestion`, `executeStudioItemExplain`, `StudioService` methods (`getProgress`, `recordProgress`, `resetProgress`, `gradeQuiz`, `explainItem`), `handleStudioRoute` | Imports `@everlast/contracts`, `@everlast/db`, `@everlast/cloud` (`StructuredGenerator` interface); `routes/studio.ts` maps HTTP only; zero new `@everlast/worker/*` imports | `apps/api/src/v2/runtime.ts` | `apps/api/test/studio-quiz-grader.test.ts`, `apps/api/test/studio-active-learning.test.ts` |
| `FR-ST-12..15`, `Gate v4.0` | `apps/web/src/studio/{api,artifact-list,flashcards-viewer,quiz-viewer,learning-overview-viewer,panel}.ts`, `apps/web/src/workspace.css`; Stage 1 Package 4.1 | Browser UI Viewers & Client API | `createFlashcardsViewer`, `createQuizViewer`, `createLearningOverviewViewer`, `buildSafeSvgElement`, `createStudioApi`, `createStudioPanel` | Type-only imports from `@everlast/contracts`; allowlisted `buildSafeSvgElement` DOM/SVG token parser (`createElementNS`, no `innerHTML`); zero Node/server/db imports | `apps/web/src/studio/panel.ts`, `apps/web/src/workspace/index.ts` | `apps/web/test/{studio-flashcards,studio-quiz,studio-learning-overview}.test.ts`, `apps/web/test/studio-active-learning.spec.ts` |
| `FR-ST-12..15`, `NFR-EVAL-02/04`, `Gate v4.0 #1` | `packages/evals/src/studio-active-learning-eval.ts`, `packages/evals/src/cli.ts`; Stage 1 Package 4.1 | Deterministic Gate v4.0 #1 Evaluation Runner | `runStudioActiveLearningDeterministicEval` | Imports strictly `@everlast/contracts` and `@everlast/testkit/studio-structure-fixtures` (`no-shared-to-app` compliant; zero `apps/*` imports) | `packages/evals/src/cli.ts` (`mode === "deterministic"`) | `packages/evals/test/studio-active-learning.eval.test.ts` |

- **Workflow ownership**: `apps/api/src/routes/studio.ts` owns HTTP parsing, status mapping (`400 EmptyScopeError` / `UnsupportedOutputLanguage`, `409 SupportingSourcesRequired`, `422 ValidationError`, `403`/`404`), and JSON serialization. `StudioService` + `explain.ts` + `quiz-grader.ts` own authorization, snapshot capture/rechecks, grading orchestration, `LearningProgress` coordination, and `Explain` scope checks. `packages/db/src/learning-progress.ts` and `studio-artifacts.ts` own PostgreSQL transactions and row locks (`D16`, `C-02`, `C-03`). Worker plugins own bounded evidence extraction, SVG diagram synthesis, and pre-publication validation.
- **Simple CRUD rationale**: None — `GET/POST/DELETE .../progress` routes coordinate artifact ownership + item-ID membership validation in `StudioService` rather than bypassing directly from routes to DB.
- **Dependency review**: Inspected all imports across touched files: `packages/contracts/src/package-v4-1.ts` uses only `zod` and relative `./...` modules; `packages/evals/src/studio-active-learning-eval.ts` consumes shared domain evaluators/validators from `@everlast/contracts` and `@everlast/testkit/studio-structure-fixtures` with zero `apps/*` imports; `apps/web/src/studio/*` uses `import type` only for `@everlast/contracts`; `apps/api/src/v2/runtime.ts` and `apps/api/src/server.ts` keep all existing `@everlast/worker/...` import statements byte-for-byte unchanged and add zero new cross-app worker imports (`apps/worker/package.json` adds no new exports).
- **Legacy exceptions**: `scripts/architecture-policy.json` contains 88 exact legacy `T035` exceptions (owner `@lukas-zech-software`, decision `D21`, expiry `2027-02-05`). None are modified, widened, or duplicated by Package 4.1.
- **Check availability**: Automated checks (`node scripts/check-spec-integrity.mjs`, `ARCHITECTURE_BASE_REF=origin/main pnpm lint`, `node scripts/check-kpi-sanity.mjs --include-specs --strict`, `pnpm test:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`) are available locally and executed post-implementation. Live cloud GCP deployment eval runs remain `UNAVAILABLE` without cloud credentials and are not claimed (`D24` / `DEV-07`).

## Project Structure

### Documentation (this feature)

```text
specs/014-studio-active-learning-suite/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/interfaces.md
├── tasks.md
├── analysis.md
└── validation.md
```

### Source Code (repository root)

```text
packages/
├── contracts/
│   ├── src/{package-v4-1.ts,package-v3-3.ts,package-v2-4.ts,index.ts}
│   └── test/package-v4-1.test.ts
├── db/
│   ├── migrations/0013_studio_active_learning.sql
│   ├── src/{learning-progress.ts,studio-artifacts.ts,index.ts}
│   └── test/studio-active-learning.integration.test.ts
└── evals/
    ├── src/studio-active-learning-eval.ts
    └── test/studio-active-learning.eval.test.ts

apps/
├── worker/
│   ├── src/studio/{flashcards/*,quizzes/*,learning-overview/*,registry.ts,runner.ts}
│   └── test/{flashcards,quiz,learning-overview}.test.ts
├── api/
│   ├── src/studio/{explain.ts,quiz-grader.ts,service.ts}
│   ├── src/routes/studio.ts
│   ├── src/v2/runtime.ts
│   └── test/{studio-quiz-grader,studio-active-learning}.test.ts
└── web/
    ├── src/studio/{api,artifact-list,flashcards-viewer,quiz-viewer,learning-overview-viewer,panel}.ts
    ├── src/workspace.css
    └── test/{studio-flashcards,studio-quiz,studio-learning-overview}.test.ts,studio-active-learning.spec.ts
```

**Structure & File Ownership Decision**: All work is isolated to Package 4.1 (`specs/014-studio-active-learning-suite`). Package 4.2 files (`FR-ST-16`, `FR-ST-17`, `specs/015-*`) and `scripts/architecture-policy.json` are untouched.

## Complexity Tracking

No Constitution violations or new architecture deviations; `CC-01`–`CC-09` pass cleanly within the existing stack (`D2`, `D3`, `D4`, `D9`, `D12`, `D13`, `D16`, `D21`, `D23`, `D24`).
