# Tasks: Studio Visuals & Presentations (Package 4.2)

**Input**: Design documents from `/specs/015-studio-visuals-presentations/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`)
**Package Source**: `spec/requirements/v4/package_4_2_studio_visuals_presentations.md` + `spec/requirements/README.md`
**SRS IDs in Scope**: `FR-ST-16`, `FR-ST-17`, `C-01`, `C-02`, `C-03`, `FR-SI-03`, `FR-SI-05`, `FR-UI-02`, `NFR-SEC-01`, `NFR-SEC-02`, `NFR-EVAL-01..04`, `Gate v4.0` | **Release Gate**: `Gate v4.0 #3`

**Prerequisites**: `plan.md` (`CC-01`..`CC-09` passing), `spec.md`, `research.md`, `data-model.md`, `contracts/interfaces.md`

**Tests**: MANDATORY (Constitution Principle II / `CC-02`). Every requirement, Gherkin acceptance scenario, and numeric/text boundary gets spec-derived test tasks citing its SRS ID BEFORE the implementation tasks they cover (`Red -> Green -> Refactor`).

## Phase 1: Setup (Shared Prerequisites & Test Harness Registration)

- [X] T001 Verify within-release prerequisites (`feat/v4-014-studio-active-learning-suite`), migration slot `0014`, zero changes to `scripts/architecture-policy.json`, and configure `pdfjs-dist` (`^6.5.438`) in `apps/api/package.json`, `apps/web/package.json` (`devDependencies`), and `packages/evals/package.json` (`C-03`, `CC-09`, `Gate v4.0 #3`) in `specs/015-studio-visuals-presentations/plan.md`
- [X] T002 Register pure unit test files for Package 4.2 in the `UNIT` array without adding DB/network suites (`FR-ST-16`, `FR-ST-17`, `Gate v4.0 #3`) in `vitest.config.ts`

---

## Phase 2: Foundational (Shared Contracts & PostgreSQL Migration)

**⚠️ CRITICAL**: No user story implementation begins until shared contract tests and migration integration tests are written (`Red`) and contracts + migration are implemented (`Green`).

- [X] T003 [P] Write failing contract tests for `slide_deck` (`5..20` slides, default `10`, `0..2,000` trimmed code-point `focus_prompt` rejecting `2,001`, 5 layout templates, `<= 5` bullets x `<= 15` words with overflow routed to `speaker_notes`, `visual_spec` IR, OOXML `.pptx` entries, 16:9 multi-page `.pdf` bytes) and `infographic` (`auto`/`process_flow`/`comparison`/`metrics_summary`/`architecture_diagram`, `0..1,000` trimmed code-point `focus_prompt` rejecting `1,001`, dynamic wrapping SVG with `"AI-generated · Illustration"` and XSS rejection, `StudioInfographicExportScene`) plus compatibility with existing Studio plugins (`FR-ST-16`, `FR-ST-17`, `C-03`, `D8`, `D9`) in `packages/contracts/test/package-v4-2.test.ts`
- [X] T004 [P] Write failing PostgreSQL integration tests for `0014_studio_visuals_presentations.sql` widened constraints, atomic outbox enqueueing, lease claims, startup sweep exclusion, and `Completed` publication fences for `slide_deck` and `infographic` (`FR-ST-16`, `FR-ST-17`, `C-03`, `NFR-SEC-02`) in `packages/db/test/studio-visuals.integration.test.ts`
- [X] T005 Implement shared Zod schemas, limit/bullet-overflow validators, `renderInfographicSvg` (`D9`), `validateSlideDeckPayload`, `validateInfographicPayload`, `buildSlideDeckOoxmlEntries`, and `buildSlideDeckPdfBytes` preserving `@everlast/contracts` purity (`zod` + relative imports only) (`FR-ST-16`, `FR-ST-17`, `C-03`, `D9`) in `packages/contracts/src/package-v4-2.ts`, `packages/contracts/src/package-v3-3.ts`, `packages/contracts/src/package-v2-4.ts`, and `packages/contracts/src/index.ts` (depends on T003 Red)
- [X] T006 Implement additive migration `0014_studio_visuals_presentations.sql` widening `studio_artifacts_plugin_type_check` and `studio_artifacts_kind_subtype_check` for `'slide_deck'` and `'infographic'` (`FR-ST-16`, `FR-ST-17`, `C-03`) in `packages/db/migrations/0014_studio_visuals_presentations.sql` (depends on T004 Red, T005)

