# Implementation Plan: Multimodal Ingestion & Sync

**Branch**: `codex/v3-refresh-3-1-20261021` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md`
**SRS IDs in Scope**: FR-SI-01 Subset B, FR-SI-05, C-01; supporting FR-SI-02/03/04, FR-GC-02/03/06, FR-WM-04/05/07, C-02/C-03, NFR-SEC-01/02, NFR-EVAL-01..04 | **Release Gate**: Gate v3.0 #1
**Input**: `specs/009-multimodal-ingestion-sync/spec.md`

## Summary (FR-SI-01/05, C-01)

Extend the existing ingestion pipeline with Office, delegated Drive, guarded HTML, caption and audio adapters. Persist canonical viewer content, timestamped evidence and embeddings before atomic source publication. Re-sync stages a new revision while the prior Ready revision remains readable; a durable per-source operation fence rejects overlapping requests. Existing C-02 authorization and snapshot checks govern all consumers. Deliver rename, deletion hygiene and timestamp navigation alongside ingestion. Packages 3.2/3.3 consume these adapters without a new locator union; 3.4 benchmarks the integrated release.

## Technical Context (FR-SI-01/05, C-01/C-02, NFR-SEC-01/02)

**Language/Version**: TypeScript 5.x strict ESM, Node.js 24, pnpm workspaces; reuse root package versions.
**Primary Dependencies**: Existing Zod shared contracts; pdfjs-dist/Document AI PDF path; LibreOffice and ffmpeg in architecture-designated render job; Mozilla Readability; Speech-to-Text V2 Chirp 2 batch word offsets; delegated Drive REST export; Model Armor. No ADK agent loop for ingestion. No unverified SDK signatures or deployment commands prescribed.
**Storage**: Existing Cloud SQL PostgreSQL 16+ with pgvector/FTS, revision rows and operation/outbox records; canonical viewer text in `source_pages` committed atomically with chunks (D15); private Cloud Storage raw files and binary staged objects. Existing `chunks` already has vector(768), tsv, HNSW and GIN indexes; do not create a duplicate index/table. No new datastore.
**Authentication & Residency**: Owner-only v3, generic OIDC/SAML; delegated Drive authorization separate from SSO. Cloud Run, SQL, Storage, Speech and Model Armor endpoints configured in europe-west4; no region exception. Model Armor processes within EU jurisdiction, not a claim of Netherlands-only processing. Drive is an external user-selected repository, not an EU model runtime. Use approved enterprise model endpoints and no-training agreements; do not claim zero retention.
**Testing**: Existing Vitest and Playwright stack; spec-derived boundary, contract, transaction and browser scenarios before implementation. Live provider and release benchmarks presently UNAVAILABLE.
**Execution Model**: Deterministic fetch → normalize → screen → chunk → embed → fenced commit; asynchronous Source Guide through singleton C-02 after commit. Long render/ASR operations persist provider operation IDs and resume instead of holding DB transactions open.
**Performance Goals**: 30-minute audio acceptance-to-timestamped-transcript P95 ≤45s, including queue/preprocessing/provider wait, excluding upload and indexing. Interview.mp3 citation 04:15 seeks to 255000ms. No inferred provider latency guarantee.
**Constraints**: Independent inclusive 200000000-byte and 500000-word limits; titles 1–200 trimmed Unicode code points; chunk target 300–600 tokens with section boundaries; no silent truncation or privileged credential fallback.
**Within-Release Prerequisites**: README v3 ordering: 3.1 first, then 3.2/3.3, then 3.4. Gate v2 evidence is required before v3 implementation, not before planning.

## Constitution Check (`CC-01`..`CC-08`)

Pre-research assessment used the inherited accepted specification; post-design assessment uses the artifacts below. PASS means the design complies, not that runtime acceptance has passed.

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| CC-01 | Traceability | PASS | PASS | FR-SI-01/05 and C-01 mapped below; planning refinements mirrored in spec, card and architecture. |
| CC-02 | Test-first | PASS | PASS | Quickstart scenarios derive tests before implementation; tasks generation remains next stage. |
| CC-03 | Scope/snapshot | PASS | PASS | C-02 only for consumers; singleton Inspector/Guide; immutable revision and publication fences. |
| CC-04 | Citations/leakage | PASS | PASS | FR-GC-02/03 and NFR-EVAL-02/04 require refusal, updated/deleted states and immediate access invalidation. |
| CC-05 | Contracts/pipeline | PASS | PASS | Existing shared C-01 schemas; deterministic adapters; no parallel contract definitions. Current six-field C-01 projection (including revision) and strict millisecond locator union retained; compatibility tests cover all existing consumers. |
| CC-06 | Release/order | PASS | PASS | Planning only; Gate v2 before implementation; no discovery, v4 export or v6 sharing. |
| CC-07 | Security/residency | PASS | PASS | Owner/ACL checks, atomic quota, guarded network, mandatory screening, EU endpoint map; service enablement requires owner approval at deployment. |
| CC-08 | Platform/cost | PASS | PASS | Existing services and single DB; render scales to zero; no extra framework or fixed cost. |

## Project Structure (FR-SI-01/05, C-01)

Documentation: this directory owns `plan.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`, `quickstart.md`; retains `spec.md` and checklist. No tasks.md or implementation produced.

Intended implementation boundaries (new files marked new):

- `packages/contracts/src/document-chunk.ts`: consume existing C-01; do not introduce a new locator or rewrite v1 consumer wire format. `package-v3-1.ts` (new): import, sync, status and viewer DTOs. Export through existing index.
- `packages/db/src/ingestion.ts`, `quota.ts`, `jobs.ts`, `scoped-context.ts`, `scope-guard.ts`, `cleanup.ts`: integrate revision publish and deletion with existing reads. `source-sync.ts` and next ordered migration (new): durable single-active sync, staged revision/outbox. Allocate migration number at implementation after preceding migrations merge.
- `apps/worker/src/ingestion/pipeline.ts`: integrate adapter registry; `ingestion/{office,drive,web,media,sync}.ts` (new): bounded deterministic adapters and operation executor. Reuse `extract.ts`/`chunker.ts` and `apps/worker/src/jobs.ts`. Extend the existing jobs outbox with sync jobs and fencing; no second queue or Guide implementation. The Guide lifecycle currently lives in `apps/api/src/v2/runtime.ts` and `packages/db/src/package-v2-2.ts`; persist/invalidate its revision-keyed repository and durable trigger for v3 (D16), with other v2-store migration owned by its respective package.
- `apps/api/src/routes/sources.ts`, `apps/api/src/app.ts` and `router.ts`: extend authorization/admission and content routes; `source-sync.ts` (new) for mutations and trusted notifications.
- `apps/web/src/sources/{panel,inspector}.ts`, `apps/web/src/chat/panel.ts`, `apps/web/src/lib/{api,types}.ts`: Add sources, sync/rename/remove actions and transcript seek; no new UI framework.
- `apps/render/` (architecture-planned service): Office conversion and media preprocessing only in this package, no v4/v5 generation. `infra/` uses existing service modules for API approvals, render job and per-service least privilege.
- Tests alongside these owners in existing test trees; `packages/evals/` and browser tests add mixed-modality fixture coverage.

**Structure & File Ownership Decision**: Package 3.1 owns these changes; shared schema exports, migration and architecture/card flowback serialize before 3.2. Follow-on packages consume exact C-01/C-02 contracts and invalidate snapshots when revisions change; they must not fork adapters.

## Design and requirement coverage (FR-SI-01/05, C-01/C-02)

| Spec requirements | Design boundary | Acceptance evidence to implement first |
| :--- | :--- | :--- |
| FR-001/002 | Office render + supplemental extraction, delegated Drive | Text/table/notes/visual golden fixtures; revoked delegation; normalized page anchors |
| FR-003/008 | Guarded fetch, Readability, Model Armor | Redirect/rebinding/private address matrix; PDF dispatch; blocked/empty/JS shell and quarantine failures |
| FR-004/005/006 | Caption/ASR adapters and Inspector DTO | Every media chunk timestamp bounds, 04:15 highlight/seek, MIME icons/progress; unchanged locator union |
| FR-007/009 | Shared admission and title validator | Exact byte/word/code-point boundaries, simultaneous quota contention |
| FR-010/011/012 | Source mutation transaction and durable sync operation | Atomic rollback, duplicate delivery versus overlapping request, worker crash fencing, deletion race |
| FR-013/014/015/016 | C-02, publication checks, historical access | Old/revoked snapshot fails; history unavailable on delete, Guide regeneration; Owner-only and zero leakage |

## Delivery sequence and validation (FR-SI-01/05, CC-02)

Gate v2 is recorded as owner-approved override in `docs/gate-v2-live-evaluation.md`, with failed pre-fix measurements and no live re-run; retain these limitations rather than claim measured passage. Before implementation preserve current C-01 and real PostgreSQL baseline under regression tests. Add failing contract/boundary fixtures, then DB race tests and adapter golden fixtures, then endpoint/Inspector/grounding integration scenarios. Implement against those tests, then run exact 30-minute audio benchmark and Gate v3 media citation scenario. No target is weakened if provider speed fails; record a blocker and obtain any required SRS/architecture amendment before changing scope. Deployment requires owner-approved API enablement, delegated OAuth registration and confirmed regional language/model availability. These are deployment prerequisites, not new product questions.

## Complexity Tracking (FR-SI-01, D11)

| Gate / Decision | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| D11 | Delegated Google Docs/Slides import and re-sync | Manual export cannot satisfy native linked import; privileged service-account reads violate ACLs. |

No new exception, framework, datastore, or release deviation is introduced. Post-design hooks are optional Git commit hooks only; completion includes an explicitly authorized planning commit.

## Latest-main design review — 2026-10-21 (FR-SI-01/05, C-01/C-02, D15/D16)

Latest main `0a94f3fca01395922fa788ea8cbb4286e8500f4a` replaces the old fixture assumptions: real bounded extraction/chunking/embeddings, notebook→source transaction fences, durable jobs, canonical pages, singleton Inspector and hybrid retrieval now exist. Extend these boundaries without recreating them. `publishReadySource` currently accepts only Processing sources; sync requires a separate fenced replacement path retaining Ready access and the existing quota slot, with canonical pages/chunks published in one transaction.

`SourceTitleSchema` still limits legacy creation/copied-text titles to 100; rename requires its own 1–200 code-point DTO and compatible public source projection. Do not widen the copied-text input limit as a side effect. Existing MIME and SQL checks cover only v1 types plus trusted `note_markdown`; extend both for v3 without permitting clients to upload `note_markdown`. Keep note-source provenance and shared quota behavior intact.

D16 defers v2 persistence to v3. For this package, Source Guide invalidation/regeneration needs a durable revision/language-keyed repository and publication trigger behind current interfaces, replacing process-local watcher/run deduplication as the correctness boundary. Reuse the generator; unrelated preferences, notes and Studio persistence remain assigned to their consuming packages. All CC gates above were rechecked against Constitution 2.0.0: deterministic evals each PR; judged 50-case stratified release run once per gate with sample IDs/composition/hash. Provider qualification and 45-second ASR runtime evidence remain UNAVAILABLE.
