# Tasks: Proactive Context Intelligence & Chat Control

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/interfaces.md](contracts/interfaces.md), [quickstart.md](quickstart.md), [checklists/requirements-quality.md](checklists/requirements-quality.md).
**Package Source**: [Package 2.2](../../spec/requirements/v2/package_2_2_proactive_context_intelligence_chat_control.md) + [binding rules](../../spec/requirements/README.md).
**SRS IDs in scope**: `FR-SI-02`, `FR-GC-04`, `FR-GC-05`, `FR-GC-07`, `FR-GC-09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02`, `NFR-EVAL-04`, `Gate v2.0 #1/#2`.
**Branch/worktree**: `006-source-guide-chat-control` at `wt/006`. References in commits/handoffs use `[006-source-guide-chat-control] Tnnn`.

Tests are mandatory under Constitution II/`CC-02`: each spec-derived test must first fail for the expected behavior, then pass after implementation. Do not call missing imports/configuration a Red result. Every source read uses C-02 with explicit Ready IDs and the captured `(source_id, revision)` snapshot. The structured model client is injected; tests use deterministic fakes. Map-backed persistence is a test/local adapter, not production durability. No real enterprise endpoint is configured by this task plan; local timing is not cloud P95 evidence.

## Phase 1: Setup and shared contracts

- [X] T001 Verify and record the v1 release-gate evidence and Package 2.1 language-preference prerequisite in `specs/006-source-guide-chat-control/validation.md` (`Gate v1.0`, `FR-WM-02/03`, `FR-UI-02`). Result: keyless deterministic eval passes 29/29; prior upload/citation evidence and Package 2.1 prerequisite remain upstream release evidence.

## Phase 2: Foundational Zod contracts and repository

**Purpose**: Establish package-specific DTOs and isolated in-memory persistence; do not redefine C-01/C-02.

- [X] T002 Write/run failing contract tests for strict schemas, stable Save-to-note shape, enum errors and every Unicode-code-point boundary in `packages/contracts/test/package-v2-2.test.ts` (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02`). Cover <50/≥50 words; 1–3/5–10 topics ≤40; 3–5 starter prompts ≤120; 0–3 follow-ups ≤100; custom instructions 0/1/5,000/5,001; feedback comments 0/1,000/1,001; stable request/response keys and citation DTO shape.
- [X] T003 Implement package-only Zod DTOs in `packages/contracts/src/package-v2-2.ts` and add one export line in `packages/contracts/src/index.ts` (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02`); pass T002 without changing shared C-01/C-02 files.
- [X] T004 Write/run failing repository tests for tenant/notebook isolation, exact-scope cache keys, guide/overview status, per-user configuration, feedback upsert, save-note idempotency and chat-independent note persistence in `packages/db/test/package-v2-2.test.ts` (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `NFR-EVAL-04`).
- [X] T005 Implement Map-backed Package 2.2 repository methods and `resetPackageV22Store` in `packages/db/src/package-v2-2.ts`; add one export in `packages/db/src/index.ts` (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `NFR-EVAL-04`) and pass T004. Keep maps keyed by notebook plus user/source/revision/message; never use a global unscoped content key.

## Phase 3: User Story 1 — Understand a source and start a grounded conversation (Priority: P1)

