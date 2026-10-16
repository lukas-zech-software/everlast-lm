# Package 1.2 — Text/PDF Ingestion & Inspector

- **Release:** v1.0
- **Goal:** Ingest PDF (including OCR), TXT, Markdown, and pasted raw text into normalized `UnifiedDocumentChunk` records, allow granular source selection, and provide an in-app Source Inspector with deterministic citation highlighting.
- **FRs:** FR-SI-01 (Subset A: PDF, TXT, Markdown, Copied Text), FR-SI-03, FR-SI-04
- **Gate criteria (SRS §5.4):** Gate v1.0 #1 — an end-to-end upload (PDF/MD) produces valid `UnifiedDocumentChunk` records; Gate v1.0 #2, `NFR-EVAL-04` part — $\text{Leakage} = 0$; Gate v1.0 #3 — clicking citation `[n]` deterministically scrolls the Source Inspector to the correct passage in a UI test.
- **Out of scope:** DOCX, PPTX, Web URLs, YouTube/Video URLs, Audio ASR, and source re-sync (`v3.0` — `FR-SI-01` Subset B, `FR-SI-05`); automatic Source Guide generation (`v2.0` — `FR-SI-02`); Discover Sources / Deep Research (`v6.0` — `FR-SI-06`, `FR-SI-07`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-SI-01 (Subset A) — Text, Markdown, PDF & Copied Text Ingestion

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.2 |
| Priority (within package) | P1 |
| Actors | Owner; Editor (from v6.0) |
| Depends on | FR-WM-01, FR-WM-07, C-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor uploads a `.pdf`, `.txt`, or `.md` file or submits pasted text via the "Copied text" dialog, the system shall create a `Source` record in state `Uploading`, move it to `Processing` once the content is received, extract the text and structural layout (including OCR for scanned PDF pages and table structure), segment it into `UnifiedDocumentChunk` objects (`Contract C-01`), and transition the source to `Ready`.
- *Ubiquitous:* The system shall assign every `UnifiedDocumentChunk` a deterministic `locator` (`page_span` with page and text offsets for PDFs; `page_span` with paragraph/text offsets and no physical page for TXT/MD/Copied Text) so that citations can resolve back to the exact passage.
- *Unwanted:* If a file is corrupted, password-protected, or contains zero extractable text even after OCR, then the system shall transition the source state to `Failed` and display an inline error indicator next to the source in the sidebar.

**User story:** As a researcher, I want to upload PDFs (including scanned documents), text files, Markdown files, or pasted clipboard text into my notebook, so that the AI can analyze and cite their contents accurately.

**Reference behaviour**
1. User clicks `+ Add source` in the left Sources panel.
2. Modal displays a drag-and-drop file zone (`Upload files: PDF, .txt, Markdown`) and a chip for `Paste text` (`Copied text`).
3. If the user selects `Copied text`, a sub-dialog opens with a multi-line textarea; clicking `Insert` names the source `"Pasted text"` (editable later in `v3.0`) and starts ingestion.
4. During ingestion, the source appears in the left sidebar with a spinning progress indicator.
5. Once complete, the spinner turns into a source-type icon (PDF/Text icon) and a checked checkbox.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.2 FR-SI-01` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| File upload | `.pdf`, `.txt`, `.md` | Max $200\text{ MB}$, max $500,000$ words per source (`FR-WM-07`) | — |
| Copied text | UTF-8 string | $1\text{ char}$ to $500,000$ words | Source title: `"Pasted text"` |
| `UnifiedDocumentChunk` | `Contract C-01` JSON | `source_id`, `chunk_id`, `text`, `token_count`, `locator` (`page_span`; text-only sources omit the physical page) | — |

**Outputs & state**
- Visible: Source item in left sidebar with format icon, title, and status indicator.
- Persisted: `Source` record (`id`, `notebook_id`, `title`, `media_type`, `status`, `word_count`) and $1..N$ `UnifiedDocumentChunk` records.
- States: `Uploading` $\rightarrow$ `Processing` $\rightarrow$ `Ready` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Upload multi-page PDF with scanned page produces valid chunks
  Given an open notebook
  When the owner uploads a 10-page PDF where page 4 is a scanned image of text
  Then the source transitions from "Processing" to "Ready"
  And every generated UnifiedDocumentChunk conforms to Contract C-01
  And chunks from page 4 contain the OCR-extracted text with locator page = 4

Scenario: Paste raw clipboard text
  Given the "Add sources" modal is open
  When the owner clicks "Copied text", pastes 1,500 words of meeting notes, and clicks "Insert"
  Then a new source titled "Pasted text" is added to the sidebar in state "Ready"
  And its chunks are immediately selectable for chat queries

Scenario: Password-protected PDF fails gracefully
  Given an encrypted, password-protected PDF file
  When the owner uploads the file
  Then the source status transitions to "Failed"
  And an error message "Could not read file (password-protected or corrupted)" is shown
```

**Edge & error cases**
- Empty `.txt` or `.md` file ($0\text{ bytes}$) $\rightarrow$ Rejected with message `"File is empty"`.
- PDF containing only decorative vector graphics and no text $\rightarrow$ OCR yields $0$ tokens; source marked `Failed` (`"No extractable text found"`).
- Simultaneous upload of $20$ PDF files $\rightarrow$ Queued and processed concurrently without blocking the UI thread.

**Measurable criteria**
- Standard $20$-page digital PDF is parsed, chunked, and `Ready` in $\le 5.0\text{ s}$ (P95).
- 100% of persisted chunks validate against the `Contract C-01` JSON schema (`Gate v1.0 #1`).

**Deviations from reference:** None for Subset A.

**Out of scope:** Google Drive picker integration, DOCX/PPTX, Web URLs, YouTube, Audio (`v3.0`).

**Open questions:** None for implementation. Reference chunking internals are unverified. The architecture uses structure-aware chunks targeting 300–600 tokens with overlap, without crossing page/section boundaries; size is a chunker policy, not part of C-01. Short boundary fragments may be below 300 tokens; split oversized sections rather than exceed the configured cap.

---

### FR-SI-03 — Granular Source Selection / Scoping

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.2 |
| Priority (within package) | P1 |
| Actors | Owner; Editor, Viewer (from v6.0) |
| Depends on | FR-SI-01, C-02, NFR-EVAL-04 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The system shall display a checkbox next to every source in the left sidebar and a master `"Select all sources"` checkbox at the top of the source list.
- *Event:* When a new source finishes ingestion (`Ready`), the system shall automatically set its checkbox to selected in the importing user's session only ($s_i \in S_{\text{aktiv}}$).
- *Event:* When the user toggles any source checkbox or the `"Select all sources"` checkbox, the system shall immediately update the active source set $S_{\text{aktiv}}$ and update the counter badge (`"<n> sources"` / `"<n> Quellen"`) inside the chat input bar.
- *State:* While a source is in state `Uploading`, `Processing`, or `Failed`, the system shall disable its selection checkbox and exclude it from $S_{\text{aktiv}}$.
- *Unwanted:* If the user deselects all sources ($\lvert S_{\text{aktiv}}\rvert = 0$), then the system shall disable chat submit and Studio generation, display a prompt to select at least one source, and reject empty-scope generation requests server-side.

**User story:** As a knowledge worker, I want to check or uncheck individual sources in the sidebar before asking a question, so that I can restrict the AI's reasoning to a specific subset of documents.

**Reference behaviour**
1. Left sidebar lists all uploaded sources with a checkbox on the right of each row and a `"Select all sources"` row above them.
2. Newly uploaded sources default to checked.
3. User unchecks $2$ of $5$ sources; the pill next to the chat prompt box immediately changes from `"5 sources"` to `"3 sources"`.
4. User submits a chat message; the backend `ScopedContextProvider` (`Contract C-02`) receives only the $3$ checked `source_id`s.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.2 FR-SI-03` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $0 \le \lvert S_{\text{aktiv}}\rvert \le N_{\text{max}}$, each source must be in state `Ready` | All `Ready` sources in the notebook |

**Outputs & state**
- Visible: Individual checkboxes, master checkbox (checked / indeterminate / unchecked), and `"<n> sources"` indicator in the chat input bar.
- Persisted: Active selection state in session/client state and sent explicitly with every chat/Studio request payload to `ScopedContextProvider`.
- States: `AllSelected` $\leftrightarrow$ `PartialSelected` $\leftrightarrow$ `NoneSelected`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Deselected source never leaks into context
  Given Source A ("Policy_2024.pdf") and Source B ("Policy_2025.pdf") are in state "Ready"
  And only Source B contains the phrase "Project Aurora budget is $4.2M"
  When the user unchecks Source B so only Source A is selected
  And the user asks "What is the Project Aurora budget?"
  Then ScopedContextProvider returns chunks exclusively from Source A
  And the chat answer states that the selected sources do not mention Project Aurora

Scenario: Zero sources selected disables chat input
  Given a notebook with 2 ready sources
  When the user unchecks "Select all sources"
  Then the chat input counter shows "0 sources"
  And the chat send button is disabled
```

**Edge & error cases**
- Source is deleted while checked $\rightarrow$ Automatically removed from $S_{\text{aktiv}}$ and counter decrements by $1$.
- User toggles selection while a previous chat answer is streaming $\rightarrow$ In-flight request completes with the snapshot of $S_{\text{aktiv}}$ taken at request submission; subsequent turn uses the new selection.

**Measurable criteria**
- Context leakage from unselected sources ($s_i \notin S_{\text{aktiv}}$) = $0$ across the `NFR-EVAL-04` test suite (`Gate v1.0 #2`).
- UI counter updates within $\le 50\text{ ms}$ of checkbox click.

**Deviations from reference:** None.

**Out of scope:** Saved selection presets / source folders.

**Open questions:** None. Selection is local per user, browser session, and notebook and is passed explicitly on each request (see the cross-package rules).

---

### FR-SI-04 — Integrated Source Inspector (Source Viewer)

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.2 |
| Priority (within package) | P1 |
| Actors | Owner; Editor, Viewer (from v6.0) |
| Depends on | FR-SI-01, FR-GC-03, C-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the user clicks a source title in the left sidebar, the system shall expand the left panel into the Source Inspector view and render the formatted full text of that source without leaving or resetting the active chat session.
- *Event:* When the Source Inspector is opened via a click on an inline citation badge `[n]` (`FR-GC-03`), the system shall open the corresponding source, scroll smoothly and deterministically to the DOM element matching the cited chunk's `locator`, and apply a visual highlight to the cited passage.
- *Event:* When the user clicks the close (`✕`) or back button in the Source Inspector header, the system shall collapse the inspector and return to the standard source list sidebar.

**User story:** As a researcher, I want to read the full text of any source side-by-side with my chat and have clicked citations jump straight to the highlighted passage, so that I can verify the surrounding context immediately.

**Reference behaviour**
1. User clicks on a source row (outside the checkbox) in the left panel, or clicks a citation badge `[1]` in a chat response.
2. The left panel widens and opens the Source Viewer displaying the source title at the top and the full extracted document text below (with page/section boundaries).
3. If opened via citation `[1]`, the viewer automatically scrolls to the exact cited paragraph and highlights it in a distinct accent color (e.g., purple/blue highlight).
4. User can scroll up and down through the entire document or click `✕` to return to the source list.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.2 FR-SI-04` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `source_id` | UUID | Must exist in current `notebook_id` | — |
| `highlight_chunk_id` (optional) | Chunk UUID (`Contract C-01`; locator is resolved server-side) | Valid `chunk_id` belonging to `source_id` | `null` (scroll to top) |

**Outputs & state**
- Visible: Expanded left panel with document header, scrollable full-text container (`data-chunk-id` anchors), and highlighted passage when triggered from a citation.
- Persisted: Read-only view of persisted `UnifiedDocumentChunk` records ordered by sequence/offset.
- States: `Closed (List View)` $\leftrightarrow$ `Open (Document View)` $\leftrightarrow$ `Open & Highlighted (Chunk Focused)`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Clicking source title opens full text at top
  Given a notebook with a Ready source "Architecture_Spec.md"
  When the user clicks the title "Architecture_Spec.md" in the sidebar
  Then the Source Inspector opens in the left panel
  And renders the full text of "Architecture_Spec.md" scrolled to the top
  And on desktop the middle Chat panel remains visible and intact (on narrow screens the Chat tab retains its state)

Scenario: Citation click scrolls deterministically to target chunk
  Given a chat answer with citation [2] pointing to chunk "chk_042" on page 7 of "Report.pdf"
  When the user clicks citation badge [2]
  Then the Source Inspector opens "Report.pdf"
  And the DOM element with data-chunk-id="chk_042" is scrolled into the viewport
  And the element has the active highlight CSS class applied
```

**Edge & error cases**
- Very large source ($400,000$ words) opened in Source Inspector $\rightarrow$ Uses virtualized scrolling / windowed chunk rendering so jumping to `chk_1500` (with structure-aware chunks targeting 300–600 tokens; exact chunk count depends on content and overlap) completes without freezing the browser tab.
- User clicks a second citation `[3]` from a different source while Source Inspector is already open on `[1]` $\rightarrow$ Inspector switches immediately to the new source and scrolls to `[3]`.

**Measurable criteria**
- Opening a source and scrolling to a cited `chunk_id` completes in $\le 300\text{ ms}$ (`Gate v1.0 #3`).
- Scroll target is 100% deterministic in automated Playwright/DOM E2E tests.

**Deviations from reference:** In `v1.0`, the top of the Source Inspector displays only the document title and full text; the collapsible *Source Guide* (summary + key topics) at the top of the inspector is added in `v2.0` (`FR-SI-02`).

**Out of scope:** Editing source text inside the inspector; audio/video timestamp player inside the inspector (`v3.0`).

**Open questions:** `None`
