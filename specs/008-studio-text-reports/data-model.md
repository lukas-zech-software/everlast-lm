# Data Model: Studio Text Synthesis & Reports

**Spec**: [spec.md](spec.md) | **SRS IDs**: FR-ST-10, FR-ST-11, C-02, C-03 | Schemas live in `packages/contracts/src/package-v2-4.ts`.

## Entities

### StudioArtifact (in-memory store of the running API, D16; FR-ST-10/11, C-03)

| Field | Type | Constraint |
| :- | :- | :- |
| `id` | UUID | primary key |
| `notebook_id` | UUID | FK `notebooks(id)` ON DELETE CASCADE |
| `owner_id` | text | server-side only; never in the DTO (Owner-only v2.0, NFR-SEC-02) |
| `plugin_type` | `'report'` | extensible by future plugins |
| `subtype` | enum | `briefing_doc`, `study_guide`, `faq`, `timeline`, `dynamic`, `custom` |
| `status` | enum | `Queued`, `Running`, `Completed`, `Failed`, `Cancelled` |
| `title` | string | non-empty |
| `params_json` | `{ custom_prompt?: string }` | `custom_prompt` required for `dynamic`/`custom`; 1–5,000 code points after trim |
| `payload_json` | `{ content_md, citations[], sections[] } \| null` | non-null **iff** `status = Completed`; `content_md` non-empty, ≥ 1 citation; `sections` = `{ key, heading }[]`, a template subtype carries every required key |
| `source_revisions_snapshot` | `{source_id, revision}[]` | ≥ 1, unique `source_id`, immutable (card name; renamed from `active_source_ids_snapshot`, T059) |
| `output_language` | string | effective output language (`FR-UI-02`), resolved server-side when the request omits it; generation and cache parameter |
| `progress` | `{ stage, percent 0–100 } \| null` | substate of `Running` |
| `failure` | `{ code, message } \| null` | non-null iff `Failed` or `Cancelled`(code `Cancelled`, reserved in C-03; v2 has no cancel action) |
| `attempt` / `retry_of` | int ≥ 1 / UUID \| null | retry creates a new row |
| `created_at` / `updated_at` | ISO timestamp | |

### ReportCitation

`{ badge_number ≥ 1, chunk_id (UUID v7, C-01), source_id, revision, snippet }`. `snippet` is a substring of the cited chunk.

### ReportSuggestion / ReportSuggestionsResult (FR-ST-11)

`{ title, description, prompt_template }` (prompt ≤ 5,000 code points). Result is a union on `state`: `SuggestionsLoading`, `SuggestionsReady` (3–4 suggestions), `SuggestionsUnavailable` (`reason`).

### SourceGuideState (consumed, FR-SI-02)

`{ source_id, revision, status: Pending|Ready|Failed, summary?, key_topics? }`. Owned by the Source Guide package; this feature reads it only through `SourceGuideProvider`.

### Report draft (internal pipeline model)

`ReportFinding { kind: fact|quote|event|actor|term, text, chunk_id, date?, name?, definition? }` → `ReportDraft { sections: { id, heading, layout: list|table, columns?, items[], note? }[] }`, `item = { text, answer?, date?, name?, term?, cells?, chunk_ids ≥ 1 }`.

## State transitions (C-03, SC-005)

```text
Queued ──► Running ──► Completed
  │           ├──────► Failed
  └───────────┴──────► Cancelled
```

Terminal states are immutable. `Running` carries `progress.stage` ∈ `reading`, `extracting`, `composing`, `validating`, `publishing`.

## Templates: required sections (FR-002..005, FR-015, card revision 2026-10-20)

Rule: **every required section non-empty, Timeline exception only.** A missing or empty required section → `Failed` / `InsufficientEvidence`. Section keys are stable; headings follow the output language.

| Subtype | Required section keys (`payload_json.sections[].key`) | Exception |
| :- | :- | :- |
| `briefing_doc` | `executive_summary`, `core_themes`, `key_takeaways`, `quotes` (verbatim, cited) | – |
| `study_guide` | `topic_review`, `short_answer_questions`, `answer_key`, `essay_questions`, `glossary` | – |
| `faq` | `faq` (≥ 1 question with its answer) | – |
| `timeline` | `events`, `cast_of_characters` | no dated events → `events` carries the no-dated-events notice; `cast_of_characters` must still be non-empty |
| `dynamic` / `custom` | `report` (≥ 1 cited item) | – |

## Validation rules

- Custom prompt: trim outer whitespace; code points via `Array.from`; reject 0 and > 5,000; never truncate (FR-010, Constitution II).
- `active_source_ids`: non-empty UUID array, unique; no server fallback (FR-012).
- Citation checks per [research.md](research.md#r3--validation-before-publication-d13-nfr-eval-0204-fr-014015).
- Cache key for suggestions: see R5; includes `output_language`.
