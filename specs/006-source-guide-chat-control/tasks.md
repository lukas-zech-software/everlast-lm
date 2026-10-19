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

### Tests (Red before implementation)

- [X] T037 Write/run failing C-02 reader tests for exact principal, Ready IDs, revisions, foreign chunks and pre/post authorization changes in `apps/worker/test/package-v2-2-context.test.ts` (`C-02`, `NFR-EVAL-04`).
- [X] T038 Write/run failing deterministic runtime composition and Ready-callback tests in `apps/worker/test/package-v2-2-runtime.test.ts` (`FR-SI-02`, `FR-GC-04/05`, `C-02`).
- [X] T039 Write/run failing API tests for owner-authorized source listing, stale/current follow-up snapshots, persistence and unconfigured authenticated chat behavior in `apps/api/test/package-v2-2.test.ts` (`FR-SI-02`, `FR-GC-01/02/05`, `C-02`, `FR-WM-04/05`).
- [X] T040 Write/run failing authorized source-list loading and shell scope-publication tests in `apps/web/test/source-list-loader.test.ts` and `apps/web/test/package-v2-2.integration.test.ts` (`FR-SI-02`, `FR-GC-04/05`, `C-02`).
- [X] T041 Write/run failing full saved-note, citation-link, zero-citation and idempotent-render tests in `apps/web/test/saved-response-note.test.ts` (`FR-GC-09`, `FR-NM-02`).
- [X] T042 Write/run failing repository tests for message-keyed, owner-isolated follow-up persistence and exact snapshot validation in `packages/db/test/package-v2-2.test.ts` (`FR-GC-05`, `C-02`).
- [X] T043 Write/run failing optional negative-feedback comment tests for Unicode bounds, request payload and active rating in `apps/web/test/source-guide.test.ts` (`FR-GC-09`, FR-014).
- [X] T044 Write/run failing preference-load/header-label tests and notebook identity/empty-state presentation tests in `apps/web/test/source-guide.test.ts` and `apps/web/test/package-v2-2.integration.test.ts` (`FR-GC-07`, FR-GC-04/06, FR-010).
- [X] T045 Write/run failing deterministic local latency and revoked-scope-cache tests for guide, overview, follow-ups, copy/feedback and saved-note rendering in worker/web tests (`SC-001–005`, `NFR-EVAL-04`).
- [X] T046 Add test assertions for the `source_word_count` generation rule, hashed authorization partition, canonical C-02 runtime, and stable note/follow-up contracts (`CC-01`, `FR-SI-02`, `FR-GC-04/05`).

### Implementation (Green → Refactor)

- [X] T047 Bind worker reads and publication rechecks to the shared `ScopedContextProvider`, caller principal, exact Ready ID/revision snapshot and metadata (`C-02`, `NFR-EVAL-04`).
- [X] T048 Compose an injectable deterministic worker runtime and Ready callback; make unconfigured generation and authenticated chat fail closed (`FR-SI-02`, `FR-GC-01/02/04/05`, `C-02`, `FR-WM-04/05`).
- [X] T049 Add owner-authorized source-list API and mount the selection controller in the shell; publish initial/changed revision snapshots without mutating chat selection when a Source Guide is opened (`FR-SI-02`, `FR-GC-04/05`, `C-02`).
- [X] T050 Render the complete saved response, title and citation links in Studio; replace duplicate idempotent note renders (`FR-GC-09`, `FR-NM-02`).
- [X] T051 Persist follow-up metadata by authenticated owner/notebook/message with the exact assistant snapshot; reauthorize current Ready revisions before returning a cached suggestion (`FR-GC-05`, C-02).
- [X] T052 Display populated notebook identity/source count and the correct empty state; clear synchronously on empty scope or source deletion (`FR-GC-04/06/07`).
- [X] T053 Add the optional 0–1,000 Unicode-code-point feedback comment form and retain the active rating (`FR-GC-09`, FR-014).
- [X] T054 Load and display the specific active chat style and response length after configuration load/save (`FR-GC-07`, FR-010).
- [X] T055 Record local-only timing/cache evidence and refresh the focused quickstart/validation documentation without claiming cloud P95 (`SC-001–005`, `NFR-EVAL-04`).
- [X] T056 Flow runtime/DTO refinements into plan/contracts/data model and refreshed analysis; all convergence findings resolved (`CC-01`).

