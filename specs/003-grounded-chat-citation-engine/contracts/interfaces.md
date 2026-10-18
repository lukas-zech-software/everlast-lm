# Interface Contracts: Grounded Chat & Citation Engine

Trace: FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06, C-01, C-02. Import the [single shared baseline](../../001-workspace-foundation/contracts/shared-context.md) and [admission contract](../../001-workspace-foundation/contracts/workspace-api.md).

### Chat API (FR-GC-01/02/03/06)

- POST `/api/notebooks/{id}/chat/turns`: `{message,active_source_ids,request_id}`; 1–10000 Unicode code points after outer trim and explicit nonempty Ready scope. Server captures complete source/revision provenance. Request replay never creates duplicate messages or revives a cleared turn.
- Progress stream emits only request/status/error events while the complete factual draft is buffered. Final event is a validated answer with citations or refusal. No raw model tokens cross the transport before verification; cancellation is keyed to request and thread epoch.
- GET `/api/notebooks/{id}/chat`: current owner's single ordered thread; source authorization masks unavailable historical generated content. Merely deselected content remains visible.
- DELETE `/api/notebooks/{id}/chat`: confirmed clear, increment epoch/cancel active request/delete messages atomically. Sources and notes untouched. Late worker completion with old epoch cannot publish or persist.
- GET `/api/notebooks/{id}/chat/search?q=...`: same thread only; no match returns empty results and UI “No messages found”; click identifies exact message without rewriting conversation. Search projection honors current source authorization.
- Citation preview and click use already-persisted badge mapping plus current authorization; preview is full verbatim chunk in scrollable popover. Deleted source returns “Source deleted”, no cached content and no click-through. Inspector uses 1.2 authorized singleton route; never mutates current generation scope.
- 401 invalid identity, 403 ownership/InvalidScopeError, 404 missing notebook/thread, 400 empty scope, 422 invalid message, 409 invalidated revision/epoch; model timeout/rate-limit produces the specified retry message without corrupted assistant persistence.

### Model and publication pipeline

Use architecture-selected ADK/Google SDK enterprise transport and smallest approved Flash model passing evals. Call C-02 before model reasoning with request-bound query/identity and exact snapshot. History requires complete active/current/authorized provenance for both prompt and response; any missing or excluded source removes both turn halves and derived tool/summary context. No web search or v2 persona/overview/chips/actions.

Request structured sentences with supporting chunk IDs. Parse all output before publication; require citations on each factual/synthesized claim, resolve exclusively against retrieved chunks, reject fabricated IDs or missing factual citations with immediate refusal and no regeneration. Meta/refusal text alone needs no citation. Semantic entailment is independently checked by judged evaluation, never treated as proved by UUID existence. Recheck ownership/revisions/thread epoch immediately before atomic persistence/publication; no locks held during model call. Number badges deterministically 1..K by first chunk appearance; 8 supports render first3 +5 with expansion.

Cache identity, if caching is introduced, includes notebook/exact revisions/effective authorization/language/parameters; no cache is required for MVP. Hover/focus <=300ms; flip placement inside viewport. Source changes during request fail; checkbox-only changes affect next turn. Standard validated-answer TTFT <=2.5s is non-gating in v1, not a reason to stream unverified text.

## Universal failure rules

Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.
