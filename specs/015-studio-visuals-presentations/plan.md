# Implementation Plan: Studio Visuals & Presentations (Package 4.2)

**Branch**: `feat/v4-015-studio-visuals-presentations` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)
**Package Source**: `spec/requirements/v4/package_4_2_studio_visuals_presentations.md`
**SRS IDs in Scope**: `FR-ST-16`, `FR-ST-17`, `C-01`, `C-02`, `C-03`, `FR-SI-03`, `FR-SI-05`, `FR-UI-02`, `NFR-SEC-01`, `NFR-SEC-02`, `NFR-EVAL-01`, `NFR-EVAL-02`, `NFR-EVAL-03`, `NFR-EVAL-04`, `Gate v4.0` | **Release Gate**: `Gate v4.0 #3`
**Input**: Feature specification from `/specs/015-studio-visuals-presentations/spec.md`

## Summary

Deliver Stage 2 of Release `v4.0` (Package 4.2) by adding two independent `C-03` Studio plugins (`slide_deck`, `infographic`), PostgreSQL constraint widening (`0014_studio_visuals_presentations.sql`), deterministic OOXML PresentationML `.pptx` + 16:9 multi-page `.pdf` export (`FR-ST-16`, `Gate v4.0 #3`, `D8`/`DEV-02`), 5-style deterministic vector SVG infographics with dynamic line wrapping + `2x` PNG export (`FR-ST-17`, `D9`), `everlast-render` private studio namespace support (`notebooks/{uuid}/studio/{uuid}/...`), Right Panel `slide-deck-viewer` and `infographic-viewer` UIs, deterministic `Gate v4.0 #3` evals, `docs/gate-v4-live-evaluation.md`, and `scripts/sync-github-project.mjs` roadmap alignment for Packages `4.1` & `4.2`.

## Technical Context

**Language/Version**: TypeScript (strict ESM) on Node.js 26 (`pnpm` workspaces); browser-native DOM/SVG/Canvas compiled via `tsc` (`apps/web/tsconfig.build.json`) with `import type` only for contracts.
**Primary Dependencies**: Zod (`packages/contracts`), `@everlast/cloud` (`StructuredGenerator` for Flash), `pdfjs-dist` (devDependency in tests for `.pdf` structural verification alongside existing `apps/worker` dependency), Cloud Run services/jobs, PostgreSQL 16 + `pgvector` (`packages/db`). Zero external chart/diffusion models or unapproved frameworks added.
**Storage**: Single Cloud SQL / PostgreSQL 16 instance (`studio_artifacts` widened via additive `0014_studio_visuals_presentations.sql`), plus existing GCS `notebooks/{uuid}/studio/{uuid}/...` object prefix support in `everlast-render`.
**Authentication & Residency**: Identity Platform generic OIDC/SAML (`D6`); strictly Owner-only in `v4.0` (`FR-WM-04`, `NFR-SEC-02`); `europe-west4` storage/compute/`everlast-render` and EU (`europe-west4` / `eu`) enterprise no-training Gemini endpoints (`D3`, `D23`, `NFR-SEC-01`).
**Execution Model**: Deterministic worker pipelines (`slides`, `infographics`) over all original `C-02` chunks (`D12`), deterministic OOXML/PDF assembly (`apps/api/src/studio/slide-export.ts` + `ooxml-zip.ts`) and validated SVG scene assembly (`apps/api/src/studio/infographic-export.ts`).
**Performance Goals**: `10`-slide deck generation `<= 25.0 s` P95 (`FR-ST-16`), infographic generation `<= 20.0 s` P95 (`FR-ST-17`), calibrated under `D24` / `DEV-07`; passes `node scripts/check-kpi-sanity.mjs --include-specs --strict`.
**Constraints**: Slide `slide_count` `5..20` (default `10`), slide `focus_prompt` `0..2,000` trimmed Unicode code points (reject `> 2,000`), `<= 5` bullets per slide (`<= 15` words/bullet with overflow routed to `speaker_notes`), `visual_spec` structured IR preserved for `v5.0` `FR-ST-05`, Google Slides omitted (`D8` / `DEV-02`); infographic `style` in `auto | process_flow | comparison | metrics_summary | architecture_diagram`, `focus_prompt` `0..1,000` trimmed Unicode code points (reject `> 1,000`), crisp `D9` SVG with zero text-clipping/overlap and `"AI-generated · Illustration"` badge; Failed/Cancelled jobs offer `Retry` and expose zero partial exports.
**Within-Release Prerequisites**: Consumes `v1` `C-01`/`C-02`, `v2.1` `FR-UI-02`, `v2.4` `C-03`, `v3.1`/`v3.3` multimodal chunks & durable Studio outbox/lease fencing, and `v4.1` `validateSafeDeterministicSvg` + `verifyStudioCitations`.

