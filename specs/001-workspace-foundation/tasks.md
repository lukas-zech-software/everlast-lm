# Tasks: Workspace Foundation

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts](contracts/workspace-api.md), [shared context](contracts/shared-context.md), [quickstart](quickstart.md).
**Package Source**: `spec/requirements/v1/package_1_1_workspace_foundation.md` + [binding cross-package rules](../../spec/requirements/README.md).
**SRS IDs in Scope**: FR-WM-01, FR-WM-04, FR-WM-07; C-01/C-02; NFR-EVAL-04; Gate v1.0.
**Branch / Worktree / Base**: `spec/v1-functional-requirements` / `/private/tmp/everlast-v1-specs` / `0ed1a04`.
**Prerequisites**: Plan CC-01..CC-08 reviewed; spec has no open clarification markers. `/speckit-analyze` must review this task list before implementation. Shared upstream changes require reconciliation, not automatic adoption.

**Tests are mandatory** under constitution II/CC-02. Each production behavior task depends on its listed test tasks and their observed requirement-related Red failures. Setup may create empty adapters/interface stubs to make tests executable, but an import/configuration error is not Red. Store case IDs, command, failure reason, commit and later Green result in `specs/001-workspace-foundation/validation.md`; distinct task output directories permit independent test work. Never skip or weaken a spec-derived assertion without an SRS amendment.

**Ownership**: This session owns only this tasks document. Implementation assignment must be published before editing code. The active infrastructure branch `feat/v1-terraform-and-architecture-alignment` has overlapping manifests/CI/infra and uncommitted governance changes; T001 is a mandatory coordination gate. No foreign worktree is modified. Every task below is unchecked and unexecuted.

## Format and State

`- [ ] Tnnn [P?] [USn?] action (SRS IDs) in exact paths — depends on ...`

Qualified task identity is `specs/001-workspace-foundation Tnnn`. [P] permits parallel work only after its dependencies pass, with disjoint files and ownership; it does not permit concurrent edits to shared schema/index, database migration, fixtures or validation log. Each task follows its explicit dependencies even if a section appears later. Green/refactor never changes the requirement.

## Phase 1: Setup (Shared Prerequisites & Package Scaffolding)

**Goal / Independent Test**: Establish an assigned, isolated foundation workspace and runnable harness without implementing behavior.

- [ ] T001 Record owner, allowed files, base commit and shared-file handoff in `specs/001-workspace-foundation/implementation-handoff.md` and the shared issue/PR description (Gate v1.0). Reconcile the active `feat/v1-terraform-and-architecture-alignment` session before touching `package.json`, `.github/workflows/ci.yml`, `infra/` or architecture-governed configuration; integrate approved upstream changes, update affected plan/contracts and rerun analyze if they differ. Do not copy uncommitted foreign-worktree changes. **Depends on:** approved analyze and user/package ownership handoff.

- [ ] T002 Initialize only missing pnpm workspace scaffolding in `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` and manifests/tsconfigs for `packages/contracts`, `packages/db`, `packages/evals`, `apps/api`, `apps/web`, `apps/worker` (Gate v1.0, C-01, C-02). Preserve integrated infrastructure scripts. Pin Node 24/TypeScript 5.x baseline and actual dependency versions; no new framework, ORM or datastore. **Depends on:** T001.

- [ ] T003 Wire the planned scripts from `quickstart.md` in `package.json`, `vitest.config.ts`, `playwright.config.ts`, and package test configs (Gate v1.0). Include lint/typecheck/unit/contract/integration/E2E/deterministic/judged commands, build/dev and isolated migration entrypoints; absent downstream suites must report UNAVAILABLE, never pass on zero tests. Create only importable interface stubs needed for requirement-related Red assertions, not behavior. **Depends on:** T002.

- [ ] T004 Prepare schema-valid UUID fixtures and two-owner/two-notebook records in `packages/evals/fixtures/workspace-isolation.json`, isolated database/storage test helpers in `packages/db/test/fixtures.ts` and `apps/worker/test/storage-fixtures.ts` (FR-WM-04, C-01, C-02). Assign distinct ports/database/bucket prefixes and output directory; fixtures carry no credentials or real company content. **Depends on:** T003.

