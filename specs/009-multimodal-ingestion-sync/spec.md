# Feature Specification: Multimodal Ingestion & Sync

**Feature Branch**: `codex/v3-tasks-analysis-pr-20261022`
**Created**: 2026-10-19
**Status**: Implemented (2026-10-23); live provider, benchmark and release-gate evidence pending (see implementation-evidence.md)
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
- **Upstream Flow-Back Status (`CC-01`)**: The 2026-10-19 clarification decisions on overlapping re-sync requests and transcription timing have been flowed back into the package 3.1 FR card. They refine FR-SI-05/FR-SI-01 acceptance without changing shared contracts, release scope or architecture decisions. Subsequent refinements must flow back into the applicable upstream tier.

## Clarifications

### Session 2026-10-19

- Q: What should happen when another manual or automatic re-sync request arrives while the same source is already being refreshed? → A: Option B. Reject the additional request with `Sync already in progress`; the caller must retry after the current refresh finishes. Do not queue a follow-up refresh.

- Q: Which start and end points should define the 45-second transcription target for a 30-minute audio recording? → A: Option A. Start when uploaded audio is accepted for transcription and end when its timestamped transcript is available. Include queue waiting; exclude upload and later indexing.

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

1. **Given** an open notebook, **When** the owner uploads the 10-minute `Interview.mp3`, **Then** transcription creates chunks each carrying a valid C-01 `time_span` with `start_ms` and `end_ms`, with derived `mm:ss` in its transcript/view DTO; **When** citation [1] references 04:15, **Then** the Inspector opens Interview.mp3, highlights 04:15 and seeks to 04:15. (`FR-SI-01`, `FR-SI-04`, `FR-GC-03`, `Gate v3.0 #1`)
2. **Given** a 30-minute audio fixture has been uploaded, **When** it is accepted for transcription, **Then** measure elapsed time through queue waiting until its timestamped transcript is available; across the declared benchmark runs P95 is ≤45 seconds, excluding upload and later indexing. (`FR-SI-01`)
3. **Given** a video with neither captions nor accessible audio, **When** submitted, **Then** it fails with `No transcript available for this video`. (`FR-SI-01`)

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
4. **Given** a source refresh is active, **When** another manual request or webhook requests re-sync for that source, **Then** reject it with `Sync already in progress`, leave the active refresh unchanged and queue no follow-up; the caller may retry after completion. (`FR-SI-05`)
5. **Given** generation captured a source revision, **When** it is deleted, replaced or authorization is revoked before publication, **Then** generation fails without stale output or silent substitution. (`FR-SI-05`, `C-02/C-03`, `NFR-SEC-02`)

### Edge Cases *(mandatory)*