**Checkpoint**: Shared contracts and `0014` database constraints pass (`Green`) before User Story plugins, export adapters, and viewers are built.

---

## Phase 3: User Story 1 - Grounded Slide Decks with Speaker Notes & PPTX/PDF Export (Priority: P1) 🎯 MVP

**Goal**: Generate evidence-grounded Slide Decks (`5..20` slides, default `10`, 5 layouts, `<= 5` bullets x `<= 15` words + `speaker_notes` + `visual_spec` IR + `[n]` citations) strictly from $S_{\text{aktiv}}$, render a 16:9 carousel viewer with thumbnails and toggleable `Speaker Notes` drawer, export structurally valid `.pptx` and `.pdf` files (`Gate v4.0 #3`), support `everlast-render` studio prefixes, and show `Retry` with zero partial exports on `Failed` artifacts (`FR-ST-16`, `D8`/`DEV-02`).

**Independent Test**: Seed 2 active sources + 1 deselected source -> generate 8-slide deck -> verify 8 slides citing active sources only (`0` deselected leakage), bullet bounds enforced, `Speaker Notes` toggled in 16:9 viewer -> export `.pptx` (valid OOXML ZIP with 8 slides & linked `notesSlide1..8.xml`) and `.pdf` (8 valid 16:9 pages parsed by `pdfjs-dist`) -> failed job displays `Retry` with zero export buttons.

### Tests for User Story 1 (MANDATORY, test-first — `CC-02`) ⚠️

- [X] T007 [P] [US1] Write failing worker unit tests for Slide Deck generation (`5..20` count target, bullet overflow truncation to `<= 5` x `<= 15` words pushed into `speaker_notes`, `visual_spec` IR across 5 templates, brief-source `insufficient_evidence_note`, zero-evidence refusal, invalid citation rejection, zero deselected-source leakage) (`FR-ST-16`, `C-02`, `C-03`, `NFR-EVAL-02/04`) in `apps/worker/test/slide-deck.test.ts`
- [X] T008 [P] [US1] Write failing API unit & integration tests for OOXML `.pptx` and 16:9 `.pdf` export (`Gate v4.0 #3`, ZIP + XML + `notesSlide` validation, `sanitizeOoxml` compatibility, `pdfjs-dist` `numPages === slides.length` & readable text), admission (`400 EmptyScopeError`, `422` on `4`/`21` slides or `2,001`-char prompt), cancellation/retry, snapshot revocation (`409 SourceSnapshotInvalid`), and non-`Completed` export rejection (`409 Conflict`) (`FR-ST-16`, `C-02`, `C-03`, `NFR-SEC-02`, `Gate v4.0 #3`) in `apps/api/test/studio-slide-export.test.ts` and `apps/api/test/studio-visuals.test.ts`
- [X] T009 [P] [US1] Write failing `everlast-render` unit test verifying private `notebooks/{uuid}/studio/{uuid}/...` `.pptx` -> `.pdf` render namespace parsing and cross-namespace rejection (`FR-ST-16`, `NFR-SEC-02`) in `apps/render/test/render-config.test.ts`
- [X] T010 [P] [US1] Write failing web unit tests for Slide Deck tile/customization modal (`5..20` default `10`, `0..2,000` prompt), 16:9 carousel (`"Slide k of N"`), thumbnail navigation, toggleable `Speaker Notes` drawer, citation badge clicks, `"Export PPTX"` & `"Export PDF"` downloads, and failed-row `Retry` with no export actions (`FR-ST-16`, `D8`/`DEV-02`, `Gate v4.0 #3`) in `apps/web/test/studio-slide-deck.test.ts`

### Implementation for User Story 1

