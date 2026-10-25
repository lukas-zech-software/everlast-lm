# Validation Guide: Package 3.3

Scope: `FR-ST-08/09/18`, `C-01..C-03`, `NFR-EVAL-01..04`, `Gate v3.0 #3`. This guide describes verification; it contains no implementation or complete tests.

## Current planning checks (`CC-01/02`)

From the dedicated package worktree, use Node 26 and run:

```sh
node scripts/check-spec-integrity.mjs
git diff --check
cat .specify/feature.json
```

Pin must be `specs/011-studio-mindmaps-data-tables`; no persistent SPECIFY_FEATURE_DIRECTORY. Inspect generated plan/research/data model/contracts. These checks establish document consistency only.

## Runtime prerequisites (`C-03`, `NFR-SEC-01/02`)

Gate v2.0 currently has owner-approved override per `docs/gate-v2-live-evaluation.md`, not a measured pass; the 2026-10-22 live re-run passes #3 while #1 and FR-GC-07 Shorter still fail. Preserve known follow-ups and normal v3 gates. Shared C-01/C-02/C-03/language contracts exist and must remain compatible. Prepare isolated EU enterprise test environment with keyless approved identities, existing Cloud SQL/Tasks/worker/API/web, migrated additive Studio variants and reviewed locked dependencies. No new API/service enablement is performed by this plan. Use synthetic schema-valid fixtures, never company content with developer keys.

Existing `pnpm dev -- --offline` actually starts an isolated local PostgreSQL container, ensures its dev database, applies numbered migrations, builds the web app, then starts API/worker. Offline mode uses synthetic embeddings with no configured chat model; plain `pnpm dev` requires approved Vertex project/ADC and EU model configuration. `pnpm db:migrate` really applies pending top-level numbered SQL files using DATABASE_URL/PG variables and an advisory lock; applied 0005–0008 include all v2 stores and the former draft directory is removed. Cloud Run API configuration sets `MIGRATE_ON_START=true`: pending migrations run before traffic, and a failure prevents new-revision readiness. Rehearse additive schema compatibility with the previous report API/worker revision; verify readiness before enabling new-kind dispatch, preserve sweep exclusions and drain/fence old inline work. Advisory migration locking does not replace job lease/recovery fences. Do not run it against an unverified target. Current reports already use PostgreSQL 0008 with app-scoped pool binding; inline dispatch and the single API instance remain under D16. Preserve completed reports after restart and interrupted Queued/Running → Failed/GenerationError → explicit retry. New plugin outbox/lease/source publication fences remain planned; they are not supplied by the existing report restart sweep. New mindmap/table routes/tests/timing fixtures remain UNAVAILABLE now. No launch, database mutation or deployment is performed by this document refresh.

After those prerequisites and tests exist, existing repository runners are:

```sh
pnpm install --frozen-lockfile
pnpm test:contract
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm eval:deterministic
pnpm eval:judged
```

Do not call a green unrelated suite package acceptance. The judged harness exists and requires configured approved Vertex/ADC environment; it reports UNAVAILABLE without prerequisites. Its release mode selects the fixed stratified 50-case sample; `--limit`/case subsets are diagnostic and cannot substitute gate evidence. Record exact revision, environment, versions, fixture IDs, commands and outputs. Specs-only plan does not run/deploy these feature scenarios.

## Scenarios and expected results (`FR-ST-08/09/18`)