## Constitution Check (`CC-01`..`CC-09`)

| Gate ID | Principle | Pre-Research Status | Post-Design Status | Verification Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CC-01` | **I. Traceability** | `PASS` | `PASS` | Every spec requirement, plan row, task (`T001`–`T030`), and test cites `FR-ST-16`, `FR-ST-17`, `C-01..03`, `D8`/`DEV-02`, `D9`, `NFR-EVAL-01..04`, or `Gate v4.0 #3`; `Session 2026-11-16` clarifications flowed back to `package_4_2_studio_visuals_presentations.md`. |
| `CC-02` | **II. Test-First** | `PASS` | `PASS` | `tasks.md` schedules Red spec-derived unit, contract, DB integration, API, render, web, eval, and Playwright tests before every implementation task (`### Tests` precedes `### Implementation` in every User Story). |
| `CC-03` | **III. Scope & Snapshot** | `PASS` | `PASS` | Generation reads solely via `C-02` captured `(source_id, revision)` snapshots; `/export` and `/get` re-verify captured snapshots (`409 SourceSnapshotInvalid` / `403 InvalidScope` when changed/revoked); zero `"All Ready"` server fallback. |
| `CC-04` | **III. Citations & Leakage** | `PASS` | `PASS` | Pre-publication validators (`validateSlideDeckPayload`, `validateInfographicPayload`) verify every `chunk_id` and snippet against scoped chunks (`D13`, `NFR-EVAL-02 = 1.0`); zero deselected-source leakage (`NFR-EVAL-04 = 0`). |
| `CC-05` | **IV. Contracts & Pipelines** | `PASS` | `PASS` | Shared Zod schemas, deterministic `D9` SVG infographic renderer, and pure OOXML/PDF builders live once in `packages/contracts/src/package-v4-2.ts`; worker generators use deterministic structured pipelines without touching prior Studio plugins. |
| `CC-06` | **V. Release & Package Order** | `PASS` | `PASS` | Runs as Stage 2 off completed Package 4.1 (`feat/v4-014-studio-active-learning-suite`); excludes deferred Google Slides (`D8`/`DEV-02`), `v5.0` `FR-ST-05` video muxing, and `@Notebook` (`D5`/`DEV-03`). |
| `CC-07` | **VI. Security, RBAC & Residency** | `PASS` | `PASS` | Owner-only server-side checks on creation, polling, cancel, retry, delete, and export; OOXML parts contain zero macros/OLE/ActiveX/external links; SVG rejects `<script>`/`on*`/`<foreignObject>`/URLs; EU enterprise endpoints (`europe-west4` / `eu`, `NFR-SEC-01`). |
| `CC-08` | **Platform & Cost** | `PASS` | `PASS` | Uses pnpm TS workspace, PostgreSQL, existing `StructuredGenerator`, `StudioPluginRegistry`, and `everlast-render`; zero new paid APIs or fixed-idle services; passes `check-kpi-sanity --include-specs --strict`. |
| `CC-09` | **IV. Architectural Boundaries & Evidence** | `PASS` | `PASS` | Boundary table populated below; `scripts/architecture-policy.json` (88 legacy exceptions) untouched; zero new `@everlast/worker/*` imports in `apps/api/`; `@everlast/contracts` purity and `@everlast/web` browser-safety preserved. Hardening centralized `STUDIO_SLIDE_DECK_PLUGIN_TYPE`/`STUDIO_INFOGRAPHIC_PLUGIN_TYPE` in `package-v3-3.ts` and replaced bullet markup and export filename/SVG regexes with linear scanners. |