- [X] T011 [P] [US1] Implement `SlideDeckModelClient` (`DeterministicSlideDeckModel`, `VertexSlideDeckModel`), all-original batch pipeline, bullet-overflow normalizer, citation validator, and `SlideDeckGeneratorPlugin`, and register `slide_deck` in worker registry & runner without editing existing `apps/api/` `@everlast/worker/*` imports (`FR-ST-16`, `C-02`, `C-03`, `NFR-SEC-01`, `CC-09`) in `apps/worker/src/studio/slides/{model,pipeline,plugin,validation}.ts`, `apps/worker/src/studio/registry.ts`, and `apps/worker/src/studio/runner.ts` (depends on T007 Red, T005)
- [X] T012 [US1] Implement pure API OOXML ZIP packager (`writeOoxmlZip`) and `exportSlideDeckArtifact` (`.pptx` OOXML + 16:9 `.pdf` with optional `soffice` path) and wire `exportSlideDeck` into `StudioService` and `POST /export` binary attachment response in `handleStudioRoute` (`FR-ST-16`, `D8`/`DEV-02`, `NFR-SEC-02`, `Gate v4.0 #3`) in `apps/api/src/studio/{ooxml-zip,slide-export,service}.ts` and `apps/api/src/routes/studio.ts` (depends on T008 Red, T006, T011)
- [X] T013 [P] [US1] Extend `everlast-render` private object namespace matcher to allow `notebooks/{uuid}/studio/{uuid}/...` alongside `sources/{uuid}/...` (`FR-ST-16`, `NFR-SEC-02`) in `apps/render/src/main.ts` (depends on T009 Red)
- [X] T014 [US1] Implement browser-safe `slide-deck-viewer.ts` (16:9 slide stage, thumbnails, Prev/Next, toggleable `Speaker Notes` drawer, clickable citations, `"Export PPTX"` / `"Export PDF"`) and wire `"Slide Deck"` tile + customization modal + binary export API into `api.ts`, `artifact-list.ts` (`cancellable`), `panel.ts`, and `workspace.css` (`FR-ST-16`, `D8`/`DEV-02`, `Gate v4.0 #3`) in `apps/web/src/studio/{api,artifact-list,slide-deck-viewer,panel}.ts` and `apps/web/src/workspace.css` (depends on T010 Red, T012)

**Checkpoint**: User Story 1 passes worker, API, render, and web unit tests (`Green`).

---

## Phase 4: User Story 2 - Deterministic Visual Infographics with SVG & PNG Export (Priority: P2)

**Goal**: Generate deterministic vector Infographics (`auto`, `process_flow`, `comparison`, `metrics_summary`, `architecture_diagram`; `0..1,000` focus prompt) strictly from $S_{\text{aktiv}}$ using `D9` dynamic wrapping SVG rendering (zero text clipping/overlap, `"AI-generated · Illustration"` label, cited sources footer), present a zoomable canvas viewer with safe DOM SVG mounting and `"Export SVG"` / `"Export PNG"` (`2x`), and show `Retry` with zero partial exports on failure (`FR-ST-17`, `D9`).

**Independent Test**: Source describing 4-stage incident response workflow -> generate Infographic (`style: "process_flow"`) -> verify 4 stages in `structured_blocks` and non-clipping `rendered_svg` -> zoom & inspect in `infographic-viewer` -> download `.svg` and `2x` `.png` -> failed infographic offers `Retry` with zero partial exports.

### Tests for User Story 2 (MANDATORY, test-first — `CC-02`) ⚠️

