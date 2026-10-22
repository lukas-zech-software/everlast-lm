# Tasks: Multimodal Ingestion & Sync

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [interfaces](contracts/interfaces.md), [quickstart.md](quickstart.md).
**Package Source**: `spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md` + `spec/requirements/README.md`.
**SRS IDs in Scope**: FR-SI-01/02/03/04/05, FR-GC-02/03/06, FR-WM-04/05/07, FR-NM-03, C-01/C-02/C-03, NFR-SEC-01/02, NFR-EVAL-01..04 | **Release Gate**: Gate v3.0 #1.
**Date**: 2026-10-22. **State**: generated; no implementation task has been executed.

**Prerequisites**: Reviewed spec/designs and CC-01..CC-08; recorded Gate v2 owner override in `docs/gate-v2-live-evaluation.md`, retaining its known failures (the 2026-10-22 live re-run passes #3 while #1 and FR-GC-07 Shorter still fail). Review the custom requirements checklist before implementation; no unchecked reviewer item is silently approved by this task-generation run. Existing v1 C-01/C-02, v2 Guide repository and applied migrations 0001–0008 remain authoritative. D19 makes sandbox R6 obsolete; this package introduces no sandbox qualification task.

**Tests**: Mandatory Constitution II/CC-02. Write each task's cited tests, observe a requirement-related failure, implement, then rerun Green→Refactor. Test files listed here are planned additions unless already present; absent runners/environments are UNAVAILABLE, never PASS. Every implementation task explicitly names its Red test prerequisites. Final verification tasks rerun those tests; they do not defer first test creation until the end.

**Migration reservation**: `packages/db/migrations/0009_multimodal_ingestion_sync.sql` is reserved for package 3.1. It extends source MIME constraints, revision/view metadata, delegated references and source operation/outbox fences; it does not recreate 0005–0008 or a Guide table. Recheck current applied/reserved numbers before implementation and coordinate any renumbering with 3.2/3.3. Those packages start at 0010 or later. Preserve compatibility with the previous API revision under MIGRATE_ON_START.

**Task references**: Qualify external references as `[009-multimodal-ingestion-sync] Tnnn` or `specs/009-multimodal-ingestion-sync Tnnn`. `[P]` permits disjoint-file work only after cited prerequisites and shared contract ownership are fixed.

## Phase 1: Setup

**Goal**: Establish package-only implementation preconditions (FR-SI-01/05, CC-01/02).

**Independent Test / Checkpoint**: Gate authority and environment limits recorded; schema-valid synthetic fixtures identified.

- [ ] T001 Record Gate v2 override/evidence, feature pin, dependency versions/Node 26, reviewer-checklist result, isolated DB/storage/ADC prerequisites and package boundaries in specs/009-multimodal-ingestion-sync/implementation-evidence.md (FR-SI-01/05, NFR-SEC-01/02, Gate v3.0 #1).
- [ ] T002 Prepare versioned synthetic DOCX/PPTX/Drive/HTML/PDF/MP3/WAV/M4A/video/roadmap fixtures and UUIDv7 symbolic-ID mapping, including trusted note_markdown provenance, in packages/evals/src/fixtures/multimodal-ingestion.ts and packages/evals/fixtures/v3-multimodal/manifest.json (FR-SI-01/05, FR-NM-03, C-01).

## Phase 2: Foundational — contracts, staging and scope

**Goal**: Extend the existing contracts and PostgreSQL pipeline without creating a duplicate reader, index or v2 store (C-01/C-02, FR-SI-01/05).

**Independent Test / Checkpoint**: Existing consumers accept unchanged C-01; additive migrations preserve v1/v2 data and fail stale/unauthorized publication.

- [ ] T003 Write failing shared-schema/DTO tests for the existing strict revision-bearing page_span/time_span/dom_path union, unchanged v1 consumers, title lengths 0/1/200/201 after trimming Unicode code points with copied-text 100 preserved, kind-specific import fields, UUIDv7 fresh replacement IDs, integer bounded timestamps, derived display_time outside C-01, additive 200 upload envelopes and 202 import/sync envelopes in packages/contracts/test/package-v3-1.test.ts (C-01/C-02, FR-SI-01/04/05; FR-004, FR-006, FR-013).
- [ ] T004 Write failing PostgreSQL migration/operation tests for inclusive "200000000 bytes/500000 words", staged invisibility, notebook→source locking, "Queued→Running→Succeeded/Failed/Cancelled", expected-revision/lease/fencing-token recovery, atomic operation+outbox admission and unchanged 0001–0008 data in packages/db/test/source-sync-foundation.integration.test.ts (FR-SI-01/05, FR-WM-07, C-01/C-02; FR-007, FR-011, FR-012).
- [ ] T005 Write failing scoped/admission regressions for Owner-only notebook/document access (403 foreign notebook, 404 absent per existing ownership boundary), empty/omitted Ready scope, singleton Inspector preserving local selection, trusted-only note_markdown, shared quota contention, failed-import release-once, publication refusal and current revision filters in apps/api/test/multimodal-scope.test.ts and packages/db/test/multimodal-scope.integration.test.ts (FR-SI-03/05, FR-WM-04/05/07, FR-NM-03, C-02/C-03, NFR-EVAL-02/04; FR-007, FR-013, FR-014, FR-015, FR-016).
- [ ] T006 Add shared import/sync/status/view DTOs, UUID IDs, kind-specific fields and trimmed "1–200 code points" rename DTO; preserve copied-text creation 100, strict C-01 revision/locator fields and source display compatibility in packages/contracts/src/package-v3-1.ts, packages/contracts/src/source-admission.ts and packages/contracts/src/index.ts; depends on T003, T005 Red (FR-SI-01/05, C-01; FR-006, FR-009).
- [ ] T007 Implement additive 0009 migration and repository staging/operation admission with immutable revision manifests, "200000000 bytes/500000 words", lease/fence tokens, delegated secret references and source cascade; preserve source_pages/chunks atomicity, existing vector/FTS and trusted note provenance in packages/db/migrations/0009_multimodal_ingestion_sync.sql, packages/db/src/source-sync.ts, packages/db/src/ingestion.ts and packages/db/src/quota.ts; depends on T003–T005 Red, T006 (FR-SI-01/05, FR-WM-07, FR-NM-03, C-01/C-02; FR-006, FR-007, FR-011, FR-012).
- [ ] T008 Extend existing jobs outbox/admission and pipeline operation routing, retaining app-scoped pool binding and Processing-only initial-import publication; no second queue or Guide store in packages/db/src/jobs.ts, apps/worker/src/jobs.ts and apps/worker/src/ingestion/pipeline.ts; depends on T004, T005 Red, T006, T007 (FR-SI-01/05, FR-SI-02, C-01/C-02; FR-006, FR-007, FR-011, FR-014).
- [ ] T009 Write failing render configuration/process-boundary tests for bounded LibreOffice/ffmpeg jobs, no macro/subresource execution or filename shell interpolation, private object references, EU/service identity and scale-to-zero config in apps/render/test/render-config.test.ts (FR-SI-01, NFR-SEC-01/02, C-01; FR-001, FR-004, FR-016).

## Phase 3: User Story 1 — Office and linked documents (P1, MVP)

**Goal**: Import DOCX/PPTX and delegated Docs/Slides while retaining page evidence and all required content (FR-SI-01/05, C-01).

**Independent Test / Checkpoint**: Every golden text/table/notes/visual passage is in the viewer; permission/provider failures do not publish partial sources.

### Tests for User Story 1 (mandatory, CC-02)

Write these first and observe requirement-related Red before the implementation below.

- [ ] T010 [US1] Write failing golden Office extraction/anchor tests for all text, tables, speaker notes and embedded visual descriptions, malformed/encrypted/empty files, structural chunk target "300–600 tokens" without rejecting short boundary fragments or crossing page/section boundaries, and no slide_number locator in apps/worker/test/ingestion-office.test.ts (FR-SI-01, C-01; FR-001, SC-003).
- [ ] T011 [P] [US1] Write failing delegated Docs→DOCX/Slides→PPTX tests for requesting-user scopes, external ID persistence, revoked/insufficient ACLs, token hygiene, capability/export ceiling versus app 200MB, long-running export and mid-export revision change in apps/worker/test/ingestion-drive.test.ts (FR-SI-01/05, NFR-SEC-02; FR-002, FR-007, FR-016, SC-003, SC-006).
- [ ] T012 [P] [US1] Write failing upload/import API and Add sources Office/Drive UI tests for actual 200{items}/200{source} compatibility, MIME admission excluding client note_markdown, source icons, progress, Owner checks and both inclusive limits in apps/api/test/office-import.test.ts and apps/web/test/office-import.spec.ts (FR-SI-01/04/05, FR-WM-07, C-01; FR-001, FR-002, FR-006, FR-007, FR-016, SC-003, SC-005).
### Implementation for User Story 1

- [ ] T013 [US1] Add render package/job entry, LibreOffice+ffmpeg image configuration and typed private-object request/result boundary, with OpenTofu EU render job, API/secret approval preflight and least privilege in apps/render/package.json, apps/render/src/main.ts, apps/render/Dockerfile and infra/modules/compute/main.tf; depends on T009, T010 Red, T007 (FR-SI-01, NFR-SEC-01/02, C-01; FR-001, FR-004, FR-016).
- [ ] T014 [US1] Implement deterministic Office PDF normalization plus OOXML supplemental notes/table/description extraction, stable page/offset mapping and complete validation before staged chunks in apps/worker/src/ingestion/office.ts and apps/worker/src/ingestion/extract.ts; depends on T010 Red, T006–T008, T013 (FR-SI-01, C-01; FR-001, FR-006, FR-007, SC-003).
- [ ] T015 [US1] Implement delegated read-only Drive export and metadata fencing using secret references, capability-aware bounded downloads and existing Office normalization, no privileged fallback in apps/worker/src/ingestion/drive.ts; depends on T011 Red, T014 (FR-SI-01/05, NFR-SEC-02, C-01; FR-002, FR-007, FR-016, SC-003, SC-006).
- [ ] T016 [US1] Extend existing source upload/complete and imports routes with new MIME/type checks, actual-byte quota admission, operation metadata and bounded delegated inputs in apps/api/src/routes/sources.ts, apps/api/src/routes/source-sync.ts, apps/api/src/app.ts and apps/api/src/router.ts; depends on T005, T012 Red, T006–T008, T014, T015 (FR-SI-01/05, FR-WM-07, NFR-SEC-02; FR-001, FR-002, FR-006, FR-007, FR-016).
- [ ] T017 [US1] Integrate Office upload and delegated linked-document/picker entry, operation progress and format icons through existing browser API/types in apps/web/src/sources/panel.ts, apps/web/src/lib/api.ts and apps/web/src/lib/types.ts; depends on T012 Red, T016 (FR-SI-01/04, C-01; FR-001, FR-002, FR-006, SC-003).

## Phase 4: User Story 2 — Safe web articles (P1)

**Goal**: Import permitted article evidence without SSRF, active content or unapproved scraping capabilities (FR-SI-01/05, NFR-SEC-02).

**Independent Test / Checkpoint**: A valid article/PDF imports; forbidden connections and quarantined/empty content never become Ready.

### Tests for User Story 2 (mandatory, CC-02)

Write these first and observe requirement-related Red before the implementation below.

- [ ] T018 [US2] Write failing SSRF tests for every connect/redirect/reconnect, validated-address socket binding, DNS rebinding, IPv4-mapped IPv6, loopback/link-local/metadata denial and private/ULA tenant-policy+user-access requirements in apps/worker/test/ingestion-web-security.test.ts (FR-SI-01/05, NFR-SEC-02; FR-008, FR-016, SC-006).
- [ ] T019 [P] [US2] Write failing HTML/PDF-routing golden tests for main text, canonical URL, inert sanitized DOM/offsets, HTTP 403/paywall/empty/JS-shell errors "Unable to extract content from URL", byte/word limits and no remote subresources in apps/worker/test/ingestion-web.test.ts (FR-SI-01, C-01; FR-003, FR-007, FR-008, SC-005, SC-006).
- [ ] T020 [P] [US2] Write failing Model Armor screening tests for web and refreshed external content, EU fail-closed timeout/error/quarantine, zero Ready/C-02/model exposure and retained prior revision on sync failure in apps/worker/test/ingestion-screening.test.ts (FR-SI-01/05, NFR-SEC-01/02, C-02; FR-008, FR-013, FR-015, FR-016, SC-006).
- [ ] T021 [P] [US2] Write failing Website admission, safe progress/error and globe-icon browser/API tests including server Owner/delegation policy in apps/api/test/web-import.test.ts and apps/web/test/web-import.spec.ts (FR-SI-01, FR-WM-04/05, NFR-SEC-02; FR-003, FR-006, FR-008, FR-016).
### Implementation for User Story 2

- [ ] T022 [US2] Implement connection-bound guarded fetch and deterministic Readability extraction on an inert DOM, canonical sanitized viewer content and existing-PDF dispatch in apps/worker/src/ingestion/web.ts; depends on T018, T019 Red, T006–T008 (FR-SI-01/05, NFR-SEC-02, C-01; FR-003, FR-007, FR-008, FR-016).
- [ ] T023 [US2] Add shared screening boundary before external-content indexing/model use and preserve EU/no-training fail-closed configuration in apps/worker/src/ingestion/screening.ts, apps/worker/src/ingestion/pipeline.ts and infra/modules/project_services/main.tf; depends on T020 Red, T022, T009 Red; apply APIs only after recorded owner approval (FR-SI-01/05, NFR-SEC-01/02, C-02; FR-008, FR-015, FR-016).
- [ ] T024 [US2] Wire Website imports into existing operation admission and browser controls with exact error text, canonical URL and globe icon in apps/api/src/routes/source-sync.ts and apps/web/src/sources/panel.ts; depends on T021 Red, T016, T017, T022, T023 (FR-SI-01, C-01; FR-003, FR-006, FR-008, SC-006).

## Phase 5: User Story 3 — Audio/video evidence navigation (P1)

**Goal**: Ingest supported audio/video and make every timestamp citation navigable (FR-SI-01/04, FR-GC-03).

**Independent Test / Checkpoint**: Interview.mp3 04:15 highlights/seeks 255000ms; all media chunks have valid DTO times and authorized playback.

### Tests for User Story 3 (mandatory, CC-02)

Write these first and observe requirement-related Red before the implementation below.

- [ ] T025 [US3] Write failing caption/ASR tests for MP3/WAV/M4A and accessible video, authorized-caption/download capability, no transcript/audio error "No transcript available for this video", integer monotonic duration-bounded time_span and immutable source snapshots in apps/worker/test/ingestion-media.test.ts (FR-SI-01/05, C-01, NFR-SEC-02; FR-004, FR-006, FR-007, FR-016, SC-001, SC-006).
- [ ] T026 [P] [US3] Write failing transcript/view DTO, Inspector paging/cursor and media proxy tests for floor(start_ms/60000):zero-padded seconds, singleton C-02, authorized range reads, mid-stream revocation and no bearer URL bypass in apps/api/test/media-content.test.ts (FR-SI-01/04/05, FR-GC-03, C-01/C-02; FR-004, FR-005, FR-013, FR-014, FR-016, SC-001, SC-006).
- [ ] T027 [P] [US3] Write failing audio/video Add sources and transcript citation browser tests for Uploading→Processing→Ready/Failed, Fetching/Transcribing/Parsing substates, icons and 10-minute Interview.mp3 04:15→255000ms highlight/scroll/seek in apps/web/test/media-citations.spec.ts (FR-SI-01/04, FR-GC-03, Gate v3.0 #1; FR-004, FR-005, FR-006, SC-001).
- [ ] T028 [P] [US3] Write failing benchmark-aggregation tests that include queue/preprocessing/provider/assembly, exclude upload/indexing, retain all failed/unfinished runs as +infinity in the full sample, predeclare N≥20 repetitions and 30-minute fixture and nearest-rank P95≤45s without warm-only exemption in packages/evals/test/audio-transcription-benchmark.test.ts (FR-SI-01; FR-004, SC-002).
### Implementation for User Story 3

- [ ] T029 [US3] Implement bounded caption/authorized-audio acquisition and Speech V2 Chirp 2 word-offset transcription with absolute segment offsets and deterministic overlap deduplication, no unapproved region/model fallback in apps/worker/src/ingestion/media.ts and apps/worker/src/ingestion/pipeline.ts; depends on T025 Red, T006–T008, T013, T023 (FR-SI-01/05, C-01, NFR-SEC-01/02; FR-004, FR-006, FR-007, FR-016, SC-001, SC-002).
- [ ] T030 [US3] Extend canonical source_pages/revision transcript metadata and existing authorized content route plus media streaming proxy; derive display_time in view DTO only, retain strict chunk schema and cursor revision in packages/db/src/scoped-context.ts, apps/api/src/routes/sources.ts and apps/api/src/services/source-context.ts; depends on T003, T005, T026 Red, T007, T029 (FR-SI-01/04/05, FR-GC-03, C-01/C-02; FR-004, FR-005, FR-013, FR-014, FR-016).
- [ ] T031 [US3] Implement media upload/video URL controls, source progress/icons and Inspector transcript playback/highlight/seek through existing chat citation navigation in apps/web/src/sources/panel.ts, apps/web/src/sources/inspector.ts and apps/web/src/chat/panel.ts; depends on T027 Red, T024, T029, T030 (FR-SI-01/04, FR-GC-03; FR-004, FR-005, FR-006, SC-001).
- [ ] T032 [US3] Implement versioned synthetic 30-minute audio benchmark and manifest/result capture in scripts/eval-v3-audio.mjs and packages/evals/src/audio-transcription-benchmark.ts; depends on T028 Red, T029–T031; record codec/language/hash/size/provider region/model/runtime, queue/concurrency and every observation (failure/unfinished=+infinity) before evaluating nearest-rank P95≤45s (FR-SI-01, Gate v3.0 #1; SC-001, SC-002).

## Phase 6: User Story 4 — Source identity, re-sync and removal (P1)

**Goal**: Preserve source identity and the old committed revision until validated replacement; invalidate stale or deleted evidence immediately (FR-SI-05, C-02/C-03).

**Independent Test / Checkpoint**: May→June sync commits atomically; failed sync preserves June; overlap returns 409/no follow-up; restart cannot lose the Guide event.

### Tests for User Story 4 (mandatory, CC-02)

Write these first and observe requirement-related Red before the implementation below.

- [ ] T033 [US4] Write failing rename/title projection tests for trimmed Unicode lengths 0/1/200/201, whitespace-only rejection, sidebar/Inspector/citation propagation and copied-text 100 versus rename 200 distinction in apps/api/test/source-rename.test.ts and apps/web/test/source-management.spec.ts (FR-SI-05, FR-GC-03; FR-009, SC-005).
- [ ] T034 [P] [US4] Write failing source sync DB transaction tests for Ready-preserving staged May→June replacement, fresh chunk IDs/hash/last_synced_at, byte 199999999/200000000/200000001 and word 499999/500000/500001 boundaries, rollback on 503/parse/embedding/safety/ACL errors, existing slot and stale/deleted fence in packages/db/test/source-sync.integration.test.ts (FR-SI-01/05, FR-WM-07, C-01/C-02; FR-007, FR-011, FR-012, FR-013, SC-004, SC-005, SC-006).
- [ ] T035 [P] [US4] Write failing manual/webhook sync admission and operation status tests for linked-only eligibility, authenticated delegated notifications, same-key replay versus mismatched payload 409, distinct overlap 409 "Sync already in progress", no follow-up, new request after completion and safe operation errors in apps/api/test/source-sync.test.ts (FR-SI-05, NFR-SEC-02; FR-011, FR-012, FR-016, SC-008).
- [ ] T036 [P] [US4] Write failing worker/outbox/Guide recovery tests for transport redelivery, expired lease/fence, restart after sync commit before dispatch, downtime beyond watcher lookback without reopening, exact revision/language once-only Guide regeneration, reused Ready guide, stale completion and owning app pool in apps/worker/test/source-sync-recovery.test.ts and packages/db/test/source-guide-sync.integration.test.ts (FR-SI-02/05, C-02, NFR-EVAL-04; FR-011, FR-012, FR-013, FR-014, FR-015, SC-004, SC-006, SC-008).
- [ ] T037 [P] [US4] Write failing deletion/revocation/snapshot and history regression tests for captured generation invalidation, 0ms subsequent-read retrieval staleness, no exact old-chunk jump, "Source updated" versus "Source deleted", unavailable traces/artifacts/exports/media, cache identity and deselection-only history visibility in apps/api/test/source-lifecycle.test.ts and packages/db/test/source-lifecycle.integration.test.ts (FR-SI-03/05, FR-GC-02/03/06, FR-WM-07, C-02/C-03, NFR-EVAL-02/04; FR-010, FR-013, FR-014, FR-015, FR-016, SC-004, SC-006, SC-007).
- [ ] T038 [US4] Add failing browser sync/remove/citation regressions for old Ready revision during Syncing, no partial replacement, sync toast on failure, overlap message/no queue, confirmed deletion/counter and no stale highlight; extend apps/web/test/source-management.spec.ts after T033 test-file ownership ends (FR-SI-05, FR-GC-03, FR-WM-07; FR-009, FR-010, FR-011, FR-012, FR-013, SC-004, SC-005, SC-008).
### Implementation for User Story 4

- [ ] T039 [US4] Implement distinct rename 200 DTO use and title projections without widening copied-text 100, plus existing mutation authorization in apps/api/src/routes/source-sync.ts and packages/db/src/ingestion.ts; depends on T033 Red, T006, T016 (FR-SI-05, FR-GC-03; FR-009, SC-005).
- [ ] T040 [US4] Implement linked-source sync admission/operation status and trusted webhook mapping, payload idempotency and exact 409 overlap/no follow-up in apps/api/src/routes/source-sync.ts and packages/db/src/source-sync.ts; depends on T034, T035 Red, T007, T024, T029 (FR-SI-05, NFR-SEC-02; FR-011, FR-012, FR-016, SC-004, SC-008).
- [ ] T041 [US4] Implement deterministic sync fetch/staging executor, short notebook→source fenced atomic Ready-replacement transaction, fresh UUIDv7 chunks/hash/time, no network under lock, rollback preserving source/slot and durable Guide/invalidation events in apps/worker/src/ingestion/sync.ts and packages/db/src/source-sync.ts; depends on T034, T036 Red, T007, T008, T014, T015, T022, T023, T029, T040 (FR-SI-01/02/05, FR-WM-07, C-01/C-02; FR-007, FR-011, FR-012, FR-013, FR-015, SC-004, SC-006, SC-008).
- [ ] T042 [US4] Implement same-operation redelivery, lease renewal/reclaim and stale-token rejection using existing jobs outbox/worker entrypoint; do not queue a distinct overlapping refresh in packages/db/src/jobs.ts, apps/worker/src/jobs.ts and apps/worker/src/ingestion/sync.ts; depends on T004, T036 Red, T008, T041 (FR-SI-05, NFR-SEC-02; FR-011, FR-012, FR-013, SC-004, SC-006, SC-008).
- [ ] T043 [US4] Extend existing PostgreSQL Guide repository with transactional current-revision/access/attempt completion fencing and durable sync-trigger delivery, exact singleton C-02 plus app-pool binding, preserving Ready results and one-API operation in packages/db/src/package-v2-2.ts, apps/api/src/v2/runtime.ts and apps/worker/src/ready-hooks.ts; depends on T005, T036 Red, T041, T042 (FR-SI-02/05, FR-GC-02, C-02, NFR-EVAL-02/04; FR-011, FR-013, FR-014, FR-015, SC-006, SC-007).
- [ ] T044 [US4] Extend authoritative deletion/revocation transaction, slot release, operation cancellation/fence and durable DB/object cleanup while blocking subsequent C-02/media reads immediately in packages/db/src/cleanup.ts, packages/db/src/ingestion.ts, packages/db/src/scope-guard.ts and apps/worker/src/notebook-cleanup.ts; depends on T005, T037 Red, T007, T030, T041 (FR-SI-05, FR-WM-07, C-02/C-03, NFR-SEC-02; FR-010, FR-013, FR-014, FR-016, SC-004, SC-006).
- [ ] T045 [US4] Integrate exact captured revision publication fences, scoped cache identity and history/citation access projections across sources and downstream generation without changing consumers' public contracts in packages/db/src/scoped-context.ts, packages/db/src/chat-history.ts, apps/api/src/services/source-context.ts and apps/api/src/chat/service.ts; depends on T005, T037 Red, T043, T044 (FR-SI-03/05, FR-GC-02/03/06, C-02/C-03, NFR-EVAL-02/04; FR-013, FR-014, FR-015, FR-016, SC-004, SC-006, SC-007).
- [ ] T046 [US4] Wire rename/remove confirmation, Re-sync/progress/toast/counter, preserved Ready view, updated/deleted citation navigation and revocation stopping playback in apps/web/src/sources/panel.ts, apps/web/src/sources/inspector.ts, apps/web/src/chat/panel.ts and apps/web/src/lib/api.ts; depends on T033, T038 Red, T031, T039–T045 (FR-SI-02/04/05, FR-GC-03, FR-WM-07; FR-009, FR-010, FR-011, FR-012, FR-013, SC-004, SC-005, SC-008).

## Phase 7: Polish, eval gates and cross-cutting verification

**Goal**: Complete package evidence without misreporting planned behavior as deployed acceptance (NFR-EVAL-01..04, Gate v3.0 #1).

**Independent Test / Checkpoint**: All story tests and required mixed-modality gates have reproducible evidence or explicit UNAVAILABLE/FAIL; no unavailable gate is declared green.

- [ ] T047 Rerun all foundation/story contract, DB race, security, browser and note-source regressions; retain Red→Green evidence, exact limits and task status in specs/009-multimodal-ingestion-sync/implementation-evidence.md; depends on T001–T046 (FR-SI-01/05, FR-NM-03, NFR-SEC-02, C-01/C-02, Gate v3.0 #1).
- [ ] T048 Run deterministic citation-ID 1.0/leakage 0 evals on every implementation PR with mixed-modality fixtures and invalidation cases through packages/evals/src/fixtures/multimodal-ingestion.ts; record command/result in specs/009-multimodal-ingestion-sync/implementation-evidence.md; depends on T045–T047 (FR-GC-02, NFR-EVAL-02/04; FR-014, FR-015, SC-007).
- [ ] T049 For an authorized release candidate run judged hallucination <5%, rejection ≥99% and semantic support once on fixed deterministic stratified 50-case golden sample; retain case IDs/composition/dataset hash in specs/009-multimodal-ingestion-sync/implementation-evidence.md; depends on T048, do not add judged-per-PR obligation (NFR-EVAL-01/03, FR-GC-02; SC-007).
- [ ] T050 Execute declared audio benchmark and integrated Interview.mp3 04:15 click scenario, preserving every attempt/failure and ≤45s P95 queue-inclusive boundary; retain environment/provider manifest and results in specs/009-multimodal-ingestion-sync/implementation-evidence.md; depends on T032, T046, T047 (FR-SI-01/04, FR-GC-03, Gate v3.0 #1; SC-001, SC-002).
- [ ] T051 Validate additive migration 0009 under Node 26/MIGRATE_ON_START with old/new API compatibility, failure→unready and one-instance rollout; retain approval/IaC plan evidence in specs/009-multimodal-ingestion-sync/implementation-evidence.md; depends on T007, T013, T047, no deployment without required service approval (FR-SI-01/05, C-01/C-02, NFR-SEC-01/02).
- [ ] T052 Synchronize any discoveries into specs/009-multimodal-ingestion-sync/spec.md and plan.md, spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md, spec/requirements/README.md, SRS/architecture as applicable and affected issue references; rerun speckit-analyze after refinements; depends on T047–T051 (FR-SI-01/05, C-01/C-02, NFR-EVAL-01..04).
- [ ] T053 Run specs/009-multimodal-ingestion-sync/quickstart.md, scripts/check-spec-integrity.mjs and applicable lint/type/unit/contract/integration/browser/eval gates; publish qualified handoff and explicit unresolved runtime limits in specs/009-multimodal-ingestion-sync/implementation-evidence.md; depends on T052 (FR-SI-01/05, Gate v3.0 #1).

## Dependencies & Execution Order (FR-SI-01/05, C-01/C-02, CC-02)

`Setup T001–T002 → Foundation T003–T009 → US1 T010–T017 → US2 T018–T024 → US3 T025–T032 → US4 T033–T046 → verification T047–T053` is the safe serialized path. Tests within a story precede its implementation; exact dependencies above are authoritative. US2/US3 are independently testable after foundation plus their stated render/route dependencies; the listed story order serializes shared pipeline/API/UI owners. US4 depends on supported format adapters for linked refresh, not on packages 3.2/3.3. Package 3.2/3.3 consume C-01/C-02 after this package's shared contract/operational handoff; package 3.4 performs integrated benchmarks after all prerequisite implementations.

### Safe parallel examples

- US1: T011 (Drive test file) and T012 (API/browser test files) may run together once T002 fixtures and foundation are ready; T010's Office golden fixture ownership must be agreed first. Shared schema writes T006 remain serialized.
- US2: T018–T021 test owners have disjoint files and consume fixed DTOs/fixtures; run independently once prior-story routes are stable. All writes to pipeline/source-sync/panel are serialized.
- US3: T025–T028 test owners have disjoint files; T029–T032 implementation observes explicit dependencies. API media delivery cannot race shared scoped-context ownership from US4.
- US4: T034–T037 test owners are disjoint after shared fixtures; T038 waits for T033's source-management.spec.ts ownership. No parallel DB source-sync/jobs/Guide mutation or migration edits.

### Incremental implementation strategy

MVP is US1 after foundation: local Office and delegated linked imports with complete page evidence, ACL/quota invariants and regression compatibility. Then ship safe web import, media/transcript navigation and source identity/sync as independently tested increments. MVP is not Gate v3.0 completion. Follow test-first tasks, keep unchecked work unchecked until executed, and qualify every external task reference with the feature path. Functional discoveries flow back before implementation continues; never loosen numeric/security/snapshot requirements to make a test pass. D19 means no R6 pre-implementation sandbox qualification is introduced here.

### Coverage keys

Every local `FR-001`–`FR-016` and `SC-001`–`SC-008` is cited in the tasks above. The final read-only analysis records the detailed requirements→Red tests→implementation/verification mapping in analysis.md; runtime and reviewer approval remain distinct from artifact coverage.
