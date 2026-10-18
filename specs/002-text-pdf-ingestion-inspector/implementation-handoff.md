# Implementation Handoff: Package 1.2 (Text/PDF Ingestion & Source Inspector)

**Task**: `specs/002-text-pdf-ingestion-inspector T001`
**Date**: 2026-10-18
**Package Source**: `spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md` + [binding cross-package rules](../../spec/requirements/README.md)
**SRS IDs in Scope**: `FR-SI-01`, `FR-SI-03`, `FR-SI-04`, `C-01`, `C-02`, `NFR-EVAL-04`, `Gate v1.0`

---

## 1. Assigned Owner

- **Package Owner**: `specs/002-text-pdf-ingestion-inspector` (Package 1.2 Implementer)
- **Role & Scope**: Implements text, PDF, Markdown, and copied-text ingestion pipelines, canonical `C-01` chunk normalization and indexing, granular active source scoping ($S_{\text{aktiv}}$), and the collapsible Source Inspector with citation passage targeting.

---

## 2. Allowed Files and Directories

The implementer for Package 1.2 is restricted strictly to the following paths:

- **Worker Ingestion Pipeline**:
  - `apps/worker/src/ingestion/*` (modality parsers, Document AI OCR fallback, canonical offset mapping, token chunker, indexing pipelines)
  - `apps/worker/test/ingestion.*` (acceptance, boundary, integration tests)
- **Database Persistence**:
  - `packages/db/migrations/0002_ingestion.sql` (ingestion schema, document chunk storage, vector/FTS indexes, source revision tracking)
  - `packages/db/src/ingestion.ts` (ingestion persistence and chunk queries)
  - `packages/db/src/scoped-context.ts` (hybrid vector + FTS retrieval with strict snapshot revision filtering)
  - `packages/db/src/source-view.ts` (singleton source document reconstruction for inspector)
  - `packages/db/test/package-v1-2-schema.test.ts`
- **Contracts & DTOs**:
  - `packages/contracts/src/package-v1-2.ts` (package-specific DTOs, file upload payloads, selection states, inspector contracts)
  - `packages/contracts/test/package-v1-2.test.ts`
- **Web UI & Presentation**:
  - `apps/web/src/sources/*` (file upload component, source selection list, selection state manager, Source Inspector view, virtualized text viewer)
  - `apps/web/test/source-selection.*`
  - `apps/web/test/source-inspector.*`
- **API Endpoints (Source Ingestion & Context)**:
  - `apps/api/src/routes/sources.ts` (source upload, state polling, deletion endpoints)
  - `apps/api/src/routes/source-content.ts` (authorized singleton source passage inspection)
  - `apps/api/src/services/source-context.ts` (scoped context provider integration)
- **Package Specifications & Evidence**:
  - `specs/002-text-pdf-ingestion-inspector/*` (spec, plan, data model, contracts, checklists, tasks, validation, implementation handoff)

### Boundary Rules & Disallowed Edits
- **Shared Manifests & Scaffolding**: No unilateral edits to root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, or CI workflows (`.github/workflows/ci.yml`). Any coordination must follow shared-owner serialization.
- **Shared Contracts**: Do NOT duplicate or redefine `C-01` (`packages/contracts/src/document-chunk.ts`) or `C-02` (`packages/contracts/src/scoped-context.ts`). Import directly from Package 1.1 foundational schemas.
- **Infrastructure**: Do NOT create competing infrastructure files. All GCP resources reuse `infra/stacks/v1_foundation/` baseline.
- **Preceding Migrations**: Do NOT modify `packages/db/migrations/0001_workspace.sql`.

---

## 3. External Dependencies & Coordination

### Consumes (Upstream Prerequisites from Package 1.1)
- **Monorepo Scaffolding**: Workspace structure, TypeScript configs, test harness configurations (Vitest, Playwright).
- **Database & Transactions**: `packages/db/src/transaction.ts` transaction runner, migration framework (`packages/db/src/migrate.ts`), base workspace tables (`users`, `notebooks`, `sources`, `quotas`).
- **Identity & Authorization**: Revocation-aware Identity Platform verified subject mapping (`apps/api/src/auth/identity.ts`).
- **Quota & Admission Ledger**: Atomic source slot reservation (`FR-WM-07`) ensuring slots are reserved before ingestion starts and released upon failure.
- **Core Contracts**: `C-01 UnifiedDocumentChunk` schema and `C-02 ScopedContextProvider` envelope.

### Provides (Downstream Deliverables for Packages 1.3 & 1.4)
- **To Package 1.3 (`specs/003-grounded-chat-citation-engine`)**:
  - Normalized `C-01` chunks with deterministic `chunk_id`, `token_count` (300–600 tokens), and `page_span` locators.
  - Hybrid retrieval implementation (vector via `pgvector` + PostgreSQL FTS with Reciprocal Rank Fusion) under `C-02` contract enforcing submission-time `(source_id, revision)` snapshots and zero deselected-source leakage (`NFR-EVAL-04`).