**Checkpoint**: Record only verified results; unavailable or externally blocked checks remain open.

## Phase 2: Foundational (Blocking Package Prerequisites)

**Goal / Independent Test**: Define the single shared schema and identity/database boundaries. Foundation passes its applicable contract/schema tests before story implementation.

- [ ] T005 Write and run failing schema tests in `packages/contracts/test/document-chunk.test.ts` and `packages/contracts/test/workspace.test.ts` (C-01, FR-WM-01): five-field C-01 projection, UUID v7 chunks and UUID v4 notebooks, page_span/time_span/dom_path only, optional physical page, finite ordered half-open code-point offsets, nonnegative token_count, required text, reject unknown variants/fields; title 0/1/100/101 code points after trim including emoji, default title and UTC timestamps. Capture Red evidence. **Depends on:** T004.

- [ ] T006 Implement and export sole shared chunk/workspace schemas and pure title helper in `packages/contracts/src/document-chunk.ts`, `workspace.ts`, `text-limits.ts`, `index.ts` (C-01, FR-WM-01); pass T005. Preserve 1–100 code points, no truncation/normalization altering title; 300–600-token chunk target is not a C-01 hard bound. **Depends on:** T005.

- [ ] T007 [P] Write and run failing authentication tests in `apps/api/test/identity.test.ts` (FR-WM-04, NFR-SEC-01): absent/invalid/expired/revoked/wrong-project tokens, forged body owner, stable verified subject mapping rather than email, and production rejection of fixture identities. Capture Red evidence. **Depends on:** T004.

- [ ] T008 Implement revocation-aware Identity Platform token adapter and verified owner context in `apps/api/src/auth/identity.ts` (FR-WM-04, NFR-SEC-01); pass T007. Use keyless credentials, configurable OIDC/SAML deployment inputs, no chosen corporate IdP or fixture bypass in deployment. **Depends on:** T007, T006.

- [ ] T009 Write and run failing database foundation tests in `packages/db/test/workspace.integration.test.ts` (FR-WM-01, FR-WM-04, FR-WM-07): user unique verified subject; notebook owner FK/immutable UUID v4/title/timestamps; composite notebook/source linkage; source status/metadata nonnegativity; 100-notebook limit including 99 plus two concurrent creates; admission attempt uniqueness and payload-free cleanup metadata. Migration absence/import errors alone are not sufficient Red evidence. **Depends on:** T006, T004.

- [ ] T010 Implement base entities, constraints, transaction helper and migration entrypoint in `packages/db/migrations/0001_workspace.sql`, `packages/db/src/transaction.ts`, `packages/db/src/migrate.ts` (FR-WM-01, FR-WM-04, FR-WM-07); pass the schema/constraint subset of T009. Owner→notebook→source lock order is fixed; quota service assertions remain Red until their owning tasks. Do not add parser, chat, notes or Studio tables. **Depends on:** T009.

- [ ] T011 Write and run failing request-envelope contract tests in `packages/contracts/test/scoped-context.test.ts` (C-02, NFR-EVAL-04): public two-argument signature, explicit nonempty Ready IDs, immutable server-captured revisions, bound principal/query/purpose, source IDs normalized as a set, no trusted client role, snapshot metadata outside C-01, missing provenance cannot be eligible. Capture Red evidence. **Depends on:** T006.

- [ ] T012 Implement request-bound provider types, snapshot schemas and exports in `packages/contracts/src/scoped-context.ts`, `packages/contracts/src/index.ts` (C-02, NFR-EVAL-04); pass T011. Define one shared boundary with inspection/generation modes; real retrieval implementation remains package 1.2 and C-03 remains v2. **Depends on:** T011, T008, T010.

**Checkpoint**: Record only verified results; unavailable or externally blocked checks remain open.

## Phase 3: User Story 1 - Notebook CRUD (Priority: P1)

