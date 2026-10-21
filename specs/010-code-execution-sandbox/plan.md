# Implementation Plan: Quantitative Code Execution Sandbox

**Branch**: `plan-v3/010-sandbox-managed-default` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v3/package_3_2_code_execution_sandbox.md`
**SRS IDs in Scope**: FR-GC-08; FR-GC-01/02/03/06, FR-SI-03/05, FR-WM-04/05, C-01/C-02, NFR-SEC-01/02, NFR-EVAL-01..04 | **Release Gate**: Gate v3.0 #2
**Input**: `specs/010-code-execution-sandbox/spec.md`

## Summary (FR-GC-08, C-02)

Extend grounded chat with a bounded Python execution tool over immutable scoped inputs, exact Computed values, validated chart/citation publication and inspectable ordered retry traces. Consume package 3.1's C-01-compatible inputs without changing ingestion or Studio. The ADK agent decides when to compute; a deterministic controller enforces execution/security/retry rules. Accepted clarifications require a focused follow-up before ambiguous statistical calculations and preservation/display of both retry attempts.

**Planning status: complete through Phase 1 design.** D18 records the owner's superseding acceptance of the managed default 2 vCPU / 1.5 GB profile. The primary path is Agent Platform Code Execution over REST from TypeScript. R6 is a mandatory implementation/deployment qualification gate for all retained controls; no runtime acceptance is claimed. No implementation or tasks are generated.

## Technical Context (FR-GC-08, C-01/C-02, NFR-SEC-01/02)

- Language/version: TypeScript 5.x strict ESM, Node 24, pnpm workspace; generated Python only inside the sandbox.
- Dependencies: shared Zod; ADK TypeScript for grounded chat/tool selection; enterprise Gemini model tier selected by quality/latency checks. No new agent framework/datastore.
- Runtime: Agent Platform Code Execution, Python, default 2 vCPU / 1.5 GB RAM; one fresh sandbox per attempt under an IaC-managed parent runtime without deployed agent code (D18). Research is resolved; R6 measurements/admission tests are specified in r6-feasibility.md.
- Storage: existing single Cloud SQL Postgres for ChatMessage trace and private Cloud Storage chart objects. No provider memory/session store for user conversation state.
- Authentication/region map: API, database, chart storage and intended execution service in europe-west4; enterprise no-training endpoints and keyless service identity. Region exceptions: none approved; if a runtime is unavailable there, stop rather than select a different region.
- Performance: submission-to-real-running-code ≤2.5 s; cold/warm sandbox boot plus standard-tabular execution ≤4.0 s P95; per-attempt execution ≤15.0 s. Code progress never counts as validated answer TTFT. D17 warm-only chat acceptance does not relax these code-execution criteria.
- Constraints: ≤2 vCPU, ≤1.5 GB RAM, ≤64 MB /tmp; zero inbound/outbound network; read-only scoped inputs; required Python numerical libraries preinstalled; one exception retry and zero timeout/OOM retries.
- Testing: existing Vitest and Playwright runners; new package scenarios and R6 environment are UNAVAILABLE until implemented. Existing scripts named dev/db:migrate currently print readiness messages and are not runtime setup proof.
- Prerequisites: Gate v2 evidence before v3 implementation; package 3.1 plan/contract precedes this work; existing C-01/C-02, auth, history, cancellation and validated publication. Package 3.4 consumes these declared timing populations; 3.3 remains separate.

## Constitution Check (CC-01..CC-08)

Statuses refer to design review, not deployed acceptance. D18 resolves the former CPU/RAM mismatch; R6 runtime qualification is still UNAVAILABLE and required before implementation/admission.

| Gate | Principle | Pre-research | Post-design | Evidence |
| --- | --- | --- | --- | --- |
| CC-01 | Traceability | PASS | PASS | Every artifact maps FR-GC-08 and shared IDs; findings flow into card/spec/architecture |
| CC-02 | Test-first | PASS | PASS | quickstart requires failing contract/security/e2e tests before implementation; absent gates UNAVAILABLE |
| CC-03 | Scope/snapshot | PASS | PASS | C-02 only, immutable inputs, revision/auth checks and generation epoch fence |
| CC-04 | Citations/leakage | PASS | PASS | Buffered publication, invalid citation refusal, private charts and all-attempt access hygiene |
| CC-05 | Contracts/pipelines | PASS | PASS | Shared DTOs, unchanged C-01/C-02; ADK reasoning with deterministic controller |
| CC-06 | Release/package order | PASS | PASS | Planning may precede Gate v2; implementation may not; predecessor 3.1 inherited |
| CC-07 | Security/residency | PASS | PASS | Managed isolation path, Owner checks and EU map; retained controls fail closed at R6 admission, not claimed validated |
| CC-08 | Platform/cost | PASS | PASS | D18 accepted managed default; existing TS/Cloud Run/Postgres stack, no new framework or idle application deployment |

## Project Structure (FR-GC-08, FR-GC-06)

Artifacts: plan.md, research.md, r6-feasibility.md, data-model.md, contracts/interfaces.md, quickstart.md beside existing spec/checklist. No tasks.md created.

Exact intended implementation boundaries:

| Owner boundary | Change |
| --- | --- |
| packages/contracts/src/package-v3-2.ts (new) | Execution trace, result/artifact and adapter DTO schemas |
| packages/contracts/src/package-v1-3.ts, index.ts | Add nullable trace to strict ChatMessage and export schemas; legacy read compatibility |
| packages/db/src/chat-history.ts; new numbered migration | Persist/reload trace and artifact references in SQL and test doubles |
| apps/api/src/chat/execution/ (new) | Scoped manifest, controller, runtime adapter, output validation and cleanup |
| apps/api/src/chat/{agent,publication,transport}.ts; routes/chat.ts | Tool integration, truthful progress, result gate and cancellation |
| apps/api/src/routes/chat-charts.ts (new); server.ts | Authorized private chart delivery |
| apps/web/src/chat/{turn,history}.ts; code-execution.ts (new) | Computed result/chart UI and ordered code drawer |
| packages/evals/test; existing package test directories | Golden arithmetic, citations, leakage and adversarial isolation scenarios |
| infra/ | Only qualified runtime resources after R6 and owner API approval |

Shared schema exports, migration numbering, chat transport and cleanup changes are serialized after package 3.1. Preserve predecessor contract definitions rather than replacing them. Do not touch Studio implementation, package 3.3 planning or later-release features.

## Phase 0 Research (FR-GC-08)

research.md records source-backed runtime mismatch and resolved decisions for manifests, retries, schema evolution, chart authorization and repo reuse. Parent/package rule limits active package agents to one; research was performed within this package agent. The owner superseded Option A with the managed-default envelope (D18). All planning decisions are resolved. R6 qualification remains a separate prerequisite to implementation/runtime admission; its evidence is not fabricated.

## Phase 1 Design (FR-GC-08, NFR-EVAL-01..04)

The controller snapshots authorized C-02 inputs, asks for missing statistical intent, creates each isolated attempt, captures outputs and destroys the execution environment. Only first-attempt Python exceptions receive one correction. Publication rechecks revisions, access and citations; saves ordered trace and exact results atomically; emits code and charts only after validation. All terminal/security errors produce safe refusal/error without invented numbers. Clearing chat or source invalidation fences late callbacks and invalidates chart delivery.

Data-model and contracts specify message migration compatibility, artifact provenance, internal errors, status semantics and cleanup. Quickstart binds acceptance scenarios to future failing tests and records the current UNAVAILABLE evidence boundary. The selected runtime lifecycle is specified in contracts/interfaces.md. One or two simultaneous users is the declared workload context; D18 increases only CPU/RAM. Before implementation, R6 proves the remaining controls in the selected environment. A failed control returns for explicit architectural resolution, never an automatic relaxation.

## Complexity Tracking (FR-GC-08, R6)

| Gate / decision | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| D18 / FR-GC-08 | Owner-approved 2 vCPU / 1.5 GB managed default | Retaining former caps required an unqualified fallback; the owner chose the managed profile instead. 4 vCPU / 4 GB remains excluded. |

D18 and the SRS amendment approve the CPU/RAM change only. This changes project acceptance limits, not a verified reference-product deviation, so no DEV entry is inferred. Existing D17/DEV-05 remains restricted to NFR-PERF-01 warm-service chat timing.
