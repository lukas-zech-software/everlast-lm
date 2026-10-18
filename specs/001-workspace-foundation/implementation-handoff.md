# Implementation Handoff & Ownership Agreement: Workspace Foundation (Package 1.1)

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Tasks**: [tasks.md](tasks.md)
**Package Source**: `spec/requirements/v1/package_1_1_workspace_foundation.md`
**SRS IDs in Scope**: `FR-WM-01`, `FR-WM-04`, `FR-WM-07`, `C-01`, `C-02`, `NFR-SEC-01`, `NFR-EVAL-04`, `Gate v1.0`
**Date**: 2026-10-18
**Status**: ACTIVE / PHASE 1 SETUP

---

## 1. Assigned Owner

- **Feature Directory & Spec Slug**: `specs/001-workspace-foundation`
- **Assigned Implementer**: Package 1.1 Implementer Session (`specs/001-workspace-foundation`)
- **Caller / Coordinator**: Parent Agent (`2767cc6c-8fa1-4084-a93c-cac8e214504b`)
- **Constitution Authority**: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) (Principles I–VI, Gates `CC-01`..`CC-08`)

---

## 2. Base Commit and Branch Information

- **Working Directory**: `/Users/luke/.gemini/antigravity/worktrees/everlast-lm/implement_speckit_v1`
- **Active Branch**: `implement_speckit_v1`
- **Base Commit**: `cc430e4202dfe37b6f4724d90f05172d19f5c5b7` (`feat(speckit): add agent-context extension and streamline AGENTS.md (#113)`)
- **Spec / Planning Origin Base**: `spec/v1-functional-requirements` (`838a71b`), following checklist approval (`4fe9cfa`), clarify review (`2468629`), and plan approval (`d797ca0`).
- **Target Integration Branch**: `main` (via coordinated pull request)

---

## 3. Allowed Files and Directory Ownership Boundaries

Package 1.1 owns the initialization of the monorepo root harness and the baseline workspace foundation implementation. Edits in this session are strictly constrained to the following paths:

### Monorepo Scaffolding & Root Manifests (Serialized Prerequisite)
- `package.json` (root workspace scripts and pinned engines/dependencies)
- `pnpm-workspace.yaml` (workspace package layout: `packages/*`, `apps/*`)
- `pnpm-lock.yaml` (pinned dependency graph; Node 24 / TypeScript 5.x baseline)
- `tsconfig.base.json` (strict ESM TypeScript base configuration)
- Package manifests and tsconfigs:
  - `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
  - `packages/db/package.json`, `packages/db/tsconfig.json`
  - `packages/evals/package.json`, `packages/evals/tsconfig.json`
  - `apps/api/package.json`, `apps/api/tsconfig.json`
  - `apps/web/package.json`, `apps/web/tsconfig.json`
  - `apps/worker/package.json`, `apps/worker/tsconfig.json`
- Test configs: `vitest.config.ts`, `playwright.config.ts`
- Root CI configuration: `.github/workflows/ci.yml` (orchestrating lint, typecheck, test, and spec integrity)

### Shared Contracts (`packages/contracts`)
- `packages/contracts/src/document-chunk.ts` (`C-01` `UnifiedDocumentChunk` 5-field schema and locator union)
- `packages/contracts/src/scoped-context.ts` (`C-02` `ScopedContextProvider` signature, submission snapshots, eligibility helpers)
- `packages/contracts/src/workspace.ts` (Notebook DTOs, default title `"Untitled notebook"`, UUID v4 identity)
- `packages/contracts/src/text-limits.ts` (pure Unicode code point length validation and whitespace trimming)
- `packages/contracts/src/source-admission.ts` (Quota DTOs, 50–300 source limits, 200 MB / 500,000 word limit types)
- `packages/contracts/src/index.ts` (barrel exports for contracts package)
- `packages/contracts/test/*.test.ts` (contract and schema validation test suites)

### Relational Database & Migrations (`packages/db`)
- `packages/db/migrations/0001_workspace.sql` (baseline schema: `users`, `notebooks`, `sources` admission ledger, deletion fence/outbox)
- `packages/db/src/*`:
  - `packages/db/src/notebooks.ts` (notebook repository, owner row locks, 100-notebook cap)
  - `packages/db/src/quota.ts` (source admission ledger, atomic slot reservation and release)
  - `packages/db/src/scope-guard.ts` (owner/Ready/revision validation and publication fencing)
  - `packages/db/src/cleanup.ts` (deletion fences, outbox dispatch, durable cleanup ledger)
  - `packages/db/src/transaction.ts` (connection pooling and transactional helpers)
  - `packages/db/src/migrate.ts` (isolated migration runner)
  - `packages/db/src/index.ts` (database barrel export)
- `packages/db/test/*` (integration tests for workspace, isolation, admission, and deletion cascade)

### API Service (`apps/api`)
- `apps/api/src/auth/identity.ts` (Identity Platform token adapter, verified subject mapping)
- `apps/api/src/routes/notebooks.ts` (authenticated notebook CRUD, quota, and deletion status routes)
- `apps/api/src/services/workspace.ts` (workspace orchestration and scope guard integration)
- `apps/api/src/http.ts`, `apps/api/src/server.ts` (native HTTP adapter and routing)
- `apps/api/test/*` (API contract and HTTP status mapping tests)

### Web Frontend (`apps/web`)
- `apps/web/src/notebooks.ts` (notebook home card list, `/notebook/{id}` navigation)
- `apps/web/src/notebook-title.ts` (inline rename, 1–100 Unicode code point enforcement, blur/Enter commit, network error rollback)
- `apps/web/src/delete-notebook.ts` (delete modal confirmation, 404 multi-tab recovery)
- `apps/web/src/quota-indicator.ts` (authoritative quota capacity counters and upload button disabling)
- `apps/web/src/main.ts`, `apps/web/src/index.html` (minimal SPA shell entrypoints)
- `apps/web/test/*` (Playwright E2E and timing tests)

### Worker Background Service (`apps/worker`)
- `apps/worker/src/notebook-cleanup.ts` (durable, idempotent storage cleanup across all live/noncurrent object generations)
- `apps/worker/test/*` (cleanup worker crash-recovery and outbox drain tests)

### Evaluation & Isolation Fixtures (`packages/evals`)
- `packages/evals/fixtures/workspace-isolation.json` (deterministic two-owner / two-notebook isolation fixtures including `OMEGA-991`)
- `packages/evals/test/workspace-isolation.test.ts` (deterministic isolation assertions proving zero cross-notebook chunk leakage)

### Infrastructure Baseline (`infra/stacks/v1_foundation/`)
- `infra/stacks/v1_foundation/main.tf`, `variables.tf`, `outputs.tf`, `versions.tf` (OpenTofu IaC baseline `D14`; zero soft-delete retention on application-content buckets, `europe-west4` default residency)
- `infra/tests/*` (infrastructure policy acceptance tests)

### Feature Documentation & Task Log
- `specs/001-workspace-foundation/*` (spec, plan, data model, contracts, tasks, checklists, validation log, handoff)

### Strictly Forbidden Paths for Package 1.1
- Ingestion pipelines, parsers, or inspector UI (`packages/db/migrations/0002_ingestion.sql`, `apps/worker/src/ingestion/*`, `apps/api/src/routes/sources.ts`, `apps/web/src/sources/*` — reserved for **Package 1.2**)
- Chat threads, messages, model grounding agents, or prompt history (`packages/db/migrations/0003_chat.sql`, `apps/api/src/chat/*`, `apps/web/src/chat/*` — reserved for **Package 1.3**)
- Responsive 3-panel UI layout or integrated release gate orchestration (`apps/web/src/workspace-layout.ts`, `packages/evals/test/release-v1.test.ts` — reserved for **Package 1.4**)
- Unassigned worktree files or branches outside `specs/001-workspace-foundation` scope.

---

## 4. Shared-File Handoff Coordination Rules for Unblocking Packages 1.2, 1.3, and 1.4

To ensure smooth parallel and downstream execution without merge conflicts or architectural divergence:

1. **Shared Contract Single Source of Truth (`packages/contracts`)**:
   - Package 1.1 publishes the canonical TypeScript types and Zod schemas for `UnifiedDocumentChunk` (`C-01`), `ScopedContextProvider` (`C-02`), and source admission quotas (`FR-WM-07`).
   - Packages 1.2 and 1.3 MUST import schemas directly from `@everlast/contracts`. They MUST NOT redefine or fork chunk or scope schemas.
   - `C-01` is strictly limited to the 5 mandatory projection fields (`chunk_id`, `source_id`, `revision`, `locator`, `token_count`, `text`) with locator union `page_span | time_span | dom_path`.

2. **Sequential Database Migrations (`packages/db/migrations`)**:
   - Package 1.1 claims and applies `0001_workspace.sql`.
   - Package 1.2 claims `0002_ingestion.sql` (adding chunk vectors, pgvector extension, and text search indexes).
   - Package 1.3 claims `0003_chat.sql` (adding chat threads, messages, and citation provenance tables).
   - All migrations maintain the strict locking hierarchy: `users` (owner) → `notebooks` → `sources` → downstream child records.

3. **Monorepo Manifest Coordination (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`)**:
   - Package 1.1 creates and stabilizes the root workspace manifest and lockfile in Phase 1 Setup (`T001`–`T003`).
   - Downstream packages must base their worktrees on the commit containing the merged setup before adding package-local dependencies.
   - Root scripts (`lint`, `typecheck`, `test:unit`, `test:contract`, `test:integration`, `test:e2e`, `eval:deterministic`, `eval:judged`, `db:migrate`, `dev`) are owned by 1.1. Missing downstream test suites report `UNAVAILABLE` rather than empty passes.

4. **Scope Guard & Context Provider Interface (`C-02`)**:
   - Package 1.1 delivers `packages/db/src/scope-guard.ts` and `packages/contracts/src/scoped-context.ts`.
   - Package 1.2 implements the storage-backed chunk retrieval adapter behind this interface.
   - Package 1.3 consumes this interface to retrieve active sources, evaluate submission snapshots `(source_id, revision)`, and re-verify access before model calls.

5. **Cross-Package Integration Test Handoff (`T044` / `T048`)**:
   - In `T044`, Package 1.1 authors cross-package failing test suites:
     - `packages/db/test/workspace-cascade.integration.test.ts`
     - `packages/evals/test/workspace-consumers.test.ts`
     - `apps/worker/test/source-limits.integration.test.ts`
   - These test files are handed off to Packages 1.2 and 1.3.
   - Package 1.1 marks its foundational interfaces complete without blocking on downstream implementation, while leaving task `T048` open to track eventual end-to-end passing status once 1.2 and 1.3 integrate.

---

## 5. Gate v1.0 Prerequisites and Verification Checklist Status

### Verification Checklists Status
All Spec Kit validation checklists for Package 1.1 have been reviewed, verified, and confirmed **PASS**:

- **Specification Quality Checklist** ([`checklists/requirements.md`](checklists/requirements.md)): **PASS** (13 / 13 items verified `[x]`).
- **Workspace Isolation & Quotas Checklist** ([`checklists/workspace-isolation-quotas.md`](checklists/workspace-isolation-quotas.md)): **PASS** (17 / 17 items verified `[x]`, `CHK001`–`CHK017`).
- **Specification Analysis Report** ([`analysis.md`](analysis.md)): **PASS** (Categories A–F: 0 critical, 0 high, 0 findings; Constitution Principles I–VI and Gates `CC-01`..`CC-08` verified `PASS`).
- **Repository Spec Integrity** (`node scripts/check-spec-integrity.mjs`): **PASS** (78 Markdown files validated, 55 SRS requirement IDs resolved, 12 Spec Kit feature artifacts aligned).

### Gate v1.0 Release Sequence
In accordance with Constitution Principle V (`CC-06`) and SRS §5.4:
- Package 1.1 (Workspace Foundation, Identity, Isolation, Quotas) **→ Prerequisite for**
- Package 1.2 (Ingestion, Inspector, Parsers) **→ Prerequisite for**
- Package 1.3 (Grounded Chat, Citations, D13 Refusal) **→ Prerequisite for**
- Package 1.4 (UI Skeleton, Evaluation Gates) **→ Gate v1.0 Release Verification**.

---

## 6. Handoff Approval

| Role | Stakeholder / Agent | Status | Date |
| :--- | :--- | :--- | :--- |
| Implementer | Package 1.1 Session (`specs/001-workspace-foundation`) | APPROVED | 2026-10-18 |
| Package Lead / Coordinator | Parent Agent (`2767cc6c-8fa1-4084-a93c-cac8e214504b`) | SUBMITTED FOR RECORD | 2026-10-18 |
