# Shared C-01/C-02 Contract Baseline

Scope: C-01, C-02, FR-WM-04, FR-SI-03/04, FR-GC-01/02/06, NFR-EVAL-04. Defined once in `packages/contracts`; package 1.1 owns initial schema/guard design. Package 1.2 owns ingestion/content adapter implementation; package 1.3 owns query/history/citation consumers. See [plan ownership](../plan.md#project-structure).

## C-01: UnifiedDocumentChunk

The content object has exactly the SRS projection below. Database-only notebook identity, source revision, vector, sequence and full-text fields remain outside it.

| Field | Type / validation | Provenance |
| :--- | :--- | :--- |
| `source_id` | UUID, parent source exists in the authorized notebook | C-01, FR-WM-04 |
| `chunk_id` | UUID v7 per accepted architecture; globally unique, immutable for this revision | C-01 |
| `text` | Nonempty normalized passage text | C-01 |
| `token_count` | Nonnegative integer measured by the ingestion tokenizer | C-01 |
| `locator` | Discriminated `page_span`, `time_span`, or `dom_path` | SRS §5.1 C-01 |

Locator representation to lock in shared schema tests before consumers:

- `page_span`: `{type:"page_span", page?:positive integer, start:number, end:number}`. Physical pages use 1-based numbering. Offsets are nonnegative Unicode-code-point indexes in the canonical extracted page text when page is present, otherwise in the canonical whole text source; `[start,end)` with end > start. Offsets reference the persisted canonical text, never raw PDF binary bytes or rendered HTML. v1 normalizes PDF chunks to a single page; text-only chunks omit page. Paragraph/section boundaries and order are retained by canonical text/offset metadata outside C-01. This is a design encoding of the required page/text offsets, not a new locator variant.
- `time_span`: `{type:"time_span", start_seconds:number, end_seconds:number}` with finite nonnegative start and end > start. Reserved in the schema for v3; no player/parser is built in v1.
- `dom_path`: `{type:"dom_path", path:string, start:number, end:number}` with a nonempty canonical document node path and nonnegative code-point interval. Reserved for web adapters in v3. Persisted document snapshot, not a mutable live site, is the reference.

No `char_span` or `slide_number` variant. Normalized slide content later uses page_span. A locator is required even for small fragments. The architecture's 300–600-token chunk target is a chunker policy, not a C-01 validation bound; boundary fragments may be smaller and oversized sections split. These fields are design choices within the existing locator union; all later package plans must consume this one definition rather than invent competing shapes.

## C-02: Public Signature and Bound Request Context

Public method remains `getScopedContext(notebook_id, active_source_ids)` and returns an array of C-01 objects. Do not add an alternative third principal/query argument. Construct a request-bound provider with verified principal, read purpose (`generation` or `inspection`), optional query, and a server-captured source/revision snapshot. Provenance is retained in this bound context and the consumer's result envelope, not hidden inside C-01.

Request capture validates explicit nonempty IDs against current owner, notebook, Ready state and authorization. No defaulting to all Ready sources. A malformed or omitted array is rejected. Duplicate IDs normalize to a set before snapshot/cache identity. An unknown/not-owned source fails the whole request; do not silently filter unauthorized IDs and answer from the remaining ones. Cross-notebook source IDs yield 403 / InvalidScopeError and zero chunks.

For queued work, persist exact `(source_id,revision)` pairs with the principal's verified identity reference and read purpose; never persist a client role as trusted authorization. Workers authenticate as services but recheck the initiating user's resource rights. For an already captured request, source deletion/replacement/revocation yields `SourceSnapshotInvalid`, not a recapture of newer content. Empty scope yields `EmptyScopeError`; non-Ready selection yields `SourceNotReady`.

## Read and Publication Protocol

1. Capture validates access and records the immutable requested Ready revisions at submission.
2. Before read, recheck access/current revisions; filter relational, full-text and vector paths on notebook, explicit source IDs and captured revisions. Every returned C-01 object must pass membership/schema checks. One valid subset cannot rescue an invalid source set.
3. For generation, retrieval ranking belongs to 1.2's C-02 implementation using D1; query is request-bound. Never bypass C-02 for an agent-side read. For inspection, use an explicitly authorized singleton scope and ordered full source passage access, not top-k retrieval; it leaves chat selection unchanged. Pagination stays within the same captured revision.
4. Before publication, recheck exact revisions and current authorization under the same short serialization fence used by mutations. Never hold database locks during model calls. A changed/deleted snapshot fails; no stale result or newer substitution is published. Buffered answer validation is separately enforced in 1.3 per D13.
5. The verified retrieved chunk set is the only allowed citation-ID universe. A valid source ID alone does not validate a citation to a chunk not retrieved for this answer (FR-GC-02). No invalid draft, stripped-citation answer, or implicit retry.

## Context Reuse and Visibility

- Cache identity includes notebook, sorted exact source/revision set, effective authorization, language and generation parameters. Missing provenance means no reuse.
- A prior turn's complete used provenance must be eligible; if not, exclude both question and answer plus summaries/tool output. Displayed citations alone are insufficient.
- Mere deselection can leave an authorized historical answer/inspector view readable but never injects it into a new prompt or restores old selection.
- Deletion/revocation invalidates historical generated content, snippets, exports and signed access when those features exist; a placeholder can remain. Do not return stale copied snippets from ChatMessage JSON after source access fails.
- Follow-up/drilldown interactions in later packages use the current selection and prompt for missing sources; no source scope mutation as a side effect of viewing (FR-GC-01/03/06, NFR-EVAL-04).

## Contract Acceptance Before Implementation

- Schema fixtures validate each locator variant and reject missing/unknown fields, invalid IDs, inverted offsets and nonfinite bounds; fixture placeholders such as chk_10 map to valid UUIDs.
- Two owners/two notebooks: same-owner cross-notebook source, another owner's source and missing ownership all yield zero content.
- Empty/omitted/non-Ready scopes reject; no “all sources” fallback. Checkbox changes after submission preserve the original snapshot; a replaced revision fails.
- Race fixtures place deletion/revocation between capture/read/publication. A snapshot cannot be used after its fence is invalidated.
- Singleton inspector reads do not change browser selection; generation cannot reuse inspector-only context.
- Consumer fixtures demonstrate uncited source provenance exclusion and cache-key separation. Full model/citation UI assertions remain package 1.3/1.4 integration gates, not completed foundation tests.