1. Owner selects 3 Ready synthetic source documents and generates map. Inspect Queued/Running/Completed, unique rooted acyclic hierarchy, cited labels/summaries, depth 2–5, ≤120 nodes and ≤80-code-point labels; render depth 2 initially. Inject cycles/orphans/duplicates/121 nodes/81-code-point labels: Failed, no payload. Evidence-limited map explains fewer nodes; no supported facts refuses. Capture submission→Completed≤20s P95 on declared fixtures/environment, predeclared N≥20 accepted submissions, nearest-rank ceil(0.95*N)th sorted, failed/unfinished=positive infinity and all cold/warm strata retained; runtime result currently UNAVAILABLE.
2. Generate with ≥50 sources and original chunk coverage manifest, including a fact only in a late original batch and absent from Source Guides. All batches processed, retained evidence retrievable, no summary substitution. Failed/missing batch cannot complete. Re-sync/delete/revoke during read and immediately before commit: fail without stale artifact. Mere checkbox changes do not alter in-flight snapshot.
3. Open 120-node map, pan/zoom/fit and toggle chevrons; body click triggers chat rather than branch toggle. Record browser/hardware/frame timings for 60fps/≤16ms criterion. With 25 visible nodes including offscreen branches, PNG is nonempty 2× full bounds and SVG parses with all 25 labels; neither crops to viewport. Export rejects active SVG content and external resources. Browser screenshots/manual inspection validate labels/wrapping, not file parse alone.
4. Click eligible child under parent: ordinary grounded cited chat turn persists. Deselect required supporting source, clear selection, replace revision, submit forged label/node, or revoke permission: safe selection/unavailable response, zero node/parent text enters chat context and no automatic reselect. Existing active chat rejects another request and preserves draft.
5. Compare 3 vendor PDFs: 3 rows with Vendor/Price/Uptime SLA; absent value is exact N/A marker; contradictory prices remain one vendor row with all alternatives/citations and disagreement. Sort preserves associations. Boundaries 0/2,000/2,001 prompt code points, 500/501 rows and 25/26 cols behave exactly as spec; 501/26 attempt fails with narrowing request, zero published tables, not a truncated sample.
6. Export CSV and XLSX using contract [interfaces](contracts/interfaces.md) and [data model](data-model.md). Test comma/quote/CRLF/non-ASCII data, formula-risk=,+,-,@, leading spaces/tabs/control variants, headings and conflicting multiline values. Independently parse CSV after BOM, inspect OOXML for strings and absence of formulas/external links, open XLSX in Excel/LibreOffice or independent OOXML reader without errors. No formula executes. Count/values/conflicts/citations survive; no export silently drops rows.
7. Cross-notebook/unauthorized reads, drilldowns and exports reveal no content. Deletion/revocation invalidates loaded/cached/pending exports and stops application delivery. Merely deselected historical artifacts remain viewable/exportable, while new drilldown cannot reuse them. For new plugins, restart API/worker after admission and between outbox commit/notification; recover the same attempt, retain completed payloads and no duplicate publication. Competing workers, expired leases and cancellation/source mutation immediately before commit cannot publish stale output. Inject citation refusal then redeliver: no silent model rerun. Cancel/retry/redelivery fences prevent double or stale publication. Regress existing report generation/viewing/conversion and startup interrupted-to-Failed with explicit retry; legacy late completions stay rejected. New-kind leased jobs must be excluded from the report sweep. Preserve app-pool isolation for requests, timers and worker continuations and the one-API-instance deployment limit. Existing baseline suites are `apps/api/test/v2-restart.integration.test.ts` and `packages/db/test/studio-artifacts.pg.integration.test.ts`; no new execution result is claimed here.

## Evaluation and handoff (`NFR-EVAL-01..04`, `CC-01..CC-08`)

Require citation-ID precision 1.0 and leakage 0 deterministic suites on each PR; judged hallucination<5%, rejection≥99%, semantic support once per release candidate on the fixed stratified 50-case sample, recording case IDs/category composition/dataset hash. No judged-per-PR obligation is introduced. Use schema-valid multimodal locators and all supported content kinds, not only plain PDFs. Record refusal/no-publication errors as assertions, not ignored failed fixtures. Integrated Gate v3.0 additionally needs 3.1/3.2/3.4 runtime evidence; D19 accepts 3.2's managed provider and makes R6 obsolete; normal integration/release tests still apply.

Next workflow is speckit-tasks, then speckit-analyze, then gated test-first implementation. No runtime gate is claimed by planning completion.

## Task-analysis validation details (2026-10-22; FR-ST-08/09/18, NFR-EVAL-01..04)

The declared SC-002 cohort cannot discard failed, unfinished or slow accepted runs. Freeze fixture/environment/cold-warm mix/sample count before measurement; all accepted attempts remain in P95, failure/unfinished=positive infinity. Frame action/window/sample/hardware/browser settings likewise precede capture; record slow/failed samples against unchanged 60fps/≤16ms targets. Scripts `scripts/eval-v3-studio.mjs` and `scripts/eval-v3-mindmap-viewer.mjs` are future task outputs and unavailable until implemented. Register pure Vitest files explicitly and keep browser files under `apps/web/test`. `pnpm eval:judged` invokes the existing `packages/evals/src/cli.ts release`, not a new judged script. T014 owns early deterministic eval Red tests; final T051 reruns them. Unsupported output_language retains 400 while other invalid parameters use 422.

## Phase 1 Setup Readiness (`[011-studio-mindmaps-data-tables] T001–T003`, 2026-10-24)

