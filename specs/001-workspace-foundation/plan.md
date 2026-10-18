# Implementation Plan: Workspace Foundation

**Branch**: `spec/v1-functional-requirements` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v1/package_1_1_workspace_foundation.md`
**SRS IDs in Scope**: FR-WM-01, FR-WM-04, FR-WM-07; C-01/C-02; NFR-SEC-01, NFR-EVAL-04 | **Release Gate**: Gate v1.0
**Input**: `specs/001-workspace-foundation/spec.md`, clarified in `2468629`.

## Summary

Deliver authenticated, owner-only notebook creation/open/rename/permanent deletion and atomic baseline quotas. Define shared C-01/C-02 contracts first, then implement the notebook/isolation/quota foundation consumed by packages 1.2 and 1.3. Preserve the complete [specification](spec.md), [FR cards](../../spec/requirements/v1/package_1_1_workspace_foundation.md), [binding rules](../../spec/requirements/README.md) and [constitution](../../.specify/memory/constitution.md).

This plan ends after Phase 1 design. It does not implement ingestion, chat, the full responsive workspace, Studio, or a release gate. Cross-package requirements in the spec define interfaces and integration checks; their downstream owners remain explicit below. No framework or datastore is added to [D1–D14](../../docs/solution-architecture.md#decisions).

## Technical Context

**Language/Version**: Template baseline TypeScript 5.x, strict ESM, Node.js 24, pnpm workspaces; exact dependency patch versions are pinned when the first implementation lockfile is created.
**Primary Dependencies**: Zod in `packages/contracts`; PostgreSQL driver and Google Cloud client/auth libraries for existing services. Native Node HTTP request adapter and browser DOM/History APIs suffice for package 1.1; no new web/server framework, ORM or bundler is selected. `tsc` emits browser-compatible ESM with explicit `.js` relative imports; pure shared helpers are emitted alongside it. Zod boundary validation runs server-side. No ADK/model dependency is needed for CRUD/quota handlers.
**Storage**: One Cloud SQL PostgreSQL instance, including pgvector/FTS as required by D1; Cloud Storage for raw/derived files. Existing Cloud Tasks/worker handles durable cleanup retries. No Redis, second database, or scheduler service.
**Authentication & Residency**: Identity Platform generic OIDC/SAML (D6); verified ID-token identity maps to a local user. Concrete IdP/issuer/client ID are deployment inputs, not a new product choice. Cloud Run, SQL, storage and task queue use `europe-west4`; no region exception. Identity Platform identity metadata/configuration requires deployment residency review; no claim that every managed identity operation is region-pinned.
**Testing**: Vitest unit/contract/database integration and deterministic NFR-EVAL-04 foundations; Playwright notebook journeys. Model-judged suites remain owned by 1.3/1.4 and required before Gate v1.0. Current runners are UNAVAILABLE.
**Execution Model**: Deterministic handlers and cleanup workflow; no LlmAgent loop. Ingestion later remains deterministic; grounded chat agentic orchestration belongs to 1.3.
**Performance Goals**: Creation through redirect P95 <=1.0 s; database/chunk cascade deletion <=2.0 s; declared oversized upload admission rejection <=200 ms. Actual object purge has no fabricated 2 s promise; completion is measured separately and never claimed before verified cleanup.
**Constraints**: Titles 1–100 Unicode code points after outer trim; 100 notebooks/user; 50 sources/notebook by default, deployment configurable 50–300; independent inclusive 200,000,000-byte and 500,000-word limits. Owner-only v1–v5. Atomic admission, deterministic error handling and no late publication after deletion.
**Within-Release Prerequisites**: C-01/C-02 definitions and contract tests first; 1.1 identity/notebooks/quotas → 1.2 ingestion/inspector → 1.3 chat/citations → 1.4 integrated UI and all three Gate v1.0 criteria. Harnesses and minimal shells may precede consumers.

## Constitution Check (`CC-01`..`CC-08`)

Pre-research review was completed before Phase 0 on 2026-10-17. Post-design status below assesses the documented design, not execution of tests or cloud deployment. CC-02 checks the required test-first design; task ordering must be checked again after `/speckit-tasks`.

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | FR-WM-01/04/07 map to the schema, API and coverage matrix in [quickstart](quickstart.md); source cards are unchanged. |
| CC-02 | Test-First | PASS | PASS | Every original scenario, supplemental boundary and integration obligation has an explicit test group. `/speckit-tasks` must order its Red evidence before implementation. No task/test is claimed complete. |
| CC-03 | Scope & Snapshot | PASS | PASS | [Shared contracts](contracts/shared-context.md) preserve the two-argument C-02 signature, explicit Ready IDs, server-captured revisions and authorization rechecks at read/publication. |
| CC-04 | Citations & Leakage | PASS | PASS | History/cache provenance and deletion fences are contract obligations; 1.3 owns D13 buffering/refusal implementation. Foundation tests exercise no cross-notebook or stale context return. |
| CC-05 | Contracts & Pipelines | PASS | PASS | One implementation of each shared schema in packages/contracts. C-01 remains five fields; request envelope contains revisions. Deterministic foundation; C-03 implementation starts in v2. |
| CC-06 | Release & Package Order | PASS | PASS | Shared baseline merges first, then 1.1, dependent packages and integrated gate. D5/DEV-03, D8/DEV-02 and D10 remain excluded. |
| CC-07 | Security, RBAC & Residency | PASS | PASS | Verified principal plus ownership on every endpoint/worker; transactional quotas; private objects, revocation fences, keyless service identity and EU configuration. Deployment verification remains a prerequisite, not a completed check. |
| CC-08 | Platform & Cost | PASS | PASS | Native TypeScript adapters within existing Cloud Run/SQL/Storage/Tasks stack and OpenTofu (`D14`) baseline in `infra/stacks/v1_foundation/`. No new framework or fixed-cost component; no API activation or live infrastructure apply in this stage. |

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-foundation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── workspace-api.md
│   └── shared-context.md
└── checklists/requirements.md
```

