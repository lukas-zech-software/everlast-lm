# Tasks: Quantitative Code Execution Sandbox

**Input**: `specs/010-code-execution-sandbox/{spec,plan,research,data-model,quickstart}.md` and `contracts/interfaces.md`.
**Package Source**: `spec/requirements/v3/package_3_2_code_execution_sandbox.md` plus `spec/requirements/README.md`.
**SRS IDs**: FR-GC-08; supporting FR-GC-01/02/06, FR-SI-03/05, FR-WM-04/05, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04, NFR-PERF-01. **Gate**: Gate v3.0 #2.
**Tests**: Mandatory Constitution II/CC-02: observe requirement-related Red before the implementation tasks it covers; then Green→Refactor. All tasks are planned and unchecked; no implementation/runtime acceptance is claimed.
**Prerequisites**: Recorded Gate v2 authority/evidence limits, package 3.1 C-01/C-02/invalidation handoff, current Node 26 workspace; review custom requirements checklist separately without auto-approval. D19 accepts Google Agent Platform (Agent Engine): R6 is obsolete and no qualification spike/admission task is generated.
**Migration reservation**: `packages/db/migrations/0010_code_execution.sql`, after applied 0001–0008 and predecessor reserved `0009_multimodal_ingestion_sync.sql`. Next package reserves 0011+. Confirm actual tail before execution; never rename applied migration history.
**Reference format**: External refs use `[010-code-execution-sandbox] T001` or `specs/010-code-execution-sandbox T001`. Local IDs below are unique to this feature.
**[P] policy**: Only disjoint test files after listed fixtures/schemas/prerequisites; no parallel migration, schema export, chat service/history/UI/config mutation.


## Phase 1: Setup and prerequisites

**Goal / independent checkpoint**: Establish package boundaries without implementing sandbox behavior.

- [x] T001 Verify Gate v2 recorded owner approval/evidence limits, predecessor specs/009-multimodal-ingestion-sync task/contract handoff and D18/D19 acceptance; record prerequisites and unavailable environments in specs/010-code-execution-sandbox/quickstart.md (FR-GC-08, C-01/C-02, Gate v3.0).

- [x] T002 Prepare schema-valid UUID fixtures for 12 values 1–12, population sqrt(143/12), sample sqrt(13), two-source units/CAGR, invalid citations and adversarial inputs in packages/evals/src/fixtures/code-execution.ts; preserve existing golden cases (FR-GC-08, FR-GC-02, NFR-EVAL-01..04; FR-005, FR-008, FR-012, FR-014, SC-001, SC-005, SC-007).

- [x] T003 Add planned package tests to existing discovery, keeping unit/integration separation and Playwright testDir apps/web/test, and document exact commands in vitest.config.ts and specs/010-code-execution-sandbox/quickstart.md; no passing placeholder tests (FR-GC-08, NFR-EVAL-02/04, Gate v3.0).



## Phase 2: Foundation — contracts, persistence and accepted runtime

**Goal / independent checkpoint**: Complete foundational Red→Green work before story execution. These safety tests precede every runtime/controller implementation.

- [x] T004 [P] Write failing schema compatibility tests in packages/contracts/test/package-v3-2.test.ts: IDs UUID; immutable execution_id; revisions positive integers; manifest internal filename/content digest/byte count/extracted values+units/supporting C-01 IDs; schema_version Literal 1; state CodeGenerating/SandboxRunning/Succeeded/TimedOut/Failed; attempts ordered 1–2 after execution, empty before execution including Failed-before-code; ordinal 1 or 2; final_attempt_id null before terminal or for zero-attempt terminal failure, otherwise last actual attempt; each actual attempt retains UUID attempt_id, UTF-8 code/stdout/stderr, start/end timestamps, terminal reason and artifacts: [authenticated chart_urls]; nullable integer exit_code never fabricated 0; nullable safe-enum failure_code; chart UUID artifact/execution/attempt/message refs, private key/generation, digest/byte size, snapshot/citation IDs and private candidate/published/invalidated state; MIME image/png or image/svg+xml; published_artifact_ids successful final only; ordinary/clarification trace absent|null; exact canonical value strings and invalid/non-finite rejection (FR-GC-08, FR-GC-06, C-01/C-02; FR-003, FR-005, FR-007, FR-009, FR-012, FR-014, SC-004, SC-007).

