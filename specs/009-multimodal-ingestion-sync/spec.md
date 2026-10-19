# Feature Specification: Multimodal Ingestion & Sync

**Feature Branch**: `v3-specify-20261019/009-multimodal-ingestion-sync`
**Created**: 2026-10-19
**Status**: Draft
**Package Source**: `spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md`
**SRS IDs in Scope**: `FR-SI-01` Subset B, `FR-SI-05`, `C-01`; supporting `FR-SI-02/03/04`, `FR-GC-02/03`, `FR-WM-04/05/07`, `C-02/C-03`, `NFR-SEC-01/02`, `NFR-EVAL-01..04`
**Release & Gate**: `v3.0` (`Gate v3.0 #1`)
**Input**: User description: "Specify package 3.1, Multimodal Ingestion & Sync, as one release-v3 package in its own worktree."

## Source Traceability & Package Scope *(mandatory)*

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-SI-01 | Office, Web, Video & Audio Ingestion (Subset B) | [Ingestion](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-01-subset-b--office-web-video--audio-ingestion) | D11 delegated Google import; D3 residency |
| FR-SI-05 | Source CRUD & Re-Synchronization | [Source management](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-05--source-crud-rename-delete--re-synchronization) | D11 delegated re-sync; D13 publication safeguards |
| C-01 | UnifiedDocumentChunk | Same ingestion card; SRS §5.1 | Existing locator union remains unchanged |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: Existing v1 ingestion, quotas, Inspector and C-01/C-02; v2 Source Guide and C-03. Package 3.1 supplies adapters consumed by 3.2 and 3.3; 3.4 benchmarks integrated v3. Gate v2 must pass before v3 implementation, but specification may proceed now.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only in v1–v5. Card references to Editors and other viewer roles apply from v6 only.
- **Data Residency (`D3`)**: `europe-west4` default; no exception introduced. Company content uses enterprise no-training endpoints (`NFR-SEC-01`); zero retention is not asserted.
- **Upstream Flow-Back Status (`CC-01`)**: This specification transcribes existing decisions and binding cross-package rules; no new clarification, scope change, or technical decision requires upstream amendment. Subsequent refinements must flow back into the card and applicable SRS/architecture tier.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add Office and linked documents (Priority: P1)

**SRS IDs**: `FR-SI-01`, `C-01`, `FR-SI-04`, `NFR-SEC-02`
**Actors**: Owner in v3; Owner/Editor from v6.

The owner opens Add sources, chooses Google Drive / Office files, uploads a Word document or slide deck, or provides a Google Docs/Slides link or authorized picker selection. The resulting source retains text, tables, speaker notes and embedded visual descriptions in a normalized viewer.

**Why this priority**: Required document formats must retain evidence beyond visible slide text.
**Independent Test**: Import DOCX, PPTX, Docs and Slides fixtures and inspect all required content and citations.

**Acceptance Scenarios**:

1. **Given** delegated read access to a Google Slides document with slide text and speaker notes, **When** the owner imports its link, **Then** both appear in the normalized viewer and citations use `page_span`, not `slide_number`. **When** delegated access is revoked before re-sync, **Then** re-sync is denied without privileged service-account access. (`FR-SI-01`, `FR-SI-05`, `C-01`, `NFR-SEC-02`)
2. **Given** valid DOCX/PPTX content within both source limits, **When** uploaded, **Then** text, tables, notes and visual descriptions survive normalization with page-based evidence locations and the corresponding Doc/Slides icon. (`FR-SI-01`, `C-01`, `FR-WM-07`)

### User Story 2 - Add a web article safely (Priority: P1)

**SRS IDs**: `FR-SI-01`, `C-01`, `NFR-SEC-02`
**Actors**: Owner in v3; Owner/Editor from v6.

The owner chooses Website in Add sources, submits an authorized URL and receives the main article without navigation or advertisements, with its canonical URL and globe icon.

**Why this priority**: Web evidence must be usable without exposing private destinations or indexing malicious instructions.
**Independent Test**: Import permitted article fixtures and exercise blocked, empty, redirected and PDF destinations.

**Acceptance Scenarios**:

1. **Given** a URL returning HTTP 403 or no extractable article content, **When** submitted, **Then** the source becomes `Failed` with `Unable to extract content from URL`. (`FR-SI-01`)
2. **Given** an authorized reachable article, **When** imported, **Then** main content and canonical URL are retained; **Given** a PDF destination, **Then** ingestion uses the existing PDF path. (`FR-SI-01`, `C-01`)
3. **Given** a forbidden resolved destination or prompt-injected content, **When** import or re-sync attempts to use it, **Then** forbidden connections are blocked and quarantined content never becomes Ready or enters source context. (`FR-SI-01`, `FR-SI-05`, `C-02`, `NFR-SEC-02`)