## Dependencies and execution order

- Tests T037–T045 precede implementation T047–T055. Documentation/analysis T046 and T056 close the traceability loop; all phase tasks are complete.
- Original Package 2.2 tasks T001–T036 remain unchanged and complete. Every task cites its SRS/constitution gate, and all task references outside this file use `[006-source-guide-chat-control] Tnnn`.
- Package 2.3 owns note conversion and the full Gate v2.0 #2 roundtrip. This feature implements the shared FR-GC-09/FR-NM-02 note contract only.

## Phase 10: Convergence

- [X] T057 Allow evidence-limited notebook overview prompt counts without unsupported padding per FR-005 (contradicts).
- [X] T058 Validate the one-sentence summary rule for sources under 50 words per FR-002 (partial).
- [X] T059 Require source-linked supporting chunk IDs for generated overview content per FR-020 (partial).

## Phase 11: Convergence

Assessed on 2026-10-20 against the revised Package 2.2 card (PR #127), SRS §5.4–5.6 (Gate v2.0 #1/#2, DEV-04, card review 2026-10-20), `docs/solution-architecture.md` (model routing, D3, D16) and the constitution. In-memory v2 storage in the single API process is the accepted v2 PoC store (D16 / DEV-04) and is not a gap; no PostgreSQL migration work is planned here. Tests precede their implementation tasks (Constitution II / `CC-02`); task references outside this file use `[006-source-guide-chat-control] Tnnn`.

### Flow-back (before any code task)

- [ ] T060 CRITICAL: Flow the revised Package 2.2 card back into `specs/006-source-guide-chat-control/spec.md`, i.e. transcribe its current EARS and edge cases, citing the SRS IDs on each change. FR-003: a topic chip sends to the user's current selection and shows a select-sources prompt when the inspected source is not selected. FR-001: the guide is generated in the notebook's effective output language, stored per (`source_id`, revision, output language), and generated on demand for another language. FR-018/SC-001: the trigger fires on every successful ingestion and timing is measured from `Ready`. FR-005: the client requests the overview for its browser-local selection and the server caches it by scope key. FR-008: chips sit above the chat input bar; each chip carries supporting chunk IDs validated against the current C-02 scope, and invalid chips are dropped. FR-010/Key Entities: `chat_config` (`style`, `custom_instructions`, `response_length`). FR-012: Shorter/Longer are measured once per release gate on the fixed 50-case sample. FR-014: one feedback record per user and message, the latest rating wins, and clicking the active thumb clears it. Shared save-note contract: title = preceding user question trimmed to 200 code points, or `Saved response`; body IDs must equal path IDs, else `400`; the route is the one shared with Package 2.3 and writes the single notes store. Per Constitution I / `CC-01` (`FR-SI-02`, `FR-GC-04/05/07/09`, `FR-NM-02`) (partial)
- [ ] T061 Flow the same refinements into `specs/006-source-guide-chat-control/plan.md`, `data-model.md`, `contracts/interfaces.md` and `quickstart.md`. Replace the "Cloud SQL production storage / Map-backed test adapter only" and "no model SDK" statements with D16 (v2 records in the single API process until v3; v2 background work runs in `apps/api/src/v2/runtime.ts`). Add the model routing (Flash-Lite with structured output via `@google/genai` on Vertex AI, `europe-west4`, keyless ADC). Add the language-keyed guide identity, the per-chip follow-up support IDs, feedback clearing, the save-note `400`/title rules, and the single shared notes store with Package 2.3. Per plan: storage/model decisions, D16, D3, `CC-01` (contradicts)

### Tests (Red first)

- [ ] T062 CRITICAL: Write failing web tests in `apps/web/test/source-guide.test.ts` and `apps/web/test/package-v2-2.integration.test.ts`. They prove that a topic-chip click sends a grounded turn with the current selection only when the inspected source is selected. Otherwise they prove it shows a select-sources prompt, sends nothing, and never changes or restores the selection. Per Constitution III (topic chips use current `S_aktiv`), `FR-SI-02` (missing)
- [ ] T063 CRITICAL: Write failing web tests in `apps/web/test/chat-control.test.ts` and `apps/web/test/package-v2-2.integration.test.ts`. Follow-up chips render in one row above the chat input bar, not inside the answer bubble. The row is removed as soon as a new stream starts or the selection, revisions or output language change. A chip from an earlier scope can never be clicked into a new turn. Per Constitution III (no deselected-source text in new prompts), `FR-GC-05`, US3/AC3 (contradicts)
- [ ] T064 CRITICAL: Write failing tests for language-keyed generation, in four places. `packages/db/test/package-v2-2.test.ts`: guide identity is (notebook, source, revision, output language), and a different language is a cache miss. `apps/worker/test/package-v2-2-runtime.test.ts`: `onSourceReady` generates in the notebook's effective output language (owner-set in v1–v5, `FR-UI-02`), not the hard-coded `en-US`. `apps/api/test/package-v2-2.test.ts`: the guide `GET` takes the effective or requested output language and starts on-demand generation (returning `202 GuidePending`) when no guide exists for that language. The same file also checks that follow-ups are generated in, and cached under, the effective output language. Per Constitution III (cache keys include output language), `FR-SI-02`, `FR-GC-05`, SRS §5.6 card review 2026-10-20 (contradicts)
- [ ] T065 CRITICAL: Write failing tests in `apps/worker/test/package-v2-2-gemini.test.ts` for a Vertex `StructuredGenerationClient`, using an injected fake `GoogleGenAI`. Check that it uses `vertexai: true`, `europe-west4` (`VERTEX_LOCATION` override as in `packages/cloud/src/embeddings.ts`), model `gemini-2.5-flash-lite`, and JSON structured output with a response schema. Check that no API key is passed or read (`GEMINI_API_KEY`/`GOOGLE_API_KEY` ignored). Check that 429/5xx/timeout errors are marked `transient` for the existing 3-attempt retry, and that invalid or non-schema JSON is permanent. Check that source text is passed as untrusted data. In `apps/api/test/` also check that `startApiServer`/`createV2Runtime` wire the client when Vertex is configured, so guide, overview and follow-ups stop answering `503`. Per `FR-SI-02`, `FR-GC-04/05`, plan: model routing, D3, `NFR-SEC-01` (missing; blocks P1 US1/US2)
- [ ] T066 Write failing API runtime tests in `apps/api/test/package-v2-2.test.ts`. A source that reaches `Ready` triggers Source Guide generation asynchronously even when no client ever lists the notebook's sources. The trigger fires once per (source, revision). Guide latency is measured from the `Ready` transition (an injected clock with the deterministic fake model stays under 10 s). A failed guide never blocks reading the source. Per Gate v2.0 #1, `FR-SI-02`, FR-018, SC-001 (partial)
- [ ] T067 Write failing API tests in `apps/api/test/package-v2-2.test.ts` for the shared `POST /api/notebooks/{notebook_id}/chat/messages/{message_id}/note`. The note it creates is the same record the Package 2.3 notes store lists (`GET /api/notebooks/{id}/notes`), with `origin_type: "saved_response"` and the stable 2.2 response DTO. It is idempotent per (authenticated user, `source_message_id`), including a note already saved through the 2.3 store. Title = the preceding user question trimmed to 200 code points, or `Saved response` when there is none. Body `notebook_id`/`message_id` that differ from the path, or an invalid body, return `400 ValidationError`. Per `FR-GC-09`, `FR-NM-02` shared save-note contract (contradicts)
- [ ] T068 Write failing tests for feedback clearing. `packages/db/test/package-v2-2.test.ts` and `apps/api/test/package-v2-2.test.ts`: there is one record per (user, message), re-rating replaces it, and a clear request removes it. `apps/web/test/chat-control.test.ts`: clicking the active thumb clears the rating, resets both `aria-pressed` states and sends the clear request. Per `FR-GC-09`, FR-014 (missing)
- [ ] T069 Write failing tests in `packages/contracts/test/package-v2-2.test.ts`, `apps/worker/test/package-v2-2.test.ts` and `apps/api/test/package-v2-2.test.ts`. Each follow-up chip carries its own nonempty supporting chunk IDs. Chips whose IDs fall outside the current C-02 scope are dropped before persistence and display, so they no longer reject the whole set. The surviving chips (0–3, ≤100 code points) still persist on the assistant message. Per `FR-GC-05`, FR-008, C-02 (partial)
- [ ] T070 Write failing web tests in `apps/web/test/package-v2-2.integration.test.ts`. With no sources, or after all sources are deleted, the chat panel shows `"Add a source to get started"` and the overview is cleared. With a populated selection, the overview hero shows the notebook's own icon (`icon_emoji`, falling back to the default), title and source count. Per `FR-GC-04`, FR-006, FR-007, US2/AC4 (partial)
- [ ] T071 Write failing tests in `packages/evals/test/` for a response-length metric over the fixed stratified 50-case release sample. It averages `Shorter` (≤50 %) and `Longer` (≥150 %) answer token counts against `Default` for the same question, only on cases whose sources support a longer answer. It reports `UNAVAILABLE` rather than pass when the judged runner or model is not configured. Per `FR-GC-07`, FR-012, Constitution eval gating (missing)

### Implementation (Green → Refactor)

- [ ] T072 CRITICAL: Pass T062 by giving `SourceGuideController`'s topic action in `apps/web/src/source-guide.ts` / `apps/web/src/v2/workspace-features.ts` the current selection. It sends via `ask` only when the inspected source is selected, and otherwise shows a select-sources prompt without mutating the selection. Per Constitution III, `FR-SI-02` (missing)
- [ ] T073 CRITICAL: Pass T063 by moving follow-up chips into one container above the chat input bar in `apps/web/src/chat/panel.ts` / `apps/web/src/v2/workspace-features.ts`. Drive the container from `ChatControlController` state (scope signature, streaming), clear it synchronously in `onSelectionChange`, on language change and on stream start, and render only chips whose signature matches the current scope. Per Constitution III, `FR-GC-05` (contradicts)
- [ ] T074 CRITICAL: Pass T064 by adding `output_language` to the guide identity and `SourceGuideSchema` in `packages/contracts/src/package-v2-2.ts` and `packages/db/src/package-v2-2.ts`. Resolve the notebook's effective output language (`WorkspacePreferencesService.resolveLanguagePreferences`) in `apps/api/src/v2/runtime.ts` for `onSourceReady` and follow-ups. Accept a language in the guide route in `apps/api/src/routes/package-v2-2.ts` and start on-demand generation for a missing language. Key the follow-up cache by output language. Per Constitution III, `FR-SI-02`, `FR-GC-05` (contradicts)
- [ ] T075 CRITICAL: Pass T065 by implementing a Vertex `StructuredGenerationClient` (Source Guide, overview, follow-ups) in `apps/worker/src/package-v2-2-gemini.ts`. Reuse the `VertexTopicEmojiClient` / `createVertexClient` pattern: `@google/genai`, `vertexai: true`, `europe-west4`, keyless ADC, `gemini-2.5-flash-lite`, `responseMimeType: "application/json"` plus response schema, temperature 0, a bounded timeout, Zod-validated output and the `transient` error flag. Then pass it as `generation` from `apps/api/src/server.ts` under the same Vertex-configured condition as the topic emoji selector. Never read `GEMINI_API_KEY`/`GOOGLE_API_KEY`, and enable no cloud API. Per `FR-SI-02`, `FR-GC-04/05`, plan: model routing, D3, `NFR-SEC-01` (missing)
- [ ] T076 Pass T066 by dispatching the Ready-source hooks from the API process (D16, single instance) whenever a source reaches `Ready`, without depending on `GET /sources`. Use a bounded-interval in-process watcher over PostgreSQL `(source_id, active_revision)` Ready transitions in `apps/api/src/v2/runtime.ts`. Keep listing-time dispatch only as the existing idempotent fallback. Record the observed `Ready` time with the guide so latency from `Ready` is measurable. Per Gate v2.0 #1, `FR-SI-02`, FR-018 (partial)
- [ ] T077 Pass the shared-store part of T067 by making the 2.2 save-note route create or return the note through the Package 2.3 notes store (`NotesService.saveFromMessage` / `saveResponseAsNote` in `packages/db/src/notes.ts`), mapped to the stable 2.2 response DTO. Retire the separate saved-response `noteStore` in `packages/db/src/package-v2-2.ts`. In `apps/web/src/v2/workspace-features.ts`, hand the saved note to the notes panel (refresh it, or insert by note ID once Package 2.3 mounts it). Coordination: this is the one route shared with `FR-NM-02`. Package 007 removes `/notes/from-message` or redirects it to this route; 006 adds no 2.3-side changes. Per `FR-GC-09`, `FR-NM-02` (contradicts)
- [ ] T078 Pass the remaining T067 cases in `apps/api/src/routes/package-v2-2.ts` and the save path. Derive the title from the preceding user question trimmed to 200 code points (fallback `Saved response`) instead of the first seven words. Return `400 ValidationError` when body IDs differ from the path IDs or the body is invalid, instead of overwriting them with path values or answering `422`. Show the `"Saved to notes"` confirmation. Per `FR-GC-09`, `FR-NM-02` shared save-note contract (contradicts)
- [ ] T079 Pass T068 by adding a feedback clear operation (repository delete keyed by notebook/user/message, plus an owner-authorized route in `apps/api/src/routes/package-v2-2.ts`). Make the active thumb in `renderResponseActions` (`apps/web/src/chat-control.ts`) toggle the rating off. Per `FR-GC-09`, FR-014 (missing)
- [ ] T080 Pass T069 by changing `FollowUpSuggestionsSchema` and `StructuredGenerationClient.generateFollowUps` so each chip carries its own supporting chunk IDs (`packages/contracts/src/package-v2-2.ts`, `apps/worker/src/package-v2-2.ts`). Drop chips with out-of-scope IDs before `saveMessageFollowUps`, and update the web consumer to read the chip text. Per `FR-GC-05`, FR-008, C-02 (partial)
- [ ] T081 Pass T070 by rendering the `"Add a source to get started"` empty state when the notebook has no sources. Keep the select-sources prompt for the case where sources exist but none is selected. Use the notebook's `icon_emoji` in `renderNotebookOverview` (`apps/web/src/chat-control.ts`, `apps/web/src/v2/workspace-features.ts`, `apps/web/src/workspace/index.ts`). Per `FR-GC-04`, FR-006, FR-007 (partial)
- [ ] T082 Pass T071 by adding the response-length metric to the judged release run in `packages/evals/src/` (`eval:judged` on the fixed 50-case sample) and recording sample IDs and generation parameters in the gate report. Per `FR-GC-07`, FR-012, Constitution eval gating (missing)

### Verification

- [ ] T083 Run the focused Package 2.2 Vitest suites, `pnpm typecheck`, `pnpm lint`, `node scripts/check-spec-integrity.mjs` and `env -u GEMINI_API_KEY -u GOOGLE_API_KEY pnpm eval:deterministic`, and record the exact results in `specs/006-source-guide-chat-control/validation.md`. Replace the "Known duplication … unify in v3" and "No Gemini client … 503" notes with the current state. Record Gate v2.0 #1 cloud P95 and the response-length release metric as `UNAVAILABLE` until a deployed run against Vertex AI in `europe-west4` exists. Leave Gate v2.0 #2 pending until Package 2.3 conversion is proven. Per `CC-02`, Gate v2.0 #1/#2, `NFR-EVAL-02/04` (partial)

### Dependencies and execution order (Phase 11)

- T060 and T061 precede every other Phase 11 task. Each test task (T062–T071) precedes its implementation (T072–T082): T062→T072, T063→T073, T064→T074, T065→T075, T066→T076, T067→T077/T078, T068→T079, T069→T080, T070→T081, T071→T082.
- Contract changes T074 (language-keyed guide) and T080 (per-chip support IDs) land before T075, so the Vertex client implements the final `StructuredGenerationClient` shape. T076 follows T074, because the Ready hook needs the effective output language.
- T073 and T080 both edit the follow-up web consumer; serialize them. T077 then T078 both edit the save-note route; serialize them. T082 depends on the generation and chat-config path being unchanged by T075.
- T083 runs last. Package 007 (Package 2.3) removes or redirects `/notes/from-message` to the shared route after T077; no 2.3-side task is added here.