**Goal / Independent Test**: Create/open/rename/delete owned notebooks, including durable cleanup. Independent proof: HTTP/database fixtures and browser notebook journeys; real downstream content cascades stay explicitly pending.

### Tests (MANDATORY — observe Red first)

- [ ] T013 [US1] Write and run failing notebook HTTP contract tests in `apps/api/test/workspace.test.ts` (FR-WM-01, FR-WM-04, FR-WM-07): GET list/detail/quota, POST create, PATCH title, DELETE and deletion-status routes; 401/403/404/422/409/503 mapping, unknown mutation fields, owner-scoped idempotency and no deleted-result resurrection. Capture Red evidence. **Depends on:** T012.

- [ ] T014 [US1] Extend and run failing notebook repository tests in `packages/db/test/workspace.integration.test.ts` (FR-WM-01, FR-WM-04): persisted create/reopen, title and updated_at commit/rollback, delete cancellation as no request, parent cascade/fence, original-owner-only deletion status, concurrent create at 99, and same create-key replay. Include cleanup outbox commit even if enqueue fails. Capture Red evidence. **Depends on:** T012, T009.

- [ ] T015 [US1] Write and run failing browser journeys in `apps/web/test/workspace.spec.ts` (FR-WM-01): new home card/default title, `/notebook/{id}` navigation with Add sources open, reopen unchanged ID, Enter/blur/card-menu rename, whitespace and 101-code-point rejection, network error restores persisted title/toast, delete confirmation/cancel, tab B receives 404/“Notebook no longer exists” then home. Capture Red evidence. **Depends on:** T012.

- [ ] T016 [US1] Write and run failing cleanup tests in `apps/worker/test/notebook-cleanup.test.ts` (FR-WM-01, FR-WM-04): all live/noncurrent object generations; crash between DB commit/enqueue; replay/drain recovery; duplicate events; pending/resumable signed uploads; final sweep after quiescence; retained/held objects never Purged; late callbacks cannot republish; status/logs contain no source content. Capture Red evidence with injected storage/queue failures. **Depends on:** T012.

- [ ] T017 [P] [US1] Write and run failing timing assertions in `apps/web/test/workspace-performance.spec.ts` and `packages/db/test/deletion-performance.test.ts` (FR-WM-01): creation action through modal <=1.0 s P95 and relational/chunk cascade <=2.0 s on declared fixture/environment; record sample counts and cold/warm conditions. Storage purge is separately observed without a fabricated 2 s threshold. **Depends on:** T012.

### Implementation (Green → Refactor)

- [ ] T018 [US1] Implement notebook repository and owner-locked create/idempotency in `packages/db/src/notebooks.ts` (FR-WM-01, FR-WM-04, FR-WM-07); pass notebook subsets of T009/T014. Enforce 100 live notebooks, normalized title and timestamps, no owner supplied by client, and no reuse of a deleted notebook through replay. **Depends on:** T014, T013, T010.

- [ ] T019 [US1] Implement transactional deletion fence, durable cleanup operation/outbox and retry lookup in `packages/db/src/cleanup.ts` and notebook service orchestration in `apps/api/src/services/workspace.ts` (FR-WM-01, FR-WM-04); pass T014/T016 service subsets. Delete owned rows immediately; retain only payload-free cleanup metadata, cancel attempts and never recreate deleted parent records. **Depends on:** T018, T016.

- [ ] T020 [US1] Implement authenticated notebook routes, native HTTP adapter, SPA route fallback and deletion-status responses in `apps/api/src/routes/notebooks.ts`, `http.ts`, `server.ts` (FR-WM-01, FR-WM-04); pass T013 notebook subsets. Return 202 while physical purge pending and 204 only when verified; content/child reads return 404 after logical delete. Quota summary integration finishes in T039. **Depends on:** T019, T013, T008.

- [ ] T021 [US1] Implement notebook home/title/delete flows and minimal Add sources handoff in `apps/web/src/notebooks.ts`, `notebook-title.ts`, `delete-notebook.ts`, `main.ts`, `index.html` (FR-WM-01); pass T015. Preserve draft/error handling; do not introduce full responsive layout, ingestion controls with fake success, or Studio functionality. **Depends on:** T020, T015, T017.

