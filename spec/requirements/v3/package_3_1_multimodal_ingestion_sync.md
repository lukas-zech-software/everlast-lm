# Package 3.1 — Multimodal Ingestion & Sync

- **Release:** v3.0
- **Goal:** Extend the ingestion pipeline (`Contract C-01`) to natively parse DOCX, PPTX, Web URLs, Video URLs (with timestamp transcripts), and Audio files (via ASR with timestamps), and enable renaming, deleting, and re-synchronizing sources.
- **FRs:** FR-SI-01 (Subset B: DOCX/Google Docs, PPTX/Slides, Web URLs, Video URLs, Audio ASR), FR-SI-05
- **Gate criteria (SRS §5.4):** Gate v3.0 #1 — Audio-/Video-Uploads erzeugen Chunks mit klickbaren Zeitstempel-Locators (`mm:ss`).
- **Out of scope:** Autonomous intranet/web search discovery (`v6.0` — `FR-SI-06`, `FR-SI-07`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-SI-01 (Subset B) — Office, Web, Video & Audio Ingestion

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-01 (Subset A), FR-SI-04, FR-WM-07, C-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor uploads a `.docx` or `.pptx` file, the system shall extract all document/slide text, tables, speaker notes, and embedded visual descriptions into `UnifiedDocumentChunk` records (`Contract C-01`) with C-01 `page_span` locators into the normalized viewer document. The Office adapter must preserve speaker notes and extract visual descriptions alongside PDF conversion; a rendered slide number is page metadata, not a new locator variant.
- *Event:* When the Owner submits a Google Docs/Slides link or selects a document in the authorized picker, the v3 Google Drive import adapter shall use that user's delegated read access, export Docs/Slides into the Office normalization path, and preserve the external document ID for manual re-sync. Reject revoked/insufficient permission; never substitute a service account's access. This import adapter precedes v6 enterprise discovery (D11).
- *Event:* When the Owner/Editor submits a Web URL, the system shall fetch the page, strip boilerplate navigation/ads, extract the main article content into `UnifiedDocumentChunk` records, and store the canonical URL.
- *Event:* When the Owner/Editor submits a Video URL (e.g., YouTube or internal media portal) or uploads an Audio file (`.mp3`, `.wav`, `.m4a`), the system shall extract the caption transcript or run Automatic Speech Recognition (ASR) to produce `UnifiedDocumentChunk` records where every chunk carries the existing C-01 `time_span` locator (`start_ms`, `end_ms`); its transcript/view DTO exposes the formatted `mm:ss` derived from `start_ms`, outside the strict locator object.
- *Event:* When the user clicks an inline citation `[n]` (`FR-GC-03`) pointing to an audio or video chunk, the Source Inspector (`FR-SI-04`) shall open the transcript with an embedded media/timestamp player, scroll to the highlighted transcript segment, and seek the player to `start_ms`.

**User story:** As a researcher working with heterogeneous media, I want to add Word docs, PowerPoint decks, web articles, YouTube/video links, and audio recordings to my notebook and jump to the exact timestamp when clicking a citation, so that all my formats are unified in one workspace.

**Reference behaviour**
1. In the `"Add sources"` modal, in addition to file upload and pasted text, the user sees chips for `Website`, `YouTube` (Video URL), and `Google Drive / Office files` (`.docx`, `.pptx`), plus audio file support (`.mp3`, `.wav`, `.m4a`) in the file dropzone.
2. Uploading an `.mp3` meeting recording transcribes the audio in the background; once `Ready`, opening it in the Source Inspector shows the timestamped transcript alongside the Source Guide.
3. Clicking a citation `[3]` from a video/audio source highlights the transcript passage at e.g. `14:22` and seeks the embedded player to `14:22`.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.2 FR-SI-01` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Office files | `.docx`, `.pptx` | Max $200\text{ MB}$, $\le 500,000$ words (`FR-WM-07`) | — |
| Audio files | `.mp3`, `.wav`, `.m4a` | Max $200\text{ MB}$ | — |
| Website URL | `https://...` | Public HTML or explicitly allowlisted enterprise HTML reachable under the requesting user's authorized access; Google Docs/Slides use the delegated v3 adapter, not generic scraping | — |
| Video URL | YouTube / enterprise video URL | Must have captions/transcript or audio track accessible | — |
| `time_span` locator / display DTO | Existing `Contract C-01` JSON + transcript/view DTO | Locator retains integer `start_ms`, `end_ms`; derived `display_time: "mm:ss"` is view metadata outside the strict C-01 locator | — |

**Outputs & state**
- Visible: Format-specific icons (Web globe, Video play icon, Audio waveform, Slides icon, Doc icon) in the Left Panel; timestamped transcript + media player in Source Inspector.
- Persisted: `Source` record (`media_type`, `external_url`) and `UnifiedDocumentChunk` records with `page_span`, `time_span`, or `dom_path` locators only (C-01).
- States: `Uploading` $\rightarrow$ `Processing` $\rightarrow$ `Ready` (or `Failed`), with Fetching/Transcribing/Parsing as progress substates, not new eligibility states.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Audio upload produces chunks with clickable mm:ss timestamp locators (Gate v3.0 #1)
  Given an open notebook
  When the owner uploads a 10-minute "Interview.mp3" file
  Then the ASR pipeline transcribes the audio and creates UnifiedDocumentChunk records
  And every chunk contains a valid existing C-01 time_span locator (start_ms, end_ms)
  And its transcript/view DTO exposes the derived display_time "mm:ss"
  When the user clicks a chat citation [1] referencing a statement at 04:15 in "Interview.mp3"
  Then the Source Inspector opens "Interview.mp3", highlights the segment at 04:15, and seeks the player to 04:15

Scenario: Audio transcription timing includes queue waiting
  Given a declared 30-minute audio fixture has completed upload
  When the uploaded audio is accepted for transcription
  Then timing starts at acceptance and includes queue waiting
  And timing ends when the timestamped transcript is available
  And P95 across the declared benchmark runs is at most 45 seconds
  And upload and later indexing are excluded

Scenario: Paywalled or unreachable Web URL fails with clear message
  Given a Web URL returning HTTP 403 Forbidden or no extractable article content
  When the owner submits the URL in the "Website" dialog
  Then the source status transitions to "Failed" with reason "Unable to extract content from URL"

Scenario: Google Slides import preserves notes and deterministic locators
  Given an owner has delegated read access to a Google Slides document with slide text and speaker notes
  When the owner imports its link
  Then both slide text and speaker notes appear in the normalized viewer
  And all citations use C-01 page_span locators rather than a slide_number variant
  When delegated access is revoked before re-sync
  Then re-sync is denied without using a privileged service account
```

**Edge & error cases**
- SSRF protection applies before each connection and redirect, including resolved IPs: always block loopback, metadata, link-local and equivalent IPv4-mapped IPv6 destinations. Private ranges (including IPv6 ULA) are denied except explicit enterprise destinations allowed by tenant network policy and user authorization; an allowlisted hostname cannot bypass forbidden addresses or DNS-rebinding checks.
- Screen web/research content for prompt injection before indexing or model use (Constitution VI). Quarantined content never becomes Ready or enters C-02.
- Video URL has neither subtitles nor an extractable audio stream $\rightarrow$ Fails gracefully with `"No transcript available for this video"`.
- Web URL points to a PDF $\rightarrow$ Automatically routes to the PDF ingestion parser (`Paket 1.2`).

**Measurable criteria**
- $100\%$ of ingested audio/video chunks contain valid `time_span` (`mm:ss`) locators (`Gate v3.0 #1`).
- $30$-minute audio file ASR transcription completes in $\le 45\text{ s}$ (P95), measured from acceptance of the uploaded audio for transcription until its timestamped transcript is available. Include queue waiting; exclude upload and later indexing. Use a declared fixture/environment.

**Deviations from reference:** Use the architecture's fetch + Readability path with deterministic snapshots. A page containing only an unsupported JavaScript shell fails clearly; no unapproved headless-browser dependency is implied.

**Out of scope:** Crawling entire multi-page websites recursively from a single root URL (`Discover Sources` is in `v6.0`).

**Open questions:** `None`

---

### FR-SI-05 — Source CRUD (Rename, Delete) & Re-Synchronization

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-01, FR-GC-03, C-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks the three-dot menu (`⋮`) next to a source in the Left Panel and selects `"Rename source"` (`"Quelle umbenennen"`), the system shall update the `Source.title` across the sidebar, Source Inspector, and all citation tooltips.
- *Event:* When the Owner/Editor selects `"Remove source"` (`"Quelle entfernen"`) and confirms, the system shall delete the `Source` and its `UnifiedDocumentChunk` records from the notebook and decrement the source counter.
- *Event:* Where a source originates from a mutable external link (Web URL or linked cloud/intranet document), when the Owner/Editor clicks `"Re-sync"` (`"Neu synchronisieren"` / `"Click to sync"`) in the Source Inspector or via a webhook event, the system shall re-fetch the latest content, stage and validate the replacement (limits, safety, parsing and embeddings), then atomically replace the source's `UnifiedDocumentChunk` set with fresh non-reused chunk IDs, and regenerate its `Source Guide` (`FR-SI-02`).

- *State:* While a source re-sync is active, the system shall reject additional manual or webhook re-sync requests for that source with `"Sync already in progress"`, leave the active refresh unchanged, and queue no follow-up refresh. The caller must retry after the active refresh finishes.

**User story:** As a project lead working with living web pages and cloud documents, I want to rename or remove sources and re-sync external sources when the upstream document changes, so that my notebook never works on stale information.

**Reference behaviour**
1. Hovering over a source in the Left Panel reveals a three-dot menu (`⋮`) with `Remove source` and `Rename source`.
2. Opening a linked Google Doc / Slides or Web source in the Source Inspector displays a sync action if the upstream document has been modified; clicking it refreshes the notebook's copy of the source.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.2 FR-SI-05` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| New source title | UTF-8 string | $1\text{–}200$ characters after trimming | Original filename / page `<title>` |
| Re-sync trigger | User click or webhook payload | Only available for URL / connected document sources | — |

**Outputs & state**
- Visible: Updated title in sidebar; `"Syncing..."` indicator during re-sync; updated `last_synced_at` timestamp in Source Inspector.
- Persisted: Atomic swap of `UnifiedDocumentChunk` records for `source_id`; updated `content_hash` and `last_synced_at`.
- States: `Ready` with a `ReSyncing` operation indicator $\rightarrow$ `Ready` at the new revision on success; the old committed revision remains readable until atomic swap and is retained on any failure. This does not change the FR-SI-03 Ready eligibility rule.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Overlapping re-sync requests are rejected without a queued follow-up
  Given a source re-sync is already active
  When another manual request or webhook requests re-sync for that source
  Then the additional request is rejected with "Sync already in progress"
  And the active refresh continues unchanged and no follow-up is queued
  When the caller submits a new request after the active refresh finishes
  Then the new request can start normally

Scenario: Re-syncing a Web URL updates chunks atomically and keeps previous chunks on network failure
  Given a Web URL source "https://intranet.corp/roadmap" ingested with content "Release v1 in May"
  When the upstream page changes to "Release v1 in June" and the owner clicks "Re-sync"
  Then the source chunks are replaced and asking "When is Release v1?" answers "June"
  When the upstream server returns HTTP 503 during a subsequent "Re-sync"
  Then the system displays a sync error toast and retains the "June" chunks intact
```

**Edge & error cases**
- Historical chat message cited `chk_old_04` before re-sync $\rightarrow$ Mark the citation `Source updated`; an authorized viewer may read the saved historical snippet and explicitly open the current source at the top, but no exact-passage jump is offered. Chat-Only click-through stays blocked. Never retarget the old chunk ID to new text or use the stale snippet in a new prompt.

**Measurable criteria**
- Deleting a source removes its chunks from retrieval immediately ($0\text{ ms}$ staleness on next chat turn).

**Deviations from reference:** Generalizes Google Drive's `"Click to sync with Google Drive"` to work for any Web URL or connected enterprise document repository.

**Out of scope:** Sub-second live keystroke streaming from external editors.

**Open questions:** `None`

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

## Task-analysis clarification (2026-10-22; FR-SI-01/05, C-01)

The timestamp display label is derived view metadata; the existing strict C-01 locator remains unchanged. For the declared 30-minute audio benchmark, predeclare N≥20 accepted attempts, include all attempts in nearest-rank P95, and sort failed/unfinished attempts as positive infinity while retaining their separate outcomes. Do not remove attempts or reclassify them based on observed latency. The ≤45s target still includes queue waiting and excludes upload/indexing. Concrete migration 0009 and file ownership in the feature plan only decompose this package's existing implementation scope.

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