### User Story 3 - Navigate audio and video evidence (Priority: P1)

**SRS IDs**: `FR-SI-01`, `FR-SI-04`, `FR-GC-03`, `C-01`, `Gate v3.0 #1`
**Actors**: Owner in v3; authorized roles subject to v6 permissions.

The owner drops an MP3, WAV or M4A file or chooses YouTube/Video URL. Background transcription produces a Ready source with a timestamped transcript, Source Guide, media player and Audio/Video icon. Clicking an answer citation opens its precise transcript passage and playback position.

**Why this priority**: Clickable timestamps are the package's explicit release gate.
**Independent Test**: Import the 10-minute Interview.mp3 fixture and a video fixture, then follow their citations.

**Acceptance Scenarios**:

1. **Given** an open notebook, **When** the owner uploads the 10-minute `Interview.mp3`, **Then** transcription creates chunks each carrying a valid `time_span` with `start_ms`, `end_ms` and `mm:ss`; **When** citation [1] references 04:15, **Then** the Inspector opens Interview.mp3, highlights 04:15 and seeks to 04:15. (`FR-SI-01`, `FR-SI-04`, `FR-GC-03`, `Gate v3.0 #1`)
2. **Given** a video with neither captions nor accessible audio, **When** submitted, **Then** it fails with `No transcript available for this video`. (`FR-SI-01`)

### User Story 4 - Keep source identity and content current (Priority: P1)

**SRS IDs**: `FR-SI-05`, `FR-SI-02`, `FR-GC-03`, `FR-WM-07`, `C-01/C-02/C-03`
**Actors**: Owner in v3; Owner/Editor from v6.

The owner uses the source's three-dot menu to rename or confirm removal, or the Inspector's Re-sync action to refresh a linked source. Re-sync shows Syncing... while preserving the committed source until replacement succeeds.

**Why this priority**: Living sources must refresh without corrupting existing evidence or quota accounting.
**Independent Test**: Rename, refresh, fail a refresh, and delete a linked source while exercising current and historical citations.

**Acceptance Scenarios**:

1. **Given** the intranet roadmap contains `Release v1 in May`, **When** it changes to `Release v1 in June` and the owner selects Re-sync, **Then** chunks are atomically replaced and a new explicitly scoped answer says June. **When** the next sync returns HTTP 503, **Then** a sync error toast appears and June chunks remain intact. (`FR-SI-05`, `C-01/C-02`)
2. **Given** a valid new title, **When** Rename source is saved, **Then** sidebar, Inspector and citation tooltips show it. **Given** confirmed Remove source, **Then** its chunks are unavailable on the next chat turn and the source counter decreases. (`FR-SI-05`, `FR-WM-07`)
3. **Given** a historical citation to a replaced chunk, **When** re-sync commits, **Then** it says `Source updated`; authorized viewers may see its historical snippet and explicitly open the current source at the top, without an exact-passage jump or stale evidence in a new prompt. (`FR-SI-05`, `FR-GC-03`, `NFR-EVAL-04`)
4. **Given** generation captured a source revision, **When** it is deleted, replaced or authorization is revoked before publication, **Then** generation fails without stale output or silent substitution. (`FR-SI-05`, `C-02/C-03`, `NFR-SEC-02`)

### Edge Cases *(mandatory)*

