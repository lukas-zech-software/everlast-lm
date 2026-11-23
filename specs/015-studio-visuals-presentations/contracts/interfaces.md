# API & Plugin Contracts: Studio Visuals & Presentations (Package 4.2)

**Feature**: `specs/015-studio-visuals-presentations`
**SRS IDs**: `FR-ST-16`, `FR-ST-17`, `C-02`, `C-03`, `FR-SI-03`, `FR-UI-02`, `D8`/`DEV-02`, `D9`, `NFR-SEC-02`, `NFR-EVAL-04`, `Gate v4.0 #3`

## 1. Studio Job Creation (`POST /api/notebooks/:notebookId/studio/artifacts`)

- **Slide Deck (`FR-ST-16`)**:
  ```json
  {
    "plugin_type": "slide_deck",
    "subtype": "default",
    "active_source_ids": ["<uuid>"],
    "slide_count": 10,
    "focus_prompt": "optional 0..2000 Unicode code points",
    "output_language": "optional BCP-47"
  }
  ```
- **Infographic (`FR-ST-17`)**:
  ```json
  {
    "plugin_type": "infographic",
    "subtype": "default",
    "active_source_ids": ["<uuid>"],
    "style": "auto | process_flow | comparison | metrics_summary | architecture_diagram",
    "focus_prompt": "optional 0..1000 Unicode code points",
    "output_language": "optional BCP-47"
  }
  ```
- **Errors**: `400 EmptyScopeError` (empty `active_source_ids`), `400 UnsupportedOutputLanguage` (unsupported locale), `422 ValidationError` (over-limit `focus_prompt`, out-of-range `slide_count`, invalid `style`, incompatible params across plugins), `403`/`404` (non-owner / missing notebook).

## 2. Slide Deck Export (`POST /api/notebooks/:notebookId/studio/artifacts/:id/export`)

- **Request**: `{ "format": "pptx" | "pdf" }`
- **Preconditions**: Caller owns notebook; artifact `plugin_type === "slide_deck"`, `status === "Completed"`, and `verifySnapshot` succeeds (`409 Conflict` if not Completed; `409 SourceSnapshotInvalid` or `403 InvalidScope` if captured sources changed/revoked).
- **Response (`200 OK`)**:
  - `format === "pptx"`: Binary OOXML PresentationML ZIP (`Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`, `Content-Disposition: attachment; filename="slide-deck-<shortId>.pptx"`, `Cache-Control: private, no-store`). Includes editable `<p:sp>` shapes and `ppt/notesSlides/notesSlide{k}.xml` speaker notes.
  - `format === "pdf"`: Binary 16:9 multi-page PDF 1.4 (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename="slide-deck-<shortId>.pdf"`, `Cache-Control: private, no-store`) with `N === payload.slides.length` landscape pages.

## 3. Infographic Export (`POST /api/notebooks/:notebookId/studio/artifacts/:id/export`)

- **Request**: `{ "format": "svg" | "png" }`
- **Preconditions**: Caller owns notebook; artifact `plugin_type === "infographic"`, `status === "Completed"`, `verifySnapshot` succeeds, and `validateSafeDeterministicSvg(payload.rendered_svg)` passes (`409` on non-Completed/changed snapshot).
- **Response (`200 OK`)**: JSON `StudioInfographicExportScene` (`Cache-Control: private, no-store`):
  ```json
  {
    "format": "svg | png",
    "svg": "<svg ...>...</svg>",
    "width": 960,
    "height": 640,
    "scale": 1,
    "filename": "infographic-<shortId>.svg"
  }
  ```
  (`scale === 2` and `.png` filename when `format === "png"`).

## 4. `everlast-render` Private Studio Namespace (`apps/render/src/main.ts`)

- Allows `notebooks/{uuid}/sources/{uuid}/...` AND `notebooks/{uuid}/studio/{uuid}/...` private GCS object prefixes for `office-to-pdf` (`.pptx` -> `.pdf` headless LibreOffice conversion), enforcing matching namespace between input and output and rejecting path traversal (`..`, `//`) or external URIs.