- **To Package 1.4 (`specs/004-ui-skeleton-quality-gates`)**:
  - Source list UI components, individual checkboxes, `"Select all"` master toggle, and active source counter (`"<n> sources"` badge).
  - Source Inspector panel with deterministic passage scrolling and highlighting to `[data-chunk-id]` in $\le 300\text{ ms}$ upon citation badge click (`Gate v1.0 #3`).

---

## 4. Base Commit and Branch Information

- **Working Branch**: `implement_speckit_v1`
- **Specification Source Branch**: `spec/v1-functional-requirements`
- **Base Commit**: `cc430e4202dfe37b6f4724d90f05172d19f5c5b7`
- **Upstream Milestones Included**:
  - `6f3d6b2`: OpenTofu `D14` foundation baseline in `infra/stacks/v1_foundation/`
  - `d797ca0`: Package 1.1 implementation plan and foundation alignment
  - `8f538e9`: Package 1.2 specification clarifications
  - `f41f3c3`: Spec Kit clarify, plan, checklist, tasks, and analyze workflows for v1.0 MVP
  - `cc430e4`: Agent context extension and governance reconciliation

---

## 5. Verification Checklist Status

All pre-implementation quality gates and checklists have been formally evaluated and confirmed passing:

| Review / Gate Artifact | Status | Verification Summary |
| :--- | :---: | :--- |
| **`checklists/requirements.md`** | **PASS** | 12 of 12 checks verified. Zero clarification markers remain; plain-English user stories, complete acceptance scenarios, exact input limits, and edge cases confirmed. |
| **`checklists/ingestion-scoping-inspector.md`** | **PASS** | 17 of 17 checks (`CHK001`–`CHK017`) verified. Ingestion modalities, 5-field `C-01` schema, granular scoping, DOM inspector navigation, zero-leakage invariant, and edge cases satisfied. |
| **`analysis.md` (Constitution Check `CC-01`..`CC-08`)** | **PASS** | All 8 gates passed. Zero ambiguity, zero duplication, zero critical/high issues detected. 100% requirement coverage across `T001`–`T030`. |
| **`scripts/check-spec-integrity.mjs`** | **PASS** | 78 markdown files, 55 SRS requirement IDs, and 12 Spec Kit feature artifacts resolve with 0 errors. |

---

## 6. Implementation Summary & Deliverables

All tasks in Package 1.2 (`T001` through `T030`) have been completed, verified via strict TDD (Red → Green), and documented:

### Phase 1: Setup & Shared Contracts (`T001`–`T006`)
- **Contracts**: `packages/contracts/src/package-v1-2.ts` (29 tests passing).
- **Database Schema**: `packages/db/migrations/0002_ingestion.sql` defining `ingestion_attempts`, `source_revisions`, and `document_chunks` with composite FKs and indexes (11 tests passing).

### Phase 2: User Story 1 - Ingest Sources (`T007`–`T013`)
- **Worker Pipeline**: `apps/worker/src/ingestion/pipeline.ts` supporting `.pdf` (OCR/tables), `.txt`, `.md`, and copied text with 300–600 token chunking and 200MB/500,000 word bounds.
- **Persistence & API**: `packages/db/src/ingestion.ts` and `apps/api/src/routes/sources.ts`.
- **Web Upload**: `apps/web/src/sources/upload.ts` (19 tests passing).

### Phase 3: User Story 2 - Select Active Sources (`T014`–`T020`)
- **Controller**: `apps/web/src/sources/selection.ts` implementing `SourceSelectionController`, master tri-state checkbox, badge counter, and in-flight submission snapshot immutability (`CP2`).
- **API & Storage**: `apps/api/src/routes/selection.ts` rejecting empty scopes with HTTP 400 (`EmptyScopeError`) preventing ungrounded inference.
- **List Presenter**: `apps/web/src/sources/list.ts` (14 tests passing).

### Phase 4: User Story 3 - Inspect Source Passages (`T021`–`T027`)
- **Inspector Controller**: `apps/web/src/sources/inspector.ts` managing singleton read scope and leaving active chat selection untouched (`C-02`, `NFR-EVAL-04`).
- **Viewer Presenter**: `apps/web/src/sources/viewer.ts` & `apps/web/src/sources/virtual-text.ts` supporting deterministic passage highlighting and windowed rendering for large 400k-word sources.
- **Service & Route**: `packages/db/src/source-view.ts`, `apps/api/src/routes/source-content.ts`, and `apps/api/src/routes/inspector.ts` (17 tests passing).

### Phase 5: Polish & Integrated Verification (`T028`–`T030`)
- **Full Package Regression**: 12 test suites, 90 tests passing (100% GREEN, 1.13s execution time).
- **Spec Integrity**: `node scripts/check-spec-integrity.mjs` passes with 0 errors across 78 Markdown files and 55 SRS requirements.
- **Status**: Package 1.2 is fully verified and ready for downstream integration by Package 1.3 (`specs/003-grounded-chat-citation-engine`) and Package 1.4 (`specs/004-ui-skeleton-quality-gates`).