- [X] T015 [P] [US2] Write failing worker unit tests for Infographic generation across all 4 concrete styles + `"auto"` resolution, 4-stage `process_flow` workflow preservation, long-label dynamic wrapping/box-height adjustment (`0` clipping), SVG XSS sanitization, invalid citation rejection, and zero deselected leakage (`FR-ST-17`, `D9`, `C-02`, `C-03`, `NFR-EVAL-02/04`) in `apps/worker/test/infographic.test.ts`
- [X] T016 [P] [US2] Write failing API unit & integration tests for Infographic admission (`400 EmptyScopeError`, `422` on invalid `style` or `1,001`-char prompt), `POST /export` `{ format: "svg" | "png" }` scene validation (`scale: 1 | 2`, `Cache-Control: private, no-store`), snapshot revocation (`409`), and non-`Completed` export rejection (`409 Conflict`) (`FR-ST-17`, `D9`, `NFR-SEC-02`) in `apps/api/test/studio-infographic-export.test.ts` and `apps/api/test/studio-visuals.test.ts`
- [X] T017 [P] [US2] Write failing web unit tests for Infographic tile/customization modal (`auto | process_flow | comparison | metrics_summary | architecture_diagram`, `0..1,000` prompt), zoom controls (`zoom-in`, `zoom-out`, `zoom-reset`), safe DOM SVG rendering (`buildSafeSvgElement`), cited footer, `"Export SVG"` & `"Export PNG"` downloads, and failed-row `Retry` with no export buttons (`FR-ST-17`, `D9`) in `apps/web/test/studio-infographic.test.ts`

### Implementation for User Story 2

- [X] T018 [P] [US2] Implement `InfographicModelClient` (`DeterministicInfographicModel`, `VertexInfographicModel`), all-original batch pipeline, `D9` SVG rendering + safety validation, and `InfographicGeneratorPlugin`, and register `infographic` in worker registry & runner (`FR-ST-17`, `D9`, `C-02`, `C-03`, `NFR-SEC-01`) in `apps/worker/src/studio/infographics/{model,pipeline,plugin,validation}.ts`, `apps/worker/src/studio/registry.ts`, and `apps/worker/src/studio/runner.ts` (depends on T015 Red, T005)
- [X] T019 [US2] Implement `buildInfographicExportScene` and wire `exportInfographic` into `StudioService` and `POST /export` JSON scene response (`Cache-Control: private, no-store`) in `handleStudioRoute` (`FR-ST-17`, `D9`, `NFR-SEC-02`) in `apps/api/src/studio/{infographic-export,service}.ts` and `apps/api/src/routes/studio.ts` (depends on T016 Red, T006, T018)
- [X] T020 [US2] Implement browser-safe `infographic-viewer.ts` (zoom controls, `buildSafeSvgElement`, citations, `"Export SVG"` + `2x` Canvas `"Export PNG"` via `rasterizeSvgSceneToPng`) and wire `"Infographic"` tile + customization modal + export API into `api.ts`, `artifact-list.ts` (`cancellable`), `panel.ts`, and `workspace.css` (`FR-ST-17`, `D9`) in `apps/web/src/studio/{api,artifact-list,infographic-viewer,panel}.ts` and `apps/web/src/workspace.css` (depends on T017 Red, T019)

**Checkpoint**: User Story 2 passes worker, API, and web unit tests (`Green`).

---

## Phase 5: Eval Gates, Browser E2E, Gate v4.0 Docs, Project Sync & Convergence