- [ ] T022 [US1] Implement idempotent cleanup worker and durable outbox-drain/recovery entrypoint in `apps/worker/src/notebook-cleanup.ts` (FR-WM-01, FR-WM-04); pass T016. Retry generation-specific deletions, track pending capabilities/sessions, reject late completion, and mark Purged only after final quiescent sweep. Provide recoverable dispatch after crash even when the original enqueue failed; no new cloud service. **Depends on:** T019, T016.

- [ ] T023 [US1] Run US1 Green then behavior-preserving refactor against `apps/api/test/workspace.test.ts`, `apps/web/test/workspace.spec.ts`, `apps/worker/test/notebook-cleanup.test.ts`, `packages/db/test/workspace.integration.test.ts`; append Red/Green commands, case IDs and actual outcomes to `specs/001-workspace-foundation/validation.md` (FR-WM-01, FR-WM-04). Keep real ingestion/chat cascades explicitly pending T044/T048. **Depends on:** T021, T022.

**Checkpoint**: Record only verified results; unavailable or externally blocked checks remain open.

## Phase 4: User Story 2 - Isolated Knowledge Context (Priority: P1)

**Goal / Independent Test**: Ensure every source read is notebook/owner/selection/revision scoped. Independent proof: two-owner/two-notebook scope-guard tests and deterministic fixtures; final chat answers require package 1.3.

### Tests (MANDATORY — observe Red first)

- [ ] T024 [US2] Extend and run failing C-02 guard tests in `packages/contracts/test/scoped-context.test.ts` (C-02, FR-WM-04): missing/empty/non-Ready selection, cross-notebook source even with same owner, unknown source, entire-request rejection with zero chunks and 403/InvalidScopeError; inspector singleton cannot mutate generation selection. Capture Red evidence. **Depends on:** T023.

- [ ] T025 [US2] Extend and run failing isolation/race tests in `packages/db/test/workspace.integration.test.ts` (FR-WM-04, C-02): two owners/two notebooks, independent identical-file sets, submission snapshot unchanged by later checkboxes, deletion/replacement/revocation between capture/read/publication, and serialization in both race orders. Capture Red evidence. **Depends on:** T023.

- [ ] T026 [P] [US2] Write and run failing consumer-provenance contract tests in `packages/contracts/test/context-provenance.test.ts` (C-02, FR-GC-01, FR-GC-06, NFR-EVAL-04): exclude both question/answer when any used source/revision is ineligible, including uncited/tool/summary provenance; missing provenance excluded; cache keys include notebook/exact revisions/authorization/language/parameters; mere deselection viewability differs from deleted/revoked placeholders. Capture Red evidence. **Depends on:** T023.

- [ ] T027 [P] [US2] Write and run failing deterministic isolation evals in `packages/evals/test/workspace-isolation.test.ts` using `packages/evals/fixtures/workspace-isolation.json` (FR-WM-04, NFR-EVAL-04): OMEGA-991 absent from notebook B context, tampered IDs never return content and no foreign chunks pass a defense-in-depth result check. Capture Red evidence; final chat refusal is an external integration assertion. **Depends on:** T023.

### Implementation (Green → Refactor)

- [ ] T028 [US2] Implement owner/Ready/revision validation and short read/publication fencing in `packages/db/src/scope-guard.ts` (C-02, FR-WM-04, NFR-EVAL-04); pass T024/T025. Bind principal/query/purpose per request, fail stale snapshots rather than recapture, filter notebook and explicit IDs/revisions, and never hold DB locks across model/storage calls. **Depends on:** T024, T025.

- [ ] T029 [US2] Implement shared eligibility/cache-identity helpers in `packages/contracts/src/scoped-context.ts` and integrate scope guards with notebook operations in `apps/api/src/services/workspace.ts` (C-02, FR-WM-04, NFR-EVAL-04); pass T026. Consumers import the one helper; no separate live retrieval adapter, chat history store or prompt implementation is added here. **Depends on:** T028, T026.

