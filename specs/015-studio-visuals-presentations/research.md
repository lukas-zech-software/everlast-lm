# Phase 0 Research: Studio Visuals & Presentations (Package 4.2)

**Feature**: `specs/015-studio-visuals-presentations`
**Package**: Package 4.2 (`FR-ST-16`, `FR-ST-17`, `C-01..C-03`, `D8`/`DEV-02`, `D9`, `Gate v4.0 #3`)
**Date**: 2026-11-16

## Decision 1: Reusing `C-03` Durable Studio Outbox, Leases & Evidence Batching

- **Decision**: Extend `StudioPluginTypeSchema` additively (`"slide_deck"`, `"infographic"`) in `packages/contracts/src/package-v3-3.ts` / `package-v4-2.ts` / `package-v2-4.ts`, widen PostgreSQL check constraints in `packages/db/migrations/0014_studio_visuals_presentations.sql`, and register `SlideDeckGeneratorPlugin` and `InfographicGeneratorPlugin` in `apps/worker/src/studio/registry.ts` + `DEFAULT_VALIDATORS` in `apps/worker/src/studio/runner.ts`.
- **Rationale**: Reuses the exact atomic outbox (`jobs` `kind = 'studio'`), lease fencing (`claimExecution`, `renewLease`, `completeWithFence`, `failWithFence`), startup sweep exclusion (`WHERE plugin_type = 'report'`), and all-original chunk batching (`processAllOriginalEvidenceBatches`) without modifying existing `report`, `mindmap`, `data_table`, `flashcards`, `quiz`, or `learning_overview` plugins or adding new `@everlast/worker/*` imports to `apps/api/`.

## Decision 2: Pure OOXML PresentationML `.pptx` & Deterministic 16:9 `.pdf` Assembly

- **Decision**: Construct OOXML PresentationML parts (`buildSlideDeckOoxmlEntries`) and deterministic 16:9 (`960 x 540 pt`) PDF 1.4 binary streams (`buildSlideDeckPdfBytes`) in pure TypeScript inside `packages/contracts/src/package-v4-2.ts`, package `.pptx` entries via `apps/api/src/studio/ooxml-zip.ts` (`deflateRawSync`) inside `apps/api/src/studio/slide-export.ts`, and optionally support `soffice` conversion when present while extending `apps/render/src/main.ts` private object patterns to `notebooks/{uuid}/studio/{uuid}/...`.
- **Rationale**:
  1. Keeps `@everlast/contracts` strictly compliant with `contracts-only` (imports `zod` and `./...` only; zero `node:zlib` or third-party OOXML bloat) while allowing both `apps/api` and `packages/evals` (without `no-shared-to-app` imports) to validate slide deck exports directly (`Gate v4.0 #3`).
  2. Emits complete OOXML PresentationML packages (`[Content_Types].xml`, `_rels/.rels`, `docProps/{core,app}.xml`, `ppt/presentation.xml` `12192000 x 6858000` EMU, `ppt/slideMasters/*`, `ppt/slideLayouts/*`, `ppt/theme/theme1.xml`, `ppt/slides/slide1..N.xml`, `ppt/notesMasters/*`, `ppt/notesSlides/notesSlide1..N.xml`) with editable `<p:sp>` text shapes, speaker notes, and zero macros/ActiveX/OLE/external links — passing `everlast-render`'s `sanitizeOoxml` check cleanly.
  3. Emits valid PDF 1.4 binary pages (`[0 0 960 540]` MediaBox, exact `xref`, Type1 `/Helvetica` & `/Helvetica-Bold`) verified parseable via `pdfjs-dist` (`doc.numPages === payload.slides.length` and non-empty extracted slide text).
- **Alternatives rejected**: Adding heavy third-party presentation generators that emit remote fonts or fail offline/sandbox environments; cross-app importing `apps/render/src/zip.ts` from `apps/api` (forbidden by `no-cross-app`).

## Decision 3: Deterministic Bullet-Overflow Enforcement & `v5.0` `FR-ST-05` Structured IR

- **Decision**: Implement `enforceSlideBulletLimit` in `packages/contracts/src/package-v4-2.ts` and invoke it during slide composition so every slide has `1..5` bullets and `<= 15` words per bullet, routing trimmed words or overflow bullets deterministically into `speaker_notes`, and embedding a typed `visual_spec` union (`title`, `two_column`, `key_metric_callout`, `comparison_table`, `diagram_chart`).
- **Rationale**: Guarantees `FR-ST-16` slide text never clips or overflows visually and ensures `v5.0` `FR-ST-05` Narrated Slideshow Video can read `slides` + `visual_spec` + `speaker_notes` directly without schema migration.

## Decision 4: Deterministic 5-Style Infographic SVG Layout (`D9`) & `2x` PNG Rasterization

- **Decision**: Implement `renderInfographicSvg` in `packages/contracts/src/package-v4-2.ts` supporting `"process_flow"`, `"comparison"`, `"metrics_summary"`, and `"architecture_diagram"` (with deterministic `"auto"` resolution in the worker pipeline), reusing `wrapDiagramText` / `escapeXmlText` / `validateSafeDeterministicSvg` from `package-v4-1.ts`. In `apps/api/src/studio/infographic-export.ts`, return a validated `StudioInfographicExportScene` (`{ format, svg, width, height, scale: 1 | 2, filename }`); in `apps/web/src/studio/infographic-viewer.ts`, render via allowlisted `buildSafeSvgElement` DOM mounting and rasterize `.png` at `2x` scale via the browser Canvas API (`rasterizeSvgSceneToPng` pattern from `mindmap-export.ts`).
- **Rationale**: Zero garbled raster text (`D9`), zero overlapping or clipped boxes regardless of label length, zero `innerHTML` script risks, and consistent `svg`/`png` export UX matching Package 3.3 Mindmaps.

## Decision 5: `Gate v4.0` Verification & GitHub Project Mapping (`docs/gate-v4-live-evaluation.md`, `scripts/sync-github-project.mjs`)

- **Decision**: Wire `runStudioVisualsDeterministicEval()` (`Gate v4.0 #3`: Slide Deck + Infographic grounding, bullet limits, OOXML PPTX + PDF `pdfjs-dist` verification, SVG safety & zero clipping) into `packages/evals/src/studio-v4-eval.ts` and `packages/evals/src/cli.ts`, document full `Gate v4.0 #1..#3` verification status in `docs/gate-v4-live-evaluation.md` (marking live GCP `eval:judged` / LibreOffice binary execution transparently as `UNAVAILABLE` if absent locally per `D24` / `DEV-07`), and map Package `4.1` (`014-studio-active-learning-suite`) and Package `4.2` (`015-studio-visuals-presentations`) in `scripts/sync-github-project.mjs`.
- **Rationale**: Preserves honest reporting (Constitution Principle II / `D24`), keeps `Gate v4.0` backlog state accurate until PRs merge (`sync-github-project.test.mjs`), and consolidates `v4.0` release readiness evidence.
