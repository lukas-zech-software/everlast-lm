# Research: Studio Text Synthesis & Reports

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **SRS IDs**: FR-ST-10, FR-ST-11, C-02, C-03, NFR-EVAL-02, NFR-EVAL-04

No `NEEDS CLARIFICATION` remains (the Source Guide pending/failed question is resolved in the spec). Decisions below are plan-level refinements, flowed back into [spec.md](spec.md) §Plan Refinements.

## R1 — C-03 plugin shape (C-03, architecture §4.4 Studio control flow)

- **Decision**: `StudioGeneratorPlugin` has `manifest` (`plugin_type`, `display_name`, `subtypes`), `triggerJob(request)` (synchronous validation of subtype/params returning a `StudioJobPlan { title, params_json }`) and `generate(ctx)` (async, receives scoped chunks, snapshot, `AbortSignal`, progress callback; returns `completed` payload or `refused`). The shared `StudioJobRunner` owns lifecycle, persistence, access re-checks and citation validation, so no plugin can skip them. `StudioPluginRegistry` rejects duplicate `plugin_type` and unknown lookups.
- **Rationale**: The architecture names `registry.get(plugin).triggerJob(scopedContext, params)`; splitting validation from generation lets the API reject bad requests with 4xx before creating a row while the worker does the long work. Open-closed: adding plugins registers new objects only.
- **Rejected**: Plugins creating their own artifact rows (lifecycle drift, bypassed validation); an ADK agent per report (violates Constitution IV).

## R2 — Bounded map-reduce over all scoped chunks (D12, FR-ST-10)

- **Decision**: `batchChunks` splits the ordered scoped chunks into batches bounded by `maxTokensPerBatch` (default 8,000) and `maxChunksPerBatch` (default 40); every chunk lands in exactly one batch (an oversized chunk forms its own batch). Map: one model `extract` call per batch returns chunk-anchored findings. Reduce: one `compose` call over the merged findings. Source Guides are never used as evidence.
- **Rationale**: Satisfies "all original scoped chunks in bounded batches"; no summary-only reduction. A single batch is the common small-notebook case.
- **Rejected**: Truncating context; summary-of-summaries.

## R3 — Validation before publication (D13, NFR-EVAL-02/04, FR-014/015)

- **Decision**: After composition the pipeline checks required blocks per template, then the runner validates citations: every `chunk_id` must be in the scoped chunk set and match the snapshot revision; every verbatim quote must be a substring of a cited chunk; every timeline date string must occur in a cited chunk; the final Markdown must carry ≥ 1 citation. Any violation → `Failed` with `CitationValidationFailed` and a refusal message; nothing is stripped, nothing retried.
- **Insufficient evidence**: each template has *core* blocks (briefing: executive summary; study guide: topic review; FAQ: ≥ 1 Q&A; timeline: events or cast). A core block with zero supported items → `Failed` / `InsufficientEvidence`. Non-core blocks with zero items render with an explanatory note ("fewer items with an explanation"). Timeline without dates renders the no-explicit-dates statement plus the Cast of Characters.
- **Rejected**: Silent removal of unsupported citations; padding to reach a target count.

## R4 — Lifecycle and retry (C-03, FR-013)

- **Decision**: Legal transitions: `Queued→Running|Cancelled`, `Running→Completed|Failed|Cancelled`; terminal states are immutable. Retry (`POST …/retry`) is allowed only for `Failed`/`Cancelled`, requires a **fresh explicit** `active_source_ids` in the body, creates a **new artifact row** (`attempt = previous + 1`, `retry_of = previous id`) with fresh authorization and a new snapshot; the old row is untouched. Cancellation is cooperative: the runner aborts via `AbortSignal` and refuses to publish if the row is no longer `Running`.
- **Failure codes**: `SourceChanged`, `Unauthorized`, `CitationValidationFailed`, `InsufficientEvidence`, `GenerationError`.

## R5 — Dynamic suggestions (FR-ST-11, FR-SI-02)

- **Decision**: `ReportSuggestionService` reads Source Guide states through `SourceGuideProvider` for the explicit snapshot. Any `Pending` → `SuggestionsLoading` (not cached); any `Failed` → `SuggestionsUnavailable` with an explanation; all `Ready` → model `suggest` returns 3–4 `{title, description, prompt_template}` (validated; otherwise Unavailable). A 3,000 ms timeout bounds the call. Cache key = `computeContextCacheKey({notebook_id, source_revisions, subject, language, generation_parameters:{kind:'report_suggestions'}})`, so scope, revision, authorization and language changes miss the cache. Standard and custom report creation never depend on suggestions.

## R6 — Injectable model client (Constitution IV/VI, Model efficiency)

- **Decision**: `ReportModelClient { extract, compose, suggest }` with structured (Zod-validated) inputs/outputs. `DeterministicReportModel` is a rule-based fake (sentence classification: dated events, capitalised actors, "X is/means Y" definitions) used by tests and local runs. The production Gemini Flash (reports) / Flash-Lite (suggestions) adapter is created by the composition root against the enterprise endpoint; it is not in this slice and no consumer API key path exists.
- **Consequence**: LLM-judged faithfulness (`NFR-EVAL-01/03`) is `UNAVAILABLE` here and stays a Gate v2.0 prerequisite.

## R7 — Deletion hygiene (Constitution III, FR-013)

- **Decision**: `GET artifact` re-verifies the snapshot through the access verifier; if any captured source is deleted/replaced/unauthorized, the response replaces `payload_json` with `{ unavailable: true, reason }` and copy/convert are rejected. Completed artifacts stay viewable when sources are merely deselected.