- [x] T005 [P] Write failing PostgreSQL tests in packages/db/test/code-execution.integration.test.ts for additive migration 0010, per-user/notebook/request admission and lease/epoch fencing, ordered trace atomic publication, legacy rows, restart/unknown outcome, cleanup markers, explicit clear-chat dependency invalidation and app-pool isolation; include boundary/null/enum constraints from T004 (FR-GC-08, FR-GC-06, NFR-EVAL-04; FR-007, FR-010, FR-011, SC-005).

- [x] T006 [P] Write failing adapter/controller contract tests in apps/api/test/code-execution-runtime.test.ts for fresh sandbox per attempt, managed D20 profile CPU≤2vCPU/RAM≤1.5GB, 100MB file I/O cap, application deadline 15.0s with sandbox deletion and late-result discard, scoped input copies, zero network/credentials, required math/statistics/numpy/pandas/matplotlib/scipy, no pip, truthful start, termination/cancellation and idempotent destroy; provider unavailable/unknown outcomes cannot replay code (FR-GC-08, NFR-SEC-01/02; FR-002, FR-003, FR-004, FR-006, SC-002, SC-004).

- [x] T007 [P] Write failing manifest/evidence tests in apps/api/test/code-execution-manifest.test.ts for immutable Ready revision snapshots, C-02-only acquisition, all supplied chunk IDs, whole-table coverage versus partial top 12, no URLs/credentials/path traversal, explicit units and honest insufficient evidence (FR-GC-08, C-01/C-02, NFR-EVAL-04; FR-001, FR-008, FR-009, FR-010, FR-012, SC-001, SC-005).

- [x] T008 Implement shared execution/result/artifact schemas and nullable strict ChatMessage trace compatibility in packages/contracts/src/package-v3-2.ts, packages/contracts/src/package-v1-3.ts and packages/contracts/src/index.ts; quote/implement all T004 field constraints without changing C-01; depends on T004 Red (FR-GC-08, FR-GC-06, C-01/C-02; FR-003, FR-005, FR-007, FR-009, FR-012, FR-014).

- [x] T009 Implement packages/db/migrations/0010_code_execution.sql and packages/db/src/code-execution.ts, export through packages/db/src/index.ts; additive JSONB trace, private artifact/admission/cleanup records, UUID/revision/state/attempt/null constraints from T004/T005, unique active-user/notebook fence and transactional ownership/revision/epoch guards; preserve 0001–0009 and startup migration compatibility; depends on T005 Red, T008 (FR-GC-08, FR-GC-06, NFR-SEC-02; FR-007, FR-010, FR-011).

- [x] T010 Write failing OpenTofu configuration tests in infra/modules/code_execution/tests/runtime_policy.tftest.hcl for approved enterprise EU parent runtime, no deployed agent code, default 2vCPU/1.5GB profile, keyless least-privilege identity and no secret injection; no runtime feasibility/R6 spike (FR-GC-08, NFR-SEC-01/02; FR-002, FR-003, FR-013, SC-002, SC-004).

- [x] T011 Implement accepted parent-runtime/IAM outputs and API configuration in infra/modules/code_execution/main.tf, infra/modules/code_execution/variables.tf, infra/modules/code_execution/outputs.tf, infra/environments/dev/main.tf, infra/modules/compute/main.tf and apps/api/src/config.ts; reuse project-services/IAM ports, require owner approval before new API enablement/apply; depends on T010 Red, T006 Red (FR-GC-08, NFR-SEC-01/02; FR-002, FR-003, FR-013; D18/D19).