- [ ] T030 [US2] Connect deterministic eval fixtures to the real foundation scope guard in `packages/evals/test/workspace-isolation.test.ts` (FR-WM-04, NFR-EVAL-04); pass T027 with zero leaked chunks. Keep full retrieval and response assertions identified for T044, not replaced by successful mocks. **Depends on:** T029, T027.

- [ ] T031 [US2] Run US2 Green/refactor and document exact zero-leakage, authorization and snapshot race results in `specs/001-workspace-foundation/validation.md` (FR-WM-04, C-02, NFR-EVAL-04). Confirm all source-read consumers introduced so far cross the C-02 guard and no duplicate shared schema exists. **Depends on:** T030.

**Checkpoint**: Record only verified results; unavailable or externally blocked checks remain open.

## Phase 5: User Story 3 - Resource Quotas (Priority: P2)

**Goal / Independent Test**: Enforce authoritative limits and atomic reservations. Independent proof: two-connection races, numeric boundary tests and quota UI; parser receipt checks integrate with package 1.2.

### Tests (MANDATORY — observe Red first)

- [ ] T032 [US3] Write and run failing quota DTO/config tests in `packages/contracts/test/source-admission.test.ts` (FR-WM-07): integer source limit 50–300/default 50, invalid 49/301/noninteger configuration fails startup, 100 notebooks, nonnegative actual/declared bytes and extracted words, immutable attempt IDs; lowering configured limit below usage blocks admission without deleting content. Capture Red evidence. **Depends on:** T031.

- [ ] T033 [US3] Extend and run failing two-connection admission tests in `packages/db/test/workspace.integration.test.ts` (FR-WM-07): 49/50 plus two uploads admits one, winner failure releases immediately, duplicate failure/dismissal cannot double-release; batch 45/50 +10 admits first five; Uploading/Processing/Ready consume slots and Failed does not; duplicate attempt replay and delete/finalize races. Capture Red evidence. **Depends on:** T031.

- [ ] T034 [P] [US3] Write and run failing trusted-worker boundary tests in `packages/contracts/test/source-boundaries.test.ts` (FR-WM-07, FR-SI-01): independent 199999999/200000000/200000001 bytes and 499999/500000/500001 words, 215 MB PDF rejected pre-upload, 40 MB/520000-word TXT fails with “Exceeds 500,000 words limit”, dishonest declaration detected, partial purge and slot release; no client word count trusted. Capture Red evidence. **Depends on:** T031.

- [ ] T035 [US3] Extend and run failing quota UI/API cases in `apps/web/test/workspace.spec.ts`, `apps/api/test/workspace.test.ts` (FR-WM-07): counters in sidebar/modal, at-limit disabled Add source/dropzone, server rejection despite enabled/tampered UI, counts at 50 and 300, failed-row dismissal leaves usage unchanged, errors identify exceeded limit. Capture Red evidence. **Depends on:** T031.

- [ ] T036 [P] [US3] Write and run failing admission-latency assertion in `apps/api/test/quota-performance.test.ts` (FR-WM-07): declared >200000000 bytes rejected within <=200 ms on declared fixture/environment before issuing a signed upload; actual byte checks remain separate. Capture requirement-related Red evidence, not an absent-server timing error. **Depends on:** T031.

### Implementation (Green → Refactor)

- [ ] T037 [US3] Implement source admission DTOs/config validation and exports in `packages/contracts/src/source-admission.ts`, `packages/contracts/src/index.ts` (FR-WM-07, FR-SI-01); pass T032/T034 numeric validation subsets. Preserve inclusive byte/word limits and trusted-worker distinction. **Depends on:** T032, T034.

- [ ] T038 [US3] Implement reserve/receive/fail/dismiss and Ready-transition validation in `packages/db/src/quota.ts` (FR-WM-07, FR-SI-01); pass T033/T034 state subsets. Count occupied rows under notebook lock, preserve ordered batch results, lock order and once-only releases. Re-sync contract retains old revision/slot on failure but no v1 re-sync feature is implemented. **Depends on:** T037, T033, T028.

