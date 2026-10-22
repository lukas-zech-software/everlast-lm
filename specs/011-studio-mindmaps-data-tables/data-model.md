# Data Model: Mindmaps and comparison tables

Scope:`FR-ST-08/09/18`,`C-01/C-02/C-03`,`NFR-SEC-02`,`NFR-EVAL-02/04`. This is a design, not executable schemas or migrations. Define each shared Zod type once in `packages/contracts` and import it everywhere.

## Shared Studio envelope (`C-03`, `FR-ST-08/18`)

Reuse artifact ID(UUID), notebook ID, owner ID, plugin_type, subtype, title, params_json, payload_json, exact source_revisions_snapshot, effective output_language, progress, failure, attempt/retry_of and timestamps. New plugin/subtype pairs are `mindmap/default` and `data_table/default`; existing report subtypes remain unchanged. Add discriminated validated payload variants without weakening report schema validation. A common generic plugin/dispatch layer delegates per-kind validation and preserves old report interfaces through compatible defaults/adapters. It must not force existing report plugins to change.

The existing `studio_artifacts` table is applied0008 and used by `PostgresStudioArtifactRepository`; DEV-04 is closed by specs/013. Preserve its IDs, insertion order, report payloads, source snapshots, attempt/retry_of, lifecycle and constraints. Add valid plugin/subtype pairs, outbox and lease/version fields in reserved `packages/db/migrations/0011_studio_structure.sql` (after predecessor reservations0009/0010); never rewrite0008 or recreate the removed draft. Drain/fence legacy inline jobs during rollout while retaining persisted Completed/Failed/Cancelled rows; no reset or invented backfill is appropriate. Existing startup interruption handling marks legacy Queued/Running reports Failed/GenerationError with explicit retry; scope that sweep to report rows before new-kind durable dispatch starts. Preserve row-locked terminal transitions against stale inline completions. No source slot is added; provenance invalidation uses existing cleanup.

`Queued→Running→Completed|Failed|Cancelled`; only Completed has a published payload. Reading/extracting/composing/validating/publishing remain Running progress. Cancellation/revision loss wins a transactionally checked publication fence, with source rows and attempt state serialized consistently against source mutation. Queued admission and identifier-only outbox commit together; claim lease/version is persisted, stale workers cannot complete, restart recovers pending/in-progress delivery for new plugin kinds (legacy reports keep interrupted-to-Failed/explicit-retry behavior), and redelivery of terminal refusal does not start model generation again. Avoid applying generic outbox automatic retry to already failed citation/generation outcomes. Queue redelivery of same attempt never publishes twice; explicit retry creates a new attempt with fresh snapshot and language/authorization resolution. Reusing previous source IDs implicitly is forbidden.

## Evidence reference (`C-01/C-02`, `FR-GC-02`, `FR-SI-05`)

A factual unit carries one or more existing UUIDv7 chunk IDs, resolved server-side to notebook, source_id, revision and unchanged C-01 locator. All IDs must belong to the captured scope and remain authorized at publication/read. Snapshot is the authoritative revision association; do not add revision/locator variants to C-01. A coverage manifest records processed original chunk IDs/batches for generation validation and regression tests; it is not model truth or an extra content-read path.

## Mindmap payload (`FR-ST-08/09`)

`root_node` recursively contains `id`(unique opaque ID), `label`(trimmed≤80 Unicode code points), `summary`(plain text), `source_chunk_ids`, and ordered `children`. Summaries and labels are factual units with references; if they use different support, store field-specific evidence in an additive provenance map rather than pretending one citation supports both. Grouping/visual structure is explicitly illustration; it cannot carry uncited factual claims. Parent relationship is derived from nesting, not a second editable edge graph.

Validation walks the entire tree with visited identities, unique IDs and recursion depth bounds: exactly one root, no cycles/orphans/duplicates, maximum5 levels/120 nodes. Target minimum2 levels/15 nodes permits fewer supported nodes only with an explicit evidence-limited explanation; no supported facts means refusal. Initial expansion depth2. Layout coordinates, expanded node set, pan/zoom and focus are browser-session viewer state and do not alter evidence or persisted payload. Export verifies visible node identities against the artifact tree and includes ancestors.

## Data table payload (`FR-ST-18`)

`columns`: ordered unique `{id,label}` entries; `rows`: ordered unique `{item_id,cells}` where exactly one cell corresponds to each column. One row per compared item. Item identity/label is source-derived and cited as a normal factual value. Candidate extraction identifies equivalent items across documents before merge; ambiguity cannot silently collapse distinct items or duplicate one to avoid conflicts.

Each cell is one of:

| Kind | Fields and invariants |
| :--- | :--- |
| supported | `values:[{value_text,chunk_ids}]` with exactly one value and≥1 validated reference; plain text, never HTML/formula. |
| conflict | `values` with≥2 distinct source-stated alternatives, each individually cited; `disagreement:true`; render all values in same cell with explicit disagreement. |
| missing | No values/references, literal `N/A (Not in sources)`; only when attribute absent from selected evidence; never substitutes a conflict. |

Target2–25 columns,1–500 rows. Evidence-limited lower counts require an explanation. Required result>500 rows or>25 columns fails with narrowing request and no payload, regardless of whether a model returned a shortened sample. Schema/focus prompt is optional0–2,000 trimmed Unicode code points; explicit suggested-schema selection resolves server-side to allowed columns and is recorded with parameters. Headers are structural unless making factual assertions; factual headers carry support too.

Sorting uses stable display-text order with item ID tie-break, leaves citation/value associations intact and is browser state. Exports preserve the selected presentation order only when validated row IDs are a full permutation; no client-created values or skipped rows. CSV/XLSX flatten conflict alternatives with their references and disagreement marker into the same field; missing marker stays literal. Formula escaping is an export transformation, not a mutation of canonical source values.

## Errors and availability (`C-03`, `FR-ST-08/09/18`)

Reuse shared failure codes: `SourceChanged`, `Unauthorized`, `CitationValidationFailed`, `InsufficientEvidence`, `GenerationError`, `Cancelled`. Map invalid graph/dimensions or oversized requested comparison to `GenerationError` with safe explanation and a package detail discriminator (`InvalidMindmap`, `InvalidTable`, `TableLimitExceeded`); preserve existing shared code values. `TableLimitExceeded` says narrow instructions and publishes no table. No silent citation retry. A Failed/Cancelled result has no usable export.

Unavailable historical artifact view contains safe ID/kind/status plus unavailable reason, no source-derived title, labels/summaries/cells, cached snippets or failure text. Deletion/revocation invalidates derived/cache/export material immediately; explicit current authorization determines all future requests. Source deselection alone does not invalidate historical viewing. New drilldown uses node and parent evidence union as the eligibility boundary, plus normal current-scope filtering of conversation history.
