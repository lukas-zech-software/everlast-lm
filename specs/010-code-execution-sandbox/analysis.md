# Specification Analysis Report: Package 3.2

Date: 2026-10-22. Scope: FR-GC-08; supporting FR-GC-01/02/06, FR-SI-03/05, FR-WM-04/05, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04, NFR-PERF-01 and Gate v3.0 #2.

## Workflow and evidence boundary

Created `/private/tmp/everlast-v3-tasks-3-2-20261022` on `codex/v3-tasks-3-2-20261022` from completed predecessor `fc0ee3864099f95f4b1b9bce3f16f6f7aacab799`. First action created the worktree; second exported the supplied `SPECIFY_FEATURE_DIRECTORY=specs/010-code-execution-sandbox`, wrote the exact feature_directory value to `.specify/feature.json`, then unset/asserted absent. Task setup resolved the package and override template. Before/after task and analysis hooks parsed successfully with Ruby Psych; all are optional Git commit hooks, explicitly skipped in favor of a reviewed final commit. No mandatory hook omitted.

Executed tasks generation, then strict read-only analysis using `check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`. Initial findings were emitted before authorized remediation. The user's instruction to resolve findings provided prior authorization; remediation was a separate editing step, followed by another read-only analysis. This report is saved afterward as a separate reporting action. No application/test implementation, runtime tests, cloud enablement or deployment occurred.

## Initial findings and resolutions

| ID | Category | Severity | Location(s) | Finding | Resolution |
| --- | --- | --- | --- | --- | --- |
| I1 | Inconsistency | HIGH | contracts/interfaces.md §Chat entry and progress; apps/api/src/routes/chat.ts; packages/db/src/chat-history.ts; packages/db/src/notebooks.ts:77 | Contract stated notebook ownership 404, conflicting with current 404 missing/403 foreign DB path. | Corrected contract and task tests to preserve current status semantics; spec/card note no new source authority follows. |
| I2 | Inconsistency | HIGH | quickstart.md §Implementation-time prerequisites; playwright.config.ts | Proposed tests/e2e/code-execution.spec.ts is outside configured apps/web/test discovery. | Corrected quickstart and actual tasks to apps/web/test/code-execution.spec.ts; T003/T047 preserve discovery. |
| U1 | Underspecification | MEDIUM | plan.md §Project Structure; tasks.md T009–T013/T043–T046 | New runtime, infra, benchmark and test files and migration number lacked exact plan ownership. | Reserved 0010_code_execution.sql, named all files in plan and linked commands/tasks; predecessor 0009 and next 0011+ explicit. |
| C1 | Coverage | MEDIUM | spec.md FR-011; tasks.md T004/T032/T037 | Cache-key/eligible-history subrequirements needed explicit tests/implementation coverage; DTO constraints needed complete task transcription. | Expanded T032/T037 and T004 field constraints; retain scope keys/current-history filtering and all trace/artifact fields. No new result cache required. |
| A1 | Ambiguity | MEDIUM | quickstart.md §Integration and timing evidence; tasks.md T043/T044 | Cohort sample count, failed-run accounting and P95 aggregation were insufficiently explicit. | Predeclare counts per cold/warm/load cohort; nearest-rank ceil(0.95*N); failed/time-out attempt fails cohort, no dropping; missing samples UNAVAILABLE. Flowed to spec/card/plan/contracts/quickstart. |
| A2 | Ambiguity | MEDIUM | data-model.md §ChatMessage.code_execution_trace; spec.md FR-007 | Terminal failure before code starts had no clear 0-attempt/final-null representation. | Before allocation no trace; allocated-before-code failure is Failed/attempts[]/final null/no artifacts. Unknown outcome after actual submission retains real attempt and never replays. Flowed through spec/card/model/contracts/tasks. |

No numeric/resource/security limit, accepted intent/retry answer, scope rule or provider decision was weakened. D19 accepts Google Agent Platform (Agent Engine), making R6 obsolete; no standalone qualification/admission/fallback project is generated. SRS amendment and architecture D18/D19 already govern that choice; own FR-card flow-back records these contract/test refinements without a new release/package or reference-product deviation.

