# Feature Specification: Studio Visuals & Presentations (Package 4.2)

**Feature Branch**: `feat/v4-015-studio-visuals-presentations`
**Created**: 2026-11-16
**Status**: Clarified
**Package Source**: `spec/requirements/v4/package_4_2_studio_visuals_presentations.md`
**SRS IDs in Scope**: `FR-ST-16`, `FR-ST-17`, `C-01`, `C-02`, `C-03`, `FR-SI-03`, `FR-SI-05`, `FR-UI-02`, `NFR-SEC-01`, `NFR-SEC-02`, `NFR-EVAL-01`, `NFR-EVAL-02`, `NFR-EVAL-03`, `NFR-EVAL-04`, `Gate v4.0`
**Release & Gate**: `v4.0` (`Gate v4.0 #3`)
**Input**: User description: "Package 4.2 — Studio: Visuals & Presentations (`FR-ST-16`, `FR-ST-17`)"

## Source Traceability & Package Scope *(mandatory)*

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| `FR-ST-16` | Studio: Slide Decks with PPTX & PDF Export | [`package_4_2_studio_visuals_presentations.md#fr-st-16--studio-slide-decks-with-pptx--pdf-export`](../../spec/requirements/v4/package_4_2_studio_visuals_presentations.md#fr-st-16--studio-slide-decks-with-pptx--pdf-export) | `D2`, `D3`, `D4`, `D8`/`DEV-02`, `D12`, `D13`, `D23`, `D24`/`DEV-07` |
| `FR-ST-17` | Studio: Visual Infographics | [`package_4_2_studio_visuals_presentations.md#fr-st-17--studio-visual-infographics`](../../spec/requirements/v4/package_4_2_studio_visuals_presentations.md#fr-st-17--studio-visual-infographics) | `D2`, `D3`, `D9`, `D12`, `D13`, `D23`, `D24`/`DEV-07` |
| `C-01`, `C-02`, `C-03` | Unified Chunk, Scoped Context, Studio Plugin Contracts | [`spec/requirements/README.md#binding-cross-package-rules`](../../spec/requirements/README.md#binding-cross-package-rules) | `D2`, `D12`, `D13`, `D16`, `D21` |
| `FR-SI-03`, `FR-SI-05` | Explicit Scope, Deletion & Re-sync Snapshot Safety | [`spec/requirements/README.md#binding-cross-package-rules`](../../spec/requirements/README.md#binding-cross-package-rules) | `D12`, `D15` |
| `FR-UI-02` | Effective Output Language Hierarchy | [`spec/requirements/README.md#binding-cross-package-rules`](../../spec/requirements/README.md#binding-cross-package-rules) | `D2`, `D16` |
| `NFR-SEC-01`, `NFR-SEC-02` | Enterprise No-Training Endpoints & Server-Side AuthZ | [`spec/requirements/README.md#binding-cross-package-rules`](../../spec/requirements/README.md#binding-cross-package-rules) | `D3`, `D6`, `D23` |
| `NFR-EVAL-01`..`04` | Hallucination, Citation Validity, Negative Rejection, Leakage | [`spec/requirements/README.md#binding-cross-package-rules`](../../spec/requirements/README.md#binding-cross-package-rules) | `D24` / `DEV-07` |
| `Gate v4.0` | Slide Deck PPTX & PDF Export Integrity (`#3`) | [`package_4_2_studio_visuals_presentations.md#package-42--studio-visuals--presentations`](../../spec/requirements/v4/package_4_2_studio_visuals_presentations.md#package-42--studio-visuals--presentations) | `D8`/`DEV-02`, `D9`, `D24`/`DEV-07` |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: Consumes `v1` `C-01` (`UnifiedDocumentChunk`), `C-02` (`ScopedContextProvider`), `v2.1` `FR-UI-02` language resolution, `v2.4` `C-03` (`StudioGeneratorPlugin` registry & lifecycle), `v3.1` multimodal chunks, `v3.3` durable Studio job delivery, lease fencing, and all-original evidence batching, and `v4.1` `D9` SVG safety validation (`validateSafeDeterministicSvg`) + citation verifier (`verifyStudioCitations`). Registers `slide_deck` and `infographic` as independent `C-03` plugins without modifying existing `report`, `mindmap`, `data_table`, `flashcards`, `quiz`, or `learning_overview` plugins.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Strictly `Owner`-only across `v1.0`–`v5.0`. `Editor` (generate) and `Viewer Full` (view/export) roles take effect only in `v6.0`.
- **Data Residency (`D3`, `D23`)**: `europe-west4` default for storage, PostgreSQL, `everlast-render`, and Cloud Run; enterprise Gemini inference/structured generation uses `europe-west4` / approved EU multi-region `eu` under `D23`.
- **Upstream Flow-Back Status (`CC-01`)**: Technical clarifications from `Session 2026-11-16` are captured below and flowed back to [`spec/requirements/v4/package_4_2_studio_visuals_presentations.md`](../../spec/requirements/v4/package_4_2_studio_visuals_presentations.md).

## Clarifications

### Session 2026-11-16

1. **Deterministic OOXML `.pptx` & Multi-Page 16:9 `.pdf` Export (`FR-ST-16`, `Gate v4.0 #3`, `D8`/`DEV-02`)**: `.pptx` exports assemble a complete, standards-compliant OOXML PresentationML ZIP archive with 16:9 widescreen slide geometry (`12192000 x 6858000` EMU), editable `<p:sp>` text boxes (slide headline, structured visual detail, `<= 5` bullet paragraphs, and citation markers `[n]`), and linked `ppt/notesSlides/notesSlide{k}.xml` speaker notes (`p:ph type="body"`) sanitized with zero macros, OLE, ActiveX, or external links (compatible with both `everlast-render`'s OOXML sanitizer and headless LibreOffice conversion). `.pdf` exports produce a valid 16:9 (`960 x 540 pt` landscape) multi-page PDF 1.4 binary document matching the exact slide count (`numPages === payload.slides.length`) with embedded Type1 fonts (`/Helvetica`, `/Helvetica-Bold`), parseable via `pdfjs-dist` (`getDocument` + `page.getTextContent()`), with `everlast-render` private namespace support extended to `notebooks/{uuid}/studio/{uuid}/...` for Cloud Run headless LibreOffice conversion when configured. Google Slides OAuth export remains explicitly deferred per `D8` / `DEV-02`.
2. **Slide Bullet Overflow Policy & `v5.0` `FR-ST-05` Intermediate Representation (`FR-ST-16`)**: Every generated slide strictly enforces `<= 5` bullets per slide and `<= 15` words per bullet; any overflow clauses or verbose detail beyond 15 words or 5 bullets are routed deterministically into `speaker_notes` so slide visuals never clip or overflow. Each slide includes a typed `visual_spec` JSON IR (`layout` plus structured `callout`, `columns`, `table_rows`, or `diagram_steps` fields and source references) enabling `v5.0` `FR-ST-05` Narrated Slideshow Video to consume it directly without schema re-architecture.
3. **Evidence-Constrained Slide Count & Atomic Failure Handling (`FR-ST-16`, `FR-ST-17`, `C-03`)**: Slide count accepts integers `5..20` (default `10`). When $S_{\text{aktiv}}$ lacks enough distinct factual points for `target_count` slides, the deck produces fewer grounded slides (`>= 1`) accompanied by a non-empty `insufficient_evidence_note` rather than invented padding, or fails with `InsufficientEvidence` if zero slides can be grounded. Both `slide_deck` and `infographic` artifacts in `Failed` or `Cancelled` state present a `Retry` action (requiring explicit `active_source_ids`) and offer zero partial `.pptx`, `.pdf`, `.svg`, or `.png` export actions (`409 Conflict` if `/export` is requested on a non-`Completed` artifact).
4. **Deterministic 5-Style Vector Infographics & `2x` PNG Export (`FR-ST-17`, `D9`)**: Infographic generation accepts layout style `auto` (resolved deterministically to one of the 4 concrete styles `process_flow`, `comparison`, `metrics_summary`, or `architecture_diagram` based on source structure/prompt), plus optional `focus_prompt` (`0..1,000` trimmed Unicode code points; rejecting `> 1,000` without truncation). The deterministic SVG layout engine wraps long block headings/bodies and expands box heights dynamically so zero text clips or overlaps, includes an `"AI-generated · Illustration"` label and cited sources footer (`[1] ...`), and passes `validateSafeDeterministicSvg` (zero `<script>`, `on*`, `<foreignObject>`, or external URLs). `POST /export` validates `{ format: "svg" | "png" }` and returns a sanitized export scene (`scale: 1` for `.svg`, `scale: 2` for browser Canvas `.png` rasterization).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Grounded Slide Decks with Speaker Notes & PPTX/PDF Export (Priority: P1)

**SRS IDs**: `FR-ST-16`, `FR-SI-03`, `FR-SI-05`, `C-02`, `C-03`, `D8`/`DEV-02`, `Gate v4.0`
**Actors**: `Owner` (in `v4.0`–`v5.0`; `Owner` / `Editor` generate, `Viewer Full` view/export from `v6.0`)

As a consultant or manager, I want to generate a structured slide deck with speaker notes directly from my active notebook sources (optionally choosing slide count `5..20` and a focus prompt `0..2,000` characters), browse it in a 16:9 slide carousel with thumbnails and a `Speaker Notes` drawer, and export valid `.pptx` and `.pdf` files so I can go from research to an executive presentation in minutes.

**Why this priority**: Slide deck generation and valid `.pptx`/`.pdf` export are `P1` and directly satisfy `Gate v4.0 #3`.

**Independent Test**: Seed a notebook with 2 active sources (and 1 deselected source). Generate an 8-slide deck, verify 8 slides across supported templates with `<= 5` bullets (`<= 15` words/bullet), `visual_spec`, `speaker_notes`, and active source citations (`0` deselected leakage), toggle `Speaker Notes` in the 16:9 viewer, export `.pptx` (verifying 8 slides + speaker notes XMLs) and `.pdf` (verifying 8 valid 16:9 pages via `pdfjs-dist`), and verify a failed job shows `Retry` with no partial export buttons.

**Acceptance Scenarios**:

1. **Given** a notebook with 2 active sources in $S_{\text{aktiv}}$ (and an optional deselected source), **When** the owner generates a `"Slide Deck"` of `8` slides (within `5..20`, default `10`, optional focus prompt `0..2,000` chars), **Then** the completed artifact contains `8` slides using the 5 layout templates (`title`, `two_column`, `key_metric_callout`, `comparison_table`, `diagram_chart`), each with headline, `<= 5` bullets (`<= 15` words/bullet), `visual_spec`, `speaker_notes`, and inline source citations `[n]` (`0` deselected source leakage) (`FR-ST-16`, `Gate v4.0 #3`).
2. **Given** the Completed 8-slide deck is opened in the Right Panel Slide Deck Viewer, **When** the user navigates the 16:9 carousel/thumbnails, toggles `"Speaker Notes"`, clicks `"Export PPTX"`, and clicks `"Export PDF"`, **Then** `"Export PPTX"` downloads a structurally valid OOXML `.pptx` archive containing all 8 editable slides and linked speaker notes (passing OOXML sanitization and headless LibreOffice conversion without errors) and `"Export PDF"` downloads a valid 16:9 `.pdf` containing all `8` pages (`FR-ST-16`, `Gate v4.0 #3`).
3. **Given** a notebook with 2 active sources, **When** slide deck generation fails, **Then** the artifact shows state `"Failed"` with an error message and a `"Retry"` action, and NO partial `.pptx` or `.pdf` export is offered (`FR-ST-16`, `C-03`).

---

### User Story 2 - Deterministic Visual Infographics with SVG & PNG Export (Priority: P2)

**SRS IDs**: `FR-ST-17`, `FR-SI-03`, `FR-SI-05`, `C-02`, `C-03`, `D9`
**Actors**: `Owner` (in `v4.0`–`v5.0`; `Owner` / `Editor` generate, `Viewer Full` view/export from `v6.0`)

As a communicator, I want to turn dense technical or business sources into a single crisp vector infographic poster (choosing `auto`, `process_flow`, `comparison`, `metrics_summary`, or `architecture_diagram` and an optional `0..1,000` char focus prompt) with zoomable canvas viewing and lossless `.svg` and `.png` export so stakeholders can digest key numbers and workflows at a glance without garbled AI text.

**Why this priority**: Structured visual infographics (`FR-ST-17`, `D9`) complement slide decks as the `P2` visual output capability of Package 4.2.

**Independent Test**: Seed a notebook with an active source describing a 4-stage incident response workflow, generate an Infographic with style `"process_flow"`, verify all 4 stages appear in `structured_blocks` and deterministic `rendered_svg` without text clipping/overlap (including long-label wrapping), zoom/inspect in the Infographic Viewer, export `.svg` and `2x` `.png`, and verify a failed infographic job offers `Retry` with zero partial SVG or PNG export.

**Acceptance Scenarios**:

1. **Given** a notebook with an active source describing a 4-stage incident response workflow, **When** the owner generates an `"Infographic"` with style `"process_flow"`, **Then** the completed artifact persists `structured_blocks` and sanitized deterministic `rendered_svg` displaying all 4 stages accurately with `"AI-generated · Illustration"` label, cited sources footer, and clean `.svg` + `.png` export (`FR-ST-17`, `D9`).
2. **Given** a source with long box labels or headings, **When** the deterministic SVG layout engine renders the infographic, **Then** text wraps cleanly across lines and box heights expand dynamically so zero text clips or overlaps (`FR-ST-17`, `D9`).
3. **Given** a notebook with 1 active source, **When** infographic generation fails, **Then** the artifact shows state `"Failed"` with an error message and a `"Retry"` action, and NO partial `.svg` or `.png` export is offered (`FR-ST-17`, `C-03`).

### Edge Cases *(mandatory)*

- **Boundary & Unicode Code-Point Limits (`FR-ST-16`, `FR-ST-17`)**:
  - Slide deck `focus_prompt`: `0..2,000` Unicode code points after outer whitespace trim; `2,001` code points is rejected (`422 ValidationError`) without silent truncation.
  - Slide deck `slide_count`: integer `5..20` (default `10`); `4` or `21` is rejected (`422 ValidationError`).
  - Infographic `focus_prompt`: `0..1,000` Unicode code points after outer whitespace trim; `1,001` code points is rejected (`422 ValidationError`) without silent truncation.
- **Slide Bullet Overflow (`FR-ST-16`)**:
  - Slides exceeding 5 bullets or 15 words per bullet are normalized deterministically so each slide keeps `<= 5` bullets (`<= 15` words each) and verbose detail flows into `speaker_notes`.
- **Long Infographic Labels (`FR-ST-17`, `D9`)**:
  - Deterministic SVG layout wraps text to column width and grows box height dynamically; sibling row boxes align without overlapping text or edges.
- **Explicit Scope & Empty Selection (`FR-SI-03`, `C-02`, `NFR-EVAL-04`)**:
  - Empty `active_source_ids` disables Slide Deck and Infographic tiles in the Studio UI and is rejected server-side (`400 EmptyScopeError`) with zero `"All Ready sources"` fallback.
- **Mid-Flight Source Deletion / Replacement / Revocation (`FR-SI-05`, `C-02`, `NFR-SEC-02`)**:
  - Jobs capture `(source_id, revision)` at submission and re-verify before reading and transactionally at `Completed` publication; deleted, replaced, or revoked sources fail the job (`SourceChanged` / `Unauthorized`) without publishing stale output, redact historical payloads (`unavailable`), and block `/export` (`409 SourceSnapshotInvalid` / `403 InvalidScope`).
- **Pre-Publication Citation & SVG Validation Failure (`D13`, `D9`, `NFR-EVAL-02`)**:
  - Out-of-snapshot `chunk_id`, missing snippet, or unsafe SVG (`<script>`, `on*`, `<foreignObject>`, external URLs) fails the job immediately (`CitationValidationFailed`) with zero published artifacts and no partial exports.
- **Unauthorized Cross-Notebook Access (`FR-WM-04`, `NFR-SEC-02`)**:
  - Non-owners receive `403` / `404` on creation, listing, reading, cancelling, retrying, deleting, and exporting endpoints.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`FR-ST-16`, `C-03`)**: *(Event-driven)* When an authorized user triggers `"Slide Deck"` (`plugin_type: "slide_deck"`, `subtype: "default"`) with non-empty `active_source_ids`, optional `slide_count` (`5..20`, default `10`), optional `focus_prompt` ($0\text{–}2,000$ trimmed Unicode code points), and optional `output_language` (`FR-UI-02`), the system MUST run a deterministic `C-03` pipeline over all original `C-02` scoped chunks (`D12`) and persist a citation-validated deck (`slides`, `target_count`, `insufficient_evidence_note`, `citations`, `coverage`) across the 5 layout templates (`title`, `two_column`, `key_metric_callout`, `comparison_table`, `diagram_chart`).
- **FR-002 (`FR-ST-16`)**: *(Ubiquitous)* Each slide MUST contain `slide_number` (`1..N`), `layout`, non-HTML `title`, `1..5` bullets each `<= 15` words (with overflow detail pushed to `speaker_notes`), a typed `visual_spec` intermediate representation suitable for `v5.0` `FR-ST-05`, non-empty `speaker_notes`, `source_chunk_ids`, and `citations` (`[n]`).
- **FR-003 (`FR-ST-16`, `D8`/`DEV-02`, `Gate v4.0 #3`)**: *(Event-driven)* The Slide Deck Viewer MUST present a 16:9 slide carousel with slide thumbnails, Prev/Next navigation, slide counter (`"Slide k of N"`), toggleable `"Speaker Notes"` drawer, clickable citation badges `[n]`, `"Export PPTX"`, and `"Export PDF"`. Exporting `"pptx"` MUST return a valid OOXML PresentationML ZIP archive containing editable text boxes and linked `notesSlide` speaker notes (safe for OOXML sanitization and headless LibreOffice conversion); exporting `"pdf"` MUST return a valid 16:9 multi-page `.pdf` matching the deck slide count. Google Slides export MUST remain omitted (`D8` / `DEV-02`).
- **FR-004 (`FR-ST-17`, `D9`, `C-03`)**: *(Event-driven)* When an authorized user triggers `"Infographic"` (`plugin_type: "infographic"`, `subtype: "default"`) with non-empty `active_source_ids`, optional `style` (`auto` | `process_flow` | `comparison` | `metrics_summary` | `architecture_diagram`, default `auto`), optional `focus_prompt` ($0\text{–}1,000$ trimmed Unicode code points), and optional `output_language`, the system MUST synthesize `structured_blocks` strictly from $S_{\text{aktiv}}$ and render a deterministic crisp vector SVG (`rendered_svg`) with dynamic line wrapping, dynamic box-height adjustment (zero text-clipping/overlap), `"AI-generated · Illustration"` label, and cited sources footer `[n]`.
- **FR-005 (`FR-ST-17`, `D9`)**: *(Event-driven)* The Infographic Viewer MUST display an interactive zoomable SVG canvas (with safe DOM rendering, zoom in/out/reset controls, and clickable source citations) plus `"Export SVG"` and `"Export PNG"` buttons that download lossless `.svg` and `2x` `.png` files cleanly.
- **FR-006 (`FR-ST-16`, `FR-ST-17`, `C-03`)**: *(Unwanted)* If a `slide_deck` or `infographic` job enters `Failed` or `Cancelled`, then the system MUST present an error message and a `"Retry"` action (using explicit `active_source_ids`) and MUST NOT expose partial `.pptx`, `.pdf`, `.svg`, or `.png` export actions or accept `/export` requests (`409 Conflict`).
- **FR-007 (`C-02`, `C-03`, `FR-SI-05`, `NFR-SEC-01`, `NFR-SEC-02`, `NFR-EVAL-02`, `NFR-EVAL-04`)**: *(Ubiquitous)* Both plugins (`slide_deck`, `infographic`) MUST reuse the durable `studio_artifacts` outbox/lease/publication-fence lifecycle (supporting cancellation, retry, and startup sweep exclusion), validate all citation IDs and snippets against scoped `C-01` chunks before `Completed` publication (`NFR-EVAL-02 = 1.0`), enforce zero deselected/revoked source leakage (`NFR-EVAL-04 = 0`), enforce server-side Owner authorization, and route model calls exclusively through EU enterprise endpoints (`europe-west4` / `eu`, `NFR-SEC-01`).

### Key Entities

- **SlideDeck & SlideItem (`FR-ST-16`, `C-03`)**: `StudioArtifact` (`plugin_type: "slide_deck"`, `subtype: "default"`) storing `slides: SlideItem[]` (`1..20`), `target_count` (`5..20`), `insufficient_evidence_note`, `citations`, and optional `coverage`. Each slide carries `slide_number`, `layout` (`title` | `two_column` | `key_metric_callout` | `comparison_table` | `diagram_chart`), `title`, `bullets` (`1..5`, `<= 15` words each), `visual_spec`, `speaker_notes`, `source_chunk_ids`, and `citations`.
- **Infographic & InfographicBlock (`FR-ST-17`, `D9`, `C-03`)**: `StudioArtifact` (`plugin_type: "infographic"`, `subtype: "default"`) storing `style` (`process_flow` | `comparison` | `metrics_summary` | `architecture_diagram`), `title`, `subtitle`, `structured_blocks` (`>= 1` `InfographicBlock`), sanitized `rendered_svg`, `source_chunk_ids`, `citations`, and optional `coverage`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`FR-ST-16`, `Gate v4.0 #3`)**: `100%` of exported `.pptx` files pass structural OOXML ZIP + XML + notes validation (and OOXML sanitization for headless LibreOffice conversion) and `100%` of exported `.pdf` files pass `pdfjs-dist` structural parsing with exact slide page count (`N` pages for `N` slides); `10`-slide deck generation satisfies `<= 25.0 s` P95 (`D24` / `DEV-07`).
- **SC-002 (`FR-ST-17`, `D9`)**: `100%` of generated infographics emit valid sanitized deterministic SVG with zero text-clipping/overlap across all 4 resolved styles (`process_flow`, `comparison`, `metrics_summary`, `architecture_diagram`) and export clean `.svg` and `2x` `.png` files; infographic generation satisfies `<= 20.0 s` P95 (`D24` / `DEV-07`).
- **SC-003 (`NFR-EVAL-01`..`04`, `Gate v4.0`)**: Deterministic eval suites verify `NFR-EVAL-02` citation ID validity = `1.0` and `NFR-EVAL-04` deselected-source leakage = `0` across both `slide_deck` and `infographic`; LLM-judged thresholds (`NFR-EVAL-01 < 10%`, `NFR-EVAL-03 >= 90%`) conform to `D24` / `DEV-07`.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: Strictly `Owner`-only authorization in `v4.0`; `StudioPluginRegistry` (`C-03`), PostgreSQL `studio_artifacts` outbox/leases, `C-02` `ScopedContextProvider`, and `everlast-render` private GCS namespaces remain the sole orchestration and rendering paths (`D4`, `D12`, `D16`).
- **Out of Scope / Deferred**: Google Slides OAuth export (`D8` / `DEV-02`); narrated slideshow video muxing (`v5.0` `FR-ST-05` builds on `visual_spec` + `speaker_notes`); freehand vector illustration editing (`FR-ST-17`); `@Notebook` (`D5` / `DEV-03`); `v6.0` sharing/RBAC (`D10`).

## Architecture Impact (mandatory; CC-09)

- **Affected invariants / SRS IDs**: `C-01` (`UnifiedDocumentChunk`, unchanged), `C-02` (`ScopedContextProvider` snapshot reads), `C-03` (`StudioGeneratorPlugin` registry, durable outbox/lease/publication fences), `FR-ST-16`, `FR-ST-17`, `Gate v4.0 #3`, `NFR-SEC-01/02`, `NFR-EVAL-02/04`, `D8`/`DEV-02`, `D9`, `D12`, `D13`, `D16`, `D21`, `D23`.
- **Review relevance**: `R1` (worker plugins registered through existing `@everlast/worker/studio/registry` without adding new cross-app `@everlast/worker/*` imports in `apps/api/`), `R2` (transport handlers in `apps/api/src/routes/studio.ts` map HTTP responses only; `StudioService`, `slide-export.ts`, and `infographic-export.ts` own export orchestration and binary/scene serialization inside `apps/api`; `apps/web/src/studio/*` stays browser-safe with type-only contract imports), and `R3` (clean dependency boundaries verified via `pnpm check:architecture` without modifying `scripts/architecture-policy.json`).
- **Unresolved ownership questions**: None. Module ownership, public exports, composition roots, and legacy exception preservation are specified in `plan.md`.