- [X] T021 [P] Write deterministic citation precision (`NFR-EVAL-02 = 1.0`), zero-leakage (`NFR-EVAL-04 = 0`), bullet-overflow enforcement, OOXML `.pptx` + `pdfjs-dist` 16:9 `.pdf` export verification (`Gate v4.0 #3`), and `D9` SVG infographic non-clipping eval runner & suite, and wire into `packages/evals/src/cli.ts` (`FR-ST-16`, `FR-ST-17`, `NFR-EVAL-02/04`, `Gate v4.0 #3`) in `packages/evals/src/studio-v4-eval.ts`, `packages/evals/src/cli.ts`, and `packages/evals/test/studio-v4.eval.test.ts`
- [X] T022 [P] Write Playwright browser E2E suite verifying 8-slide deck generation, `Speaker Notes` drawer, `.pptx` (ZIP + 8 slide/notes XMLs) & `.pdf` (`pdfjs-dist` 8 pages) download verification (`Gate v4.0 #3`), failed slide deck `Retry` with no export buttons, and 4-stage incident response `process_flow` infographic generation + `.svg`/`.png` downloads (`FR-ST-16`, `FR-ST-17`, `Gate v4.0 #3`) in `apps/web/test/studio-visuals.spec.ts`
- [X] T023 [P] Create `docs/gate-v4-live-evaluation.md` documenting `Gate v4.0 #1`, `#2`, and `#3` verification evidence and transparent `UNAVAILABLE` marking for unconfigured live GCP `eval:judged` / LibreOffice binary runs under `D24` / `DEV-07` (`Gate v4.0`, `NFR-EVAL-01..04`) in `docs/gate-v4-live-evaluation.md`
- [X] T024 [P] Update `scripts/sync-github-project.mjs` and `scripts/sync-github-project.test.mjs` mapping Package `4.1` (`slug: "014-studio-active-learning-suite"`) and Package `4.2` (`slug: "015-studio-visuals-presentations"`) while keeping `Gate v4.0` accurate until PR merge (`CC-01`, `Gate v4.0`) in `scripts/sync-github-project.mjs` and `scripts/sync-github-project.test.mjs`
- [X] T025 Run full verification suite inside worktree: `ARCHITECTURE_BASE_REF=origin/main node scripts/lint.mjs`, `node scripts/check-kpi-sanity.mjs --include-specs --strict`, `pnpm build`, `pnpm test:contract`, `pnpm test:unit`, `node --test scripts/sync-github-project.test.mjs`, `pnpm test:integration`, `pnpm eval:deterministic`, and full `pnpm test:e2e` (`FR-ST-16`, `FR-ST-17`, `Gate v4.0 #3`)
- [X] T026 Verify bidirectional upstream spec flow-back (`spec/requirements/v4/package_4_2_studio_visuals_presentations.md`), execute `/speckit-converge` check against `spec.md`, `plan.md`, `tasks.md`, and final `git diff`, record validation evidence in `specs/015-studio-visuals-presentations/validation.md`, and mark completed tasks `[X]` (`CC-01`, `CC-09`)

---

## Dependencies & Execution Order

- **Phase 1–2**: `T001` -> `T002` -> (`T003`, `T004` Red) -> `T005` -> `T006`
- **Phase 3 (US1)**: (`T007`, `T008`, `T009`, `T010` Red) -> `T011`, `T013` -> `T012` -> `T014`
- **Phase 4 (US2)**: (`T015`, `T016`, `T017` Red) -> `T018` -> `T019` -> `T020`
- **Phase 5 (Verification & Sync)**: `T021`, `T022`, `T023`, `T024` -> `T025` -> `T026`

## Architecture Task Coverage (mandatory; CC-09)

- Preserve existing `report`, `mindmap`, `data_table`, `flashcards`, `quiz`, and `learning_overview` contracts, schemas, outbox, lease fencing, and startup sweep invariants (`T004`, `T006`, `T011`, `T018`).
- Every touched module maps cleanly to `plan.md`'s boundary inventory: `@everlast/contracts` imports only `zod` + relative modules (`T005`), `@everlast/db` owns SQL & migration DDL (`T006`), `apps/worker` owns `C-03` plugins & validation (`T011`, `T018`), `apps/api/routes` stays transport-only while `StudioService`, `slide-export.ts`, and `infographic-export.ts` own export workflows without cross-app `@everlast/render` imports (`T012`, `T019`), `apps/render` stays self-contained (`T013`), `apps/web` stays browser-safe with `import type` contracts (`T014`, `T020`), and `packages/evals/src/studio-v4-eval.ts` avoids `apps/*` imports (`T021`).
- `scripts/architecture-policy.json` (88 legacy `T035` exceptions) and existing `@everlast/worker/*` import lines in `apps/api/src/v2/runtime.ts` and `apps/api/src/server.ts` remain unmodified (`T001`, `T011`, `T018`, `T025`).
- Automated `pnpm check:architecture`, `pnpm check:architecture-artifacts`, `pnpm test:architecture`, `check-spec-integrity.mjs`, and `check-kpi-sanity.mjs --include-specs --strict` run in `T025`; live cloud LLM-judged evals and headless `soffice` binary runs remain `UNAVAILABLE` locally unless configured (`T023`, `T026`).
