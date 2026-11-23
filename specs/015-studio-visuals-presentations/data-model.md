# Data Model: Studio Visuals & Presentations (Package 4.2)

**Feature**: `specs/015-studio-visuals-presentations`
**Contracts**: `packages/contracts/src/package-v4-2.ts`, `package-v3-3.ts`, `package-v2-4.ts`
**Migration**: `packages/db/migrations/0014_studio_visuals_presentations.sql`
**SRS IDs**: `FR-ST-16`, `FR-ST-17`, `C-01..C-03`, `D8`/`DEV-02`, `D9`

## 1. PostgreSQL Schema Extensions (`0014_studio_visuals_presentations.sql`)

### 1.1 `studio_artifacts` Widened Constraints

- Preserves migrations `0008_studio_artifacts.sql`, `0011_studio_structure.sql`, and `0013_studio_active_learning.sql` unchanged.
- Widens `studio_artifacts_plugin_type_check` to `('report', 'mindmap', 'data_table', 'flashcards', 'quiz', 'learning_overview', 'slide_deck', 'infographic')`.
- Widens `studio_artifacts_kind_subtype_check` so `'slide_deck'` and `'infographic'` require `subtype = 'default'`.
- Reuses existing `version`, `lease_token`, `lease_expires_at`, `source_revisions_snapshot`, `jobs` outbox (`kind = 'studio'`), and `sweepInterruptedStudioArtifacts` (`WHERE plugin_type = 'report'`).

## 2. Canonical JSON Payload Schemas (`@everlast/contracts`)

### 2.1 `SlideItem` & `StudioSlideDeckPayload` (`FR-ST-16`)

- `SlideLayoutType`: `"title" | "two_column" | "key_metric_callout" | "comparison_table" | "diagram_chart"`
- `SlideVisualSpec` (v5.0 `FR-ST-05` intermediate representation):
  - `layout`: `SlideLayoutType`
  - `subtitle`: `string` (optional)
  - `callout`: `{ value: string; label: string; context?: string }` (optional, used for `key_metric_callout`)
  - `columns`: `{ left_heading: string; left_points: string[]; right_heading: string; right_points: string[] }` (optional, used for `two_column`)
  - `table`: `{ headers: string[]; rows: string[][] }` (optional, used for `comparison_table`)
  - `diagram_steps`: `string[]` (optional, used for `diagram_chart`)
- `SlideItem`:
  - `slide_number`: positive integer (`1..N`, contiguous `1..slides.length`)
  - `layout`: `SlideLayoutType`
  - `title`: non-empty plain text (no HTML markup)
  - `bullets`: `string[]` (`1..5` items, each non-empty plain text with `<= 15` words)
  - `visual_spec`: `SlideVisualSpec`
  - `speaker_notes`: non-empty plain text (`>= 1` char)
  - `source_chunk_ids`: `UUIDv7[]` (non-empty)
  - `citations`: `StudioEvidenceRef[]` (non-empty; every `chunk_id` in `source_chunk_ids` and present in `payload.citations`)
- `StudioSlideDeckPayload`:
  - `slides`: `SlideItem[]` (`1..20`)
  - `target_count`: integer `5..20` (default `10`)
  - `insufficient_evidence_note`: `string | null` (mandatory non-empty when `slides.length < target_count`)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
  - `coverage`: `StudioCoverageManifest` (optional)

### 2.2 `InfographicBlock` & `StudioInfographicPayload` (`FR-ST-17`, `D9`)

- `InfographicStyle`: `"auto" | "process_flow" | "comparison" | "metrics_summary" | "architecture_diagram"`
- `InfographicResolvedStyle`: `"process_flow" | "comparison" | "metrics_summary" | "architecture_diagram"`
- `InfographicBlock`:
  - `id`: `STUDIO_NODE_ID_PATTERN` identifier
  - `heading`: non-empty plain text (no HTML markup)
  - `body`: non-empty plain text (no HTML markup)
  - `metric_value`: optional plain text (metrics_summary highlight)
  - `metric_label`: optional plain text
  - `category`: optional plain text (used for comparison / architecture grouping)
  - `badge_numbers`: `number[]` (positive integers, min `1`)
- `StudioInfographicPayload`:
  - `style`: `InfographicResolvedStyle`
  - `title`: non-empty plain text (no HTML markup)
  - `subtitle`: optional plain text
  - `structured_blocks`: `InfographicBlock[]` (`1..12`)
  - `rendered_svg`: sanitized deterministic SVG (`validateSafeDeterministicSvg` passes: positive `viewBox`, `"AI-generated"` badge, zero `<script>`, `on*`, `<foreignObject>`, or external URLs)
  - `source_chunk_ids`: `UUIDv7[]` (non-empty)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
  - `coverage`: `StudioCoverageManifest` (optional)

### 2.3 Export DTOs (`FR-ST-16`, `FR-ST-17`)

- `SlideDeckExportRequest`: `{ format: "pptx" | "pdf" }`
- `InfographicExportRequest`: `{ format: "svg" | "png" }`
- `StudioInfographicExportScene`: `{ format: "svg" | "png", svg: string, width: number > 0, height: number > 0, scale: 1 | 2, filename: string }`