- **Limits (`FR-SI-01`, `FR-WM-07`)**: Each source independently obeys inclusive 200,000,000-byte and 500,000-extracted-word limits, including audio transcripts and URL sources. Reject over-limit content without truncation. Atomically reserve slots; Uploading/Processing/Ready consume them. Failed uploads release their slot and leave a dismissible error row; re-sync reuses its existing slot.
- **Titles (`FR-SI-05`)**: Trim outer whitespace and count Unicode code points; reject empty, >200-point and whitespace-only names. Default title is the original filename or page title.
- **Network safety (`FR-SI-01`, `NFR-SEC-02`)**: Check resolved addresses before every connection/redirect, including DNS rebinding and IPv4-mapped IPv6. Always block loopback, metadata and link-local destinations. Private/ULA destinations require explicit enterprise tenant policy and user access; hostname allowlisting never bypasses forbidden addresses.
- **Extraction (`FR-SI-01`)**: Unreachable/paywalled/empty pages fail clearly; unsupported JavaScript-only shells do not trigger an unapproved browser dependency. Google Docs/Slides use delegated import, not generic scraping. Reject insufficient/revoked delegated access.
- **Overlapping re-sync (`FR-SI-05`)**: While one refresh is active for a source, reject additional manual/webhook requests with `Sync already in progress`. Do not cancel the active operation or queue a follow-up; callers must retry after completion.
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
- **FR-004 (`FR-SI-01`, `C-01`)**: On Video URL or MP3/WAV/M4A upload, use accessible captions or speech transcription; every chunk MUST carry the existing C-01 `time_span` start/end milliseconds; the corresponding transcript/view DTO MUST expose derived display time `mm:ss`, outside the strict locator object. If neither video captions nor audio are accessible, fail with `No transcript available for this video`.
- **FR-005 (`FR-SI-01`, `FR-SI-04`, `FR-GC-03`)**: On a media citation click, open the transcript/media Inspector, highlight and scroll to the cited segment and seek to `start_ms`.
- **FR-006 (`FR-SI-01`, `C-01`)**: Persist source media type/external URL and chunks using only `page_span`, `time_span` or `dom_path`; retain existing C-01 source ID, chunk ID, text, token count and locator contract. Show format icons and Uploading → Processing → Ready or Failed; Fetching/Transcribing/Parsing are progress substates.
- **FR-007 (`FR-SI-01`, `FR-WM-07`)**: Enforce both inclusive source limits and atomic slot rules described above on imports and replacements; never truncate to fit.
- **FR-008 (`FR-SI-01`, `FR-SI-05`, `NFR-SEC-02`)**: Enforce every network and prompt-injection safety rule above before connection/indexing/model use; quarantined content MUST never become Ready or enter C-02. Unextractable web content MUST fail with `Unable to extract content from URL`.
- **FR-009 (`FR-SI-05`)**: When Rename source / Quelle umbenennen is saved, validate a 1–200-code-point trimmed title and update sidebar, Inspector and all citation tooltips.
- **FR-010 (`FR-SI-05`, `FR-WM-07`, `NFR-EVAL-04`)**: When Remove source / Quelle entfernen is confirmed, remove the Source and chunks, decrement the counter and enforce deletion hygiene immediately on subsequent reads.
- **FR-011 (`FR-SI-05`, `FR-SI-02`, `C-01`)**: For URL/connected-document sources only, Re-sync / Neu synchronisieren / Click to sync or a webhook MUST fetch and stage a replacement, validate limits/safety/parsing/embeddings, atomically publish fresh non-reused chunk IDs, update `content_hash` and `last_synced_at`, and regenerate the Source Guide.
- **FR-012 (`FR-SI-05`, `FR-SI-03`)**: While re-sync runs, show Syncing.../ReSyncing with source remaining Ready and old committed revision readable. On success expose the new revision; on any failure preserve the old revision and show a sync error. Reject additional manual/webhook refresh requests for that source with `Sync already in progress`; keep the active operation unchanged and queue no follow-up. Callers must retry after completion.
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
- **SC-002 (`FR-SI-01`)**: A 30-minute audio fixture completes transcription in ≤45 seconds P95 on a declared test fixture/environment, measured from acceptance of the uploaded audio for transcription until its timestamped transcript is available. Include queue waiting; exclude upload and later indexing.
- **SC-003 (`FR-SI-01`, `C-01`)**: All required Office fixture text, tables, notes and visual descriptions are available and navigable in the viewer; every format uses the existing location contract.
- **SC-004 (`FR-SI-05`, `NFR-EVAL-04`)**: Deleted source content is absent on the next chat turn (0 ms retrieval staleness); every failed re-sync fixture preserves its previous complete revision and quota slot.
- **SC-005 (`FR-SI-05`, `FR-WM-07`)**: Boundary fixtures accept 1/200-point titles and inclusive byte/word limits, reject empty/over-limit values without truncation, and leave quota accounting correct under concurrent imports.
- **SC-006 (`FR-SI-01/05`, `NFR-SEC-02`)**: All unauthorized/revoked import, redirect, network and re-sync fixtures are rejected; no quarantined source becomes Ready and no stale in-flight generation publishes.
- **SC-007 (`NFR-EVAL-01..04`, `FR-GC-02`)**: Applicable integrated release evidence shows citation-ID validity 1.0, leakage 0, hallucination <5%, out-of-source rejection ≥99% and semantic citation support checks. This package's specification alone does not demonstrate those gates or the full v3 release gate.

- **SC-008 (`FR-SI-05`)**: Every overlapping manual/webhook re-sync request is rejected with `Sync already in progress`; exactly the already-active refresh continues and no follow-up is queued. A fresh request after completion can start normally.

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: Existing v1/v2 contracts and consumer behavior remain authoritative; no new locator variant, processing framework or source type beyond the card is introduced. Fixture values in scenarios represent schema-valid IDs when tests are derived. Reference behavior is unverified background, not a fresh product observation.
- **Out of Scope / Deferred**: Recursive crawling, autonomous intranet/web discovery and Deep Research belong to v6 (`FR-SI-06/07`); live keystroke streaming is excluded. Google Slides output export stays deferred under D8; D11 is import only. Packages 3.2–3.4 are separate specifications. No implementation, deployment, API enablement or release-gate certification is performed here.

## Planning refinements — 2026-10-20 (FR-SI-01/05, C-01, NFR-SEC-02)

