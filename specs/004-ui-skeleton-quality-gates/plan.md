# Implementation Plan: UI Skeleton & Quality Gates

**Branch**: `spec/v1-functional-requirements` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md`
**SRS IDs**: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01, C-02, Gate v1.0
**Input**: `specs/004-ui-skeleton-quality-gates/spec.md`, clarified in `47c4e90`.

## Summary

Implement exactly package 1.4 from [FR cards](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md) and [binding rules](../../spec/requirements/README.md). Prerequisite plan created before task generation; no application code is produced here. Main infrastructure baseline `6f3d6b2` (`D14` OpenTofu in `infra/stacks/v1_foundation/`) is merged and aligned across packages 1.1–1.3 (`d797ca0`, `e2725ee`, `ff04006`).

## Technical Context

- TypeScript 5.x strict ESM, Node24, pnpm baseline; pin compatible versions in the implementation lockfile, reuse package1.1 native HTTP/browser adapters instead of adding frameworks.
- Shared Zod contracts; Cloud SQL PostgreSQL+pgvector/FTS, Cloud Storage, Cloud Tasks and Cloud Run in europe-west4 by default. Use existing `infra/stacks/v1_foundation/main.tf` and modules, never duplicate infrastructure.
- Deterministic UI state and eval orchestration; model calls only in judged eval cases and the already-owned chat pipeline. No Studio generator.
- Vitest unit/contract/integration/eval and Playwright browser suites. No application runners exist yet: UNAVAILABLE.
- 1.1–1.3 provide real notebook, source, inspector and chat features; UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application.
- Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.

## Constitution Check (CC-01..CC-08)

Pre-research scope review passed before selecting implementation details; post-design review covers the contract/data/validation documents, not runtime success. No tests are claimed executed. Full analyze is required after tasks before implementation.

| Gate | Principle | Pre-research | Post-design | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | All EARS/scenarios/limits/errors from each card are mapped in tasks coverage annex; no source requirements changed. |
| CC-02 | Test-first | PASS | PASS | Per-story Red tasks precede all behavior implementation; real runners required; missing dependency is not Red. |
| CC-03 | Scope/snapshot | PASS | PASS | C-02 sole read boundary; explicit Ready set and revision/authorization rechecks in contracts. |
| CC-04 | Citation/leakage | PASS | PASS | D13 buffering, refusal and full history/cache provenance enforced across integrations. |
| CC-05 | Contracts/pipelines | PASS | PASS | Import 1.1 C-01/C-02 once; deterministic components except 1.3 reasoning; no C-03 runtime in v1. |
| CC-06 | Release order | PASS | PASS | 1.1–1.3 provide real notebook, source, inspector and chat features; UI shell and test datasets can be prepared early, but full Gate v1.0 requires the integrated runnable application. |
| CC-07 | Security/residency | PASS | PASS | Owner authorization and no-training enterprise routes; EU default with verified service region map; no API activation. |
| CC-08 | Platform/cost | PASS | PASS | Reuse TypeScript/Cloud Run/single Postgres/Storage/Tasks and OpenTofu D14; no new framework/fixed-cost service. |

## Project Structure and Ownership

Documentation owned by this session: this package's `plan.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`, `quickstart.md`, `tasks.md` on branch `spec/v1-functional-requirements` (base `47c4e90`). Runtime paths below are proposed package-owner boundaries; publish task/file reservations before implementation. Shared manifests, schema exports, migrations, entrypoints and CI remain serialized under one owner.

| Component | Exact intended files | Trace |
| :--- | :--- | :--- |
| Use adaptive workspace | `apps/web/test/workspace-layout.spec.ts`, `apps/web/src/workspace-layout.ts`, `apps/web/src/workspace-state.ts`, `apps/web/src/main.ts`, `apps/web/src/workspace.css` | FR-UI-01 |
| Enforce evaluation and security gates | `packages/evals/test/release-v1.test.ts`, `packages/evals/src/runner.ts`, `packages/evals/src/metrics.ts`, `packages/evals/src/report.ts`, `packages/evals/src/security-preflight.ts` | NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01 |

Shared dependencies: `packages/contracts/src/document-chunk.ts`, `scoped-context.ts`, `source-admission.ts`, `workspace.ts` belong to package1.1 baseline. Schema extensions must update all consumers/tests through the same files; no second C-01/C-02. Package-specific DTOs live in `packages/contracts/src/package-v1-4.ts`. Manifests/lockfile/CI changes require the shared owner and preserve OpenTofu scripts/workflow. No cloud apply or API enablement is authorized.

## Design and Phase Outputs

- [Research](research.md): decisions and alternatives.
- [Data model](data-model.md): relationships, state transitions and exact input constraints.
- [Interfaces](contracts/interfaces.md): behavior and failure contracts.
- [Quickstart](quickstart.md): required tests, setup and evidence.

## Source precedence and integration constraints

The SRS/cards/README override lower-priority architecture prose: v1 source limits remain deployment configurable 50–300; daily generation quotas and all v2+ features are excluded. The 2 s notebook deletion metric applies to database/chunk removal per FR-WM-01; do not silently extend it to outstanding signed upload capabilities. Use the 1.1 immediate-access fence and tracked all-generation purge. Any unresolved change to these contracts requires source-aligned plan updates and rerun analyze before dependent implementation.

Package 1.1's plan (`d797ca0`) is reconciled with integrated `D14` and actual `infra/stacks/v1_foundation/` paths. These package plans consume the approved baseline, and no competing infrastructure files are created.

## Complexity Tracking

No new framework, datastore, cloud service, scope deferral or constitution exception. Canonical representation, request provenance and explicit publication checks implement existing C-01/C-02/D13 requirements. Deployment endpoint/IdP/processor configuration is a live validation prerequisite, not an assumed successful deployment.