- [x] T012 Implement authenticated managed-service create/execute/read/destroy adapter in apps/api/src/chat/execution/runtime.ts using external service identity, fresh child attempts, deadline/cancellation, safe error mapping and cleanup, enforcing T006 constraints; no credentials/code execution in API process and no unapproved alternate runtime; depends on T006 Red, T008, T011 (FR-GC-08, NFR-SEC-01/02; FR-002, FR-003, FR-006, SC-002, SC-004).

- [x] T013 Implement C-02 manifest and completeness policy in apps/api/src/chat/execution/manifest.ts, consuming captured request provider and exact supplied citation universe; reject insufficient quantitative data without invented rows; depends on T007 Red, T008 and predecessor 3.1 C-01/C-02 compatibility (FR-GC-08, C-01/C-02, NFR-EVAL-04; FR-001, FR-008, FR-009, FR-010, FR-012).



## Phase 3: User Story 1 — Calculate and inspect grounded results (P1)

**Goal / independent checkpoint**: Independently test a resolved 12-month calculation/chart and statistical clarification through actual chat. Retry acceptance is completed by US2, scope/history acceptance by US3.

### Tests (mandatory, observe Red before implementation)

- [x] T014 [P] [US1] Write failing chat integration tests in apps/api/test/code-execution.test.ts for quantitative delegation, population/sample exact results, individually Computed labels/citations, unit comments, explicit sufficient-intent timing, zero sandbox calls/status for clarification and fresh scoped reply; empty scope 400, invalid text 422, missing notebook 404/foreign 403; depends on T002, T008, T009 (FR-GC-08, FR-GC-01/02, C-02; FR-001, FR-004, FR-005, FR-008, FR-009, FR-012, FR-013, FR-014, SC-001, SC-007).

- [x] T015 [P] [US1] Write failing model/draft/verifier tests in apps/api/test/code-execution-model.test.ts for dynamic ADK computation tool selection, distinct typed non-computed clarification, unchanged factual citation refusal, exact numerical output and no naked model arithmetic; depends on T002, T008 (FR-GC-08, FR-GC-02, NFR-EVAL-02/03; FR-001, FR-005, FR-008, FR-012, FR-014, SC-001, SC-007).

- [x] T016 [P] [US1] Write failing browser/UI tests in apps/web/test/code-execution.test.ts and apps/web/test/code-execution.spec.ts for actual SSE running_code serialization, ≤2.5s truthful status, Computed labels, inline PNG/SVG/download and keyboard-accessible drawer; sources/history readiness and clarification suppress execution status; depends on T002, T008 (FR-GC-08, FR-GC-06; FR-004, FR-005, FR-007, FR-009, FR-014, SC-001, SC-003, SC-007).

- [x] T017 [P] [US1] Write failing output tests in apps/api/test/code-execution-output.test.ts for exact value strings/units, invalid/non-finite rejection, PNG decode, SVG allowlist removing scripts/events/foreignObject/external references/fonts, safe names/MIME and citation provenance; depends on T002, T008 (FR-GC-08, FR-GC-02, NFR-SEC-02; FR-005, FR-008, FR-012, SC-001, SC-005).

### Implementation

- [x] T018 [US1] Extend ADK model, strict draft/prompt and verifier typed outcomes in apps/api/src/chat/model.ts, apps/api/src/chat/draft.ts, apps/api/src/chat/prompt.ts and apps/api/src/chat/verifier.ts without bypassing factual validation; clarify unresolved statistical intent before tool execution and preserve exact results/unit comments; depends on T015 Red, T013 (FR-GC-08, FR-GC-02; FR-001, FR-005, FR-008, FR-012, FR-014).

- [x] T019 [US1] Implement deterministic execution orchestration in apps/api/src/chat/execution/controller.ts with immutable manifest, durable request/admission/epoch, fresh attempt and baseline bounded lifecycle; no model-owned extra attempts; depends on T005/T006/T007/T014 Red, T009, T012, T013, T018 (FR-GC-08, FR-GC-06, C-02; FR-001, FR-002, FR-003, FR-004, FR-007, FR-009, FR-010, FR-014).