- Preserve the shared C-01 locator union; `mm:ss` is derived from `start_ms` in transcript/view metadata, not an additional required field inserted into strict shared locator objects. Reconcile any earlier plan/runtime encoding drift against SRS and consumer tests before v3 implementation; no breaking migration is authorized here.
- Use durable operation IDs and a per-source publication fence for re-sync. A transport redelivery resumes the same operation idempotently; a distinct manual/webhook request while active is rejected with `Sync already in progress`, with no queued follow-up. Deletion or stale fencing tokens prevent later publication.
- Provider export/caption capability failures remain explicit failures without truncation, service-account fallback, or redefining the inclusive application quota. Drive export's documented provider ceiling is not the application's 200MB limit; use supported delegated long-running export where appropriate. Public YouTube visibility alone does not imply authorized caption/audio access. The existing inaccessible-video failure applies; no assigned scope is removed.
- Source media delivery must recheck document/notebook authorization and revision validity; an expired or revoked source cannot remain readable through a previously issued reusable signed object URL. Use authorization-checked proxy delivery with invalidation of active delivery on revocation.
- The package plan uses regional Speech V2 Chirp 2 word offsets and existing Office normalization plus supplemental notes/descriptions, with Model Armor fail-closed screening. Deployment availability and the unchanged 45-second P95 target require live evidence; neither is asserted by planning. See `specs/009-multimodal-ingestion-sync/research.md` and `plan.md` for rationale and provider references.

## Latest-main refinement — 2026-10-21 (FR-SI-01/05, FR-SI-02/04, C-01/C-02)

- Preserve canonical viewer text and chunk anchors atomically with each published source revision under D15, so removing a source makes its text unavailable immediately through the same relational source access boundary. Raw and binary media delivery remains separately authorized.
- A successful re-sync durably invalidates the previous current Source Guide and requests generation for the new exact revision/output language. Restart or redelivery must not lose the request or allow an old Guide to appear as current (D16). D16/specs/013 now supplies durable v2 storage and restart recovery; this package preserves those outcomes and adds reliable re-sync-trigger delivery, rather than redefining existing v2 persistence. Recovery must eventually regenerate the new revision even without a user reopening the source; existing valid Guide results are reused.
- Preserve source-from-note provenance, shared source quota and trusted-only note-source admission when adding v3 source types (`FR-NM-03`, `FR-WM-07`). The 1–200-point rename limit is specific to FR-SI-05; existing copied-text creation retains its own 100-point title limit.
- Gate v2 is owner-approved by override, recorded in `docs/gate-v2-live-evaluation.md`; the 2026-10-22 live re-run passes #3 while #1 and FR-GC-07 Shorter still fail; this is not a new claim that the earlier failed measurements passed.

## Task-analysis refinements (2026-10-22; FR-SI-01/05, C-01, CC-01/02)

The `mm:ss` display value is derived transcript/view metadata, never a new strict C-01 locator field. For SC-002 predeclare N≥20 audio attempts; include every accepted attempt in nearest-rank P95, mapping failed/unfinished attempts to positive infinity and reporting their outcomes separately. No latency-based removal or cold/warm reclassification is allowed; the ≤45s threshold and accepted queue-inclusive clock remain unchanged. Concrete task files and reserved migration 0009 are implementation decomposition, not new feature scope.

## Implementation refinements — 2026-10-23 (FR-SI-01/05, FR-SI-02/04, C-01/C-02, NFR-SEC-01/02; specs/009 implement)

Discovered or decided during `/speckit-implement`; they refine existing requirements and add no scope. C-01 is unchanged.

