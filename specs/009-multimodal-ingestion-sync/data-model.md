# Data Model: Multimodal Ingestion & Sync

Scope: FR-SI-01/05, C-01/C-02, FR-WM-07, NFR-SEC-02. Extend existing Postgres entities and shared schemas; this document is not a second executable C-01 definition.

| Entity | Fields and relationships | Validation / lifecycle |
| :--- | :--- | :--- |
| Source | Existing UUID, notebook FK, title, media_type, current revision; add canonical/external URL, external document ID, delegated connection reference, content_hash, last_synced_at | Owner and upstream ACL bound; title trimmed 1–200 code points; Uploading→Processing→Ready or Failed; sync progress separate from Ready eligibility (FR-SI-01/05) |
| SourceRevision | Composite source/revision identity; canonical object generation, raw object reference, actual bytes/words, normalized manifest, ACL provenance, hash | Staged content not returned by C-02; publish only after complete validation, embedding and authorization. Independent inclusive 200000000 bytes/500000 words (FR-SI-01/05) |
| UnifiedDocumentChunk | Shared C-01 chunk/source IDs, text, token_count, locator; persistence revision/sequence and vector/FTS metadata use existing ownership | UUIDv7 fresh per replacement; only existing page/time/DOM locator alternatives. Milliseconds retained in runtime time locator; `display_time` computed in viewer DTO. 300–600 token target does not reject short boundary fragments (C-01) |
| CanonicalViewerManifest | Source/revision, ordered normalized pages or transcript segments/DOM blocks, chunk anchor mapping, safe media resource reference | Offsets refer to immutable normalized content; transcript start/end in duration bounds and monotonic order; page notes/descriptions included; no external scripts (FR-SI-04, C-01) |
| SourceOperation | UUID operation/attempt, source FK, expected revision, initiator, kind import/sync, state, progress, fencing token, lease, provider operation reference, timestamps, safe error | One active sync per source enforced transactionally; Queued→Running→Succeeded/Failed/Cancelled internal operation states, not source states. Same-operation redelivery idempotent; distinct request while active rejected (FR-SI-05) |
| Outbox event | Operation ID, event type, source/revision, delivery status | Enqueue after durable admission; retry delivery safely; publication event schedules Guide with exact new singleton snapshot (FR-SI-02/05) |
| Delegated connection | User identity, provider, secret reference, granted scopes, revoked marker | No token returned in DTO/log; no service-account substitution. Revalidate document capability/ACL before fetch/read/publish (D11, NFR-SEC-02) |
| Historical citation | Existing chunk/revision provenance and authorized saved snippet | Replaced→Source updated/current-source top only; deleted/revoked→unavailable, no snippet/media; never retarget old chunk ID (FR-GC-03, NFR-EVAL-04) |

## Commit and failure invariants (FR-SI-05, C-02/C-03)

Admission and outbox commit together. Initial imports reserve one quota slot before work; re-sync owns the existing slot. Worker resumes persistent operation state, verifies initiator/document access, stages full normalized content/chunks/embeddings and checks byte/word limits. The final short transaction locks source, compares expected revision, active operation token and current authorization, installs new revision/hash/time and chunk visibility, and emits invalidation/Guide events. No network call occurs while holding this transaction open. DB readers must filter exact current authorized revision, not wait for object cleanup or cache-event delivery.

Failure before commit removes staged exposure; initial import marks Failed and releases its slot exactly once; sync failure leaves prior Ready revision and slot intact. Cancel/delete races fence later completion. Worker crash recovery expires a lease and resumes the same operation under a new fencing token; stale workers cannot commit. Source deletion immediately tombstones access and cancels/fences jobs in the authoritative transaction, then purges DB/object derivatives with durable retries. Successful API deletion cannot leave previously issued media capabilities usable: read media via an authorization-checking proxy, never a reusable bare signed GCS URL.

## Consumer handoff (C-01/C-02, NFR-EVAL-04)

3.2 and 3.3 consume shared chunk exports through C-02 and capture exact revisions; no adapter-specific source read API is allowed. New revision invalidates stale generation and scoped caches. Mere deselection preserves authorized historical viewing but excludes dependent history from fresh prompts. Source Guide uses the new singleton scope only after Ready publication and must revalidate citations and authorization before publishing.