A final staged integrity pass also found C2: the story test tasks were correctly ordered but lacked the template-required `### Tests` subsection headings. Added the three Tests/Implementation/Verification boundaries without changing IDs or task coverage, then reran the read-only review and integrity check.

## Final read-only analysis

| ID | Category | Severity | Location(s) | Summary | Recommendation |
| --- | --- | --- | --- | --- | --- |
| — | — | — | spec.md, plan.md, tasks.md and supporting designs | No remaining actionable findings. | Follow test-first tasks in order and retain ordinary implementation/release evidence. |

## Coverage summary

All requirements below have tasks. Red tasks precede their covered implementation/verification paths; later integrated acceptance repeats the required behavior, rather than substituting for earlier Red tests.

| Requirement | Red/test tasks | Implementation or verification tasks | Coverage note |
| --- | --- | --- | --- |
| FR-001 | T007,T014,T015 | T013,T018–T021 | Quantitative delegation, scoped evidence, accepted managed runtime. |
| FR-002 | T006,T025 | T012,T019,T028 | No network/credentials, immutable scoped bytes, ordinary integration tests. |
| FR-003 | T004,T006,T025,T043 | T008,T012,T028,T044 | Exact resource/time/library/profile constraints; D18/D19. |
| FR-004 | T006,T014,T016,T043 | T019,T021,T022,T044 | Truthful real-running status ≤2.5s; not answer TTFT. |
| FR-005 | T004,T014–T017,T034 | T018,T020–T022,T038 | Exact values, labels, citations, safe charts and drawer/download. |
| FR-006 | T006,T024–T027 | T012,T028–T030 | One exception correction only; terminal/no-guessed-result behavior. |
| FR-007 | T004,T005,T024,T026,T027,T033,T035 | T008,T009,T028–T030,T036,T037,T040 | Actual ordered attempts and zero-attempt pre-execution failure; private artifacts. |
| FR-008 | T007,T014,T015,T017 | T013,T018,T020 | Explicit unit normalization and source citations. |
| FR-009 | T007,T014,T016,T032,T035 | T013,T019,T021,T040 | Explicit Ready scope, no fallback, current-scope clarification. |
| FR-010 | T005,T007,T026,T032–T035 | T009,T019,T029,T036–T039 | Snapshot/read/publication/clear and revocation fences. |
| FR-011 | T005,T026,T032–T035 | T009,T029,T036–T040 | Cache keys, history eligibility, app pool, immediate protected-content invalidation. |
| FR-012 | T004,T007,T014,T015,T017,T032,T042 | T018,T020,T021,T036,T045 | Buffered validated claims and immediate refusal; no citation failure retry. |
| FR-013 | T010,T014,T032,T034,T035 | T011,T021,T037,T038 | Owner-only server checks, enterprise EU identity; future v6 not implemented. |
| FR-014 | T004,T014–T016,T035,T042 | T018,T021,T022,T040 | Clarification has no computation/status; sufficient-intent current-scope reply. |
| SC-001 | T014–T017,T042 | T018,T020–T023,T045,T046 | 12-value exact arithmetic/plot and financial normalization example. |
| SC-002 | T006,T025 | T012,T028,T031,T046 | Actual integration isolation evidence, not mocks or R6 prerequisite. |
| SC-003 | T006,T016,T043 | T012,T019,T021,T022,T044,T046 | Cold/warm declared cohorts, 4.0s P95 and 2.5s progress, all-attempt accounting. |
| SC-004 | T004,T006,T024–T027,T043 | T008,T012,T028–T031,T044,T046 | Resource boundaries, real termination, retries and truthful terminal failures. |
| SC-005 | T005,T007,T017,T032–T035,T042 | T009,T013,T020,T036–T041,T045,T046 | Precision 1.0/leakage 0 over scope, history, caches, charts and in-flight outputs. |
| SC-006 | T042 | T045–T047 | Existing deterministic/judged runner verification; fixed stratified 50-case release sample. |
| SC-007 | T014–T016,T024,T027,T035,T042 | T018,T021–T023,T028–T031,T040,T041,T045,T046 | Statistical interpretation and ordered retry history. |