- **Transcript chunking (FR-SI-01, Gate v3.0 #1):** ASR words become transcript segments (sentence end, pause > 1.5 s, ≤ 40 words / 30 s); a caption cue is one segment. Each segment is a canonical `source_pages` row with integer `start_ms`/`end_ms`. Transcript chunks are segment-aligned (a sentence end starts a new chunk; ≤ 120 tokens, ≤ 60 s) so a citation seeks to its own statement; the 300–600-token target keeps applying to page and article text. Chunks carry a database-only `anchor_page`, never a C-01 field.
- **Web (FR-SI-01, NFR-SEC-02):** article text is stored as sanitized sections addressed by `section:nth-of-type(n)` (`dom_path` selector); fewer than 10 extracted words counts as "no extractable article content". `http` and `https` URLs are accepted; private/ULA destinations only through the tenant policy (`WEB_PRIVATE_NETWORKS`, optional `WEB_PRIVATE_HOSTS`) for the notebook Owner. Each fetch has one 60-second wall-clock deadline across redirects, headers and body. A blocked destination fails with "This URL points to a network destination that cannot be imported" (`DestinationBlocked`).
- **Video (FR-SI-01):** supported: direct WebVTT, enterprise pages with an accessible `<track kind=captions|subtitles>`, or an accessible audio/video stream (downloaded through the same guard, then ASR). A YouTube URL fails with "No transcript available for this video" without contacting YouTube, because public visibility does not grant caption/audio access; delegated YouTube caption access is not implemented in v3.
- **Office (FR-SI-01):** with the `everlast-render` job configured, LibreOffice PDF pages are the viewer pages (input OOXML sanitized first; see the security review in `specs/009-multimodal-ingestion-sync/implementation-evidence.md`); without it, deterministic native OOXML pagination is used (explicit/Word-rendered page breaks, slide order). Speaker notes are a separate section of their slide page.
- **Re-sync (FR-SI-05):** eligible link kinds are Web URL and Drive only (a video URL is not a mutable linked document). Byte-identical normalized content completes the sync without a new revision and updates `last_synced_at`. Previous revisions' rows are retained as historical evidence until the source is removed; C-02 reads only the active revision.
- **History (FR-GC-03, FR-SI-05):** a citation of a replaced revision has status `updated` ("Source updated"): saved snippet, no locator, click opens the current source at the top; the answer stays visible and is excluded from new prompts by the exact-revision history filter. Removed sources keep the existing `deleted` behaviour (answer hidden).
- **Media delivery (FR-SI-04/05):** the Inspector plays audio through `/media/{capability}` bound to user, notebook, source and revision (30-minute expiry); every request, including each Range request, re-checks ownership, Ready state and revision.
- **Screening (Constitution VI):** quarantine message "Content was blocked by safety screening"; a missing, failing or slow screener fails closed. Only local offline development may opt into a pass-through screener (refused on Cloud Run/production).
- **Delegated Drive (D11):** OAuth state is browser-bound (HttpOnly nonce cookie + single-use server row `oauth_states`) with PKCE; scope `drive.readonly`; the refresh token lives in Secret Manager. Provider push channels are accepted at `POST /webhooks/google-drive` (channel ID + token hash); creating Drive watch channels needs a verified public callback domain and is a deployment follow-up.
- **Durable Guide trigger (FR-SI-02, D16):** every published revision writes a `source_publication_events` row; the API's v2 runtime drains it and completes it only when a terminal guide exists; guide writes are fenced to the source's current Ready revision.
- **Dependencies:** `@mozilla/readability` (architecture-selected) with `jsdom` as its inert DOM host (worker, render sanitizer); loaded without leaking browser DOM types into other programs.
- **Migration:** `0009_multimodal_ingestion_sync.sql` (also holds `oauth_states`). Packages 3.2/3.3 start at `0010`.
- **Open runtime evidence:** live Speech V2 45-second P95 benchmark, judged release suite, live Drive/Model Armor/LibreOffice execution and the v3 release gate remain UNAVAILABLE (no approved API enablement or release candidate).

### Convergence follow-up — 2026-10-23 (FR-SI-01/02/05, FR-GC-03; specs/009 T054–T056)

- **Drive webhook channels (FR-SI-05):** with `DRIVE_WEBHOOK_ADDRESS` configured (verified public HTTPS domain), every successful Drive import or re-sync creates a `files.watch` channel with the user's delegated token; only a hash of the random channel token is stored; watch failures never fail the import. This supersedes the earlier "channel creation is a deployment follow-up" note; enabling it still needs the verified domain.
- **Authorized picker (FR-SI-01, D11):** when `GOOGLE_PICKER_API_KEY`/`GOOGLE_PICKER_APP_ID` are configured, "Choose from Google Drive" opens Google Picker with the user's own short-lived browser `drive.file` token (never sent to the API); the picked file ID is imported through the same server-side delegated import.
- **Video players (FR-SI-04, FR-GC-03):** a transcribed video stream is played through the authorized media proxy (`video` player; citations seek to `start_ms`); a captions-only video keeps a link to the original page, updated to the cited `#t=` timestamp.


### PR #160 review refinements (2026-10-25; FR-SI-01/04/05, NFR-SEC-02)

- Media delivery rechecks notebook ownership and the current source revision/object after storage reads and immediately before returning full or ranged bytes. Deletion or replacement during I/O invalidates the response.
- Drive import publication and both changed/unchanged re-sync completion recheck the owner's active delegated connection inside the publishing transaction, holding a shared connection lock against revocation. Revoked grants fail with `DelegatedAccessDenied`; failed re-sync preserves the previous Ready revision.
- The worker ZIP reader rejects stored-size mismatches and bounds deflate output by the declared uncompressed size, verifies the actual size, and enforces the remaining archive budget before accepting data.

Caption review (FR-SI-01, NFR-SEC-02): extract plain transcript text using the existing inert HTML parser, decode entities exactly once, and retain text-only rendering in viewers. Never treat extracted caption text as sanitized HTML.