- [x] T020 [US1] Implement output validation/private candidate storage in apps/api/src/chat/execution/output.ts using canonical numerical strings, validated safe image bytes and exact input citations; depends on T017 Red, T019 (FR-GC-08, FR-GC-02, NFR-SEC-02; FR-005, FR-008, FR-012).

- [x] T021 [US1] Wire ChatService, truthful SSE status/final serialization and app/server dependency injection in apps/api/src/chat/service.ts, apps/api/src/routes/chat.ts, apps/api/src/app.ts and apps/api/src/server.ts; preserve buffered validated publication/request IDs and safe clarification result, no public arbitrary-Python endpoint; depends on T014/T015/T016 Red, T018–T020 (FR-GC-08, FR-GC-01/02/06, C-02; FR-001, FR-004, FR-005, FR-009, FR-012, FR-014).

- [x] T022 [US1] Render computed values/images/download controls and escaped code/stdout with ordered final-output labels in apps/web/src/chat/code-execution.ts, apps/web/src/chat/panel.ts and apps/web/src/lib/types.ts; preserve sources/history readiness and accessible keyboard/focus semantics; depends on T016 Red, T021 (FR-GC-08, FR-GC-06; FR-004, FR-005, FR-007, FR-014).

### Story verification

- [x] T023 [US1] Run US1 contract/model/service/browser tests and preserve requirement-related Red→Green evidence in specs/010-code-execution-sandbox/quickstart.md; verify known 12-value results, scope and unit citations, zero-execution clarification and happy-path drawer/download; depends on T014–T022 (FR-GC-08, FR-GC-02, C-02; SC-001, SC-007).



## Phase 4: User Story 2 — Keep calculations isolated and failures honest (P1)

**Goal / independent checkpoint**: Exercise exception correction, infinite loop/resource failure, isolation and unknown outcomes without guessed numbers. Only an actual first Python exception permits attempt 2.

### Tests (mandatory, observe Red before implementation)

- [ ] T024 [P] [US2] Write failing retry/state-machine tests in apps/api/test/code-execution-retry.test.ts for exactly 1 correction on first Python exception, fresh sandbox/same snapshot, both ordered traces, final attempt publication only, second exception terminal; zero retries for timeout/OOM/storage/security/transport uncertainty/citation errors; depends on T008, T019 (FR-GC-08; FR-003, FR-006, FR-007, SC-004, SC-007).

- [ ] T025 [P] [US2] Write ordinary managed-service integration tests in apps/api/test/code-execution-runtime.integration.test.ts using approved synthetic fixtures for no HTTP/DNS/metadata/private/inbound traffic, failed network calls from executed code (no packet capture, D20), input copies cannot alter stored sources, managed memory error and 100MB file cap, 15.0s application deadline, required library outputs and fresh-state isolation; register evidence when environment exists, otherwise UNAVAILABLE, with no R6 pre-implementation qualification phase; depends on T006, T012 (FR-GC-08, NFR-SEC-01/02; FR-002, FR-003, FR-006, SC-002, SC-004).

- [ ] T026 [P] [US2] Write failing crash/cancel/replay tests in packages/db/test/code-execution-recovery.integration.test.ts and apps/api/test/code-execution-recovery.test.ts: duplicate/out-of-order callbacks, nullable unknown exit, lease fencing, destroy confirmation, orphan cleanup and no Python replay; distinguish rejected-before-allocation/no trace from allocated-before-code Failed/attempts[]/final null; clear/revoke during either attempt suppresses outputs; depends on T005, T009, T019 (FR-GC-08, FR-GC-06, NFR-EVAL-04; FR-006, FR-007, FR-010, FR-011, SC-004, SC-005).

- [ ] T027 [P] [US2] Write failing retry/error drawer tests in apps/web/test/code-execution-retry.test.ts for both attempt code/stdout/stderr in order, final/published markers, transparent timeout/OOM/second exception with no guessed number/failed-artifact download; depends on T016, T022 (FR-GC-08; FR-005, FR-006, FR-007, SC-004, SC-007).

### Implementation

