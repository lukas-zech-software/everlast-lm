# Feature Specification: Multimodal Ingestion & Sync

**Feature Branch**: `009-multimodal-ingestion-sync`
**Created**: 2026-10-19
**Status**: Draft
**Package Source**: `spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md`
**SRS IDs in Scope**: FR-SI-01 (Subset B), FR-SI-04, FR-SI-05; Contract C-01, Contract C-02; Gate v3.0 #1
**Release & Gate**: v3.0 (`Gate v3.0 #1`)
**Input**: User description: "v3 Release: v3.0 \"Version 3.0: Multimodal Ingestion, Visual Graphs & Data Analytics\""

## Source Traceability & Package Scope *(mandatory)*

This specification transcribes Package 3.1 and the governing cross-package rules from `spec/requirements/README.md`. Other v3.0 capabilities (Code Execution Sandbox, Mindmaps, Data Tables, and Long-Context Scaling) are specified in subsequent package directories (`010`–`012`). Ingestion adapters extend Contract C-01 inputs while preserving the unified chunk schema and locator union.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| `FR-SI-01` (Subset B) | Office, Web, Video & Audio Ingestion | [package_3_1_multimodal_ingestion_sync.md#fr-si-01-subset-b--office-web-video--audio-ingestion](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-01-subset-b--office-web-video--audio-ingestion) | D1, D3, D4, D6, D11, D12; Gate v3.0 #1 |
| `FR-SI-04` | Source Inspector Media & Timestamp Player Extension | [package_3_1_multimodal_ingestion_sync.md#fr-si-01-subset-b--office-web-video--audio-ingestion](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-01-subset-b--office-web-video--audio-ingestion) | D1, D6, D12 |
| `FR-SI-05` | Source CRUD (Rename, Delete) & Re-Synchronization | [package_3_1_multimodal_ingestion_sync.md#fr-si-05--source-crud-rename-delete--re-synchronization](../../spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md#fr-si-05--source-crud-rename-delete--re-synchronization) | D1, D14 |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: Package 3.1 extends C-01 adapters without changing the locator union (`page_span`, `time_span`, `dom_path`). It builds upon Package 1.2 (`FR-SI-01` Subset A and `FR-SI-04` base inspector) and Package 2.2 (`FR-SI-02` Source Guide). It precedes and supplies the multimodal grounding context consumed by Package 3.2 (Python Code Sandbox), Package 3.3 (Mindmaps & Data Tables), and Package 3.4 (Long-Context Latency Scaling).
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Releases v1.0–v5.0 are strictly Owner-only. All Editor and Viewer roles mentioned in FR cards are deferred permissions that activate exclusively in v6.0.
- **Data Residency (`D3`)**: Default region is `europe-west4`; no package-level exception requested.
- **Upstream Flow-Back Status (`CC-01`)**: Package 3.1 FR card contains zero open questions (`Open questions: None`). All boundary constraints, SSRF policies, prompt injection screenings, and Gherkin criteria are transcribed without drift.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Multimodal Ingestion (Office, Web, Audio, Video) (Priority: P1)

**SRS IDs**: `FR-SI-01` (Subset B), `FR-SI-04`, `C-01`, `C-02`, `Gate v3.0 #1`  
**Actors**: Authenticated notebook Owner (v1.0–v5.0)

As a researcher working with heterogeneous media, I want to add Word documents (`.docx`), PowerPoint presentations (`.pptx`), Google Docs/Slides links, web articles, YouTube/video links, and audio recordings (`.mp3`, `.wav`, `.m4a`) to my notebook and jump to the exact timestamp or slide passage when clicking an inline citation, so that all my source formats are unified in one grounded workspace.

**Why this priority**: Core milestone for Release v3.0 and prerequisite for Gate v3.0 #1. Without multimodal adapters, subsequent analysis packages cannot operate on non-text/PDF media.

**Independent Test**: Upload distinct fixtures for each media format (.docx, .pptx, web URL, video URL, audio file). Assert that status transitions `Uploading` → `Processing` → `Ready`, Contract C-01 records are created with valid locators, and clicking citation `[n]` navigates the Source Inspector to the exact passage or audio/video timestamp.

**Interaction Flow**:
1. User opens `"Add sources"` dialog in the left Sources panel.
2. The modal exposes options for `Files` (accepting `.docx`, `.pptx`, `.mp3`, `.wav`, `.m4a` alongside PDF/TXT/MD), `Website` (Web URL), `YouTube` (Video URL), and `Google Drive` (Docs / Slides picker).
3. The user submits a supported file or URL.
4. The system validates declared limits, reserves a quota slot atomically, and transitions source through `Uploading` → `Processing` (with sub-states `Fetching`, `Transcribing`, or `Parsing`) → `Ready`.
5. For audio/video sources, the Source Inspector integrates a media/timestamp player displaying synchronized transcripts with clickable `mm:ss` timestamps.

**Acceptance Scenarios**:

```gherkin
Scenario: Audio upload produces chunks with clickable mm:ss timestamp locators (Gate v3.0 #1)
  Given an open notebook
  When the owner uploads a 10-minute "Interview.mp3" file
  Then the ASR pipeline transcribes the audio and creates UnifiedDocumentChunk records
  And every chunk contains a valid time_span locator (start_ms, end_ms, "mm:ss")
  When the user clicks a chat citation [1] referencing a statement at 04:15 in "Interview.mp3"
  Then the Source Inspector opens "Interview.mp3", highlights the segment at 04:15, and seeks the player to 04:15

Scenario: Video URL ingestion extracts timestamped transcript and seeks player
  Given an open notebook
  When the owner submits a valid Video URL with an available caption track
  Then the system extracts the caption track into UnifiedDocumentChunk records with time_span locators
  And the source status reaches "Ready"
  When the user inspects the source in the Source Inspector
  Then the embedded video player and timestamped transcript render synchronized controls

Scenario: Office document ingestion preserves speaker notes and visual descriptions
  Given an open notebook
  When the owner uploads a PowerPoint deck "Strategy.pptx" containing slide text, speaker notes, and diagram descriptions
  Then the Office adapter extracts slide text, speaker notes, and embedded visual descriptions into UnifiedDocumentChunk records
  And all extracted chunks use Contract C-01 page_span locators into the normalized viewer document
  And slide numbers are recorded as page metadata rather than a new locator variant

Scenario: Google Slides import preserves notes and deterministic locators
  Given an owner has delegated read access to a Google Slides document with slide text and speaker notes
  When the owner imports its link
  Then both slide text and speaker notes appear in the normalized viewer
  And all citations use C-01 page_span locators rather than a slide_number variant
  When delegated access is revoked before re-sync
  Then re-sync is denied without using a privileged service account

Scenario: Web URL ingestion extracts clean article content and screens prompt injection
  Given a public Web URL containing an article with boilerplate headers, navigation bars, and ads
  When the owner submits the URL in the "Website" dialog
  Then the system fetches the page via SSRF-safe gateway, strips boilerplate, screens content with Model Armor, and generates UnifiedDocumentChunk records
  And the canonical URL is recorded on the Source entity

Scenario: Paywalled or unreachable Web URL fails with clear message
  Given a Web URL returning HTTP 403 Forbidden or no extractable article content
  When the owner submits the URL in the "Website" dialog
  Then the source status transitions to "Failed" with reason "Unable to extract content from URL"
```

---

### User Story 2 - Source CRUD & Atomic Re-Synchronization (Priority: P1)

**SRS IDs**: `FR-SI-05`, `FR-SI-01`, `FR-SI-04`, `C-01`, `C-02`  
**Actors**: Authenticated notebook Owner (v1.0–v5.0)

As a project lead working with living web pages and cloud documents, I want to rename or remove sources and re-sync external sources when the upstream document changes, so that my notebook never works on stale information and historical citations remain traceable.

**Why this priority**: External URLs and cloud documents change over time. Re-sync ensures data freshness without corrupting active chat scopes or generating phantom citations.

**Independent Test**: Ingest a mutable web URL source, rename it, trigger re-sync upon upstream content change, verify atomic chunk replacement and citation marking, and verify deletion immediacy.

**Interaction Flow**:
1. User clicks the three-dot menu (`⋮`) next to a source in the sidebar.
2. User can select `"Rename source"` (`"Quelle umbenennen"`), enter a new title ($1\text{–}200$ characters), and save. The title updates instantly in sidebar, inspector, and tooltips.
3. User can select `"Remove source"` (`"Quelle entfernen"`), confirm deletion, which atomically deletes the source and its chunks, decrements the source count, and evicts chunks from retrieval ($0\text{ ms}$ staleness).
4. For connected web/cloud sources, user clicks `"Re-sync"` in the Source Inspector (or webhook triggers it). The system fetches fresh content in the background, stages validation, and atomically swaps chunks upon completion with non-reused chunk IDs.

**Acceptance Scenarios**:

```gherkin
Scenario: Rename source updates all UI references and citation tooltips
  Given an open notebook with a source titled "Q3_Report_v1.docx"
  When the owner renames the source to "Executive Summary Q3"
  Then the sidebar, Source Inspector title, and all existing citation tooltips display "Executive Summary Q3"

Scenario: Re-syncing a Web URL updates chunks atomically and keeps previous chunks on network failure
  Given a Web URL source "https://intranet.corp/roadmap" ingested with content "Release v1 in May"
  When the upstream page changes to "Release v1 in June" and the owner clicks "Re-sync"
  Then the source chunks are replaced atomically with new chunk IDs and asking "When is Release v1?" answers "June"
  When the upstream server returns HTTP 503 during a subsequent "Re-sync"
  Then the system displays a sync error toast and retains the "June" chunks intact

Scenario: Historical chat message citation handling after re-sync
  Given a historical chat turn citing chunk "chk_old_04" from revision 1 of a Web URL source
  When the owner re-syncs the source to revision 2
  Then the existing citation badge in the historical turn is marked "Source updated"
  And clicking it displays the saved historical snippet and allows opening the source at the top without exact-passage jump

Scenario: Source deletion immediately excludes chunks from chat retrieval
  Given a notebook with source "Old_Policy.docx"
  When the owner removes "Old_Policy.docx"
  Then the source slot is released immediately
  And the next chat prompt fails to retrieve any chunk from "Old_Policy.docx" (0 ms staleness)
  And historical citations to the deleted source display "Source deleted" badge
```

---

### Edge Cases *(mandatory)*

- **SSRF & Network Boundary Protection (`FR-SI-01`, `NFR-SEC-01`, `Constitution VI`)**:
  - Web and video URL fetching MUST validate destination IP addresses before connection and redirect.
  - Deny all IPv4/IPv6 loopback (`127.0.0.0/8`, `::1`), cloud metadata services (`169.254.169.254`, `metadata.google.internal`), link-local, carrier-grade NAT, and IPv4-mapped IPv6 ranges.
  - Private RFC 1918 / IPv6 ULA ranges are blocked by default unless explicitly allowlisted in tenant network configuration under delegated owner credentials.
  - DNS rebinding checks MUST resolve the hostname immediately prior to connecting and reject forbidden target IPs.
- **Prompt Injection & Safety Screening (`Constitution VI`, `D11`)**:
  - Ingested web, Google Drive, and synced content MUST pass Model Armor / safety screening before chunking and indexing.
  - Quarantined or unsafe content transitions to `Failed` with `"Content blocked by safety policy"` and NEVER enters Contract C-02 or retrieval index.
- **Video Missing Audio/Transcript (`FR-SI-01`)**:
  - If a submitted Video URL has neither caption tracks nor an accessible audio stream, ingestion transitions to `Failed` with `"No transcript available for this video"`.
- **Unsupported JavaScript-Only Web Pages (`FR-SI-01`, `DEV-xx`, `D11`)**:
  - Pages containing only an empty client-side JavaScript shell without extractable static/server-rendered HTML fail with `"Unable to extract content from URL"`. Headless browser execution is not supported in v3.
- **Document Size & Word Quotas (`FR-WM-07`, `FR-SI-01`)**:
  - Single source byte limit: $\le 200,000,000$ bytes ($200\text{ MB}$ inclusive). Enforce pre-upload via Content-Length / signed URL constraints and post-fetch.
  - Extracted word count limit: $\le 500,000$ words inclusive across all formats. Over-limit sources are rejected with `"Exceeds 500,000 words limit"`, never silently truncated.
  - Empty files ($0\text{ bytes}$ or $0\text{ extracted words}$) fail with `"File is empty"`.
- **In-Flight Generation during Re-Sync or Deletion (`C-02`, `C-03`, `FR-SI-05`)**:
  - Generation requests capture `(source_id, revision_id)` at submission time.
  - If a captured source revision is deleted or replaced by a re-sync while generation is in flight, the job MUST fail without publishing stale output. Silent substitution of newer revisions is prohibited.
- **Atomic Source Quota Reservation (`FR-WM-07`, `FR-SI-05`)**:
  - Source slots are reserved atomically at the start of ingestion (`Uploading`/`Processing`/`Ready` consume 1 slot).
  - Failed uploads or aborted re-syncs release the reserved slot immediately and purge temporary storage objects.
  - Re-sync reuses the existing source slot and leaves the active revision untouched until atomic swap.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`FR-SI-01` Subset B)**: *(Event-driven)* When the Owner uploads a `.docx` or `.pptx` file, the system MUST extract all document text, slide text, tables, speaker notes, and embedded visual descriptions into `UnifiedDocumentChunk` records conforming to Contract C-01 with `page_span` locators.
- **FR-002 (`FR-SI-01` Subset B)**: *(Event-driven)* When the Owner submits a Google Docs or Google Slides URL, the system MUST authenticate via the user's delegated read credentials, export the document into the Office normalization path, extract chunks with C-01 `page_span` locators, and persist the external document ID for re-synchronization.
- **FR-003 (`FR-SI-01` Subset B)**: *(Event-driven)* When the Owner submits a Web URL, the system MUST validate the target against SSRF rules, fetch the page, strip boilerplate HTML via readability extraction, screen text with Model Armor, and persist `UnifiedDocumentChunk` records with canonical URL metadata.
- **FR-004 (`FR-SI-01` Subset B, `Gate v3.0 #1`)**: *(Event-driven)* When the Owner submits a Video URL or uploads an audio file (`.mp3`, `.wav`, `.m4a`), the system MUST transcribe audio content via ASR (Speech-to-Text) or parse video captions into `UnifiedDocumentChunk` records where $100\%$ of chunks contain valid `time_span` locators (`start_ms`, `end_ms`, formatted `mm:ss`).
- **FR-005 (`FR-SI-04`, `Gate v3.0 #1`)**: *(Event-driven)* When the user clicks an inline citation badge `[n]` referencing an audio or video source chunk, the Source Inspector MUST open the transcript, scroll to the referenced chunk, and seek the integrated media player to `start_ms`.
- **FR-006 (`FR-SI-05`)**: *(Event-driven)* When the Owner renames a source, the system MUST update `Source.title` across the sidebar, Source Inspector, and citation tooltips in $\le 200\text{ ms}$.
- **FR-007 (`FR-SI-05`)**: *(Event-driven)* When the Owner deletes a source, the system MUST delete the `Source` record and all its `UnifiedDocumentChunk` entries, release the quota slot, and evict the source chunks from retrieval with $0\text{ ms}$ staleness on subsequent chat turns.
- **FR-008 (`FR-SI-05`)**: *(Event-driven)* When the Owner triggers `"Re-sync"` on a URL or connected cloud source, the system MUST re-fetch the content, stage validation and chunk generation in the background, atomically swap the chunks with fresh non-reused chunk IDs upon success, update `last_synced_at`, and regenerate the Source Guide (`FR-SI-02`).
- **FR-009 (`FR-SI-05`, `C-02`)**: *(Unwanted)* If a re-sync operation fails due to network or authorization error, the system MUST retain the existing source revision and chunks intact, display an error notification, and keep the source eligible for chat retrieval.
- **FR-010 (`FR-SI-05`, `FR-GC-03`)**: *(State-driven)* Where a historical conversation turn references a chunk from a pre-resync revision, the system MUST display the citation as `"Source updated"`, permit viewing the saved snippet, and prohibit jumping to stale passage locations.

### Key Entities

- **`Source` (`Contract C-01`, `FR-SI-01`, `FR-SI-05`)**:
  - Attributes: `id` (UUIDv7), `notebook_id`, `title` ($1\text{–}200$ chars), `media_type` (`office_docx`, `office_pptx`, `web_url`, `video_url`, `audio_asr`, etc.), `external_url` (nullable), `external_doc_id` (nullable), `revision_id` (integer, monotonically incremented), `status` (`Uploading`, `Processing`, `Ready`, `Failed`), `substatus` (`Fetching`, `Transcribing`, `Parsing`), `word_count` ($\le 500,000$), `byte_size` ($\le 200,000,000$), `last_synced_at`, `created_at`.
- **`UnifiedDocumentChunk` (`Contract C-01`)**:
  - Attributes: `chunk_id` (UUIDv7, strictly non-reused across re-syncs), `source_id`, `revision_id`, `chunk_index`, `content` (text passage), `locator` (`page_span` | `time_span` | `dom_path`), `metadata` (JSON: slide number, speaker notes indicator, visual description indicator).
- **`TimeSpanLocator` (`Contract C-01`)**:
  - Attributes: `start_ms` (integer), `end_ms` (integer), `display_time` (`"mm:ss"` formatted string).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`Gate v3.0 #1`, `FR-SI-01`)**: $100\%$ of ingested audio and video chunks contain schema-valid Contract C-01 `time_span` locators with formatted `mm:ss` timestamps.
- **SC-002 (`Gate v3.0 #1`, `FR-SI-04`)**: Clicking a citation badge pointing to an audio/video chunk in the web UI navigates to the transcript and seeks the player to within $\pm 500\text{ ms}$ of `start_ms` in $100\%$ of automated end-to-end tests.
- **SC-003 (`FR-SI-01`)**: ASR transcription for a $30$-minute audio recording completes in $\le 45\text{ s}$ P95.
- **SC-004 (`FR-SI-05`)**: Source deletion evicts chunks from retrieval with $0\text{ ms}$ staleness; the immediate subsequent chat query cannot retrieve deleted chunks (`Leakage = 0`).
- **SC-005 (`FR-SI-05`)**: Re-sync operation is $100\%$ atomic; any network failure during fetch/parse leaves the prior revision completely intact with zero downtime or missing chunks.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**:
  - Owner-only execution for v3.0; multi-user RBAC active in v6.0.
  - Office file rendering converts slides/pages to normalized viewer HTML/text with slide numbers stored as page metadata.
  - Video ingestion relies on standard caption tracks or extracted audio stream routed to ASR.
- **Out of Scope / Deferred**:
  - Autonomous recursive multi-page web crawling (`v6.0` — `FR-SI-06`, `FR-SI-07`).
  - Google Slides export (`DEV-02`, `D8` — `.pptx` and `.pdf` export only).
  - Sub-second live collaborative editor keystroke streaming (`FR-SI-05` out of scope).
  - Headless browser JavaScript evaluation (D11; Readability over static HTML only).
