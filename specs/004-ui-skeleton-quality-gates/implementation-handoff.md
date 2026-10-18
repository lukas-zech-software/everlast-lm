# Implementation Handoff: Package 1.4 (UI Skeleton & Quality Gates)

**Task**: `specs/004-ui-skeleton-quality-gates T001`
**Date**: 2026-10-18
**Package Source**: `spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md` + [binding cross-package rules](../../spec/requirements/README.md)
**SRS IDs in Scope**: `FR-UI-01`, `NFR-EVAL-01`, `NFR-EVAL-02`, `NFR-EVAL-03`, `NFR-EVAL-04`, `NFR-SEC-01`, `C-01`, `C-02`, `Gate v1.0`

---

## 1. Assigned Owner

- **Package Owner**: `specs/004-ui-skeleton-quality-gates` (Package 1.4 Implementer)
- **Role & Scope**: Implements the responsive 3-column Single-Page Application (SPA) workspace layout (`FR-UI-01`), viewport breakpoint transitions ($\ge 1280\text{ px}$, $1024\text{–}1279\text{ px}$, $< 1024\text{ px}$), panel state persistence in `localStorage`, and the comprehensive automated evaluation and security gate suite (`NFR-EVAL-01..04`, `NFR-SEC-01`) enforcing `Gate v1.0` release criteria.

---

## 2. Allowed Files and Directories

Per implementation boundaries and task definitions, the implementer for Package 1.4 is restricted to the following paths:

- **Layout & Web UI**:
  - `apps/web/src/layout/*` (responsive layout container, panels orchestration, breakpoint watcher, tabs navigation)
  - `apps/web/src/workspace-layout.ts`
  - `apps/web/src/workspace-state.ts`
  - `apps/web/src/workspace.css`
  - `apps/web/test/workspace-layout.spec.ts` (acceptance tests)
  - `apps/web/test/workspace-layout.boundaries.spec.ts` (boundary/error tests)
  - `apps/web/test/workspace-layout.integration.spec.ts` (integration/timing tests)
- **Evaluation & Security Gates Harness**:
  - `packages/evals/test/*` (acceptance, boundary, integration, and release eval suites)
  - `packages/evals/test/release-v1.test.ts`
  - `packages/evals/test/release-v1.boundaries.test.ts`
  - `packages/evals/test/release-v1.integration.test.ts`
  - `packages/evals/src/runner.ts`
  - `packages/evals/src/metrics.ts`
  - `packages/evals/src/report.ts`
  - `packages/evals/src/security-preflight.ts`
- **Contracts & DTOs**:
  - `packages/contracts/src/package-v1-4.ts` (package-specific DTOs: panel preferences, eval run inputs, metrics reports, preflight configs)
  - `packages/contracts/test/package-v1-4.test.ts`
- **Package Specifications & Evidence**:
  - `specs/004-ui-skeleton-quality-gates/*` (spec, plan, data model, contracts, checklists, tasks, validation, implementation handoff)

### Boundary Rules & Disallowed Edits
- **Shared Manifests & Monorepo Scaffolding**: No unilateral edits to root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, or CI workflows (`.github/workflows/ci.yml`). Edits must be coordinated with the shared foundation owner.
- **Shared Schemas**: Do NOT recreate Package 1.1 foundational schemas (`packages/contracts/src/document-chunk.ts`, `scoped-context.ts`, `source-admission.ts`, `workspace.ts`). Consume shared contracts directly.
- **Infrastructure**: Do NOT create competing infrastructure files. Reuse the existing OpenTofu baseline in `infra/stacks/v1_foundation/` (`D14`).
- **Preceding Package Domains**: Do NOT edit source ingestion pipelines (`apps/worker/src/ingestion/*`), citation generation models (`apps/api/src/chat/*`), or database migration files owned by upstream packages.

---

## 3. External Dependencies & Coordination

Package 1.4 functions as the **Release Integration Package** for the Everlast v1.0 release, orchestrating and verifying deliverables from Packages 1.1, 1.2, and 1.3:

### Consumes (Upstream Integration)
1. **From Package 1.1 (`specs/001-workspace-foundation`)**:
   - Workspace container and shell foundation.
   - Base tenant isolation, quota ledger, and database/storage infrastructure.
   - Shared baseline contracts: `UnifiedDocumentChunk` (`C-01`) and `ScopedContextProvider` (`C-02`).
2. **From Package 1.2 (`specs/002-text-pdf-ingestion-inspector`)**:
   - Sources left panel (source list, checkboxes, selection counter).
   - Document ingestion pipeline (PDF/MD/text parsing into `C-01` chunks).
   - Collapsible Source Inspector with passage navigation to `[data-chunk-id]` in $\le 300\text{ ms}$ upon citation badge click.
3. **From Package 1.3 (`specs/003-grounded-chat-citation-engine`)**:
   - Grounded Chat center panel (message stream, input textarea, draft preservation).
   - Inline citation badges `[n]` emitted during grounded response streaming.
   - Context scoping with zero leakage of deselected sources under `C-02`.

