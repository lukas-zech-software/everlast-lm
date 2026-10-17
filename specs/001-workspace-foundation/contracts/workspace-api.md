# Workspace API and Admission Contract

Design owner: package 1.1. Trace: FR-WM-01/04/07, C-02. Runtime definitions belong once in `packages/contracts/src/workspace.ts` and `source-admission.ts`; this document is not a competing executable schema. All requests use HTTPS and a verified Identity Platform bearer ID token. Ownership is derived server-side. v1 does not accept an Editor/Viewer role or a client-supplied owner identity.

## Common DTOs and Errors

- `Notebook`: `{id, title, created_at, updated_at}`; ID UUID v4; timestamps UTC RFC3339; normalized title 1–100 Unicode code points. Owner identity stays server-side.
- `QuotaSummary`: `{notebooks_used, notebook_limit:100, sources_used, source_limit, max_source_bytes:200000000, max_source_words:500000}`; `sources_used` counts Uploading/Processing/Ready, `source_limit` integer 50–300.
- Error body: `{error:{code,message}, request_id}`. Codes are stable; no raw exception, database details or source content is disclosed. Client uses code to select localized messages.
- `401 Unauthenticated`: missing, invalid or expired token. `403 Forbidden`: existing notebook not owned by caller. `404 NotebookNotFound`: absent/deleted notebook; UI shows “Notebook no longer exists” and redirects home. All child-content endpoints also return 404 after deletion.
- `422 InvalidTitle`: empty/whitespace-only or >100 code points; retains last saved title. `409 NotebookQuotaExceeded` / `SourceQuotaExceeded`: capacity exhausted. `503 RetryableFailure`: transient failure, not implicit successful mutation. Status code choices not fixed by the cards are design conventions implementing their error states.

## Endpoints (FR-WM-01/04/07)

| Method / path | Request | Success | Contract |
| :--- | :--- | :--- | :--- |
| GET `/api/notebooks` | No owner query parameter | 200 `{notebooks: Notebook[], notebooks_used, notebook_limit:100}` | Own live notebooks only; no sorting/pinning feature added. |
| POST `/api/notebooks` | `{}`; client-generated `Idempotency-Key` UUID reused only for network retry of the same create action | 201 `{notebook:Notebook}` | Atomically enforce <=100, default title, create exactly once per request key. UI navigates to `/notebook/{id}` and opens Add sources. |
| GET `/api/notebooks/{id}` | UUID path | 200 `{notebook:Notebook, quota:QuotaSummary}` | Verify owner; opening never creates a duplicate notebook. |
| PATCH `/api/notebooks/{id}` | `{title:string}` | 200 `{notebook:Notebook}` | Outer trim, count Unicode code points, validate before persist. Unknown mutation fields rejected. Saving on Enter or blur uses same contract; UI reverts on error. |
| DELETE `/api/notebooks/{id}` | No body; UI confirmation is required before sending | 204 when purge verified; otherwise 202 `{deletion_id,status:"Pending"}` | Commit logical deletion/fence and DB cascade first; known object cleanup is tracked separately. UI removes card and returns home once accepted. Repeating against the deleted ID returns 404; a known deletion ID permits status polling. |
| GET `/api/notebook-deletions/{deletion_id}` | UUID path | 200 `{deletion_id,status,last_error_code?}` | Original owner only. Status Pending/Running/Purged; an error remains nonterminal pending retry. Never return original content/object names. |
| GET `/api/notebooks/{id}/quota` | UUID path | 200 `QuotaSummary` | Same owner authorization and atomic occupancy definition as admission; UI shows source counter in sidebar and Add sources modal. |

A cancelled delete confirmation sends no request. UI can continue showing cleanup status without exposing a recover/undo feature. Native browser navigation needs a SPA fallback for `/notebook/{id}` while `/api/*` keeps JSON errors. The root shell does not implement package 1.4 responsive layout.

## Internal Admission Interface (FR-WM-07, FR-SI-01)

These functions are service interfaces, not public upload endpoints. Package 1.2 owns upload request parsing and signed upload issuance; callers cannot bypass the following shared authority checks.

| Operation | Input | Result / invariant |
| :--- | :--- | :--- |
| `reserveSources` | Verified principal, notebook ID, ordered entries `{attempt_id,source_id,declared_bytes}` | Per-entry admitted or rejected result. In one notebook-locked transaction, first entries fitting remaining capacity get Uploading records; replays of an attempt return its existing result. |
| `acceptReceivedSource` | Trusted worker identity, source/attempt ID, actual bytes and object generation | Reverify notebook/source and immutable attempt; actual oversize fails and queues object purge. Accepted input moves Uploading→Processing with no extra slot. |
| `publishReadySource` | Trusted worker identity, source/attempt/revision, byte and word counts, staged C-01 references | Recheck limits and ownership/revision fence; commit chunks and Ready state atomically. Implementation belongs to 1.2 and imports the quota/state validators. |
| `failSource` | Trusted attempt ID and stable failure code | Conditional Uploading/Processing→Failed transition; releases slot exactly once, removes partial content, retains error row. No arbitrary client-provided word count is trusted. |
| `dismissSourceError` | Verified owner, notebook and failed record ID | Deletes only the error row; does not decrement occupancy. |

Reject >200,000,000 declared bytes before issuing upload capability and within 200 ms on the declared benchmark environment. Actual object size is independently checked before parsing. >500,000 extracted words yields “Exceeds 500,000 words limit”. Quota failures identify the exceeded limit. A failed request never returns a usable source or upload capability.

The API layer must keep byte/word validation independent: e.g. a 40 MB TXT with 520,000 extracted words fails despite its valid byte size. All admission paths, including later note conversion/research, use this service; no new v1 endpoints for later features are implied.

## Idempotency and Race Guarantees (FR-WM-01/04/07)

A request key is scoped to verified owner and operation; it cannot disclose another user's result. Retry metadata must not recreate a deleted notebook or disclose its old title. Parent absence/deletion fence takes precedence over replay. Concurrent updates are serialized; absent a specified conflict UI, the final committed valid title is authoritative. UI failure recovery refetches authoritative state if persistence outcome is unknown.

Notebook deletion vs source finalization is serialized on the parent; deletion-first means finalization fails and purges staged output. Finalization-first means the new child joins the subsequent cascade. All error/status paths are covered by contract tests before implementation.