`tasks.md` is updated in the `/speckit-tasks` stage. The existing specs for packages 1.2–1.4 remain unmodified by this plan.

### Source Code (planned, not created)

| Owner / order | Intended paths | Responsibility and SRS trace |
| :--- | :--- | :--- |
| 1.1 owner, serialized prerequisite | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`; package manifests/configs in `packages/contracts`, `packages/db`, `packages/evals`, `apps/api`, `apps/web`, `apps/worker`; `.github/workflows/ci.yml` | Minimum monorepo/test harness, build and quality commands. No other session edits these before integration (Gate v1.0). |
| 1.1 owner, shared contract baseline | `packages/contracts/src/document-chunk.ts`, `scoped-context.ts`, `workspace.ts`, `source-admission.ts`, `text-limits.ts`, `index.ts`; corresponding `test/*.test.ts` | Sole C-01/C-02 and notebook/quota DTO definitions plus pure text normalization. C-03 added later by 2.4. |
| 1.1 owner, migrations | `packages/db/migrations/0001_workspace.sql`, `packages/db/src/notebooks.ts`, `quota.ts`, `scope-guard.ts`, `cleanup.ts`, `transaction.ts`; `packages/db/test/workspace.integration.test.ts` | Owner row locks, notebook/source admission ledger, deletion fence/outbox, ownership-scoped relational operations (FR-WM-01/04/07). |
| 1.1 owner | `apps/api/src/auth/identity.ts`, `routes/notebooks.ts`, `services/workspace.ts`, `http.ts`, `server.ts`; corresponding `test/workspace.test.ts` | Native HTTP adapter; token verification, notebook CRUD, quota summary and status/error mapping (FR-WM-01/04/07). |
| 1.1 owner | `apps/web/src/notebooks.ts`, `notebook-title.ts`, `delete-notebook.ts`, `quota-indicator.ts`, `main.ts`, `index.html`; `apps/web/test/workspace.spec.ts` | Home/cards/title/delete/capacity views and minimal Add sources handoff. No new UI framework (FR-WM-01/07). |
| 1.1 owner | `apps/worker/src/notebook-cleanup.ts`, `apps/worker/test/notebook-cleanup.test.ts` | Idempotent cleanup adapter and stale-job rejection; cleanup only, no ingestion parsing (FR-WM-01/04). |
| 1.1 owner | `packages/evals/fixtures/workspace-isolation.json`, `packages/evals/test/workspace-isolation.test.ts` | Two-owner/two-notebook and stale-snapshot deterministic fixtures (FR-WM-04, NFR-EVAL-04). |
| 1.1 owner, serialized infra (`D14`) | `infra/stacks/v1_foundation/main.tf`, `infra/stacks/v1_foundation/variables.tf`, `infra/stacks/v1_foundation/outputs.tf`, `infra/stacks/v1_foundation/versions.tf` | OpenTofu (`D14`) baseline IAM, storage purge policy, `europe-west4` resources and cleanup queue bindings. Provision only after owner approval for any new API (NFR-SEC-01, FR-WM-01/04). |
| 1.2, after shared baseline | `packages/db/migrations/0002_ingestion.sql`, `packages/db/src/scoped-context.ts`, `apps/worker/src/ingestion/`, `apps/api/src/routes/sources.ts`, `apps/web/src/sources/` | Add C-01 persistence/indexes and complete C-02 read adapter using 1.1 scope guard; parser/upload/inspector work, consuming the existing quota ledger. No duplicate schemas. |
| 1.3, after 1.2 | `packages/db/migrations/0003_chat.sql`, `apps/api/src/chat/`, `apps/web/src/chat/` | Persist provenance and implement scoped history/cache access and D13 citation publication; integrate notebook deletion cascade. |
| 1.4, after contracts/shell agreement | `apps/web/src/workspace-layout.ts`, `packages/evals/test/release-v1.test.ts` | Responsive layout and combined gate. Must coordinate shared entrypoint/CI changes with their current owner. |

**Structure & File Ownership Decision**: This session owns planning artifacts under `specs/001-workspace-foundation/` on branch `spec/v1-functional-requirements` (base `2468629`). The table is an implementation ownership proposal for the package owner, not a reservation on behalf of unknown workers. Shared manifests, contracts, migration numbering, CI and `infra/stacks/v1_foundation/` (`D14`) must be claimed in a shared handoff and integrated before dependent implementation. Reservation/ownership for packages 1.2–1.4 is not changed.

## Design Sequence and Integration Boundaries

1. **Contract and harness baseline (C-01/C-02, FR-WM-01/04/07)**: Define schemas and the HTTP/internal contracts linked below. Introduce test commands, then execute failing validation/ownership/quota/snapshot tests before implementing behavior. Contract test doubles are permitted for absent downstream adapters; they are never evidence that real retrieval/chat passes.
2. **Identity and notebook CRUD (FR-WM-01/04)**: Derive owner from verified token; list/read/update/delete are owner-filtered. Lock the owner record for create/delete counts. No request supplies a trusted owner ID. New notebook uses UUID v4 and default title; route to its workspace and open Add sources. Restore the persisted title on save error.
3. **Admission ledger (FR-WM-07, FR-SI-01)**: Lock parent notebook for source admission, state transitions and deletion. Read occupied count and admit the first batch entries that fit in one transaction. Failed and dismissed rows never occupy slots. Check declared size before granting upload; package 1.2 rechecks actual bytes and extracted words before Ready.
4. **Deletion and publication fence (FR-WM-01/04)**: In a transaction, record a payload-free cleanup manifest, invalidate notebook access and delete notebook-owned records with cascade semantics. Cancel work and reject late callbacks. All-generation storage cleanup is durable and retryable; no application row is resurrected. Use `202` while physical cleanup is pending and `204` only for completed deletion; all content reads return `404` immediately after the logical deletion transaction. Details in [data model](data-model.md).
5. **Scope guard and consumer handoff (FR-WM-04, C-02)**: Implement ownership, Ready-set/revision validation and publication fencing; 1.2 supplies the real content adapter. 1.3 implements prompt/history/refusal behavior against that boundary. Preserve the exact public C-02 signature and five-field C-01 projection.
6. **Verification (Gate v1.0)**: Run package-local tests and then downstream integration as it becomes available. A runnable v1 needs all packages, configured identity and all release tests; this foundation does not unlock v2 implementation.

## Phase 0 and Phase 1 Outputs

- [Research](research.md): decisions, alternatives and official-source evidence; no unresolved technical clarification remains in this package design. Deployment configuration prerequisites are explicit.
- [Data model](data-model.md): entities, invariants, atomic transitions, deletion lifecycle and concurrency ordering.
- [Workspace API](contracts/workspace-api.md): observable HTTP behavior and internal quota operations.
- [Shared context](contracts/shared-context.md): C-01/C-02 shape, provenance and downstream ownership.
- [Quickstart](quickstart.md): available checks, future command contract, Red→Green acceptance matrix and timing fixture requirements.

## Complexity Tracking

No constitution exception or new architecture decision is required. A payload-free deletion fence/cleanup record and all-generation object deletion implement permanent deletion within the existing stack; they are not a user-visible trash/recovery feature. Versioning stays enabled as in the architecture; soft-delete retention must be zero for newly provisioned application-content buckets to permit permanent purge. Existing retained generations remain an explicit deployment blocker until policy/retention permits purge. Do not claim deletion complete or silently weaken FR-WM-01 to accommodate them.
