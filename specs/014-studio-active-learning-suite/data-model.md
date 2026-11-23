# Data Model: Studio Active Learning Suite (Package 4.1)

**Feature**: `specs/014-studio-active-learning-suite`
**Contracts**: `packages/contracts/src/package-v4-1.ts`, `package-v3-3.ts`, `package-v2-4.ts`
**Migration**: `packages/db/migrations/0013_studio_active_learning.sql`
**SRS IDs**: `FR-ST-13`, `FR-ST-14`, `FR-ST-15`, `FR-ST-12`, `C-01..C-03`, `D9`

## 1. PostgreSQL Schema Extensions (`0013_studio_active_learning.sql`)

### 1.1 `studio_artifacts` Widened Constraints

- Preserves migrations `0008_studio_artifacts.sql` and `0011_studio_structure.sql` unchanged.
- Widens `studio_artifacts_plugin_type_check` to `('report', 'mindmap', 'data_table', 'flashcards', 'quiz', 'learning_overview')`.
- Widens `studio_artifacts_kind_subtype_check` so `'flashcards'`, `'quiz'`, and `'learning_overview'` require `subtype = 'default'`.
- Reuses existing `version`, `lease_token`, `lease_expires_at`, `source_revisions_snapshot`, `jobs` outbox (`kind = 'studio'`), and `sweepInterruptedStudioArtifacts` (`WHERE plugin_type = 'report'`).

### 1.2 `learning_progress` Table (`FR-ST-15`)

```sql
CREATE TABLE IF NOT EXISTS learning_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artifact_id UUID NOT NULL REFERENCES studio_artifacts(id) ON DELETE CASCADE,
    notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    item_states_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS learning_progress_notebook_idx ON learning_progress (notebook_id, user_id);
```

## 2. Canonical JSON Payload Schemas (`@everlast/contracts`)

### 2.1 `FlashcardItem` & `StudioFlashcardsPayload` (`FR-ST-13`)

- `FlashcardItem`:
  - `id`: UUID string (unique within deck)
  - `front_text`: non-empty plain text (no HTML tags)
  - `back_text`: non-empty plain text (no HTML tags)
  - `source_chunk_ids`: `UUIDv7[]` (non-empty)
  - `citations`: `StudioEvidenceRef[]` (non-empty; every `chunk_id` matches scoped `C-01` chunks)
- `StudioFlashcardsPayload`:
  - `cards`: `FlashcardItem[]` (`1..35`)
  - `difficulty`: `"easy" | "medium" | "hard"`
  - `target_count`: `10 | 20 | 35` (`fewer -> 10`, `standard -> 20`, `more -> 35`)
  - `insufficient_evidence_note`: `string | null` (mandatory non-empty when `cards.length < target_count`)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
  - `coverage`: `StudioCoverageManifest` (optional)

### 2.2 `QuizQuestion` & `StudioQuizPayload` (`FR-ST-14`)

- `QuizQuestion`:
  - `id`: UUID string (unique within quiz)
  - `type`: `"multiple_choice" | "multiple_select" | "fill_in_the_blank" | "short_answer"`
  - `prompt`: non-empty plain text (no HTML tags)
  - `hint`: optional plain text
  - `options`: `{ id, text }[]` (`2..8` items, required for `multiple_choice` and `multiple_select`; omitted for free-text)
  - `correct_answer`: `string` (single option `id` for `multiple_choice` or expected text for free-text) OR `string[]` (unique option `id`s for `multiple_select`)
  - `rubric`: non-empty plain text grading rubric
  - `explanation`: non-empty plain text source-grounded explanation
  - `source_chunk_ids`: `UUIDv7[]` (non-empty)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
- `StudioQuizPayload`:
  - `questions`: `QuizQuestion[]` (`1..25`)
  - `target_count`: integer `5..25` (default `10`)
  - `difficulty`: `"easy" | "medium" | "hard"`
  - `insufficient_evidence_note`: `string | null` (mandatory non-empty when `questions.length < target_count`)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
  - `coverage`: `StudioCoverageManifest` (optional)

### 2.3 `LearningProgressDto` (`FR-ST-15`)

- `user_id`: UUID
- `artifact_id`: UUID
- `notebook_id`: UUID
- `item_states_json`: `Record<UUID, { status: "mastered" | "needs_review", attempts: number >= 1, last_reviewed_at: ISO8601 }>`
- `updated_at`: ISO8601

### 2.4 `LearningOverviewModule` & `StudioLearningOverviewPayload` (`FR-ST-12`, `D9`)

- `LearningOverviewModule`:
  - `id`: UUID string
  - `title`: non-empty plain text
  - `summary_md`: non-empty Markdown with `[n]` citation markers
  - `diagram_svg`: sanitized deterministic SVG (`<svg ...>...</svg>`, non-clipping wrapped boxes, `"AI-generated · Illustration"` label, no `<script>`, `on*`, `<foreignObject>`, or external URLs)
  - `flashcards`: `FlashcardItem[]` (`1..5`, target `2..3`)
  - `checkpoint_quiz`: `QuizQuestion[]` (`1..4`)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
- `StudioLearningOverviewPayload`:
  - `modules`: `LearningOverviewModule[]` (`1..6`, target `3..6`)
  - `target_section_count`: integer `3..6`
  - `insufficient_evidence_note`: `string | null` (mandatory non-empty when `modules.length < target_section_count` or `< 3`)
  - `citations`: `StudioEvidenceRef[]` (non-empty)
  - `coverage`: `StudioCoverageManifest` (optional)