- [ ] T039 [US3] Integrate quota summary/admission service and error mapping in `apps/api/src/services/workspace.ts`, `apps/api/src/routes/notebooks.ts`; couple partial-object cleanup through `apps/worker/src/notebook-cleanup.ts` (FR-WM-07, FR-WM-01). Pass T035/T036 and remaining T013 quota assertions. Package 1.2 later owns signed-upload/public source endpoints and parser-driven Ready publication. **Depends on:** T038, T035, T036, T022.

- [ ] T040 [US3] Implement shared capacity display/disable/error-row behavior in `apps/web/src/quota-indicator.ts` and integrate with `apps/web/src/notebooks.ts`, `apps/web/src/main.ts` (FR-WM-07); pass T035. Use server-authoritative occupancy, no client-only limit enforcement; integrate the same component with package 1.2 upload UI later. **Depends on:** T039, T035.

- [ ] T041 [US3] Run US3 Green/refactor, all concurrency/boundary regressions and occupancy assertions; append actual evidence to `specs/001-workspace-foundation/validation.md` (FR-WM-07, FR-SI-01). Keep real object-byte/parser-word verification pending external package 1.2; do not mark unavailable ingestion assertions complete. **Depends on:** T040.

**Checkpoint**: Record only verified results; unavailable or externally blocked checks remain open.

## Phase 6: Polish, Integration & Release Evidence

**Goal / Independent Test**: Reconcile infrastructure, run actual integrations and gates, and hand off honest evidence. Downstream checks remain open until their prerequisites exist.

- [ ] T042 Write failing infrastructure acceptance assertions before any remaining configuration edit in `infra/tests/workspace-policy.test.ts` (FR-WM-01, FR-WM-04, NFR-SEC-01): private/versioned application-content buckets, zero soft-delete retention, conflicting holds/retention detection, keyless least privilege, EU resources and isolated cleanup queue. First resolve T001 ownership and map assertions to the approved integrated infra layout; run with actual available runner, otherwise report UNAVAILABLE. **Depends on:** T041, T001.

- [ ] T043 After the infrastructure owner handoff, satisfy T042 by reusing/updating the approved infra baseline; planned fallback paths are `infra/workspace.tf`, `infra/variables.tf`, `infra/outputs.tf` (FR-WM-01, NFR-SEC-01). Do not create competing resources if `infra/stacks/v1_foundation/main.tf` or modules already provide them; update plan path ownership and rerun analyze before such path/design changes. No apply/API activation without required approval. **Depends on:** T042.

- [ ] T044 Author and transfer failing cross-package integration assertions in `packages/db/test/workspace-cascade.integration.test.ts`, `packages/evals/test/workspace-consumers.test.ts` and `apps/worker/test/source-limits.integration.test.ts` before dependent behavior implementation (FR-WM-01, FR-WM-04, FR-WM-07, FR-GC-01, NFR-EVAL-02, NFR-EVAL-04). Cover real 2-source/15-chunk/1-thread cascade, identical-file independence, actual bytes/parsed words, C-02 inspection/retrieval, OMEGA refusal, uncited history leakage and D13 invalid-citation refusal; agree handoff with 1.2/1.3 owners. Missing downstream runners are UNAVAILABLE, not Red; downstream implementation waits for runnable requirement-related Red evidence. **Depends on:** T041.

- [ ] T045 Add required check orchestration in `.github/workflows/ci.yml` and verify it invokes real scripts from `package.json` (Gate v1.0, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04). Preserve shared infra CI after T001; lint/type/unit/contract/deterministic on every PR, judged suites on retrieval/prompt/chat and release gates. No skip/empty-suite success; unavailable dependent suites keep corresponding integration checks outstanding. **Depends on:** T041, T001.

- [ ] T046 Exercise actual approved identity/storage integration with `apps/api/test/identity.integration.test.ts` and `apps/worker/test/notebook-cleanup.integration.test.ts` (FR-WM-01, FR-WM-04, NFR-SEC-01), reusing T007/T016 acceptance cases: all generations, active uploads/resumable sessions, retry recovery, deletion status privacy, token revocation and no production fixture auth. Record missing permissions/configuration as UNAVAILABLE; do not weaken retained-object purge checks. **Depends on:** T043, T022, T008.

