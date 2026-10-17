# Implementation Plan: Text/PDF Ingestion & Inspector

**Branch**: `spec/v1-functional-requirements` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md`
**SRS IDs**: FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02, Gate v1.0

## Summary

Implement exactly package 1.2 from [FR cards](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md) and [binding rules](../../spec/requirements/README.md). Prerequisite plan created before task generation; no application code is produced here. Main infrastructure baseline 6f3d6b2 was merged before this design; D14 OpenTofu supersedes older Terraform wording.

## Technical Context

- TypeScript 5.x strict ESM, Node24, pnpm baseline; pin compatible versions in the implementation lockfile, reuse package1.1 native HTTP/browser adapters instead of adding frameworks.
- Shared Zod contracts; Cloud SQL PostgreSQL+pgvector/FTS, Cloud Storage, Cloud Tasks and Cloud Run in europe-west4 by default. Use existing `infra/stacks/v1_foundation/main.tf` and modules, never duplicate infrastructure.
- Deterministic upload/parse/OCR/chunk/index pipeline; no agent loop. C-02 owns retrieval and singleton inspection.
- Vitest unit/contract/integration/eval and Playwright browser suites. No application runners exist yet: UNAVAILABLE.
- Package 1.1 shared schemas, verified identity, notebook ownership, quota ledger and deletion fences must be integrated first. Package 1.3 consumes this package; citation fixtures avoid a circular dependency.
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
| CC-06 | Release order | PASS | PASS | Package 1.1 shared schemas, verified identity, notebook ownership, quota ledger and deletion fences must be integrated first. Package 1.3 consumes this package; citation fixtures avoid a circular dependency. |
| CC-07 | Security/residency | PASS | PASS | Owner authorization and no-training enterprise routes; EU default with verified service region map; no API activation. |
| CC-08 | Platform/cost | PASS | PASS | Reuse TypeScript/Cloud Run/single Postgres/Storage/Tasks and OpenTofu D14; no new framework/fixed-cost service. |

## Project Structure and Ownership

Documentation owned by this session: this package's `plan.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`, `quickstart.md`, `tasks.md`. Worktree `/private/tmp/everlast-v1-specs`, branch `spec/v1-functional-requirements`. Runtime paths below are proposed package-owner boundaries; publish task/file reservations before implementation. Shared manifests, schema exports, migrations, entrypoints and CI remain serialized under one owner.

| Component | Exact intended files | Trace |
| :--- | :--- | :--- |
| Ingest sources | `apps/worker/test/ingestion.test.ts`, `apps/worker/src/ingestion/pipeline.ts`, `packages/db/src/ingestion.ts`, `apps/api/src/routes/sources.ts`, `apps/web/src/sources/upload.ts` | FR-SI-01 |
| Select active sources | `apps/web/test/source-selection.spec.ts`, `apps/web/src/sources/selection.ts`, `packages/db/src/scoped-context.ts`, `apps/api/src/services/source-context.ts`, `apps/web/src/sources/list.ts` | FR-SI-03 |
| Inspect source passages | `apps/web/test/source-inspector.spec.ts`, `apps/web/src/sources/inspector.ts`, `packages/db/src/source-view.ts`, `apps/api/src/routes/source-content.ts`, `apps/web/src/sources/virtual-text.ts` | FR-SI-04 |
| Persistence | `packages/db/migrations/0002_ingestion.sql` | C-01, C-02; serialize after preceding migration |

Shared dependencies: `packages/contracts/src/document-chunk.ts`, `scoped-context.ts`, `source-admission.ts`, `workspace.ts` belong to package1.1 baseline. Schema extensions must update all consumers/tests through the same files; no second C-01/C-02. Package-specific DTOs live in `packages/contracts/src/package-v1-2.ts`. Manifests/lockfile/CI changes require the shared owner and preserve OpenTofu scripts/workflow. No cloud apply or API enablement is authorized.

## Design and Phase Outputs

- [Research](research.md): decisions and alternatives.
- [Data model](data-model.md): relationships, state transitions and exact input constraints.
- [Interfaces](contracts/interfaces.md): behavior and failure contracts.
- [Quickstart](quickstart.md): required tests, setup and evidence.

## Source precedence and integration constraints

The SRS/cards/README override lower-priority architecture prose: v1 source limits remain deployment configurable 50–300; daily generation quotas and all v2+ features are excluded. The 2 s notebook deletion metric applies to database/chunk removal per FR-WM-01; do not silently extend it to outstanding signed upload capabilities. Use the 1.1 immediate-access fence and tracked all-generation purge. Any unresolved change to these contracts requires source-aligned plan updates and rerun analyze before dependent implementation.

Package1.1's older plan/task infrastructure wording must be reconciled with integrated D14 and actual infra paths at its T001 checkpoint. These package plans consume the approved baseline, not the former unintegrated infrastructure branch. No competing infrastructure files are created.

## Complexity Tracking

No new framework, datastore, cloud service, scope deferral or constitution exception. Canonical representation, request provenance and explicit publication checks implement existing C-01/C-02/D13 requirements. Deployment endpoint/IdP/processor configuration is a live validation prerequisite, not an assumed successful deployment.
