# Package 3.1 — Multimodal Ingestion & Sync

- **Release:** v3.0
- **Goal:** Extend the ingestion pipeline (`Contract C-01`) to natively parse DOCX, PPTX, Web URLs, Video URLs (with timestamp transcripts), and Audio files (via ASR with timestamps), and enable renaming, deleting, and re-synchronizing sources.
- **FRs:** FR-SI-01 (Subset B: DOCX/Google Docs, PPTX/Slides, Web URLs, Video URLs, Audio ASR), FR-SI-05
- **Gate criteria (SRS §5.4):** Gate v3.0 #1 — Audio-/Video-Uploads erzeugen Chunks mit klickbaren Zeitstempel-Locators (`mm:ss`).
- **Out of scope:** Autonomous intranet/web search discovery (`v6.0` — `FR-SI-06`, `FR-SI-07`).

---

### FR-SI-01 (Subset B) — Office, Web, Video & Audio Ingestion

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-01 (Subset A), FR-SI-04, FR-WM-07, C-01 |
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor uploads a `.docx` or `.pptx` file, the system shall extract all document/slide text, tables, speaker notes, and embedded visual descriptions into `UnifiedDocumentChunk` records (`Contract C-01`) with `page_span` / `slide_number` locators.
- *Event:* When the Owner/Editor submits a Web URL, the system shall fetch the page, strip boilerplate navigation/ads, extract the main article content into `UnifiedDocumentChunk` records, and store the canonical URL.
- *Event:* When the Owner/Editor submits a Video URL (e.g., YouTube or internal media portal) or uploads an Audio file (`.mp3`, `.wav`, `.m4a`), the system shall extract the caption transcript or run Automatic Speech Recognition (ASR) to produce `UnifiedDocumentChunk` records where every chunk carries a `time_span` locator (`start_ms`, `end_ms`, formatted `mm:ss`).
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
| Website URL | `https://...` | Publicly/internally reachable HTML; no paywall/login wall unless authenticated connector (`v6.0`) | — |
| Video URL | YouTube / enterprise video URL | Must have captions/transcript or audio track accessible | — |
| `time_span` locator | `Contract C-01` JSON | `{ start_ms: int, end_ms: int, display_time: "mm:ss" }` | — |

**Outputs & state**
- Visible: Format-specific icons (Web globe, Video play icon, Audio waveform, Slides icon, Doc icon) in the Left Panel; timestamped transcript + media player in Source Inspector.
- Persisted: `Source` record (`media_type`, `external_url`) and `UnifiedDocumentChunk` records with `time_span` or `slide_number` locators.
- States: `Uploading / Fetching` $\rightarrow$ `Transcribing / Parsing` $\rightarrow$ `Ready` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Audio upload produces chunks with clickable mm:ss timestamp locators (Gate v3.0 #1)
  Given an open notebook
  When the owner uploads a 10-minute "Interview.mp3" file
  Then the ASR pipeline transcribes the audio and creates UnifiedDocumentChunk records
  And every chunk contains a valid time_span locator (start_ms, end_ms, "mm:ss")
  When the user clicks a chat citation [1] referencing a statement at 04:15 in "Interview.mp3"
  Then the Source Inspector opens "Interview.mp3", highlights the segment at 04:15, and seeks the player to 04:15

Scenario: Paywalled or unreachable Web URL fails with clear message
  Given a Web URL returning HTTP 403 Forbidden or an empty JS shell
  When the owner submits the URL in the "Website" dialog
  Then the source status transitions to "Failed" with reason "Unable to extract content from URL"
```

**Edge & error cases**
- SSRF protection on Web/Video URL input $\rightarrow$ Blocks private loopback/metadata IPs (`127.0.0.1`, `169.254.169.254`, etc.) unless explicitly allowlisted enterprise intranet domains.
- Video URL has neither subtitles nor an extractable audio stream $\rightarrow$ Fails gracefully with `"No transcript available for this video"`.
- Web URL points to a PDF $\rightarrow$ Automatically routes to the PDF ingestion parser (`Paket 1.2`).

**Measurable criteria**
- $100\%$ of ingested audio/video chunks contain valid `time_span` (`mm:ss`) locators (`Gate v3.0 #1`).
- $30$-minute audio file ASR transcription completes in $\le 45\text{ s}$ (P95).

**Deviations from reference:** Unlike consumer NotebookLM (which only imports static snapshots of web pages and cannot follow links), our Web parser uses a headless browser fallback for internal SPA docs while still taking a deterministic snapshot per sync.

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
| Observed | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks the three-dot menu (`⋮`) next to a source in the Left Panel and selects `"Rename source"` (`"Quelle umbenennen"`), the system shall update the `Source.title` across the sidebar, Source Inspector, and all citation tooltips.
- *Event:* When the Owner/Editor selects `"Remove source"` (`"Quelle entfernen"`) and confirms, the system shall delete the `Source` and its `UnifiedDocumentChunk` records from the notebook and decrement the source counter.
- *Event:* Where a source originates from a mutable external link (Web URL or linked cloud/intranet document), when the Owner/Editor clicks `"Re-sync"` (`"Neu synchronisieren"` / `"Click to sync"`) in the Source Inspector or via a webhook event, the system shall re-fetch the latest content, atomically replace the source's `UnifiedDocumentChunk` set, and regenerate its `Source Guide` (`FR-SI-02`).

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
- States: `Ready` $\rightarrow$ `ReSyncing` $\rightarrow$ `Ready` (retains previous chunks if re-fetch fails).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Re-syncing a Web URL updates chunks atomically and keeps previous chunks on network failure
  Given a Web URL source "https://intranet.corp/roadmap" ingested with content "Release v1 in May"
  When the upstream page changes to "Release v1 in June" and the owner clicks "Re-sync"
  Then the source chunks are replaced and asking "When is Release v1?" answers "June"
  When the upstream server returns HTTP 503 during a subsequent "Re-sync"
  Then the system displays a sync error toast and retains the "June" chunks intact
```

**Edge & error cases**
- Historical chat message cited `chk_old_04` from before a re-sync $\rightarrow$ If `chk_old_04` no longer exists after re-sync, the historical citation tooltip still renders the snapshot snippet saved on `ChatMessage.citations` (`FR-GC-02`) and opens the updated source at the top with a note `"Source was updated since this answer was generated"`.

**Measurable criteria**
- Deleting a source removes its chunks from retrieval immediately ($0\text{ ms}$ staleness on next chat turn).

**Deviations from reference:** Generalizes Google Drive's `"Click to sync with Google Drive"` to work for any Web URL or connected enterprise document repository.

**Out of scope:** Sub-second live keystroke streaming from external editors.

**Open questions:** `None`