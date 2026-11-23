# Phase 0 Research: Studio Active Learning Suite (Package 4.1)

**Feature**: `specs/014-studio-active-learning-suite`
**Package**: Package 4.1 (`FR-ST-13`, `FR-ST-14`, `FR-ST-15`, `FR-ST-12`, `C-01..C-03`, `Gate v4.0 #1..#2`)
**Date**: 2026-11-16

## Decision 1: Reusing `C-03` Durable Studio Outbox, Leases & Evidence Batching

- **Decision**: Extend `StudioPluginTypeSchema` (`report`, `mindmap`, `data_table`, `flashcards`, `quiz`, `learning_overview`) additively in `packages/contracts/src/package-v3-3.ts` / `package-v4-1.ts` and register three independent `C-03` plugins in `apps/worker/src/studio/registry.ts`, leaving `reports`, `mindmaps`, and `data_table` plugins untouched.
- **Rationale**: `PostgresStudioArtifactRepository` already enforces atomic `Queued` + `jobs` outbox insertion for `pluginType !== "report"`, row-locked lease claims (`claimExecution`), heartbeat renewal (`renewLease`), publication fences (`completeWithFence` checking source ownership and `active_revision`), and `sweepInterruptedStudioArtifacts` exclusion for non-report kinds.
- **Boundary impact (`CC-09`)**: `apps/api/src/v2/runtime.ts` already invokes `createStudioPluginRegistry({ ..., structureGenerator })` from `@everlast/worker/studio/registry`. Registering the new plugins inside `createStudioPluginRegistry` exposes them to both API inline/durable runs and `apps/worker/src/server.ts` without adding any new `@everlast/worker/*` imports to `apps/api/` or modifying `scripts/architecture-policy.json`.

## Decision 2: Per-User `LearningProgress` Persistence (`0013_studio_active_learning.sql`)

- **Decision**: Add migration `packages/db/migrations/0013_studio_active_learning.sql` widening `studio_artifacts` kind/subtype constraints and creating `learning_progress` (`PRIMARY KEY (user_id, artifact_id)`) with cascade deletes to `users`, `studio_artifacts`, and `notebooks`.
- **Rationale**: Storing `item_states_json` (`{ [item_id]: { status, attempts, last_reviewed_at } }`) per `(user_id, artifact_id)` satisfies `FR-ST-15` cross-session persistence (`Gate v4.0 #2`), keeps multi-user isolation ready for `v6.0`, and preserves atomic upsert semantics under PostgreSQL row locks.
- **Alternatives rejected**: Browser `localStorage` only (rejected: loses state across reloads/devices and fails `Gate v4.0 #2` server persistence).

## Decision 3: Deterministic + Rubric-Guarded Semantic Quiz Grading

- **Decision**: Implement `apps/api/src/studio/quiz-grader.ts` inside `apps/api` (per SRS §4.1: `everlast-api` hosts quiz Short Answer semantic grading using `Flash-Lite` / `StructuredGenerator` with deterministic guardrails).
- **Rationale**:
  1. `multiple_choice` and `multiple_select` use deterministic option-ID set comparison (`<= 50 ms`).
  2. `fill_in_the_blank` and `short_answer` validate `1..1,000` trimmed Unicode code points without truncation, screen deterministically for prompt-injection / rubric-override payloads (marking them `Incorrect`), apply canonical numeric/unit normalization (`0.2 GB` == `200 MB` == `200 megabytes`), and optionally invoke `StructuredGenerator` (`flash-lite`) bounded by a `1,500 ms` deadline with strict rubric-only instruction and deterministic fallback.
- **KPI sanity (`D24` / `DEV-07`)**: Elapsed guardrail constants are named `MC_GRADING_MAX_ELAPSED_MS = 50` and `SHORT_ANSWER_GRADING_MAX_ELAPSED_MS = 1500` so `scripts/check-kpi-sanity.mjs` never misclassifies them as buffered LLM P95 latency gates.

## Decision 4: Server-Side `S_aktiv` Scope Guard for Flashcard & Quiz `"Explain"`

- **Decision**: Mirror `apps/api/src/studio/drilldown.ts` in `apps/api/src/studio/explain.ts`: resolve `item_id` strictly from the authorized `Completed` artifact payload, verify all supporting `(source_id, revision)` pairs against the caller's explicit `active_source_ids` via `readScope` BEFORE building any prompt, and throw `StudioSupportingSourcesRequiredError` (`409 SupportingSourcesRequired`) when any supporting source/revision is missing.
- **Rationale**: Prevents deselected or replaced source material from leaking into grounded chat prompts or conversation history (`FR-GC-01`, `NFR-EVAL-04`, `Gate v4.0 #1`).

## Decision 5: Shared `D9` Deterministic SVG Concept Diagram Rendering for `FR-ST-12`

- **Decision**: Implement `renderDeterministicConceptDiagramSvg` and `validateSafeDeterministicSvg` in `packages/contracts/src/package-v4-1.ts` so both `apps/worker` generation/validation and tests share one deterministic SVG renderer and sanitizer (`D9`).
- **Rationale**: Guarantees legible line-wrapped labels, dynamically sized non-overlapping boxes, `"AI-generated · Illustration"` attribution, XML escaping, and zero active script/event/external-URL vectors without requiring Package 4.2's standalone infographic layouts (`FR-ST-17`) ahead of Stage 2. In `apps/web/src/studio/learning-overview-viewer.ts`, browser DOM rendering (`buildSafeSvgElement`) parses the sanitized SVG through an allowlisted primitive/attribute token parser using `createElementNS` (without `innerHTML`), stripping any disallowed elements or attributes before attaching to the DOM.
- **Browser build constraint**: `scripts/build-web.mjs` compiles `apps/web` to raw browser ESM with no bundler, so `apps/web/src/**` MUST use `import type` only for `@everlast/contracts` and keep any browser constants local.