- **T001 Precondition Verification (`FR-ST-08/09/18`, `C-01..C-03`, `NFR-SEC-01/02`, `Gate v3.0`)**:
  - Inherited contracts `C-01` (`packages/contracts/src/document-chunk.ts`), `C-02` (`packages/contracts/src/scoped-context.ts`), and `C-03` (`packages/contracts/src/package-v2-4.ts`) verified intact on branch `feat/v3-011-studio-mindmaps-data-tables` (branched from `feat/v3-010-complete` `7bd4d5d`).
  - Gate v2.0 status verified in `docs/gate-v2-live-evaluation.md`: owner-approved override is in effect; 2026-10-22 live re-run passes Gate v2.0 #3 (`FR-ST-10`) while Gate v2.0 #1 (`FR-SI-02`) and `FR-GC-07` Shorter remain open follow-ups. No measured pass is claimed where override applies.
  - Single-API-instance constraint (`D16`) and `runWithV2Persistence(pool, ...)` app-scoped pool binding verified in `apps/api/src/v2/runtime.ts`.
  - Applied/reserved migration sequence verified: `0001`–`0008` immutable; `0009_multimodal_ingestion_sync.sql` (Package 3.1) and `0010_code_execution.sql` (Package 3.2) present; `packages/db/migrations/0011_studio_structure.sql` reserved for Package 3.3.
  - `D19` accepts Google's managed sandbox for Package 3.2 and marks `R6` obsolete; Package 3.3 requires no code-execution sandbox.
- **T002 Shared Fixtures (`packages/testkit/src/studio-structure-fixtures.ts` & `packages/evals/src/fixtures/studio-structure.ts`)**:
  - Created deterministic UUIDv7 chunk and UUIDv4 source builders covering 3 multimodal sources (`page_number`, `dom_path`, `start_ms`/`end_ms`), unselected leak probe (`VORTEX_CONFIDENTIAL_99`), ≥50-source corpus with late-only original fact (`LateBatchFact-Omega-42`), 3-vendor comparison with price conflict and missing SLA (`N/A (Not in sources)`), 500/501-row and 25/26-column boundaries, 79/80/81-code-point labels, 0/2,000/2,001-code-point prompts, and formula-prefix adversaries (`=`, `+`, `-`, `@` with leading whitespace/control characters).
- **T003 Test Registration (`vitest.config.ts`)**:
  - Pure unit suites registered in `vitest.config.ts` (`unit` project):
    - `pnpm vitest run --project unit packages/contracts/test/package-v3-3.test.ts`
    - `pnpm vitest run --project unit apps/worker/test/mindmap.test.ts apps/worker/test/studio-evidence.test.ts apps/worker/test/data-table.test.ts`
    - `pnpm vitest run --project unit apps/web/test/studio-mindmap.test.ts apps/web/test/mindmap-viewer.test.ts apps/web/test/mindmap-performance.test.ts apps/web/test/studio-table.test.ts`
    - `pnpm vitest run --project unit packages/evals/test/studio-structure.eval.test.ts packages/evals/test/studio-structure-performance.test.ts`
  - Real PostgreSQL integration suites (`integration` project via `TEST_DATABASE_URL`):
    - `pnpm vitest run --project integration packages/db/test/studio-structure.integration.test.ts apps/worker/test/studio-structure-lifecycle.test.ts apps/api/test/studio-structure.test.ts apps/api/test/studio-drilldown.test.ts apps/api/test/studio-map-export.test.ts apps/api/test/studio-table.test.ts apps/api/test/studio-table-export.test.ts`
  - Playwright browser suites (`apps/web/test/*.spec.ts`):
    - `pnpm playwright test apps/web/test/studio-mindmap.spec.ts apps/web/test/studio-mindmap-export.spec.ts apps/web/test/studio-table.spec.ts`

## Phase 2 Foundation Verification (`[011-studio-mindmaps-data-tables] T004–T012`, 2026-10-25)

- **T004–T007 Red Baseline**:
  - Validated failing contract, repository, worker, and API tests before implementation.
- **T008 Migration 0011 (`packages/db/migrations/0011_studio_structure.sql`)**:
  - Implemented migration adding `mindmap` and `data_table` check constraints to `studio_artifacts.kind` and `studio_jobs.kind`.
  - Added indexes `studio_artifacts_kind_idx` and `studio_jobs_kind_idx` without altering existing table structure.
