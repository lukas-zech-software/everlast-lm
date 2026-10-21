# Interfaces: Multimodal Ingestion & Sync

Scope: FR-SI-01/05, C-01/C-02, FR-SI-04, NFR-SEC-02. These are package DTO/HTTP refinements around existing shared contracts; implementation defines Zod DTOs once in `packages/contracts`.

## Admission and source management (FR-SI-01/05, FR-WM-07)

Base path `/api/notebooks/{notebook_id}/sources`. Every endpoint authenticates and authorizes notebook Owner plus document access; path IDs are UUIDs. Unauthorized resource reads reveal no content.

| Operation | Input | Result / semantics |
| :--- | :--- | :--- |
| POST `/uploads`, then `/{source_id}/complete` | Existing ordered upload descriptors/attempt IDs; extend MIME admission to DOCX/PPTX/MP3/WAV/M4A | Reserve quota atomically; validate actual object generation and bytes; existing 200 `{items}` batch admission and 200 `{source}` completion envelopes retained, additive operation metadata; normal Processing→Ready/Failed events |
| POST `/imports` | `{attempt_id, kind: web\|video\|drive, url?, external_document_id?, connection_id?}`; exactly the fields appropriate to kind | 202 `{source_id, operation_id, status: Processing}`. URL/Drive capabilities validated server-side; unknown connection/user mismatch rejected |
| PATCH `/{source_id}` | `{title}` | 200 current source metadata; 1–200 trimmed code points; updates all display surfaces without changing evidence revision |
| DELETE `/{source_id}` | User confirmed removal | 204 after authoritative access invalidation/slot release; durable cleanup follows; repeated deletion exposes no content |
| POST `/{source_id}/sync` | `{attempt_id}` | Linked sources only. 202 `{operation_id, source_id, committed_revision}`. 409 `{code: SyncAlreadyInProgress, message: "Sync already in progress"}` for any distinct overlapping request, no queued follow-up |
| GET `/{source_id}/operations/{operation_id}` | Authorized same notebook/source | Safe state/progress/error metadata, committed revision; no secret/provider payload |

Admission idempotency key identifies the same request payload. Same-key transport replay returns its recorded result rather than enqueuing again; mismatched payload is 409. Distinct manual/webhook requests while active are rejected even when upstream content is unchanged. Signed authenticated provider notifications map to a delegated connection/source and call the same sync admission; browser-supplied provider assertions are never trusted. No public generic fetch proxy is exposed.

Failures: 401 invalid authentication; 403 notebook/document/delegation access denied; 404 deleted source/notebook; 409 active sync or revision conflict; 413 source byte limit; 422 invalid title, unsupported/unextractable content or word limit. Asynchronous provider/parse/safety errors mark operation Failed with a safe reason. Web failure display is exactly `Unable to extract content from URL`; inaccessible video is `No transcript available for this video`. A provider export ceiling/capability error is distinct from exceeding the app's 200MB quota and never truncates content. Re-sync retains prior revision on all failures, but revoked ACL still suppresses its viewing.

## Adapter and worker boundary (FR-SI-01/05, C-01)

All adapters return canonical content, ordered structural spans, actual input byte count, extracted word count, media metadata and upstream revision/hash. They do not publish Ready or directly serve a consumer. Shared chunker emits existing C-01 schema; word counting follows the v1 canonical Unicode-whitespace convention, excluding overlap duplication. Render job exchanges private object references and operation fences, not credentials or arbitrary shell commands. Untrusted filenames/URLs never form shell commands.

Office: PDF normalization plus notes/descriptions mapped to normalized viewer pages, no slide_number variant. Web: immutable sanitized article DOM with selectors/offsets and canonical URL. Audio/video: valid caption/ASR intervals with integer start_ms/end_ms; reject malformed or out-of-duration spans; compute display_time from start_ms as floor minutes plus zero-padded seconds. Do not add display_time to strict C-01 locator objects. C-01 compatibility against v1 consumers is mandatory before any implementation wire changes.

## Inspection, media and events (FR-SI-04/05, FR-GC-03, C-02)

Reuse the route already registered in `apps/api/src/routes/sources.ts`, `GET /{source_id}/content?chunk_id=...&cursor=...` under C-02 singleton inspection mode. Return canonical passage, current revision, locator and derived transcript display_time; cursor binds revision. Media streaming uses a source-authorized proxy bound to current revision, checking ACL/deletion on each request and invalidating active delivery on revocation. Range requests never bypass that check. No publicly reusable signed source-read URLs.

Status events carry source_id, operation_id, committed revision, source status and optional Fetching/Transcribing/Parsing/Syncing progress; no new Ready eligibility state. During sync the original revision stays inspectable; new content appears only after commit. Clicking a valid time citation highlights and seeks start_ms. Replaced citation returns Source updated and authorized historical snippet plus explicit open-current-source action at top; deleted/revoked returns unavailable with navigation disabled. Guide regeneration and any C-03 job capture new or old immutable revisions explicitly and fail if replaced in flight.

## Latest-main compatibility (FR-SI-01/05, C-01/C-02, D15/D16)

Preserve current upload batch `200 {items}` admission and complete `200 {source}` responses; new operation metadata is additive and must not reinterpret these existing endpoints as the new imports 202 shape. Inspector retains `source`, paged canonical `pages`, scoped `chunks` and revision-bound cursor fields; transcript/DOM/media fields are additive DTO extensions. Canonical viewer text comes from PostgreSQL `source_pages` under C-02 (D15). C-01 remains the exact existing strict schema including revision; database-only vector/FTS fields stay internal. Source display accepts renamed 200-point titles while copied-text creation remains 100. Persist revision-keyed Guide state behind existing v2 repository interfaces and trigger it durably after sync; retain prior Guide only with its explicit old revision and never present it as current.