## Architecture Boundary Evidence (mandatory; CC-09)

Follow `docs/agent-architecture-guardrails.md`. Cite the assigned SRS IDs for every row.

| SRS / contract | Module path and owner | Responsibility | Public exports / ports | Allowed consumers / dependencies | Composition root | Regression evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `FR-ST-16`, `FR-ST-17`, `C-03`, `D8`, `D9` | `packages/contracts/src/package-v4-2.ts` (plus additive extensions in `package-v3-3.ts`, `package-v2-4.ts`, `index.ts`); Stage 2 Package 4.2 | Shared Contracts, Validators, `D9` Infographic SVG Renderer & Pure OOXML/PDF Emitters | `STUDIO_SLIDE_DECK_PLUGIN_TYPE`, `STUDIO_INFOGRAPHIC_PLUGIN_TYPE` (centralized in `package-v3-3.ts`), `StudioSlideDeckParamsSchema`, `StudioSlideDeckPayloadSchema`, `SlideDeckExportRequestSchema`, `StudioInfographicParamsSchema`, `StudioInfographicPayloadSchema`, `InfographicExportRequestSchema`, `StudioInfographicExportSceneSchema`, `validateSlideFocusPrompt`, `validateInfographicFocusPrompt`, `enforceSlideBulletLimit` (`stripAngleMarkup`), `renderInfographicSvg`, `validateSlideDeckPayload`, `validateInfographicPayload`, `buildSlideDeckOoxmlEntries`, `buildSlideDeckPdfBytes` | Imports only `zod` and relative `./...` contract modules (`contracts-only`); consumed by `db`, `worker`, `api`, `evals`, and type-only by `web` | `packages/contracts/src/index.ts` | `packages/contracts/test/package-v4-2.test.ts` (includes nested markup regression), `packages/evals/test/studio-v4.eval.test.ts` |
| `FR-ST-16`, `FR-ST-17`, `C-03` | `packages/db/migrations/0014_studio_visuals_presentations.sql`, `packages/db/src/studio-artifacts.ts`; Stage 2 Package 4.2 | Schema Migration & Studio Artifact Adapter | Widened `studio_artifacts` plugin/subtype check constraints (`'slide_deck'`, `'infographic'`); existing `PostgresStudioArtifactRepository` / `sweepInterruptedStudioArtifacts` | Imports `pg`, `@everlast/contracts`; consumed by `api` and `worker` | `packages/db/src/index.ts` | `packages/db/test/studio-visuals.integration.test.ts` (0014 migration, atomic outbox, lease fencing, sweep exclusion) |
| `FR-ST-16`, `FR-ST-17`, `C-02`, `C-03`, `D9`, `NFR-EVAL-02/04` | `apps/worker/src/studio/{slides,infographics}/{model,pipeline,plugin,validation}.ts`, `apps/worker/src/studio/{registry,runner}.ts`; Stage 2 Package 4.2 | Job / Worker Pipelines & Validation Adapters | `SlideDeckGeneratorPlugin`, `InfographicGeneratorPlugin`, `DeterministicSlideDeckModel`, `VertexSlideDeckModel`, `DeterministicInfographicModel`, `VertexInfographicModel`, `createStudioPluginRegistry`, `DEFAULT_VALIDATORS` | Imports `@everlast/contracts`, `@everlast/cloud` (`StructuredGenerator`), `apps/worker/src/studio/evidence.ts`, and `apps/worker/src/studio/reports/sentences.ts`; zero app-to-app imports | `apps/worker/src/studio/registry.ts`, `apps/worker/src/server.ts`, existing `apps/api/src/v2/runtime.ts` edge | `apps/worker/test/slide-deck.test.ts`, `apps/worker/test/infographic.test.ts` |
| `FR-ST-16`, `FR-ST-17`, `Gate v4.0 #3`, `NFR-SEC-02` | `apps/api/src/studio/{ooxml-zip,slide-export,infographic-export,service}.ts`, `apps/api/src/routes/studio.ts`; Stage 2 Package 4.2 | Transport Handler & Export Workflows | `exportSlideDeckArtifact`, `buildInfographicExportScene` (linear `buildSafeFilename` / `parseSvgDimensions`), `writeOoxmlZip`, `StudioService.exportSlideDeck`, `StudioService.exportInfographic`, `handleStudioRoute` | Imports `@everlast/contracts`, `@everlast/db`, `node:zlib`; `routes/studio.ts` maps HTTP status/headers only; zero cross-app `@everlast/render` or new `@everlast/worker/*` imports | `apps/api/src/v2/runtime.ts` | `apps/api/test/studio-slide-export.test.ts`, `apps/api/test/studio-infographic-export.test.ts` (includes repeated-hyphen/dimension fallback regression), `apps/api/test/studio-visuals.test.ts` |
| `FR-ST-16`, `NFR-SEC-02` | `apps/render/src/main.ts`; Stage 2 Package 4.2 | Headless Render Job Private Namespace Adapter | `parseRenderRequest`, `executeRender`, `buildOfficeCommand`, `sanitizeOoxml` | Imports `@everlast/cloud`, `jsdom`, Node stdlib; zero app-to-app imports | `apps/render/src/main.ts` | `apps/render/test/render-config.test.ts` |
| `FR-ST-16`, `FR-ST-17`, `Gate v4.0 #3` | `apps/web/src/studio/{api,artifact-list,slide-deck-viewer,infographic-viewer,panel}.ts`, `apps/web/src/workspace.css`; Stage 2 Package 4.2 | Browser UI Viewers & Client API | `createSlideDeckViewer`, `createInfographicViewer`, `createStudioApi`, `createStudioPanel` | Type-only imports from `@everlast/contracts`; reuses `buildSafeSvgElement` (`learning-overview-viewer.ts`) and `rasterizeSvgSceneToPng` / `triggerBlobDownload` (`mindmap-export.ts`); zero Node/server/db imports | `apps/web/src/studio/panel.ts`, `apps/web/src/workspace/index.ts` | `apps/web/test/studio-slide-deck.test.ts`, `apps/web/test/studio-infographic.test.ts`, `apps/web/test/studio-visuals.spec.ts` |
| `FR-ST-16`, `FR-ST-17`, `NFR-EVAL-02/04`, `Gate v4.0 #3` | `packages/evals/src/studio-v4-eval.ts`, `packages/evals/src/cli.ts`; Stage 2 Package 4.2 | Deterministic Gate v4.0 #3 Evaluation Runner | `runStudioVisualsDeterministicEval` | Imports strictly `@everlast/contracts`, `@everlast/testkit/studio-structure-fixtures`, and `pdfjs-dist` (`no-shared-to-app` compliant; zero `apps/*` imports) | `packages/evals/src/cli.ts` (`mode === "deterministic"`) | `packages/evals/test/studio-v4.eval.test.ts` |