- [ ] T028 [US2] Implement exception-only self-correction and all terminal/error mappings in apps/api/src/chat/execution/controller.ts and apps/api/src/chat/execution/runtime.ts, retaining 15.0s each attempt and managed controls; correction may not expand scope, change caps or retry again; depends on T024/T025 Red, T019 (FR-GC-08; FR-002, FR-003, FR-006, FR-007, SC-002, SC-004, SC-007).

- [x] T029 [US2] Implement durable unknown-outcome reconciliation and idempotent provider/artifact destruction in apps/api/src/chat/execution/reconcile.ts, packages/db/src/code-execution.ts and apps/api/src/server.ts; start reconciliation without model execution, retain handles privately until cleanup confirmed; depends on T026 Red, T028 (FR-GC-08, FR-GC-06, NFR-SEC-02; FR-006, FR-007, FR-010, FR-011).

- [ ] T030 [US2] Integrate terminal errors and both ordered attempts in apps/web/src/chat/code-execution.ts and apps/web/src/chat/panel.ts, escaping source/error text and hiding unpublished candidate bytes; depends on T027 Red, T028, T029 (FR-GC-08, NFR-SEC-02; FR-005, FR-006, FR-007).

### Story verification

- [ ] T031 [US2] Run US2 retry/recovery/security/browser checks and record actual outcomes/environment limits in specs/010-code-execution-sandbox/quickstart.md; do not treat provider acceptance as measured test success or revive R6; depends on T024–T030 (FR-GC-08, NFR-SEC-01/02; SC-002, SC-004, SC-007).



## Phase 5: User Story 3 — Preserve scope through publication and history (P1)

**Goal / independent checkpoint**: Verify no stale/out-of-scope value, trace, cache or chart is exposed before/after publication; ordinary historical messages and authorized deselected history remain compatible.

### Tests (mandatory, observe Red before implementation)

- [ ] T032 [P] [US3] Write failing scoped publication tests in apps/api/test/code-execution-scope.test.ts for empty scope, unselected/other-notebook decoys, submission snapshot, checkbox changes, source replace/delete/revoke before read and commit, no substitute revision, invalid citation immediate refusal without retry/stripped draft; exact cache-key notebook/revision/ACL/language/parameter composition and eligible-history exclusion; depends on T002, T021 (FR-GC-08, FR-SI-03/05, C-02, NFR-EVAL-02/04; FR-009, FR-010, FR-012, FR-013, SC-005).

- [ ] T033 [P] [US3] Write failing history/projection tests in packages/db/test/code-execution-history.integration.test.ts for nullable legacy/clarification traces, exact values/ordered attempts after reload, deselection viewability/current-scope history exclusion, source invalidation redaction, atomic publish and clear hygiene including feedback/follow-ups and owning app pool; depends on T009, T029 (FR-GC-08, FR-GC-06, C-02, NFR-EVAL-04; FR-005, FR-007, FR-010, FR-011, SC-005).

- [ ] T034 [P] [US3] Write failing chart authorization/format tests in apps/api/test/chat-charts.test.ts for private publication-only PNG/SVG, guessed IDs/cross-notebook/expired or revoked access, direct/range delivery, no bearer URL bypass, safe SVG, immediate invalidation including in-progress delivery; depends on T017, T020 (FR-GC-08, FR-GC-02, NFR-SEC-02, NFR-EVAL-04; FR-005, FR-010, FR-011, FR-012, FR-013, SC-005).

- [ ] T035 [P] [US3] Write failing UI/save-note/clear regressions in apps/web/test/code-execution-history.spec.ts and apps/api/test/code-execution-v2-compatibility.test.ts for current scope on clarification/follow-up, both traces reload, revocation placeholders, draft preservation on overlap, clear fencing and no protected trace leakage through saved-response/feedback; depends on T022, T030 (FR-GC-08, FR-GC-06, C-02, NFR-EVAL-04; FR-007, FR-009, FR-010, FR-011, FR-013, FR-014, SC-005, SC-007).

### Implementation