## Constitution alignment (CC-01..CC-08)

| Gate | Result | Artifact evidence |
| --- | --- | --- |
| CC-01 | PASS | Every task has SRS citations and concrete files; FR/SC mapping above; own spec/card/plan/model/contracts/quickstart refined together. |
| CC-02 | PASS | Mandatory Red before implementation; core schemas/SQL/runtime/manifest foundation tests precede their code. Story tests precede implementation; benchmark tests precede runner. No fake observed failures claimed. |
| CC-03 | PASS | Explicit Ready scope, captured C-02 snapshot and request-bound evidence, exact supplied citation universe; no direct storage/source URL bypass. |
| CC-04 | PASS | Buffered citation verification/refusal, precision 1.0/leakage 0 and private chart/history invalidation tests are scheduled. |
| CC-05 | PASS | Shared Zod schemas once, unchanged C-01, dynamic ADK selection plus deterministic controller; legacy DTO compatibility preserved. |
| CC-06 | PASS | Recorded Gate v2 owner authority/evidence limitations retained; predecessor 3.1 contract handoff before consumption; 3.4 benchmarks integrated release. No actual Gate v3 pass claimed. |
| CC-07 | PASS | Owner-only API checks, enterprise EU identity, no code credentials, explicit source/artifact authorization and no new residency exception. |
| CC-08 | PASS | Node 26/TypeScript/pnpm, existing SQL/GCS/ADK/OpenTofu, accepted managed sandbox D18/D19; no alternate host/datastore/framework. |

No remaining constitution alignment issue. Unmapped tasks: none; setup, discovery, fixtures, runtime provisioning, gate execution and flow-back tasks map to the cited package/constitutional requirements even when they are not business-story increments. No later-release role implementation is introduced.

## Metrics and task format

- Requirements: 21 (14 FR, 7 SC); covered 21/21=100%.
- Tasks: 48; setup 3, foundation 10, US1=10, US2=8, US3=10, integrated gates/flow-back 7.
- Safe [P] tasks: 17, limited to disjoint test ownership after fixtures/schema prerequisites.
- Initial semantic findings: 6 (2 HIGH, 4 MEDIUM), plus final structural C2 (CC-02 test subsection headings); resolved 7 total. Final ambiguity 0, duplication 0, critical 0; final actionable findings 0.
- Sequential IDs T001–T048, all unchecked, SRS citations/exact file paths and explicit earlier local dependencies verified.
- Both inherited checklists byte-preserved: 37 custom questions unchecked, 16 built-in criteria unchanged. Their approval is independent of this analysis.

## Verification and limits

Task setup and required-spec/tasks analysis prerequisites PASS. `node scripts/check-spec-integrity.mjs`, `git diff --check`, sequential task/coverage/dependency checks and checklist preservation PASS. Final tracked Markdown/artifact counts are verified after staging; no product code or test files were created. Existing runners were inspected, not executed; new runtime/controller/browser/migration/eval files do not yet exist and their behavior/security/latency results are UNAVAILABLE. Missing credentials, deployed service, dataset evidence or a new test runner cannot be reported as success.

The managed runtime is accepted under D19, not empirically requalified here. Current ordinary runtime/security and Gate v3 requirements remain; R6 is not a blocker. Provisioning/API approval remains separate. No custom reviewer checklist approval or complete release acceptance follows from 100% artifact coverage.

## Next actions and handoff

Use `[010-code-execution-sandbox] T001` onward after normal review/prerequisite checks. MVP is foundation plus US1 resolved calculation/clarification/inspection; US2 completes retry/isolation acceptance and US3 completes protected publication/history. Record expected Red→Green→Refactor and actual evidence as tasks execute. Flow any discovery upstream and rerun analyze before completion. Next package branches from this completed commit and reserves 0011+; never collide with predecessor 0009 or own 0010 migration. No further remediation request is needed because the user already authorized resolving findings and final analysis is clean.
