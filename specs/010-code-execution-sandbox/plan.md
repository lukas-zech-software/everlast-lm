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

Exact intended implementation boundaries:

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

New files in detail:

- Migration `packages/db/migrations/0010_code_execution.sql` (after package 3.1's 0009; never alter 0001–0009) and `packages/db/src/code-execution.ts`; `chat-history.ts`, `cleanup.ts` and `index.ts` carry projection, clear and cleanup integration.
- API: `apps/api/src/chat/execution/{runtime,manifest,controller,output,reconcile}.ts` and `apps/api/src/routes/chat-charts.ts`.
- Infra: `infra/modules/code_execution/{main,variables,outputs}.tf` and `tests/runtime_policy.tftest.hcl`, composed into dev; no apply or API enablement during planning.
- Tests: API `apps/api/test/code-execution{,-runtime,-runtime.integration,-manifest,-model,-output,-retry,-recovery,-scope,-v2-compatibility}.test.ts` and `chat-charts.test.ts`; DB `packages/db/test/code-execution{,-recovery,-history}.integration.test.ts`; web `apps/web/test/code-execution{.test,.spec,-retry.test,-history.spec}.ts`; fixtures `packages/evals/src/fixtures/code-execution.ts`; evals `packages/evals/test/code-execution{.eval,-performance}.test.ts`; runner `scripts/eval-v3-code-execution.mjs` writing `specs/010-code-execution-sandbox/evidence/gate-v3-code-execution.md`. New API pure-unit tests must be registered in the unit project list.

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

## Current baseline constraints (FR-GC-08, FR-GC-06, C-02, CC-08)

- **Retrieval and evidence:** use the current `chunks` retrieval and snapshot verification. Default retrieval returns 12 chunks, so whole-table computations need extra original evidence behind C-02 under the captured snapshot (spec edge case). Add exactly those inputs to the verified citation universe; never read raw storage.
- **Persistence:** v2 data is persisted (D16, migrations 0005–0008; DEV-04 closed). Reuse those tables; never re-promote the removed `v3-draft` schemas. v2 stores resolve their pool via `runWithV2Persistence`; sandbox SQL uses its injected app pool, never the process-default selector or memory fallback outside tests.
- **Projections:** `VisibleMessage`, web `ChatMessage` and the v2 `configureChatMessageReader` are separate projections; update all trace-aware consumers together, keep hidden traces out of save-note/feedback paths, and keep chat-clear deletion atomic.
- **Restart and admission:** the API runs one instance with in-process v2 work. Its report/Guide startup sweeps do not give sandbox restart recovery, exclusive admission or provider termination, so keep the durable execution fence and reconcile unknown outcomes without replaying Python.
- **Web readiness:** sources and history must load before a quantitative or clarification submission is accepted. This does not replace API checks and does not start the 2.5 s progress clock.
- **Rollout:** Node 26; the API runs pending migrations on start (`MIGRATE_ON_START=true`).

## Validation and evidence (FR-GC-08, NFR-EVAL-01..04, CC-02)

Timing follows spec SC-003: freeze fixtures, runtime/config, cohort sample counts (cold/warm, one/two users) and readiness classification before collection; nearest-rank P95 (`ceil(0.95*N)`); keep every run and fail cohorts with failures or timeouts. Targets: sandbox create→completion ≤4.0 s P95 and sufficient-intent submission→real "Running code…" ≤2.5 s, separate from answer TTFT. Trace states follow spec FR-007; cache keys follow FR-011 (no new execution-result cache is needed). Auth statuses stay `requireOwnedNotebook` (404 missing, 403 foreign). Eval cadence follows Constitution 2.0.0. CC-01..08 are design PASS; runtime results remain UNAVAILABLE.

Refresh history (baseline commits and what changed) is in [refresh-report.md](refresh-report.md).
