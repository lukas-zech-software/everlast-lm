# Implementation Plan: Quantitative Code Execution Sandbox

**Branch**: `codex/v3-tasks-analysis-pr-20261022` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v3/package_3_2_code_execution_sandbox.md`
**SRS IDs in Scope**: FR-GC-08; FR-GC-01/02/03/06, FR-SI-03/05, FR-WM-04/05, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04 | **Release Gate**: Gate v3.0 #2
**Input**: `specs/010-code-execution-sandbox/spec.md`

## Summary (FR-GC-08, C-02)

Extend grounded chat with a bounded Python execution tool over immutable scoped inputs, exact Computed values, validated chart/citation publication and inspectable ordered retry traces. Consume package 3.1's C-01-compatible inputs without changing ingestion or Studio. The ADK agent decides when to compute; a deterministic controller enforces execution/security/retry rules. Accepted clarifications require a focused follow-up before ambiguous statistical calculations and preservation/display of both retry attempts.

**Planning status: complete through Phase 1 design.** D18 records the owner's superseding acceptance of the managed default 2 vCPU / 1.5 GB profile. The primary path is Agent Platform Code Execution over REST from TypeScript. D19 records owner acceptance of the managed service and makes the separate R6 qualification gate obsolete. Normal application integration and release tests remain; no new runtime measurements are claimed. Tasks are now generated in tasks.md; no implementation is performed.

## Technical Context (FR-GC-08, C-01/C-02, NFR-SEC-01/02)

- Language/version: TypeScript 5.x strict ESM, Node 26, pnpm workspace; generated Python only inside the sandbox.
- Dependencies: shared Zod; ADK TypeScript for grounded chat/tool selection; enterprise Gemini model tier selected by quality/latency checks. No new agent framework/datastore.
- Runtime: Agent Platform Code Execution, Python, default 2 vCPU / 1.5 GB RAM; one fresh sandbox per attempt under an IaC-managed parent runtime without deployed agent code (D18). Research is resolved; the former R6 record in r6-feasibility.md is retained as obsolete history under D19.
- Storage: existing single Cloud SQL Postgres for ChatMessage trace and private Cloud Storage chart objects. No provider memory/session store for user conversation state.
- Authentication/region map: API, database, chart storage and intended execution service in europe-west4; enterprise no-training endpoints and keyless service identity. Region exceptions: none approved; if a runtime is unavailable there, stop rather than select a different region.
- Performance: submission-to-real-running-code ≤2.5 s; cold/warm sandbox boot plus standard-tabular execution ≤4.0 s P95; per-attempt execution ≤15.0 s. Code progress never counts as validated answer TTFT. D17 warm-only chat acceptance does not relax these code-execution criteria.
- Constraints (D20): managed sandbox limits ≤2 vCPU, ≤1.5 GB RAM, provider-limited file system, ≤100 MB file I/O per request/response; no network; scoped inputs passed as copies; application-enforced 15.0 s deadline; required Python numerical libraries preinstalled; one exception retry and zero timeout/OOM retries.
- Testing: existing Vitest and Playwright runners; new package integration scenarios and deployed test environment are UNAVAILABLE until implemented. Main now has real `pnpm dev` orchestration (PostgreSQL, migrations, API/web and worker) and `pnpm db:migrate`. They do not supply managed sandbox integration or its test results. Deterministic NFR-EVAL-02/04 suites run every PR; judged NFR-EVAL-01/03 and semantic support run once per release gate on a fixed stratified 50-case sample, recording IDs/composition/hash (Constitution 2.0.0).
- Prerequisites: Gate v2 evidence before v3 implementation; package 3.1 plan/contract precedes this work; existing C-01/C-02, auth, history, cancellation and validated publication. Package 3.4 consumes these declared timing populations; 3.3 remains separate.

## Constitution Check (CC-01..CC-08)

Statuses refer to design review, not deployed acceptance. D18 resolves the former CPU/RAM mismatch; D19 accepts the managed provider and removes the separate R6 prerequisite; ordinary implementation tests are not yet executed.

| Gate | Principle | Pre-research | Post-design | Evidence |
| --- | --- | --- | --- | --- |
| CC-01 | Traceability | PASS | PASS | Every artifact maps FR-GC-08 and shared IDs; findings flow into card/spec/architecture |
| CC-02 | Test-first | PASS | PASS | quickstart requires failing contract/security/e2e tests before implementation; absent gates UNAVAILABLE |
| CC-03 | Scope/snapshot | PASS | PASS | C-02 only, immutable inputs, revision/auth checks and generation epoch fence |
| CC-04 | Citations/leakage | PASS | PASS | Buffered publication, invalid citation refusal, private charts and all-attempt access hygiene |
| CC-05 | Contracts/pipelines | PASS | PASS | Shared DTOs, unchanged C-01/C-02; ADK reasoning with deterministic controller |
| CC-06 | Release/package order | PASS | PASS | Planning may precede Gate v2; implementation may not; predecessor 3.1 inherited |
| CC-07 | Security/residency | PASS | PASS | Managed isolation path, Owner checks and EU map; owner-accepted managed service (D19), with application scope/security and ordinary integration tests retained |
| CC-08 | Platform/cost | PASS | PASS | D18 accepted managed default; existing TS/Cloud Run/Postgres stack, no new framework or idle application deployment |

## Project Structure (FR-GC-08, FR-GC-06)

Artifacts: plan.md, research.md, r6-feasibility.md, data-model.md, contracts/interfaces.md, quickstart.md beside existing spec/checklist. tasks.md supplies the test-first implementation sequence.

Exact intended implementation boundaries (verified against main dc25c46):

`ChatService.runTurn` already captures a `RequestScopedContextProvider`, retrieves hybrid scoped chunks, filters history, buffers `GroundedModel.generate`, verifies with `verifyDraft`, and publishes through `publishTurn`. Preserve these controls. `AdkGroundedModel` currently exposes structured generation, not sandbox tools; extend its model boundary/tool integration explicitly rather than assuming an existing execution callback. `TurnEvent` and route SSE currently serialize only phase/final fields; extend both schema and serializer for truthful execution progress. `GroundedDraftSchema` is strict and recognizes answered/not_in_sources only: add typed clarification/computation output and its safe verifier/publication path, preserving existing claim citation requirements. Do not disguise a clarification as an uncited factual answer. Existing request replay occurs after publication; the process-local active AbortController map is cancellation tracking, not durable single-request admission. Implement/reuse a database-backed per-user/notebook active-request fence with crash reconciliation before admitting sandbox execution, rejecting an overlapping request while preserving its draft (FR-GC-01/06, NFR-EVAL-04).


| Owner boundary | Change |
| --- | --- |
| packages/contracts/src/package-v3-2.ts (new) | Execution trace, result/artifact and adapter DTO schemas |
| packages/contracts/src/package-v1-3.ts, index.ts | Add nullable trace to strict ChatMessage and export schemas; legacy read compatibility |
| packages/db/src/chat-history.ts, cleanup.ts; new numbered migration | Persist/reload trace and artifact references in SQL and test doubles |
| apps/api/src/chat/execution/ (new) | Scoped manifest, controller, runtime adapter, output validation and cleanup |
| apps/api/src/chat/{service,model,draft,verifier,prompt}.ts; routes/chat.ts | Extend actual ChatService/AdkGroundedModel, strict draft and verification, SSE status/final contracts and cancellation |
| apps/api/src/routes/chat-charts.ts (new); app.ts, server.ts | Authorized private chart delivery |
| apps/web/src/chat/panel.ts, lib/types.ts; chat/code-execution.ts (new) | Computed result/chart UI and ordered code drawer |
| packages/evals/test; existing package test directories | Golden arithmetic, citations, leakage and adversarial isolation scenarios |
| infra/ | Selected managed service resources through OpenTofu after required owner API approval; no R6 gate |

Shared schema exports, migration numbering, chat transport and cleanup changes are serialized after package 3.1. Preserve predecessor contract definitions rather than replacing them. Do not touch Studio implementation, package 3.3 planning or later-release features.

## Phase 0 Research (FR-GC-08)

research.md records source-backed runtime mismatch and resolved decisions for manifests, retries, schema evolution, chart authorization and repo reuse. Parent/package rule limits active package agents to one; research was performed within this package agent. The owner superseded Option A with the managed-default envelope (D18). All planning decisions are resolved. D19 makes the separate R6 qualification obsolete. Implement against the accepted managed dependency and retain normal integration/release tests.

## Phase 1 Design (FR-GC-08, NFR-EVAL-01..04)

The controller snapshots authorized C-02 inputs, asks for missing statistical intent, creates each isolated attempt, captures outputs and destroys the execution environment. Only first-attempt Python exceptions receive one correction. Publication rechecks revisions, access and citations; saves ordered trace and exact results atomically; emits code and charts only after validation. All terminal/security errors produce safe refusal/error without invented numbers. Clearing chat or source invalidation fences late callbacks and invalidates chart delivery.

Data-model and contracts specify message migration compatibility, artifact provenance, internal errors, status semantics and cleanup. Quickstart binds acceptance scenarios to future failing tests and records the current UNAVAILABLE evidence boundary. The selected runtime lifecycle is specified in contracts/interfaces.md. One or two simultaneous users is the declared workload context; D18 increases only CPU/RAM. D19 permits implementation against the owner-accepted managed service without a separate provider spike. Defects found during ordinary integration tests follow the normal correction and flow-back process.

## Complexity Tracking (FR-GC-08, D18/D19)

| Gate / decision | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| D18 / FR-GC-08 | Owner-approved 2 vCPU / 1.5 GB managed default | Retaining former caps required an unqualified fallback; the owner chose the managed profile instead. 4 vCPU / 4 GB remains excluded. |

D18 and the SRS amendment approve the CPU/RAM change only. This changes project acceptance limits, not a verified reference-product deviation, so no DEV entry is inferred. Existing D17/DEV-05 remains restricted to NFR-PERF-01 warm-service chat timing.

## Main reconciliation and validation cadence (FR-GC-08, C-02, NFR-EVAL-01..04)

Use current `chunks` retrieval and snapshot verification, not an obsolete fixture-only baseline. Default retrieval limit is 12; whole-table computations require sufficient original C-02 evidence under the captured snapshot, or an honest insufficiency response. Expand evidence only behind C-02 and update the verified citation universe with exactly those supplied inputs; never read raw storage as a shortcut. Serialize contracts/schema and migrations after 3.1; retain D15 canonical text publication and reject stale source revision inputs. D16/specs/013 now persists v2 records and closes DEV-04; it does not provide durable sandbox admission or provider cleanup. Main's `VisibleMessage`, web `ChatMessage` and v2 `configureChatMessageReader` are separate real projections; all trace-aware consumers must be updated together, without leaking hidden traces into save-note/feedback paths. Existing v2 behavior remains compatible.

Static review passes CC-01..08 under Constitution 2.0.0 before research and after the refreshed design. These are design conclusions, not runtime/security/eval passes. Release candidate judged evidence is one fixed stratified 50-case run with dataset hash, IDs and composition; deterministic PR checks remain required. tasks.md is included; no implementation is performed.

## Second main refresh: persisted v2 baseline (2026-10-21; FR-GC-08, FR-GC-06, C-02)

Main `dc25c46` applies v2 migrations `0005`–`0008` and closes DEV-04. Reuse those tables and existing repositories; allocate any sandbox migration after all applied migrations and predecessor 3.1 changes, never re-promote removed `v3-draft` schemas. The deployment still runs one API instance with in-process v2 background work. Its startup report/Guide sweeps do not establish safe sandbox restart recovery, exclusive execution admission or actual provider termination. Keep the separately designed durable execution fence, unknown-outcome reconciliation without Python replay, and ordinary integration tests.

V2 stores now resolve the application's pool through `runWithV2Persistence`/AsyncLocalStorage; production request and background continuations that use those stores must retain this scope. Sandbox SQL uses its explicitly injected app pool. Do not rely on the process-default selector or memory fallback outside tests. The v2 chat reader still closes over its configured pool: its projection is an integration boundary to audit, not proof that every callback is isolated by AsyncLocalStorage. Preserve the existing visible-message filtering, saved-response conversion and atomic feedback/follow-up deletion on chat clear. New traces/charts must obey the same invalidation before any consumer receives them.

Preserve web chat's readiness gate: sources and history must be loaded before a quantitative or clarification submission is accepted, preventing missing-scope turns and history replacement of new results. This local gate neither replaces API scope/admission checks nor starts the ≤2.5 s progress clock before actual sufficient-intent submission. All CC-01..CC-08 design conclusions remain PASS; application integration and runtime test results remain UNAVAILABLE.

Final baseline `ce3626b` (FR-GC-08, CC-08): Node 26 is selected by current workspace/CI configuration. API infrastructure now sets `MIGRATE_ON_START=true`; reuse its existing migration runner for future numbered sandbox migrations. This wiring does not supply sandbox schema, admission, cleanup or sandbox integration evidence.

## Owner-accepted managed dependency (2026-10-22; FR-GC-08, D19)

The project owner accepts Google's Agent Platform (Agent Engine) managed Code Execution sandbox as the selected service dependency. R6 is obsolete: no separate provider feasibility spike, qualification dossier or R6 implementation/deployment admission gate is required. D18's 2 vCPU / 1.5 GB default and the existing scoped-input, network, scratch, timeout, retry, cleanup, authorization, citation and residency requirements remain. Verify the application integration and required behavior through normal spec-derived tests and release gates; this decision records owner acceptance, not newly executed runtime evidence. Switching runtimes requires a new explicit architecture decision. Task generation proceeds without an R6 spike or admission task.

## Task-generation integration refinements (2026-10-22; FR-GC-08, FR-GC-06, C-02, CC-01/02)

The numbered migration is reserved as `packages/db/migrations/0010_code_execution.sql`, after package 3.1's planned 0009. New DB operations live in `packages/db/src/code-execution.ts`; existing `chat-history.ts`, `cleanup.ts` and `index.ts` carry projection, clear and cleanup integration. Do not alter applied 0001–0008 or predecessor 0009.

Exact new API implementation files are `apps/api/src/chat/execution/{runtime,manifest,controller,output,reconcile}.ts` and `apps/api/src/routes/chat-charts.ts`; these extend the existing service/model/draft/verifier/prompt and app/server boundaries. The accepted parent-runtime module uses `infra/modules/code_execution/{main,variables,outputs}.tf`, `infra/modules/code_execution/tests/runtime_policy.tftest.hcl`, dev module composition and existing compute/project-services/IAM ports; no apply/API enablement occurs during task generation. Browser tests live under the configured `apps/web/test/` directory, never an undiscovered top-level tests/e2e path.

Planned API test files under `apps/api/test/` are `code-execution.test.ts`, `code-execution-runtime.test.ts`, `code-execution-runtime.integration.test.ts`, `code-execution-manifest.test.ts`, `code-execution-model.test.ts`, `code-execution-output.test.ts`, `code-execution-retry.test.ts`, `code-execution-recovery.test.ts`, `code-execution-scope.test.ts`, `code-execution-v2-compatibility.test.ts` and `chat-charts.test.ts`. DB tests under `packages/db/test/` are `code-execution.integration.test.ts`, `code-execution-recovery.integration.test.ts`, `code-execution-history.integration.test.ts`; web tests under `apps/web/test/` are `code-execution.test.ts`, `code-execution.spec.ts`, `code-execution-retry.test.ts`, `code-execution-history.spec.ts`. Shared fixtures are `packages/evals/src/fixtures/code-execution.ts`; unit/contract discovery uses existing Vitest projects, and new API pure-unit tests must be registered in its unit list rather than silently needing a database.

Eval files are `packages/evals/test/code-execution.eval.test.ts` and `packages/evals/test/code-execution-performance.test.ts`; benchmark runner `scripts/eval-v3-code-execution.mjs` writes `specs/010-code-execution-sandbox/evidence/gate-v3-code-execution.md`. Freeze fixture IDs, runtime/config, sample count per cold/warm one/two-user cohort and readiness classification before collection. Compute each P95 by nearest rank `ceil(0.95*N)`; include every attempted run, assigning no completed timing to failures/timeouts and failing that cohort rather than silently dropping them. Empty/insufficient declared samples mean UNAVAILABLE. Every successful cohort must satisfy create→completion≤4.0s P95 and sufficient-intent submission→real-running≤2.5s; retry time/attempts are separately retained, no reset and no claim of standard answer TTFT. This is normal package validation, not R6 qualification.

Cache/history coverage explicitly tests notebook/exact source revisions/effective authorization/output language/generation parameters and eligible-history exclusion. No new execution-result cache is required; any caching used by the integration must obey these keys and invalidation. A request rejected before allocating execution has no trace. If an allocated execution fails before any actual code attempt, persist Failed with zero attempts, null final_attempt_id and empty published_artifact_ids; after execution begins retain 1–2 actual attempts, never fabricate an attempt or exit 0. Existing auth behavior is 404 missing notebook/403 foreign notebook through requireOwnedNotebook.

## Implementation flow-back (2026-10-24; `[010-code-execution-sandbox] T048`; FR-GC-08, FR-GC-06, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04)

- **Shared fixture module**: Synthetic code-execution fixtures (`LATENCY_TABLE_PAGE`, `POPULATION_STDDEV`, `SAMPLE_STDDEV`, `CAGR_2021_2025`, `DECOY_PAGE`, `ADVERSARIAL_CODE`, `UNSAFE_SVGS`, `SAFE_SVG`, `TINY_PNG_BASE64`) live in `packages/testkit/src/code-execution-fixtures.ts` (`@everlast/testkit/code-execution-fixtures`), imported across API, DB, web, eval, and CLI benchmark suites without touching production bundles.
- **Sanitization & lease hardening**: Added `apps/api/src/chat/sanitize.ts` (`neutralizeMarkers`, `plainLabel`) registered in the Vitest `unit` project (`apps/api/test/chat-sanitize.test.ts`); wrapped `ExecutionController.run` (`apps/api/src/chat/execution/controller.ts`) in `try/catch` to abandon the lease on unexpected errors; added `ChatService.abortNotebook(notebookId)` (`apps/api/src/chat/service.ts`, `apps/api/src/routes/notebooks.ts`); extended `deleteSource` (`packages/db/src/source-sync.ts`) to synchronously invalidate dependent `chart_artifacts`.
- **Performance & gate runner**: Implemented `packages/evals/src/code-execution-performance.ts` (exported from `packages/evals/src/index.ts`) and `scripts/eval-v3-code-execution.mjs` (`pnpm eval:v3-code-execution`). Retained Gate v3.0 #2 report in `specs/010-code-execution-sandbox/evidence/gate-v3-code-execution.md`. Next package (3.3, `specs/011-studio-structure-extraction`) branches from this completed Package 3.2 commit and starts migrations at `0011`.