- **T009 Contracts (`packages/contracts/src/package-v3-3.ts`, `packages/contracts/src/index.ts`)**:
  - Exported schemas for mindmap parameters/payload, data table parameters/payload, drilldown, map export, table export, and failure codes.
  - Verified with `pnpm vitest run --project unit packages/contracts/test/package-v3-3.test.ts` (3/3 PASS).
- **T010 Repository Persistence (`packages/db/src/studio-artifacts.ts`)**:
  - Implemented `createMindmapArtifact`, `getMindmapArtifact`, `createDataTableArtifact`, `getDataTableArtifact`, and export persistence.
  - Verified with `pnpm vitest run --project integration packages/db/test/studio-structure.integration.test.ts` (2/2 PASS).
- **T011 Worker Dispatcher & Plugins (`apps/worker/src/studio/`)**:
  - Registered mindmap and data_table handlers in `apps/worker/src/studio/registry.ts` and `apps/worker/src/studio/dispatcher.ts`.
  - Verified with `pnpm vitest run --project integration apps/worker/test/studio-structure-lifecycle.test.ts` (5/5 PASS).
- **T012 API Endpoints (`apps/api/src/routes/studio.ts`, `apps/api/src/studio/service.ts`)**:
  - Added `/api/workspaces/:workspaceId/studio/mindmaps` and `/api/workspaces/:workspaceId/studio/tables` routes.
  - Verified with `pnpm vitest run --project integration apps/api/test/studio-structure.test.ts` (2/2 PASS).

## Phase 3 User Story 1 Verification — Grounded Topic Map (`[011-studio-mindmaps-data-tables] T013–T024`, 2026-10-25)

- **T013–T016 Red Tests**:
  - Observed Red failures for mindmap model, deterministic citation/leakage assertions, worker pipeline, and web UI.
- **T017 All-Original Evidence Retrieval Pipeline (`apps/worker/src/studio/evidence.ts`)**:
  - Implemented batch retrieval covering all original chunks with no summary substitution (`LateBatchFact-Omega-42` retained).
  - Verified with `pnpm vitest run --project unit apps/worker/test/studio-evidence.test.ts` (2/2 PASS).
- **T018 Mindmap Model & Structural Invariants (`apps/worker/src/studio/mindmaps/model.ts`)**:
  - Implemented strict acyclic rooted hierarchy, depth 2–5, 1–120 nodes, ≤80-code-point labels, and single-parent constraints.
- **T019–T020 Worker Handler & Retry Pipeline (`apps/worker/src/studio/mindmaps/pipeline.ts`, `apps/worker/src/studio/handler.ts`)**:
  - Connected worker execution, schema-valid citation tracking, and error mapping to `apps/worker/src/studio/runner.ts`.
  - Verified with `pnpm vitest run --project unit apps/worker/test/mindmap.test.ts` (3/3 PASS).
- **T021–T022 Web UI Mindmap Tile & Panel (`apps/web/src/studio/panel.ts`)**:
  - Added mindmap generation trigger and artifact list cards in Studio panel.
  - Verified with `pnpm vitest run --project unit apps/web/test/studio-mindmap.test.ts` (2/2 PASS) and Playwright `apps/web/test/studio-mindmap.spec.ts` (PASS).
- **T023 Deterministic Evaluation Suite (`packages/evals/src/studio-structure-eval.ts`, `packages/evals/test/studio-structure.eval.test.ts`)**:
  - Verified 100% citation precision (1.000) and 0 unselected source leakage (PASS).
- **T024 Performance Harness Script (`scripts/eval-v3-studio.mjs`)**:
  - Created automated benchmarking script for mindmap generation latency.

## Phase 4 User Story 2 Verification — Explore & Export Mindmap (`[011-studio-mindmaps-data-tables] T025–T037`, 2026-10-25)

- **T025–T029 Red Tests**:
  - Established Red test baseline for interactive viewer, API drilldown, SVG/PNG export, and Playwright spec.
- **T030 Interactive Viewer Component (`apps/web/src/studio/mindmap-viewer.ts`)**:
  - Implemented native canvas/SVG-based viewer with depth-2 default expansion, pan/zoom/fit, and node chevron toggling.
  - Verified with `pnpm vitest run --project unit apps/web/test/mindmap-viewer.test.ts` (2/2 PASS).
- **T031 Grounded Node Drilldown Endpoint (`apps/api/src/studio/drilldown.ts`)**:
  - Implemented `/api/workspaces/:workspaceId/studio/mindmaps/:id/drilldown` with source verification and active chat integration.
  - Verified with `pnpm vitest run --project integration apps/api/test/studio-drilldown.test.ts` (2/2 PASS).