- [ ] T047 Run declared performance cases in `apps/web/test/workspace-performance.spec.ts`, `packages/db/test/deletion-performance.test.ts`, `apps/api/test/quota-performance.test.ts`; record build/sample/topology/cold-warm data in `specs/001-workspace-foundation/validation.md` (FR-WM-01, FR-WM-07). Prove <=1.0 s P95 creation, <=2.0 s DB/chunk deletion and <=200 ms oversized admission; report physical purge separately. Full chunk timing needs integrated 1.2. **Depends on:** T041, T046, T017, T036.

- [ ] T048 After packages 1.2/1.3 integrate the handed-off tests from T044, execute their real implementations against `packages/db/test/workspace-cascade.integration.test.ts`, `packages/evals/test/workspace-consumers.test.ts`, `apps/worker/test/source-limits.integration.test.ts` (FR-WM-01, FR-WM-04, FR-WM-07, NFR-EVAL-04). Keep this task open until every obligation passes; it does not block release of the foundation interfaces to those packages. **Depends on:** T044, T046.

- [ ] T049 With package 1.4 and the integrated runnable v1 available, record actual full-gate evidence in `specs/001-workspace-foundation/validation.md` (Gate v1.0, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04): PDF/MD C-01 upload, hallucination <0.05, citation ID precision=1.0 plus semantic support, rejection >=99%, leakage=0, and deterministic citation navigation. Do not invent a judged runner or declare v2 unlocked from foundation-only tests. **Depends on:** T048, T045, T047.

- [ ] T050 Run `node scripts/check-spec-integrity.mjs`, available quickstart checks and final diff review; update `specs/001-workspace-foundation/validation.md` and `implementation-handoff.md` with task IDs, Red/Green evidence, unavailable checks, branch/commits and downstream blockers (Gate v1.0). Maintain canonical `specs/001-workspace-foundation/tasks.md` only after verifying integrated results; distinguish foundation handoff from full package/release completion. **Depends on:** T041, T045.

**Checkpoint**: Record only verified results; unavailable or externally blocked checks remain open.

## Dependencies & Execution Order

```text
analyze + ownership → T001 → T002–T004
  → C-01/workspace Red T005 → schema T006
  → auth Red T007 → auth T008
  → DB Red T009 → base migration T010
  → C-02 Red T011 → envelope T012
  → US1 tests T013–T017 → implementation T018–T022 → T023
  → US2 tests T024–T027 → implementation T028–T030 → T031
  → US3 tests T032–T036 → implementation T037–T040 → T041
  → infrastructure test/config T042–T043; downstream tests T044; CI T045
  → real identity/storage T046; timing T047
  → external 1.2/1.3 integration → T048
  → external 1.4 integrated gate → T049
```

T050 records the foundation handoff after local story/CI verification; it may record T042–T049 as blocked, but cannot mark them complete. T048 does not prevent handing usable 1.1 interfaces to 1.2: its external dependency exists specifically to avoid a circular implementation prerequisite. T049 verifies the full release only after 1.4; it does not implement another package's backlog.

### Parallel opportunities and examples

- Foundation: after T004, T005 schema tests and T007 auth tests have disjoint files; schema implementation still waits for its own Red evidence.
- US1: after T012, T017 timing tests can be authored alongside T013 HTTP tests or T016 cleanup tests, with separate fixture/output ownership. All tests must be runnable enough to capture genuine Red before their covered implementation.
- US2: after T023, T026 provenance tests and T027 isolation eval tests are disjoint and marked [P]. T024/T025 touch shared files and are serialized.
- US3: after T031, T034 numeric worker-boundary tests and T036 latency tests are disjoint and marked [P]; T033/T035 reuse shared database/browser/API test files and are serialized.
- Implementation tasks are deliberately not marked [P]: the plan reuses service/schema/migration entrypoints. Do not split those files between workers without a new analyzed, disjoint handoff. Each worker reports qualified task IDs and commits; the package owner integrates evidence before ticking checkboxes.