- **Workflow ownership**: `apps/api/src/routes/studio.ts` owns HTTP parsing, binary/JSON response serialization (`Cache-Control: private, no-store`), and HTTP error mapping (`400`, `403`, `404`, `409`, `422`). `StudioService`, `slide-export.ts`, and `infographic-export.ts` own Owner verification, `Completed` state & `verifySnapshot` fencing, and `.pptx`/`.pdf`/SVG-scene generation. `packages/db` owns PostgreSQL migrations, outbox insertion, and lease fencing. `apps/worker` owns `C-03` chunk batching, layout synthesis, bullet-overflow routing, `D9` SVG rendering, and pre-publication validation. `apps/render` owns isolated headless `soffice` conversion over private GCS prefixes.
- **Simple CRUD rationale**: None — `/export` routes enforce artifact ownership, `Completed` state, `verifySnapshot` checks, and binary/SVG validation in `StudioService` and export adapters rather than directly accessing storage from routes.
- **Dependency review**: Inspected all imports across touched modules: `packages/contracts/src/package-v4-2.ts` imports solely `zod` and sibling `./...` contract files (`contracts-only` clean); `packages/evals/src/studio-v4-eval.ts` consumes `@everlast/contracts`, `@everlast/testkit/studio-structure-fixtures`, and `pdfjs-dist` with zero `apps/*` imports; `apps/api/src/studio/ooxml-zip.ts` implements local ZIP packing so `apps/api` never imports `apps/render`; `apps/web/src/studio/*` uses `import type` only for `@everlast/contracts`; `apps/api/src/v2/runtime.ts` and `apps/api/src/server.ts` keep all existing `@everlast/worker/*` import lines byte-for-byte unchanged and add zero new cross-app worker imports; `pdfjs-dist` is added only as a `devDependency` in `apps/api/package.json` and `apps/web/package.json` (and dependency in `packages/evals/package.json`) using the exact `^6.5.438` version already pinned in `pnpm-lock.yaml`.
- **Legacy exceptions**: `scripts/architecture-policy.json` contains 88 exact legacy `T035` exceptions (owner `@lukas-zech-software`, decision `D21`, expiry `2027-02-05`). None are modified, widened, or duplicated by Package 4.2.
- **Check availability**: Automated checks (`node scripts/check-spec-integrity.mjs`, `ARCHITECTURE_BASE_REF=origin/main node scripts/lint.mjs`, `node scripts/check-kpi-sanity.mjs --include-specs --strict`, `pnpm test:contract`, `pnpm test:unit`, `pnpm test:integration`, `pnpm eval:deterministic`, `pnpm test:e2e`, `node --test scripts/sync-github-project.test.mjs`) run locally and are recorded in `validation.md` and `docs/gate-v4-live-evaluation.md`. Live GCP `pnpm eval:judged` and headless LibreOffice binary (`soffice`) conversion remain explicitly marked `UNAVAILABLE` locally where unconfigured (`D24` / `DEV-07`).