- **T032–T035 SVG & PNG Scene Export (`apps/api/src/studio/map-export.ts`, `apps/web/src/studio/mindmap-export.ts`)**:
  - Implemented 2× scale full-tree export rejecting scripts/foreignObjects, preserving complete labels and hierarchy offscreen.
  - Verified with `pnpm vitest run --project integration apps/api/test/studio-map-export.test.ts` (2/2 PASS) and Playwright `apps/web/test/studio-mindmap-export.spec.ts` (PASS).
- **T036–T037 Viewer Performance & Browser Benchmark Script (`scripts/eval-v3-mindmap-viewer.mjs`)**:
  - Implemented 120-node layout and pan/zoom frame benchmark tests in `apps/web/test/mindmap-performance.test.ts` (PASS) and registered runner script.

## Phase 5 User Story 3 Verification — Compare Documents in a Cited Table (`[011-studio-mindmaps-data-tables] T038–T049`, 2026-10-25)

- **T038–T041 Red Tests**:
  - Established Red tests for entity comparison, CSV/XLSX export, API table routes, and table viewer UI.
- **T042 Data Table Comparison Model (`apps/worker/src/studio/tables/model.ts`)**:
  - Implemented 3-state cell representation: `supported` (cited value), `conflict` (`disagreement: true` with all alternative values cited), and `missing` (`N/A (Not in sources)` with 0 citations).
  - Enforced 500 rows × 25 columns ceiling (`TableBoundsExceeded`).
- **T043 Worker Pipeline (`apps/worker/src/studio/tables/pipeline.ts`)**:
  - Executed table generation over batched source evidence with equivalent-entity merging.
  - Verified with `pnpm vitest run --project unit apps/worker/test/data-table.test.ts` (3/3 PASS).
- **T044 CSV & XLSX Export Serialization (`apps/api/src/studio/table-export.ts`)**:
  - Implemented deterministic RFC 4180 CSV with UTF-8 BOM (`[0xef, 0xbb, 0xbf]`).
  - Implemented OOXML text-only `.xlsx` serializer using `exceljs`, prefixing formula-injection tokens (`=`, `+`, `-`, `@`) with `'`.
  - Verified with `pnpm vitest run --project integration apps/api/test/studio-table-export.test.ts` (1/1 PASS).
- **T045–T047 Table Viewer & Panel UI (`apps/web/src/studio/table-viewer.ts`, `apps/web/src/studio/panel.ts`)**:
  - Implemented sorting, multi-value conflict badges, citation tooltips, and export download buttons.
  - Verified with `pnpm vitest run --project unit apps/web/test/studio-table.test.ts` (2/2 PASS), `apps/api/test/studio-table.test.ts` (2/2 PASS), and Playwright `apps/web/test/studio-table.spec.ts` (PASS).
- **T048–T049 Multi-Batch & Boundary E2E Runs**:
  - Confirmed 50-source multi-batch fact retention, boundary refusals (501 rows / 26 cols), and CSV/XLSX export downloads.

## Phase 6 Cross-Cutting Verification & Release Evidence (`[011-studio-mindmaps-data-tables] T050–T056`, 2026-10-25)

- **T050 Lifecycle & Restart Regressions (`FR-ST-08/18`, `FR-ST-10/11`, `C-02/C-03`, `NFR-SEC-02`)**:
  - Executed:
    - `apps/worker/test/studio-structure-lifecycle.test.ts` (5 tests PASS)
    - `packages/db/test/studio-structure.integration.test.ts` (2 tests PASS)
    - `apps/api/test/v2-restart.integration.test.ts` (PASS)
    - `apps/api/test/studio-runtime.integration.test.ts` (PASS)
  - Verified: Completed records are preserved across simulated worker and API restarts; in-flight job interruptions transition to Failed/GenerationError; terminal refusals never re-execute on redelivery; single-API instance deployment constraint respected.
- **T051 Deterministic Citation & Leakage Eval (`FR-ST-08/09/18`, `FR-GC-02`, `NFR-EVAL-02/04`)**:
  - Executed `TEST_DATABASE_URL="postgres://everlast:everlast@127.0.0.1:54329/everlast" pnpm eval:deterministic`:
    - Total golden test cases: 222
    - Adversarial attack fixtures: 60
    - Citation precision: 1.000 (Target: 1.000)
    - Unselected source leakage: 0 (Target: 0)
    - Gate v3.0 #3 Studio Structure: **PASS**