- [ ] T036 [US3] Implement transactional publication/trace projection and clear invalidation in packages/db/src/chat-history.ts and packages/db/src/code-execution.ts, retaining exact owner/revision/epoch rechecks and latest source-revision failure behavior; depends on T032/T033 Red, T029 (FR-GC-08, FR-GC-06, C-02, NFR-EVAL-02/04; FR-005, FR-007, FR-010, FR-011, FR-012).

- [ ] T037 [US3] Update all v2/saved-response/feedback projections and app context wiring in apps/api/src/v2/runtime.ts, apps/api/src/chat/service.ts and apps/web/src/lib/types.ts; honor VisibleMessage filtering, current-scope eligible history, any used cache-key composition/invalidation and trace confidentiality without breaking legacy messages; no new execution cache required; depends on T033/T035 Red, T036 (FR-GC-08, FR-GC-06, NFR-EVAL-04; FR-007, FR-010, FR-011, FR-013).

- [ ] T038 [US3] Implement authenticated private chart route and composition in apps/api/src/routes/chat-charts.ts and apps/api/src/app.ts using existing owner/document authorization, safe output validation and no-store delivery with range/revocation checks; depends on T034 Red, T020, T036, T037 (FR-GC-08, FR-GC-02, NFR-SEC-02; FR-005, FR-010, FR-011, FR-012, FR-013).

- [ ] T039 [US3] Extend source/notebook cleanup and active cancellation in packages/db/src/cleanup.ts, apps/api/src/chat/execution/reconcile.ts and apps/api/src/chat/service.ts; synchronously invalidate authorization, fence callbacks, asynchronously delete private object generations and destroy child sandboxes without replay; depends on T026/T032/T033/T034 Red, T036–T038 and predecessor 3.1 invalidation contract (FR-GC-08, FR-GC-06, FR-SI-05, NFR-SEC-02; FR-006, FR-007, FR-010, FR-011).

- [ ] T040 [US3] Implement protected history/revocation/clear UI behavior in apps/web/src/chat/panel.ts and apps/web/src/chat/code-execution.ts preserving current-scope follow-up/clarification and overlap draft; depends on T035 Red, T037–T039 (FR-GC-08, FR-GC-06, C-02, NFR-EVAL-04; FR-007, FR-009, FR-010, FR-011, FR-014).

### Story verification

- [ ] T041 [US3] Run US3 API/DB/browser compatibility scenarios and record Red→Green plus invalidation/range/restart evidence in specs/010-code-execution-sandbox/quickstart.md; depends on T032–T040 (FR-GC-08, FR-GC-06, NFR-EVAL-02/04; SC-005, SC-007).



## Phase 6: Integrated performance, eval and flow-back

**Goal / independent checkpoint**: Complete normal package gates; all runtime/eval results remain unavailable until executed. No R6 qualification work is introduced.

- [ ] T042 Write failing deterministic/semantic evidence tests in packages/evals/test/code-execution.eval.test.ts for exact arithmetic/chart source claims, scope decoys, invalid citation refusal and stats intent/attempt fixtures; preserve citation precision 1.0/leakage 0 and current golden dataset lineage; depends on T002, T041 (FR-GC-08, FR-GC-02, NFR-EVAL-01..04; FR-005, FR-012, FR-014, SC-001, SC-005, SC-006, SC-007).

- [ ] T043 [P] Write failing benchmark aggregation tests in packages/evals/test/code-execution-performance.test.ts for submission→real-running≤2.5s and create→completion≤4.0s P95, predeclared cold/warm one/two-user cohorts and fixed sample counts, nearest-rank ceil(0.95*N), any failed/timeout sample fails its cohort, missing samples UNAVAILABLE, retries separately reported and no progress counted as answer TTFT; depends on T031, T041 (FR-GC-08, NFR-PERF-01; FR-004, SC-003, SC-004).

- [ ] T044 Implement declared-fixture benchmark/evidence runner in scripts/eval-v3-code-execution.mjs with complete sample/attempt metadata, failure accounting and separate code versus validated-answer timing; depends on T043 Red, T031, T041 (FR-GC-08, NFR-PERF-01; FR-004, SC-003, SC-004).