- **Limits (`FR-SI-01`, `FR-WM-07`)**: Each source independently obeys inclusive 200,000,000-byte and 500,000-extracted-word limits, including audio transcripts and URL sources. Reject over-limit content without truncation. Atomically reserve slots; Uploading/Processing/Ready consume them. Failed uploads release their slot and leave a dismissible error row; re-sync reuses its existing slot.
- **Titles (`FR-SI-05`)**: Trim outer whitespace and count Unicode code points; reject empty, >200-point and whitespace-only names. Default title is the original filename or page title.
- **Network safety (`FR-SI-01`, `NFR-SEC-02`)**: Check resolved addresses before every connection/redirect, including DNS rebinding and IPv4-mapped IPv6. Always block loopback, metadata and link-local destinations. Private/ULA destinations require explicit enterprise tenant policy and user access; hostname allowlisting never bypasses forbidden addresses.
- **Extraction (`FR-SI-01`)**: Unreachable/paywalled/empty pages fail clearly; unsupported JavaScript-only shells do not trigger an unapproved browser dependency. Google Docs/Slides use delegated import, not generic scraping. Reject insufficient/revoked delegated access.
- **Re-sync failure (`FR-SI-05`)**: Any access, size, safety, parsing, embedding or network failure preserves the previous Ready revision and slot; no partial chunk replacement. ReSyncing is an operation indicator, not a new source eligibility state.
- **Deletion/revocation (`FR-SI-05`, `FR-GC-03`, `NFR-EVAL-04`)**: Remove retrieval access, cached snippets, generated-content exposure, exports and signed media access; hide affected history/artifacts or show unavailable placeholders. Deleted citations say `Source deleted` with click-through disabled. Cancel/fail captured in-flight work.
- **Scope (`FR-SI-03`, `C-02`)**: Empty or omitted selection disables and rejects source-based generation; All Ready sources is only an initial UI selection. Selection is local to user/session/notebook. Inspector reads use authorized singleton scope without changing chat selection or source eligibility.
- **Historical evidence (`FR-GC-03/06`, `NFR-EVAL-04`)**: Deselection alone does not hide authorized history, but excludes dependent question-and-answer turns, snippets and artifacts from new prompts; interactive follow-ups use current scope and prompt to select missing sources. Never silently restore selection.
- **Authorization (`FR-WM-04/05`, `NFR-SEC-02`)**: Every read/mutation and background job checks notebook/document access; login alone is insufficient. v6 Chat-Only click-through remains blocked.
- **Grounding (`FR-GC-02`, `C-03`, `NFR-EVAL-01..04`)**: Validate scoped citation IDs before factual publication. Invalid citations produce refusal, never a citation-stripped draft or silent retry. Studio jobs fail without an invalid artifact; progress is not answer TTFT. Summaries/transcripts retain claim-level references.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`FR-SI-01`, `C-01`)**: On DOCX/PPTX upload, preserve all document/slide text, tables, speaker notes and embedded visual descriptions in normalized-viewer chunks with `page_span` locations. Slide numbers are page metadata, never new locator variants.
- **FR-002 (`FR-SI-01`, `FR-SI-05`, `NFR-SEC-02`)**: On Google Docs/Slides link or authorized picker import, use the requesting user's delegated read access and existing Office normalization, retaining external document ID for manual re-sync. Reject revoked/insufficient permission without service-account substitution (D11).
- **FR-003 (`FR-SI-01`, `C-01`)**: On Web URL submission, retain main article content and canonical URL, excluding navigation/advertisements. Accept public or explicitly authorized enterprise HTML; route PDF destinations to existing PDF ingestion.
- **FR-004 (`FR-SI-01`, `C-01`)**: On Video URL or MP3/WAV/M4A upload, use accessible captions or speech transcription; every chunk MUST carry `time_span` start/end milliseconds and display time `mm:ss`. If neither video captions nor audio are accessible, fail with `No transcript available for this video`.
- **FR-005 (`FR-SI-01`, `FR-SI-04`, `FR-GC-03`)**: On a media citation click, open the transcript/media Inspector, highlight and scroll to the cited segment and seek to `start_ms`.
- **FR-006 (`FR-SI-01`, `C-01`)**: Persist source media type/external URL and chunks using only `page_span`, `time_span` or `dom_path`; retain existing C-01 source ID, chunk ID, text, token count and locator contract. Show format icons and Uploading → Processing → Ready or Failed; Fetching/Transcribing/Parsing are progress substates.
- **FR-007 (`FR-SI-01`, `FR-WM-07`)**: Enforce both inclusive source limits and atomic slot rules described above on imports and replacements; never truncate to fit.
- **FR-008 (`FR-SI-01`, `FR-SI-05`, `NFR-SEC-02`)**: Enforce every network and prompt-injection safety rule above before connection/indexing/model use; quarantined content MUST never become Ready or enter C-02. Unextractable web content MUST fail with `Unable to extract content from URL`.
- **FR-009 (`FR-SI-05`)**: When Rename source / Quelle umbenennen is saved, validate a 1–200-code-point trimmed title and update sidebar, Inspector and all citation tooltips.
- **FR-010 (`FR-SI-05`, `FR-WM-07`, `NFR-EVAL-04`)**: When Remove source / Quelle entfernen is confirmed, remove the Source and chunks, decrement the counter and enforce deletion hygiene immediately on subsequent reads.
- **FR-011 (`FR-SI-05`, `FR-SI-02`, `C-01`)**: For URL/connected-document sources only, Re-sync / Neu synchronisieren / Click to sync or a webhook MUST fetch and stage a replacement, validate limits/safety/parsing/embeddings, atomically publish fresh non-reused chunk IDs, update `content_hash` and `last_synced_at`, and regenerate the Source Guide.
- **FR-012 (`FR-SI-05`, `FR-SI-03`)**: While re-sync runs, show Syncing.../ReSyncing with source remaining Ready and old committed revision readable. On success expose the new revision; on any failure preserve the old revision and show a sync error.
- **FR-013 (`FR-SI-05`, `FR-GC-03`, `C-02/C-03`)**: Preserve historical updated-source semantics and enforce submission snapshots, access rechecks before reads/publication, and failure on replaced/deleted/revoked revisions as described above. Never retarget old chunk IDs.
- **FR-014 (`FR-SI-03`, `C-02`, `NFR-EVAL-04`)**: Ingestion writes C-01; all agent/Guide/Inspector source reads MUST use C-02 with explicit authorized scope. Enforce empty-selection rejection, local selection and history filtering. Cache identity MUST include notebook, selected IDs/revisions, authorization, language and relevant generation parameters.
- **FR-015 (`FR-GC-02`, `C-03`, `NFR-EVAL-01..04`)**: Enforce pre-publication grounding/refusal rules. Source Guide regeneration is asynchronous and source-grounded; no ingestion path may bypass scoped reads or expose invalid generated evidence.
- **FR-016 (`FR-WM-04/05`, `NFR-SEC-01/02`)**: Enforce Owner-only v3, notebook isolation, upstream ACL provenance, enterprise no-training processing and declared EU residency without introducing a new exception.

