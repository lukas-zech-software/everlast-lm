# Interface Contracts: Text/PDF Ingestion & Inspector

Trace: FR-SI-01, FR-SI-03, FR-SI-04, C-01, C-02. Import the [single shared baseline](../../001-workspace-foundation/contracts/shared-context.md) and [admission contract](../../001-workspace-foundation/contracts/workspace-api.md).

### HTTP and event boundary (FR-SI-01/03/04, C-02)

- POST `/api/notebooks/{id}/sources/uploads`: ordered file descriptors plus immutable attempt IDs; use 1.1 reserveSources before returning size-constrained signed upload capabilities. Return per-item accepted/quota/format failures. No client word count is authoritative.
- POST `/api/notebooks/{id}/sources/{source}/complete`: verify object generation and actual bytes before Processing/enqueue; idempotent replay does not create chunks twice. Late callback after notebook deletion fails and queues object cleanup.
- POST `/api/notebooks/{id}/sources/text`: `{text,attempt_id}`; outer-trim nonempty, UTF-8 bytes and extracted words validated independently; title Pasted text. Same reservation and worker path as files.
- GET `/api/notebooks/{id}/sources`: owner-authorized metadata/status only. Ready events carry source/revision and originating session correlation so auto-selection affects only importing session.
- GET `/api/notebooks/{id}/sources/{source}/content?chunk_id=...&cursor=...`: request-bound C-02 inspection mode with exactly this source; ordered canonical passages and validated locator/highlight; cursor binds immutable revision. Unknown/cross-source chunk never resolves. No raw-object signed read URL bypass.
- Status errors: 401 invalid identity, 403 InvalidScopeError/unauthorized, 404 deleted notebook/source, 400 EmptyScopeError, 409 stale revision/not Ready, 413 actual/declared oversized bytes, 422 empty/unsupported/unreadable/word-limit input. Exact displayed source errors follow the source card.
- Source deletion support is an internal lifecycle integration from 1.1; do not introduce the later-release re-sync or source-edit feature.

### Deterministic indexing and retrieval

Extract canonical text once and retain page/section structure/table reading order. PDF OCR feeds the same canonical representation as native PDF text. Map PDF.js/Document AI offsets to code-point indexes before C-01 generation; never use provider byte/UTF-16 offsets directly. Define extracted words as runs separated by Unicode whitespace after canonical extraction; this is the parser counting convention for the existing word quota, tested with punctuation and multilingual fixtures. Chunk target 300–600 tokens with configurable 50-token overlap within a section/page only; split oversized sections and permit short boundary fragments. Persist canonical content without overlap duplication; chunk locators refer to it.

Use architecture-selected pdfjs-dist and Document AI Layout Parser for scanned/tabular pages, UTF-8 decoding for text/Markdown. Count raw copied-text bytes independently from parsed word count. Batch embeddings via enterprise endpoints using RETRIEVAL_DOCUMENT; atomically commit chunks, embeddings, tsv and Ready after authorization/revision fence. Rollback/failure purges partial objects and releases quota exactly once. No Source Guide, emoji automation, overview or v3 format adapters in v1.

C-02 generation embeds query with RETRIEVAL_QUERY, applies identical notebook/source/revision predicates in vector and FTS CTEs, merges by RRF and validates returned membership. Inspection returns ordered full content without top-k restriction. Use transaction-local iterative scan settings only when supported by the approved pgvector version; validate deployed compatibility before enabling. No direct inspector/agent source-read bypass.

## Universal failure rules

Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.
