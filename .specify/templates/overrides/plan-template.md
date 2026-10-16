# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Package Source**: `spec/requirements/v[N]/package_[N]_[M]_[name].md`
**SRS IDs in Scope**: `[FR-*, NFR-*, C-01..C-03]` | **Release Gate**: `Gate v[N].0`
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary SRS requirements, package prerequisites, and technical approach grounded in `docs/solution-architecture.md` (`D1`–`D13`)]

## Technical Context

<!--
  Fixed stack choices from Constitution v1.1.0 & `docs/solution-architecture.md` (D1–D13).
  Deviating from any choice below requires a prior recorded `Dn` decision in `docs/solution-architecture.md`.
-->

**Language/Version**: TypeScript 5.x (strict mode, ESM) on Node.js 24 (`pnpm` workspaces)
**Primary Dependencies**: Zod (`packages/contracts`), Google ADK for TypeScript + `@google/genai` (only for agentic loops), Cloud Run services/jobs, Cloud Tasks
**Storage**: Single Cloud SQL for PostgreSQL instance (`relational` + `pgvector` + PostgreSQL FTS with Reciprocal Rank Fusion, `D1`/`D4`) + Cloud Storage (`europe-west4`)
**Authentication & Residency**: Identity Platform (generic OIDC/SAML, `D6`); EU residency (`europe-west4`, `D3`) `[Document any region-map exception or "None"]`
**Testing**: Vitest (unit, contract, integration, deterministic evals `NFR-EVAL-02/04`, LLM-judged evals `NFR-EVAL-01/03`), Playwright (E2E)
**Execution Model**: `[Specify whether components in this package are Deterministic Pipelines (ingestion, Source Guide, Studio generators, rendering) or ADK LlmAgent loops (grounded chat, research, note assistant)]`
**Performance Goals**: `[e.g., Standard chat validated-answer TTFT <= 2.5 s P95 excluding progress events (D13, NFR-PERF-01), Source Guide < 10 s]`
**Constraints**: `[e.g., 200,000,000 bytes / 500,000 words per source; C-01 300–600 token chunk target; Owner-only in v1–v5, RBAC in v6]`
**Within-Release Prerequisites**: `[Cite required upstream packages and shared contracts C-01..C-03 from spec/requirements/README.md]`

## Constitution Check (`CC-01`..`CC-08`)

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Any violation is CRITICAL and must be resolved or justified in Complexity Tracking.*

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | `[PASS / FAIL]` | `[PASS / FAIL]` | Every requirement, design element, and planned task cites its SRS ID (`FR-*`, `NFR-*`, `C-01..03`) and matches its FR card + `spec/requirements/README.md`. |
| `CC-02` | **II. Test-First** | `[PASS / FAIL]` | `[PASS / FAIL]` | Spec-derived failing test tasks precede implementation tasks for every requirement, Gherkin scenario, and numeric/text limit. |
| `CC-03` | **III. Scope & Snapshot** | `[PASS / FAIL]` | `[PASS / FAIL]` | All source reads go exclusively through `C-02` with explicit `Ready` source IDs, submission-time `(source_id, revision)` snapshots, and access re-checks. |
| `CC-04` | **III. Citations & Leakage** | `[PASS / FAIL]` | `[PASS / FAIL]` | Pre-publication citation ID validation (`D13`, `NFR-EVAL-02/03`), immediate refusal on failure, and zero deselected/revoked source leakage (`NFR-EVAL-04`) across history, caches, and drilldowns. |
| `CC-05` | **IV. Contracts & Pipelines** | `[PASS / FAIL]` | `[PASS / FAIL]` | Uses shared `C-01..C-03` Zod schemas in `packages/contracts`; uses deterministic pipelines unless dynamic tool selection requires ADK `LlmAgent`. |
| `CC-06` | **V. Release & Package Order** | `[PASS / FAIL]` | `[PASS / FAIL]` | Honors `Gate v(k)` and within-release package prerequisites; excludes deferred items (`D5`/`DEV-03`, `D8`/`DEV-02`, `D10` before `v6.0`). |
| `CC-07` | **VI. Security, RBAC & Residency** | `[PASS / FAIL]` | `[PASS / FAIL]` | Enforces server-side auth (`Owner`-only in `v1–v5`, RBAC in `v6`), atomic quota slot reservation, enterprise no-training endpoints (`NFR-SEC-01`), and `europe-west4` residency. |
| `CC-08` | **Platform & Cost** | `[PASS / FAIL]` | `[PASS / FAIL]` | Fits the pnpm TypeScript / Cloud Run / single Cloud SQL Postgres stack without unrecorded frameworks, datastores, or fixed-idle-cost resources. |

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── spec.md              # Feature specification (/speckit-specify output)
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output (/speckit-plan output)
├── data-model.md        # Phase 1 output (/speckit-plan output)
├── quickstart.md        # Phase 1 output (/speckit-plan output)
├── contracts/           # Phase 1 output (/speckit-plan output)
├── checklists/          # Quality checklists (/speckit-specify & /speckit-checklist)
└── tasks.md             # Phase 2 output (/speckit-tasks output - NOT created by /speckit-plan)
```

### Source Code (repository root — `pnpm` TypeScript monorepo per `docs/solution-architecture.md`)

<!--
  ACTION REQUIRED: Keep only the workspace packages and directories touched or depended on by
  this feature, and list the exact intended file boundaries so parallel sessions do not collide.
-->

```text
packages/
├── contracts/           # Shared Zod schemas: C-01 UnifiedDocumentChunk, C-02 ScopedContextProvider, C-03 StudioGeneratorPlugin, API DTOs
├── db/                  # Cloud SQL Postgres schema, migrations, pgvector + FTS hybrid queries, C-02 implementation
└── evals/               # NFR-EVAL-01..04 deterministic and LLM-judged evaluation harnesses & golden fixtures

apps/
├── web/                 # SPA frontend (Workspace, Source Inspector, Chat, Notes, Studio UI)
├── api/                 # everlast-api (Cloud Run): BFF, server-side RBAC, OIDC auth, ADK grounded chat agent
├── worker/              # everlast-worker (Cloud Run / Cloud Tasks): ingestion, Source Guide, C-03 Studio plugins
├── live/                # everlast-live (Cloud Run, v5+): Gemini Live WebSocket voice gateway
└── render/              # everlast-render (Cloud Run Job, v4+): ffmpeg / LibreOffice headless rendering

infra/                   # Terraform IaC for Google Cloud (`europe-west4`)
```

**Structure & File Ownership Decision**: [Document the exact directories and files owned by this feature package, and list any serialized shared files (`packages/contracts`, `packages/db` migrations) that must merge first]

## Complexity Tracking

> **Fill ONLY if Constitution Check (`CC-01`..`CC-08`) has violations or requires a recorded `Dn` / `DEV-xx` reference**

| Gate / Decision | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| `[e.g. D11 / CC-05]` | `[current requirement need]` | `[why simpler alternative fails SRS or Constitution]` |