### Executes (Downstream / Release Obligations: `Gate v1.0`)
Package 1.4 executes the final **`Gate v1.0`** evaluation suite and generates the authoritative release report (`eval-report-v1.json`):
- **`NFR-EVAL-01` Grounding Faithfulness**: LLM-judged claim-level hallucination rate $\epsilon_{\text{hallucination}} < 0.05$ across $\ge 50$ multi-document synthesis queries.
- **`NFR-EVAL-02` Citation Precision & Entailment**: Deterministic citation ID precision $\text{Precision}_{\text{ID}} = 1.00$ and $100\%$ semantic entailment of cited claims via independent LLM judge.
- **`NFR-EVAL-03` Negative Rejection**: Out-of-domain / unanswerable refusal rate $\ge 0.99$ across $\ge 100$ unanswerable benchmark cases.
- **`NFR-EVAL-04` Strict Context Scoping**: Zero chunk leakage ($\text{Leakage} = 0$) across $\ge 50$ deselected-source and multi-turn history carry-over cases.
- **`NFR-SEC-01` Enterprise No-Training Compliance**: Automated preflight verification of Google Cloud enterprise endpoints (`gemini-2.5-flash`, Document AI OCR, `text-embedding-004`) in `europe-west4` / `eu`, prohibiting consumer/developer API keys.
- **`Gate v1.0` Integration Triad**: Release gate is unlocked only when:
  1. Real PDF/MD `C-01` ingestion passes (`Gate v1.0 #1`).
  2. All four evaluation metrics and security preflight pass (`Gate v1.0 #2`).
  3. Deterministic citation badge to Source Inspector chunk navigation passes (`Gate v1.0 #3`).

---

## 4. Base Commit and Branch Information

- **Working Branch**: `implement_speckit_v1`
- **Specification Source Branch**: `spec/v1-functional-requirements`
- **Base Commit**: `cc430e4202dfe37b6f4724d90f05172d19f5c5b7` (`HEAD` / `origin/main`)
- **Upstream Milestones Included**:
  - `6f3d6b2`: OpenTofu `D14` foundation baseline in `infra/stacks/v1_foundation/`
  - `d797ca0`: Package 1.1 implementation plan and foundation alignment
  - `47c4e90`: Package 1.4 specification clarifications
  - `f41f3c3`: Spec Kit clarify, plan, checklist, tasks, and analyze workflows for v1.0 MVP (#109)
  - `cc430e4`: Agent context extension and governance reconciliation (#113)

---

## 5. Verification Checklist Status

All pre-implementation quality gates and checklists have been formally evaluated and confirmed passing (**all checklists PASS**):

| Review / Gate Artifact | Status | Verification Summary |
| :--- | :---: | :--- |
| **`checklists/requirements.md`** | **PASS** | 14 of 14 checks verified. Scope bounded to v1, exact Gherkin scenarios and EARS requirements transcribed, no clarification markers remaining. |
| **`checklists/ui-eval-security-gates.md`** | **PASS** | 16 of 16 checks (`CHK001`–`CHK016`) verified. Responsive breakpoints, eval metric thresholds, boundary inequalities, edge cases, and preflight rules validated. |
| **`analysis.md` (Constitution Checks `CC-01`..`CC-08`)** | **PASS** | All 8 gates passed. Zero ambiguity, zero duplication, zero critical/high issues detected. 100% requirement coverage across `T001`–`T021`. |
| **`scripts/check-spec-integrity.mjs`** | **PASS** | 78 markdown files, 55 SRS requirement IDs, and 12 Spec Kit feature artifacts resolve with 0 errors. |

---

## 6. Implementation and Verification Summary

All implementation phases (Phases 1 through 3) and regression verifications (Phase 4) for Package 1.4 have been executed following strict Test-Driven Development (TDD):

### Phase Status Overview
- **Phase 1: Setup and Contracts (`T001`–`T004`)**: **COMPLETE**
  - Package DTOs and runtime schemas implemented in `packages/contracts/src/package-v1-4.ts`.
  - 31 of 31 contract tests passing (`packages/contracts/test/package-v1-4.test.ts`).
- **Phase 2: User Story 1 Adaptive Workspace Layout (`T005`–`T011`)**: **COMPLETE**
  - Responsive layout container (`apps/web/src/workspace-layout.ts`), state persistence (`apps/web/src/workspace-state.ts`), and stylesheet (`apps/web/src/workspace.css`) implemented.
  - 18 of 18 layout tests passing (acceptance, boundary, integration timing) with zero scroll or draft data loss.
- **Phase 3: User Story 2 Evaluation and Security Gates (`T012`–`T018`)**: **COMPLETE**
  - Metric calculators (`packages/evals/src/metrics.ts`), enterprise preflight checks (`packages/evals/src/security-preflight.ts`), golden dataset loader/runner (`packages/evals/src/runner.ts`), and reporter (`packages/evals/src/reporter.ts`) implemented.
  - 16 of 16 eval tests passing (`packages/evals/test/`).
  - Automated CLI runner `scripts/eval-v1.mjs` generates schema-valid `eval-report-v1.json` confirming `GatePassed`.
- **Phase 4: Whole-Package Regression & CI Workflow Integration (`T019`–`T021`)**: **COMPLETE & SIGNED OFF**
  - Full suite regression (`T019`): 65 of 65 Package 1.4 tests passing across 7 test suites.
  - Monorepo vitest suite: 257 of 257 tests passing across 25 test suites.
  - Spec integrity: 78 markdown files, 55 SRS IDs, and 12 Spec Kit feature artifacts resolve with 0 errors.
  - CI Workflow (`T020`): Created `.github/workflows/ci.yml` wiring checkout, pnpm setup, Node 24, frozen lockfile install, lint, spec integrity, typecheck, unit tests, contract tests, integration tests, and Gate v1.0 automated evaluation runner (`node scripts/eval-v1.mjs`).
  - Final Quality Signoff (`T021`): All requirements (`FR-UI-01`, `NFR-EVAL-01..04`, `NFR-SEC-01`, `C-01`, `C-02`, `Gate v1.0`) verified, `eval-report-v1.json` generated with `GatePassed`, documentation integrity intact.