**Goal**: Generate a source-isolated guide on Ready, expose guide state without blocking full-text viewing, and send selected topics through grounded chat (`FR-SI-02`, `C-02`, Gate v2.0 #1).
**Independent Test**: Worker tests use a known Ready source and deterministic model fake; assert singleton scope, summary/topics limits, valid supporting chunk IDs, retries/failure status and no change to chat selection.

### Tests (Red first)
- [X] T006 Write/run failing pipeline and Ready-trigger tests in `apps/worker/test/package-v2-2.test.ts` (`FR-SI-02`, `C-02`, `NFR-EVAL-04`, Gate v2.0 #1). Cover explicit `[source_id]` reads, revision/auth recheck, full and <50-word source constraints, no unsupported padding/foreign chunk IDs, at most 3 attempts with 100 ms then 200 ms delays for transient failures only, exhausted failure preserving Ready text access, asynchronous scheduling after Ready, and the local deterministic-fake budget against <10 s.
- [X] T007 [P] Write/run failing Source Guide API tests in `apps/api/test/package-v2-2.test.ts` (`FR-SI-02`, `FR-WM-04/05`, `C-02`): owner-authenticated Ready source read, pending/failed result, foreign notebook/source rejection and no selection mutation.
- [X] T008 [P] Write/run failing Source Guide presentation and topic-dispatch tests in `apps/web/test/source-guide.test.ts` (`FR-SI-02`): collapsed guide appears before full text, open/closed state, topic click sends focused grounded query, and failure leaves document viewing available.

### Implementation (Green → Refactor)
- [X] T009 Implement deterministic Source Guide pipeline, injected model client/fake, bounded retry and Ready scheduling adapter in `apps/worker/src/package-v2-2.ts` and `apps/worker/src/ingestion/pipeline.ts` (`FR-SI-02`, `C-02`, `NFR-EVAL-04`, Gate v2.0 #1); pass T006. Persist GuidePending/GuideReady/GuideFailed and validate scope/support IDs before publish.
- [X] T010 Implement owner-authenticated Source Guide read route and server dispatch in `apps/api/src/routes/package-v2-2.ts` and `apps/api/src/server.ts` (`FR-SI-02`, `FR-WM-04/05`, `C-02`); pass T007 without exposing an unscoped source-read route.
- [X] T011 Implement Source Guide panel/controller and grounded topic action in `apps/web/src/source-guide.ts` (`FR-SI-02`); pass T008 and preserve the existing inspector's singleton viewing scope.

## Phase 4: User Story 2 — Get an overview of selected sources (Priority: P1)

**Goal**: Synthesize notebook overview and starter prompts only from the current selected, authorized Ready source revisions (`FR-GC-04`, `C-02`, `NFR-EVAL-04`).
**Independent Test**: Generate for `[A,B]`, change to `[A]`, and prove stale overview is hidden immediately and replacement content/support IDs contain no B data; empty scope clears content.

### Tests (Red first)
- [X] T012 Write/run failing overview pipeline tests in `apps/worker/test/package-v2-2.test.ts` (`FR-GC-04`, `C-02`, `NFR-EVAL-04`): explicit nonempty scope, snapshot/cache identity including auth/language/parameters, 3–5 supported prompts ≤120, valid supporting chunk IDs, stale revision/access failure, another-user isolation, empty/deleted selection behavior, and local deterministic-fake generation within 6 s.
- [X] T013 Write/run failing overview route tests in `apps/api/test/package-v2-2.test.ts` (`FR-GC-04`, `C-02`, `NFR-EVAL-04`) for empty-scope rejection, prompt DTO and stale snapshot fail-closed response.
- [X] T014 Write/run failing overview controller/presentation tests in `apps/web/test/chat-control.test.ts` (`FR-GC-04`, `C-02`): show notebook summary and count, immediately clear stale data on scope/language change, empty state, and starter prompt dispatch as a grounded user turn.

### Implementation (Green → Refactor)
- [X] T015 Implement scoped overview pipeline and exact cache-key derivation in `apps/worker/src/package-v2-2.ts` (`FR-GC-04`, `C-02`, `NFR-EVAL-04`); pass T012. Read only through C-02; reject empty scope and stale revisions.
- [X] T016 Implement overview API endpoint and snapshot error mapping in `apps/api/src/routes/package-v2-2.ts` (`FR-GC-04`, `C-02`, `NFR-EVAL-04`); pass T013.
- [X] T017 Implement notebook overview state/render and starter-prompt action in `apps/web/src/chat-control.ts` (`FR-GC-04`, `C-02`); pass T014.

## Phase 5: User Story 3 — Continue exploring after an answer (Priority: P2)

**Goal**: Offer no more than three answerable follow-ups after completed responses and hide them during streaming or after scope changes (`FR-GC-05`, `C-02`, `NFR-EVAL-04`).
**Independent Test**: Test three supported suggestions, fewer than three when evidence is insufficient, refusal recovery topics, streaming hiding and stale-scope invalidation.

### Tests (Red first)
- [X] T018 Write/run failing follow-up pipeline tests in `apps/worker/test/package-v2-2.test.ts` (`FR-GC-05`, `C-02`, `NFR-EVAL-04`): post-completion only, 0–3 unique answerable chips ≤100, valid support IDs, refusal suggestions based only on scoped sources, stale revision failure and no unsupported padding, and local deterministic-fake generation within 1 s after completion.
- [X] T019 Write/run failing follow-up state and click tests in `apps/web/test/chat-control.test.ts` (`FR-GC-05`, `C-02`): hidden during streaming, current scope signature required, clear immediately on scope changes, chip click submits next grounded turn.

### Implementation (Green → Refactor)
- [X] T020 Implement scoped follow-up generation and assistant-message metadata persistence in `apps/worker/src/package-v2-2.ts` (`FR-GC-05`, `C-02`, `NFR-EVAL-04`); pass T018 and enforce ≤1 s local post-completion budget without claiming production P95.
- [X] T021 Implement follow-up chip state and rendering in `apps/web/src/chat-control.ts` (`FR-GC-05`, `C-02`); pass T019.

## Phase 6: User Story 4 — Configure chat behavior (Priority: P2)

**Goal**: Save per-owner notebook style/length preferences, apply them to later turns, and preserve non-overridable grounding/citation constraints (`FR-GC-07`, `FR-GC-01/02`).
**Independent Test**: Accept default/presets and custom instructions at the exact Unicode boundaries; reject empty/over-limit values without overwriting prior state; inspect subsequent grounded chat input.

### Tests (Red first)
- [X] T022 Write/run failing chat configuration API and agent tests in `apps/api/test/package-v2-2.test.ts` and `apps/api/test/chat-config.test.ts` (`FR-GC-07`, `FR-GC-01/02`, `FR-WM-04`): owner isolation, defaults, invalid config retention, persistence and prompt construction that cannot disable grounding/citations.
- [X] T023 Write/run failing configuration modal/state tests in `apps/web/test/chat-control.test.ts` (`FR-GC-07`): style/length selections, custom-only field, code-point counter, invalid-save retention and active header indication.

### Implementation (Green → Refactor)
- [X] T024 Implement owner/notebook configuration API and integrate saved style/length with subsequent grounded turns in `apps/api/src/routes/package-v2-2.ts` and `apps/api/src/chat/agent.ts` (`FR-GC-07`, `FR-GC-01/02`, `FR-WM-04`); pass T022; never insert custom text as an override to guardrails.
- [X] T025 Implement chat configuration controller/modal/header indicator in `apps/web/src/chat-control.ts` (`FR-GC-07`); pass T023 and keep saved values on invalid input.

## Phase 7: User Story 5 — Reuse and rate chat responses (Priority: P1)

**Goal**: Copy formatted responses, persist per-user feedback, and idempotently save read-only notes with citations (`FR-GC-09`, `FR-NM-02`, `FR-WM-04/05`).
**Independent Test**: Verify copy variants, all feedback categories and bounds, caller/message authorization, note content/citations, duplicate response and independence from chat deletion.

### Tests (Red first)
- [X] T026 Extend repository tests first in `packages/db/test/package-v2-2.test.ts` (`FR-GC-09`, `FR-NM-02`): feedback record/upsert per message/user, save only assistant messages, title/body/citation preservation, duplicate returns same note, and saved note survives chat clear.
- [X] T027 Write/run failing response-action API tests in `apps/api/test/package-v2-2.test.ts` (`FR-GC-09`, `FR-NM-02`, `FR-WM-04/05`, `NFR-EVAL-02`): caller owns assistant message, note creation Owner-only, identical repeat response, categories/comment 0/1,000/1,001 and citation validation.
- [X] T028 Write/run failing web action tests in `apps/web/test/chat-control.test.ts` (`FR-GC-09`, `FR-NM-02`): copy with/without badge markers (preserve answer text), toast, active rating, negative category/comment flow, pending-save disabling and saved note display; check local copy/feedback ≤200 ms and note display ≤300 ms without claiming production latency.

### Implementation (Green → Refactor)
- [X] T029 Implement feedback/save-note repository operations in `packages/db/src/package-v2-2.ts` (`FR-GC-09`, `FR-NM-02`); pass T026 with idempotency `(authenticated user_id, source_message_id)` and note/chat lifecycle separation.
- [X] T030 Implement feedback and stable shared save-note routes in `apps/api/src/routes/package-v2-2.ts` (`FR-GC-09`, `FR-NM-02`, `FR-WM-04/05`, `NFR-EVAL-02`); pass T027 and use the exact request/response shape in `contracts/interfaces.md` and both package cards.
- [X] T031 Implement copy, feedback and save-to-note response controls in `apps/web/src/chat-control.ts` (`FR-GC-09`, `FR-NM-02`); pass T028, strip only citation badge markers in the no-citation variant, and preserve original content/citation links for saved notes.

## Phase 8: Polish, flow-back and validation

- [X] T032 Write/run a failing web integration test that proves the Source Guide, overview, follow-up, configuration and response-action modules are reachable in the real application shell in `apps/web/test/package-v2-2.integration.test.ts` (`FR-SI-02`, `FR-GC-04/05/07/09`).
- [X] T033 Wire the Package 2.2 modules into `apps/web/src/main.ts` and its existing presentation entry points (`FR-SI-02`, `FR-GC-04/05/07/09`); pass T032.
- [X] T034 Run focused Package 2.2 contract, DB, worker, API and web Vitest suites from `specs/006-source-guide-chat-control/quickstart.md`; record exact commands/results and distinguish deterministic timing from cloud P95 in `specs/006-source-guide-chat-control/validation.md` (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`, `C-02`, `NFR-EVAL-02/04`).
- [X] T035 Verify stable save-note shape and all implementation refinements flow back to `spec.md` and the Package 2.2/2.3 cards; rerun `node scripts/check-spec-integrity.mjs` and `git diff --check` (`CC-01`, `FR-GC-09`, `FR-NM-02`).
- [X] T036 Run `pnpm typecheck`, `pnpm lint`, and targeted feature tests; assess source-scope/citation leakage and Owner authorization; record exact results in `specs/006-source-guide-chat-control/validation.md` (`Gate v2.0 #1/#2`, `NFR-EVAL-02/04`, `FR-WM-04/05`). Do not claim Gate v2.0 #2 passed until Package 2.3 FR-NM-03 converts the saved note and the next chat turn cites that source.

## Dependencies and execution order

- Phase 1 prerequisite verification blocks all implementation. Phases 2 contract/repository tests precede their implementations and block user stories.
- User Story 1 → User Story 2 → User Story 3 → User Story 4 → User Story 5 follows package integration order and shared route/worker module sequencing; each story's Red tests precede its implementation.
- Within a story, tests in disjoint worker/API/web files may run in parallel (`[P]`); edits to the same `package-v2-2.ts`, `chat-control.ts`, route or shared export are serialized.
- Every task ID referenced outside this file must use `[006-source-guide-chat-control] Tnnn`.
- Package 2.3 owns note conversion and the full Gate v2.0 #2 roundtrip. This feature implements the shared FR-GC-09/FR-NM-02 note contract only.

## Implementation strategy

Deliver the P1 Source Guide first, then P1 Overview and P1 response actions, while keeping P2 follow-ups and chat controls separate. Do not skip tests to ship an early slice. The smallest MVP demonstration is a Ready source with a generated Guide and grounded topic click; complete Package 2.2 delivery also requires all five user stories and the listed verification tasks.

## Phase 9: Convergence

- [ ] T037 Bind Package 2.2 worker source reads and publication rechecks to the canonical shared `ScopedContextProvider` contract; remove or adapt the unconnected package-specific reader boundary and prove exact Ready ID/revision/auth snapshots in worker tests per Constitution III/IV and C-02 (partial, CRITICAL).
- [ ] T038 Complete Package 2.2 application composition for worker and API runtime: supply the authorized reader, injected structured generator, Ready-trigger scheduling, overview/follow-up dependencies, and authenticated chat route; verify the shell’s required endpoints are available with deterministic local adapters and fail closed without production configuration per FR-SI-02, FR-GC-01/02/04/05, C-02 (partial, CRITICAL).
- [ ] T039 Load and mount the owner-authorized Ready source list and selection controller from the notebook shell; publish initial and subsequent exact revision snapshots to Source Guide, overview, and follow-up controllers per FR-SI-02, FR-GC-04/05, C-02 (partial, HIGH).
- [ ] T040 Render the full saved-response note, title, and preserved citation links in the Right/Studio Panel after the stable `/note` response; cover zero-citation and idempotent repeat saves per FR-GC-09, FR-NM-02 (partial, HIGH).
- [ ] T041 Persist follow-up suggestions with the latest assistant message and its source/revision snapshot; retrieve only current, authorized suggestions and invalidate them on scope changes per FR-GC-05, FR-020, C-02 (partial, HIGH).
- [ ] T042 Render the required populated notebook identity and the “Add a source to get started” empty state, clearing it synchronously on scope/source deletion per FR-GC-04, FR-GC-06/07 (partial, MEDIUM).
- [ ] T043 Add an optional 0–1,000 Unicode-code-point comment field to negative-feedback UI, submit it with the selected category, and retain the active rating state per FR-GC-09, FR-014 (partial, MEDIUM).
- [ ] T044 Display the active style and response length (not a generic active-preferences label) in the chat header after configuration load/save per FR-GC-07, FR-010 (partial, MEDIUM).
- [ ] T045 Add deterministic local timing and stale/revoked-scope cache tests for Source Guide, overview, follow-ups, copy/feedback, and saved-note rendering; document local-only evidence without claiming cloud P95 per SC-001–005, NFR-EVAL-04 (partial, MEDIUM).
- [ ] T046 Flow the `source_word_count` DTO and hashed authorization partition refinements into `plan.md`, then refresh `analysis.md` for bidirectional traceability per Constitution I, CC-01 (partial, MEDIUM).