- **T052 Judged Release-Candidate Evaluation (`FR-ST-08/09/18`, `NFR-EVAL-01/03`, `Gate v3.0`)**:
  - Executed `pnpm eval:judged`:
    - Result: `UNAVAILABLE` (exit code 2)
    - Reason: Live Vertex AI environment variables (`VERTEX_PROJECT` / `GCP_PROJECT_ID`) and ADC credentials not configured in local development environment. Per Constitution Principle VI and `CC-02`, missing approved environment is recorded truthfully as `UNAVAILABLE` rather than fabricating results or substituting unapproved proxies.
- **T053 Generation & Hardware Performance Scenarios (`FR-ST-08/09/18`, `Gate v3.0`)**:
  - Executed `node scripts/eval-v3-studio.mjs`:
    - Result: `UNAVAILABLE` (exit code 2; Live Vertex AI mindmap generation cohort requires cloud credentials).
  - Executed `node scripts/eval-v3-mindmap-viewer.mjs`:
    - Result: `UNAVAILABLE` (exit code 2; Declared browser hardware profile 120-node frame capture not configured in headless dev shell).
  - Executed Vitest performance unit tests:
    - `apps/web/test/mindmap-performance.test.ts` (PASS: layout < 50ms, frame step < 16ms).
    - `packages/evals/test/studio-structure-performance.test.ts` (PASS: model validations < 10ms).
  - Executed Playwright browser export tests:
    - `apps/web/test/studio-table.spec.ts` (PASS: CSV/XLSX download and sanitized content).
    - `apps/web/test/studio-mindmap-export.spec.ts` (PASS: SVG/PNG download with full tree bounds).
- **T054 Flow-Back Synchronization (`FR-ST-08/09/18`, `C-01..C-03`, `NFR-EVAL-01..04`, `Gate v3.0`)**:
  - Synchronized contracts and schemas across `specs/011-studio-mindmaps-data-tables/spec.md`, `plan.md`, `tasks.md`, and `spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md`.
  - Confirmed `TableBoundsExceeded` is added to `StudioFailureCodeSchema` in `packages/contracts/src/package-v2-4.ts`.
  - Preserved boundary constraints (500 rows × 25 columns ceiling; 120 nodes depth 2–5 hierarchy).
- **T055 Spec & Code Integrity Verification (`node scripts/check-spec-integrity.mjs`)**:
  - Executed `node scripts/check-spec-integrity.mjs`:
    - 190 Markdown files: all relative links and anchors resolve.
    - 55 SRS requirement IDs: every one links to an FR card.
    - 39 Spec Kit feature artifact(s): CC-01/CC-02 checks pass.
  - Executed full lint and build:
    - `pnpm lint`: PASS (0 errors, 0 warnings across all packages).
    - `pnpm build`: PASS (clean TypeScript compilation across all 10 projects, SPA built in `apps/web/dist`).
- **T056 Package 3.4 Handoff Note (`FR-ST-08/09/18`, `C-02/C-03`, `NFR-PERF-01`, `Gate v3.0`)**:
  - **Handed off to Package 3.4 (`specs/012-long-context-latency-scaling`)**:
    1. **Typed Studio Plugins**: Mindmap and data table worker pipelines registered in `apps/worker/src/studio/registry.ts` and `apps/worker/src/studio/dispatcher.ts` under kinds `"mindmap"` and `"data_table"`.
    2. **All-Original Evidence Retrieval**: `apps/worker/src/studio/evidence.ts` extracts batches across all selected documents with multimodal locator preservation (PDF `page_number`, Web `selector`, Audio/Video `start_ms`/`end_ms`).
    3. **Durable Lifecycle & Idempotency**: State transitions `Queued` → `Running` → `Completed`/`Failed` with leases, recovery sweeps, and publication fences in `packages/db/src/studio-artifacts.ts` and `apps/worker/src/studio/runner.ts`.
    4. **Export Engines**: RFC 4180 UTF-8 BOM CSV, sanitized text-only OOXML XLSX, full-scene SVG, and 2× PNG export serializers in `apps/api/src/studio/table-export.ts` and `apps/api/src/studio/map-export.ts`.
  - **Performance Boundary**: Package 3.3 implemented unit performance tests and scripts (`scripts/eval-v3-studio.mjs`, `scripts/eval-v3-mindmap-viewer.mjs`); Package 3.4 owns integrated million-token scaling, TTFT, and long-context latency optimization (`NFR-PERF-01`).
  - **Decisions**: D19 marks R6 obsolete; Package 3.3 introduces no new code execution sandbox dependencies.