- [ ] T045 Run packages/evals/test/code-execution.eval.test.ts and pnpm eval:deterministic on the integrated candidate, then once-per-release pnpm eval:judged on fixed deterministic stratified 50 golden cases with IDs/category composition/dataset hash; record unavailable credentials/services explicitly in specs/010-code-execution-sandbox/quickstart.md; depends on T042 Red, T044 (FR-GC-08, NFR-EVAL-01..04; FR-012, SC-005, SC-006).

- [ ] T046 Run declared ordinary managed-service/security/performance fixtures and retain actual report in specs/010-code-execution-sandbox/evidence/gate-v3-code-execution.md; include cold/warm P95≤4.0s, real-running≤2.5s, one/two-user load, limits/isolation, retry outcomes and complete failure accounting; depends on T025, T031, T041, T044, T045 (FR-GC-08, NFR-SEC-01/02, Gate v3.0 #2; SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-007).

- [ ] T047 Verify actual discoverability, lint/typecheck, contract/unit/integration/browser/eval results and spec integrity using package.json, playwright.config.ts and scripts/check-spec-integrity.mjs; record exact commands/PASS/FAIL/UNAVAILABLE without claiming a package pass is full Gate v3; depends on T046 (FR-GC-08, NFR-EVAL-01..04, Gate v3.0).

- [ ] T048 Flow every discovered contract/limit/error refinement back into specs/010-code-execution-sandbox/spec.md, plan.md, contracts/interfaces.md, spec/requirements/v3/package_3_2_code_execution_sandbox.md and docs/solution-architecture.md plus affected tracked GitHub issues if any, then rerun read-only analyze and preserve final analysis.md; keep D19/R6 obsolete and qualify handoff task refs; depends on T047 (FR-GC-08, C-01/C-02, Gate v3.0).



## Dependencies and execution order

Setup T001–T003 → foundation T004–T013 → US1 T014–T023 → US2 T024–T031 → US3 T032–T041 → integrated T042–T048. Each implementation task explicitly waits for its covering Red tests; failing imports alone are not requirement-related Red. Establish only the minimal fixture/interface scaffolding needed to exercise behavior before declaring Red. Existing ordinary chat remains safe while new code paths are disabled until their prerequisite tests/guards are implemented. No legacy migration, C-01 locator union, report/Studio behavior or foreign package scope is replaced.

US1's independent MVP is a resolved exact calculation, clarification and inspectable result through the real chat; its retry acceptance is delivered by US2 and protected-history acceptance by US3. Full package acceptance needs all three stories. Package 3.1's shared handoff must be implemented before consumption; package 3.3 is independent of executing code; package 3.4 consumes completed integrations and timing metadata.

### Safe parallel examples

- Foundation: T004 contracts, T005 DB, T006 runtime and T007 manifest tests use disjoint files after T002 fixtures; serialize shared DTO exports and migration ownership.
- US1: T014 service, T015 model, T016 UI/browser and T017 output tests may be separate owners after foundation. T018–T022 implementations remain serialized where service/types/UI files overlap.
- US2: T024 retry, T025 managed-service, T026 recovery and T027 UI tests use disjoint test files. Execute live-service tests only with approved resources/fixtures; unavailable environment is not a pass. Controller/runtime/reconciler writes are serialized.
- US3: T032 scope, T033 history, T034 chart and T035 compatibility tests are disjoint after their listed prerequisites. SQL publication, app wiring, cleanup and UI mutations are serial.
- T043 benchmark tests may be drafted alongside T042 eval tests once story fixtures are stable.

### Implementation strategy and evidence

Deliver foundation→US1 MVP→retry/isolation→publication/history→integrated gates. Do not disable/relax test thresholds to satisfy provider limitations or call owner acceptance a new measured result. API enablement and IaC apply still require owner authorization. Runtime security, deploy, model/eval and latency gates are UNAVAILABLE until executed; task generation/analysis claims artifact coverage only. Flow-back and repeated analysis occur before an implementation change is considered complete.