## Requirement and Scenario Coverage

| FR card / acceptance or cross-package obligation | Red tasks | Implementation / verification |
| :--- | :--- | :--- |
| FR-WM-01 create; default title/UUID; open modal; reopen | T005, T009, T013–T015 | T006, T010, T018–T021, T023 |
| FR-WM-01 rename/whitespace; 1–100 Unicode code points; Enter/blur/card menu; network rollback | T005, T013–T015 | T006, T018–T021 |
| FR-WM-01 cascade; 2 sources/15 chunks/1 thread; cancel/tab B404; raw/media purge and late writes | T014–T016, T044 | T019, T020, T022, T046, T048; future entities integrate before their release |
| FR-WM-01 creation <=1.0s P95; database/chunk delete <=2.0s | T017 | T021, T022, T047; real chunk cascade waits for 1.2 |
| FR-WM-04 OMEGA-991 isolation; zero leakage across every store/read | T024, T025, T027, T044 | T028–T031, T048 |
| FR-WM-04 tampered source ID; HTTP403/InvalidScopeError; identical-file independence | T024, T025 | T028–T031, T048 |
| FR-WM-07 215MB rejection; actual <=200000000 bytes; independent <=500000 words, 40MB/520000-word failure | T032, T034, T036, T044 | T037–T039, T047, T048 |
| FR-WM-07 51st source blocked; 50–300 config/default50; 100-notebook limit | T009, T032, T033, T035 | T018, T037–T041 |
| FR-WM-07 final-slot race, 45/50+10 ordered batch, failure release/dismissal | T033 | T038–T041 |
| C-01 five fields/locator union; C-02 signature and revision provenance | T005, T011, T024, T025 | T006, T012, T028, T029 |
| Explicit scope, Ready-only, submission snapshots, access rechecks, singleton inspector | T011, T024, T025, T044 | T012, T028, T048 |
| History/cache/drilldown hygiene, deleted placeholders, immediate invalid-citation refusal | T026, T044 | T029 local helper; actual consumer/refusal T048 via 1.3 |
| NFR-SEC-01/FR-WM-04 identity, private data, residency; no consumer keys or implied zero retention | T007, T042, T044 | T008, T043, T046; enterprise model endpoints checked with 1.3/1.4 |
| Gate v1.0, deterministic and judged cadence; no v2 unlock from package tests | T044, integrated 1.4 tests | T045, T049 |

All 9 original Gherkin scenarios map to rows above. The retained supplemental US1/US2/US3 in spec.md are additional cases of the same three stories, not three extra stories. Quickstart W01–W15 map respectively to T015, T005/T014/T015, T014/T016/T044, T027/T044, T024/T025, T034/T036/T044, T034/T044, T032/T035, T033, T009/T014, T025/T033/T044, T011/T024/T025, T026/T044, T016/T046, T007/T042/T046.

## Implementation Strategy and Stop Conditions

1. Analyze these artifacts and resolve T001 coordination before implementation. Reconcile any newer accepted constitution/architecture first; pending changes in another checkout do not silently replace this baseline.
2. Bootstrap the harness, then capture Red and implement each boundary in dependency order. Shared artifacts merge via scoped PR before downstream consumers depend on them.
3. First demonstrable slice is US1 notebook lifecycle with foundation authentication and required notebook quota. It is not the full MVP: US2 isolation, US3 source quotas and all release packages are required for v1.
4. Handoff the verified foundation API/contracts and explicit integration tests to 1.2/1.3 while retaining unchecked integration obligations. No future Studio/sharing/re-sync implementation is pulled into 1.1.
5. Current task-generation validation checks structure, dependency ordering and coverage only. Lint/type/unit/contract/eval/UI/runtime gates are UNAVAILABLE until implemented. No checkbox is marked complete by this stage. Next valid stage is `/speckit-analyze` with `SPECIFY_FEATURE_DIRECTORY=specs/001-workspace-foundation`.