### Key Entities

- **Source (`FR-SI-01/05`)**: Notebook-bound title, media type, external/canonical URL or external document ID, current revision, content hash and last-sync timestamp; Uploading/Processing/Ready/Failed with separate progress indicators.
- **UnifiedDocumentChunk (`C-01`)**: Source identity, unique chunk identity, text, token count and existing location union; media locations carry timestamp intervals; replacement never reuses chunk IDs.
- **Revision and scope snapshot (`FR-SI-05`, `C-02/C-03`)**: Committed content revision and submission-time authorized source/revision set; staged replacement is invisible until atomic commit.
- **Historical citation (`FR-GC-03`)**: Original chunk reference and authorized saved snippet; updated or deleted source status governs navigation and visibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`FR-SI-01`, `Gate v3.0 #1`)**: 100% of ingested audio/video chunks expose valid clickable mm:ss positions; the Interview.mp3 04:15 citation highlights and seeks to 04:15.
- **SC-002 (`FR-SI-01`)**: A 30-minute audio fixture completes transcription in ≤45 seconds P95 on a declared test fixture/environment.
- **SC-003 (`FR-SI-01`, `C-01`)**: All required Office fixture text, tables, notes and visual descriptions are available and navigable in the viewer; every format uses the existing location contract.
- **SC-004 (`FR-SI-05`, `NFR-EVAL-04`)**: Deleted source content is absent on the next chat turn (0 ms retrieval staleness); every failed re-sync fixture preserves its previous complete revision and quota slot.
- **SC-005 (`FR-SI-05`, `FR-WM-07`)**: Boundary fixtures accept 1/200-point titles and inclusive byte/word limits, reject empty/over-limit values without truncation, and leave quota accounting correct under concurrent imports.
- **SC-006 (`FR-SI-01/05`, `NFR-SEC-02`)**: All unauthorized/revoked import, redirect, network and re-sync fixtures are rejected; no quarantined source becomes Ready and no stale in-flight generation publishes.
- **SC-007 (`NFR-EVAL-01..04`, `FR-GC-02`)**: Applicable integrated release evidence shows citation-ID validity 1.0, leakage 0, hallucination <5%, out-of-source rejection ≥99% and semantic citation support checks. This package's specification alone does not demonstrate those gates or the full v3 release gate.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: Existing v1/v2 contracts and consumer behavior remain authoritative; no new locator variant, processing framework or source type beyond the card is introduced. Fixture values in scenarios represent schema-valid IDs when tests are derived. Reference behavior is unverified background, not a fresh product observation.
- **Out of Scope / Deferred**: Recursive crawling, autonomous intranet/web discovery and Deep Research belong to v6 (`FR-SI-06/07`); live keystroke streaming is excluded. Google Slides output export stays deferred under D8; D11 is import only. Packages 3.2–3.4 are separate specifications. No implementation, deployment, API enablement or release-gate certification is performed here.