## Project Structure

### Documentation (this feature & release artifacts)

```text
specs/015-studio-visuals-presentations/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/interfaces.md
├── tasks.md
├── analysis.md
└── validation.md

docs/gate-v4-live-evaluation.md
scripts/sync-github-project.mjs
scripts/sync-github-project.test.mjs
```

### Source Code (repository root)

```text
packages/
├── contracts/
│   ├── src/{package-v4-2.ts,package-v3-3.ts,package-v2-4.ts,index.ts}
│   └── test/package-v4-2.test.ts
├── db/
│   ├── migrations/0014_studio_visuals_presentations.sql
│   └── test/studio-visuals.integration.test.ts
└── evals/
    ├── package.json
    ├── src/{studio-v4-eval.ts,cli.ts}
    └── test/studio-v4.eval.test.ts

apps/
├── worker/
│   ├── src/studio/{slides/*,infographics/*,registry.ts,runner.ts}
│   └── test/{slide-deck.test.ts,infographic.test.ts}
├── api/
│   ├── package.json
│   ├── src/studio/{ooxml-zip.ts,slide-export.ts,infographic-export.ts,service.ts}
│   ├── src/routes/studio.ts
│   └── test/{studio-slide-export.test.ts,studio-infographic-export.test.ts,studio-visuals.test.ts}
├── render/
│   ├── src/main.ts
│   └── test/render-config.test.ts
└── web/
    ├── package.json
    ├── src/studio/{api,artifact-list,slide-deck-viewer,infographic-viewer,panel}.ts
    ├── src/workspace.css
    └── test/{studio-slide-deck.test.ts,studio-infographic.test.ts,studio-visuals.spec.ts}
```

**Structure & File Ownership Decision**: All Package 4.2 application, contract, migration, render, eval, doc, and sync changes are isolated to `feat/v4-015-studio-visuals-presentations` (`specs/015-studio-visuals-presentations`). Existing Package 4.1 (`flashcards`, `quiz`, `learning_overview`) and v2/v3 plugins remain untouched; `scripts/architecture-policy.json` and existing `@everlast/worker/*` imports in `apps/api/src/v2/runtime.ts` and `apps/api/src/server.ts` are untouched.

## Complexity Tracking

No Constitution violations or new architecture deviations; `CC-01`–`CC-09` pass cleanly within the existing stack (`D2`, `D3`, `D4`, `D8`/`DEV-02`, `D9`, `D12`, `D13`, `D16`, `D21`, `D23`, `D24`/`DEV-07`).
