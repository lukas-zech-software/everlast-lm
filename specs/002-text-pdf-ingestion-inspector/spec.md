# Feature Specification: Text/PDF Ingestion & Inspector

**Feature Branch**: `spec/v1-functional-requirements`
**Created**: 2026-10-17
**Status**: Specification reviewed; implementation not started
**Package Source**: `spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md`
**SRS IDs in Scope**: FR-SI-01, FR-SI-03, FR-SI-04; C-01, C-02; Gate v1.0
**Release & Gate**: v1.0 (Gate v1.0)
**Input**: User request: SRS Version 1.0 (MVP); resumed assigned branch; specify execution 2 of 4, one package per execution.

## Source Traceability & Package Scope *(mandatory)*

Authority: [constitution](../../.specify/memory/constitution.md), [SRS](../../spec/System_Requirements_Specification_Gemeni_Notebook.md), [package cards](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md) and [binding cross-package rules](../../spec/requirements/README.md), then [architecture decisions](../../docs/solution-architecture.md#decisions). Reference-product observations are unverified background; acceptance choices below are project requirements.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-SI-01 | Text, Markdown, PDF & Copied Text Ingestion | [Card](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md#fr-si-01-subset-a--text-markdown-pdf--copied-text-ingestion) | D1–D4, D6, D14; D13 for citation publication; D5 excludes cross-notebook integration |
| FR-SI-03 | Granular Source Selection / Scoping | [Card](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md#fr-si-03--granular-source-selection--scoping) | D1–D4, D6, D14; D13 for citation publication; D5 excludes cross-notebook integration |
| FR-SI-04 | Integrated Source Inspector (Source Viewer) | [Card](../../spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md#fr-si-04--integrated-source-inspector-source-viewer) | D1–D4, D6, D14; D13 for citation publication; D5 excludes cross-notebook integration |

- **Within-Release Prerequisites (C-01, C-02, Gate v1.0)**: Shared C-01/C-02 and package 1.1 identity, notebook and atomic quota behavior precede ingestion. Citation fixtures permit independent inspector tests; package 1.3 later supplies real citations.
- **Role Phasing (FR-WM-04/05, NFR-SEC-02)**: Owner-only in v1–v5. All Editor/Viewer/Chat-only references transcribed below are future v6 conditions, not v1 permissions.
- **Data Residency (D3, NFR-SEC-01)**: EU default `europe-west4`; no region exception requested by this specification.
- **Gate contribution**: Gate v1.0 #1 — an end-to-end upload (PDF/MD) produces valid `UnifiedDocumentChunk` records; Gate v1.0 #2, `NFR-EVAL-04` part — $\text{Leakage} = 0$; Gate v1.0 #3 — clicking citation `[n]` deterministically scrolls the Source Inspector to the correct passage in a UI test.
- **Contract boundary (C-01/C-02)**: Use the one shared chunk and scoped-context contract. The C-01 locator union remains `page_span`, `time_span`, `dom_path`; v1 emits `page_span` (physical page optional for text-only content). `char_span` and `slide_number` are not additional variants. C-03 generators begin in v2, not in this package.

## User Scenarios & Testing *(mandatory)*

The following scenarios are transcribed in full. Symbolic chunk IDs denote schema-valid fixture IDs in executable tests. The normative cross-package scenarios below qualify all defaults and historical visibility statements (C-01, C-02, NFR-EVAL-04).

### User Story 1 - Text, Markdown, PDF & Copied Text Ingestion (Priority: P1)

**SRS IDs**: FR-SI-01
**Actors**: Authenticated notebook Owner.

As a researcher, I want to upload PDFs (including scanned documents), text files, Markdown files, or pasted clipboard text into my notebook, so that the AI can analyze and cite their contents accurately.

**Why this priority**: Required for the package goal: Ingest PDF (including OCR), TXT, Markdown, and pasted raw text into normalized `UnifiedDocumentChunk` records, allow granular source selection, and provide an in-app Source Inspector with deterministic citation highlighting.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-SI-01.

**Interaction flow (FR-SI-01; target behavior from the card, subject to cross-package rules)**:

1. User clicks `+ Add source` in the left Sources panel.
2. Modal displays a drag-and-drop file zone (`Upload files: PDF, .txt, Markdown`) and a chip for `Paste text` (`Copied text`).
3. If the user selects `Copied text`, a sub-dialog opens with a multi-line textarea; clicking `Insert` names the source `"Pasted text"` (editable later in `v3.0`) and starts ingestion.
4. During ingestion, the source appears in the left sidebar with a spinning progress indicator.
5. Once complete, the spinner turns into a source-type icon (PDF/Text icon) and a checked checkbox.

**Acceptance Scenarios (FR-SI-01)**:

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

### User Story 2 - Granular Source Selection / Scoping (Priority: P1)

**SRS IDs**: FR-SI-03
**Actors**: Authenticated notebook Owner.

As a knowledge worker, I want to check or uncheck individual sources in the sidebar before asking a question, so that I can restrict the AI's reasoning to a specific subset of documents.

**Why this priority**: Required for the package goal: Ingest PDF (including OCR), TXT, Markdown, and pasted raw text into normalized `UnifiedDocumentChunk` records, allow granular source selection, and provide an in-app Source Inspector with deterministic citation highlighting.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-SI-03.

**Interaction flow (FR-SI-03; target behavior from the card, subject to cross-package rules)**:

1. Left sidebar lists all uploaded sources with a checkbox on the right of each row and a `"Select all sources"` row above them.
2. Newly uploaded sources default to checked.
3. User unchecks $2$ of $5$ sources; the pill next to the chat prompt box immediately changes from `"5 sources"` to `"3 sources"`.
4. User submits a chat message; the backend `ScopedContextProvider` (`Contract C-02`) receives only the $3$ checked `source_id`s.

**Acceptance Scenarios (FR-SI-03)**:

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

### User Story 3 - Integrated Source Inspector (Source Viewer) (Priority: P1)

**SRS IDs**: FR-SI-04
**Actors**: Authenticated notebook Owner.

As a researcher, I want to read the full text of any source side-by-side with my chat and have clicked citations jump straight to the highlighted passage, so that I can verify the surrounding context immediately.

**Why this priority**: Required for the package goal: Ingest PDF (including OCR), TXT, Markdown, and pasted raw text into normalized `UnifiedDocumentChunk` records, allow granular source selection, and provide an in-app Source Inspector with deterministic citation highlighting.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-SI-04.

**Interaction flow (FR-SI-04; target behavior from the card, subject to cross-package rules)**:

1. User clicks on a source row (outside the checkbox) in the left panel, or clicks a citation badge `[1]` in a chat response.
2. The left panel widens and opens the Source Viewer displaying the source title at the top and the full extracted document text below (with page/section boundaries).
3. If opened via citation `[1]`, the viewer automatically scrolls to the exact cited paragraph and highlights it in a distinct accent color (e.g., purple/blue highlight).
4. User can scroll up and down through the entire document or click `✕` to return to the source list.

**Acceptance Scenarios (FR-SI-04)**:

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

### Cross-package acceptance scenarios (C-02, FR-WM-04, FR-SI-03, FR-GC-01/02/03/06, NFR-EVAL-04)

1. **Given** Ready sources, **When** a request omits the selection or submits an empty selection, **Then** the server rejects it, and empty selection disables source-based generation with a select-sources prompt. Initial “All Ready sources” selection never becomes a server fallback.
2. **Given** a submitted selection and revision snapshot, **When** checkboxes change, **Then** the current request keeps its snapshot and only later requests use the new selection. **When** a captured revision is deleted, replaced or becomes unauthorized before reading or publishing, **Then** the request fails without publishing stale output or substituting a new revision.
3. **Given** prior turns or caches depend on a now-deselected source or revision (even if it was not cited), **When** a new question is submitted, **Then** both the prior question and answer, derived summaries and tool output are excluded from the prompt. Missing provenance also excludes a turn. Merely deselected historical content remains viewable while authorized.
4. **Given** historical generated content, snippets or search results depend on a deleted/revoked source, **When** they are read, **Then** the affected content is hidden or unavailable and no readable cached copy is exposed. A retained unavailable citation control may display “Source deleted” but cannot reveal text or open the source.
5. **Given** an authorized source outside the current chat selection, **When** its title or a historical citation opens the inspector, **Then** an authorized singleton C-02 read displays it without altering chat selection or making it eligible for generation.
6. **Given** a factual answer with any invalid citation, **When** verification runs, **Then** the entire draft is withheld and replaced immediately by a refusal, without regeneration or citation stripping. Progress events contain no draft factual answer and do not count toward answer TTFT.

### Boundary acceptance (FR-SI-01/03/04, C-01/C-02)

- **Given** an otherwise valid source, **When** bytes or words are exactly the inclusive maximum, **Then** ingestion may succeed; **When** either exceeds its maximum by one, **Then** fail ingestion, purge partial content and release the slot. Reject whitespace-only pasted text and unsupported formats without creating a Ready source.
- **Given** 20 PDFs within remaining quota, **When** uploaded together, **Then** progress remains visible and the UI stays responsive; each Ready source becomes selected only in the importing session. Uploading/Processing/Failed checkboxes remain disabled.
- **Given** mixed Ready/non-Ready sources, **When** Select all is toggled, **Then** only Ready sources participate, the master state is checked/indeterminate/unchecked as appropriate, and the count updates within 50 ms. Deleting a selected source removes it and decrements the count.
- **Given** an open inspector, **When** the user closes it, **Then** the source list returns with chat draft, history and selection intact; a request for a highlight chunk belonging to another source cannot expose that chunk.

### Edge Cases *(mandatory)*

**FR-SI-01**

- Empty `.txt` or `.md` file ($0\text{ bytes}$) $\rightarrow$ Rejected with message `"File is empty"`.
- PDF containing only decorative vector graphics and no text $\rightarrow$ OCR yields $0$ tokens; source marked `Failed` (`"No extractable text found"`).
- Simultaneous upload of $20$ PDF files $\rightarrow$ Queued and processed concurrently without blocking the UI thread.

**FR-SI-03**

- Source is deleted while checked $\rightarrow$ Automatically removed from $S_{\text{aktiv}}$ and counter decrements by $1$.
- User toggles selection while a previous chat answer is streaming $\rightarrow$ In-flight request completes with the snapshot of $S_{\text{aktiv}}$ taken at request submission; subsequent turn uses the new selection.

**FR-SI-04**

- Very large source ($400,000$ words) opened in Source Inspector $\rightarrow$ Uses virtualized scrolling / windowed chunk rendering so jumping to `chk_1500` (with structure-aware chunks targeting 300–600 tokens; exact chunk count depends on content and overlap) completes without freezing the browser tab.
- User clicks a second citation `[3]` from a different source while Source Inspector is already open on `[1]` $\rightarrow$ Inspector switches immediately to the new source and scrolls to `[3]`.

- **Text boundaries (FR-WM-01, FR-GC-01)**: Count Unicode code points after outer whitespace trim, not bytes or grapheme clusters; reject invalid/over-limit input without truncation. Test 0/1/100/101 title code points and 0/1/10,000/10,001 message code points in the owning packages, including non-ASCII input.
- **Independent source limits (FR-WM-07, FR-SI-01)**: 200 MB = 200,000,000 bytes inclusive; 500,000 extracted words is a separate inclusive limit, including copied text. Test both exact maxima and maximum + 1, with the other limit valid. Pasted text must contain at least one code point after trimming. Empty and unsupported uploads never become usable sources.
- **Concurrent admission (FR-WM-07, FR-SI-01)**: Atomically reserve slots before ingestion; Uploading/Processing/Ready consume slots; Failed releases its slot immediately and leaves only a dismissible error row. Dismissing it does not release capacity twice. Partial/oversized objects are removed. Later-release re-sync preserves its old Ready revision and slot if validation fails; this is not v1 re-sync scope.
- **Authorization (FR-WM-04, C-02)**: Every endpoint and worker checks ownership and notebook/document access; login alone is insufficient. Cross-notebook IDs return 403 / InvalidScopeError and zero chunks, including when the same owner owns both notebooks.

## Requirements *(mandatory)*

### Functional Requirements

#### R01 — FR-SI-01 (Subset A) — Text, Markdown, PDF & Copied Text Ingestion

**Normative EARS (FR-SI-01)**

- *Event:* When the Owner/Editor uploads a `.pdf`, `.txt`, or `.md` file or submits pasted text via the "Copied text" dialog, the system shall create a `Source` record in state `Uploading`, move it to `Processing` once the content is received, extract the text and structural layout (including OCR for scanned PDF pages and table structure), segment it into `UnifiedDocumentChunk` objects (`Contract C-01`), and transition the source to `Ready`.
- *Ubiquitous:* The system shall assign every `UnifiedDocumentChunk` a deterministic `locator` (`page_span` with page and text offsets for PDFs; `page_span` with paragraph/text offsets and no physical page for TXT/MD/Copied Text) so that citations can resolve back to the exact passage.
- *Unwanted:* If a file is corrupted, password-protected, or contains zero extractable text even after OCR, then the system shall transition the source state to `Failed` and display an inline error indicator next to the source in the sidebar.

**Inputs, defaults and exact limits (FR-SI-01)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| File upload | `.pdf`, `.txt`, `.md` | Max $200\text{ MB}$, max $500,000$ words per source (`FR-WM-07`) | — |
| Copied text | UTF-8 string | $1\text{ char}$ to $500,000$ words | Source title: `"Pasted text"` |
| `UnifiedDocumentChunk` | `Contract C-01` JSON | `source_id`, `chunk_id`, `text`, `token_count`, `locator` (`page_span`; text-only sources omit the physical page) | — |

#### R02 — FR-SI-03 — Granular Source Selection / Scoping

**Normative EARS (FR-SI-03)**

- *Ubiquitous:* The system shall display a checkbox next to every source in the left sidebar and a master `"Select all sources"` checkbox at the top of the source list.
- *Event:* When a new source finishes ingestion (`Ready`), the system shall automatically set its checkbox to selected in the importing user's session only ($s_i \in S_{\text{aktiv}}$).
- *Event:* When the user toggles any source checkbox or the `"Select all sources"` checkbox, the system shall immediately update the active source set $S_{\text{aktiv}}$ and update the counter badge (`"<n> sources"` / `"<n> Quellen"`) inside the chat input bar.
- *State:* While a source is in state `Uploading`, `Processing`, or `Failed`, the system shall disable its selection checkbox and exclude it from $S_{\text{aktiv}}$.
- *Unwanted:* If the user deselects all sources ($\lvert S_{\text{aktiv}}\rvert = 0$), then the system shall disable chat submit and Studio generation, display a prompt to select at least one source, and reject empty-scope generation requests server-side.

**Inputs, defaults and exact limits (FR-SI-03)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $0 \le \lvert S_{\text{aktiv}}\rvert \le N_{\text{max}}$, each source must be in state `Ready` | All `Ready` sources in the notebook |

#### R03 — FR-SI-04 — Integrated Source Inspector (Source Viewer)

**Normative EARS (FR-SI-04)**

- *Event:* When the user clicks a source title in the left sidebar, the system shall expand the left panel into the Source Inspector view and render the formatted full text of that source without leaving or resetting the active chat session.
- *Event:* When the Source Inspector is opened via a click on an inline citation badge `[n]` (`FR-GC-03`), the system shall open the corresponding source, scroll smoothly and deterministically to the DOM element matching the cited chunk's `locator`, and apply a visual highlight to the cited passage.
- *Event:* When the user clicks the close (`✕`) or back button in the Source Inspector header, the system shall collapse the inspector and return to the standard source list sidebar.

**Inputs, defaults and exact limits (FR-SI-04)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `source_id` | UUID | Must exist in current `notebook_id` | — |
| `highlight_chunk_id` (optional) | Chunk UUID (`Contract C-01`; locator is resolved server-side) | Valid `chunk_id` belonging to `source_id` | `null` (scroll to top) |

#### Cross-package requirements (C-02, FR-SI-03, FR-GC-01/02/06, NFR-EVAL-04)

- **CP-01**: Every generation request MUST carry explicit authorized Ready source IDs and capture `(source_id, revision)` at submission; recheck authorization before reads and publication. No empty/omitted fallback is allowed. Selection is local to each user, browser session and notebook.
- **CP-02**: C-02 MUST be the sole source-read boundary, including inspector singleton reads, histories, caches, summaries, generated prompts and follow-up actions. Ingestion writes C-01 and does not bypass read scoping.
- **CP-03**: Cache identity MUST include notebook, exact source/revision set, effective authorization, output language and relevant generation parameters. Context from outside this identity MUST NOT be reused.
- **CP-04**: History inclusion MUST use complete source/revision provenance, not only displayed citations. Deletion/revocation MUST immediately invalidate affected historical generated content and cached snippets, including exports/signed URLs when those later exist. Viewability after mere deselection does not imply eligibility for new prompts.
- **CP-05**: Validate all factual-answer citations before publication; invalid citations yield immediate refusal without retry or a stripped draft. Each factual claim needs scoped supporting evidence. Merely validating the ID does not prove semantic support.
- **CP-06 (NFR-SEC-01)**: Enterprise no-training protection covers documents, prompts and outputs including model, OCR and embedding processing. No-training is not a claim of zero retention. Consumer/developer API keys cannot be used with company data. No new cloud API is authorized by this spec.

### Key Entities *(include if feature involves data)*

**FR-SI-01 (Subset A) — Text, Markdown, PDF & Copied Text Ingestion — entities, visible outputs and state (FR-SI-01)**

- Visible: Source item in left sidebar with format icon, title, and status indicator.
- Persisted: `Source` record (`id`, `notebook_id`, `title`, `media_type`, `status`, `word_count`) and $1..N$ `UnifiedDocumentChunk` records.
- States: `Uploading` $\rightarrow$ `Processing` $\rightarrow$ `Ready` (or `Failed`).

**FR-SI-03 — Granular Source Selection / Scoping — entities, visible outputs and state (FR-SI-03)**

- Visible: Individual checkboxes, master checkbox (checked / indeterminate / unchecked), and `"<n> sources"` indicator in the chat input bar.
- Persisted: Active selection state in session/client state and sent explicitly with every chat/Studio request payload to `ScopedContextProvider`.
- States: `AllSelected` $\leftrightarrow$ `PartialSelected` $\leftrightarrow$ `NoneSelected`.

**FR-SI-04 — Integrated Source Inspector (Source Viewer) — entities, visible outputs and state (FR-SI-04)**

- Visible: Expanded left panel with document header, scrollable full-text container (`data-chunk-id` anchors), and highlighted passage when triggered from a citation.
- Persisted: Read-only view of persisted `UnifiedDocumentChunk` records ordered by sequence/offset.
- States: `Closed (List View)` $\leftrightarrow$ `Open (Document View)` $\leftrightarrow$ `Open & Highlighted (Chunk Focused)`.

**Request provenance (C-02, NFR-EVAL-04)**: Explicit source IDs/revisions, notebook identity and effective authorization accompany scoped requests and historical messages. This extends the snapshot field listed in the cards; source IDs alone are insufficient.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**SC-001 (FR-SI-01)**

- Standard $20$-page digital PDF is parsed, chunked, and `Ready` in $\le 5.0\text{ s}$ (P95).
- 100% of persisted chunks validate against the `Contract C-01` JSON schema (`Gate v1.0 #1`).

**SC-002 (FR-SI-03)**

- Context leakage from unselected sources ($s_i \notin S_{\text{aktiv}}$) = $0$ across the `NFR-EVAL-04` test suite (`Gate v1.0 #2`).
- UI counter updates within $\le 50\text{ ms}$ of checkbox click.

**SC-003 (FR-SI-04)**

- Opening a source and scrolling to a cited `chunk_id` completes in $\le 300\text{ ms}$ (`Gate v1.0 #3`).
- Scroll target is 100% deterministic in automated Playwright/DOM E2E tests.

- **SC-CROSS (C-01/C-02, Gate v1.0)**: All package and cross-package acceptance cases pass with the exact boundaries above on declared fixtures/environments. Gate v1.0 requires all three integrated outcomes: PDF/MD end-to-end upload yields valid C-01 chunks; hallucination < 0.05, ID precision = 1.0, rejection >= 99%, leakage = 0; citation navigation deterministically reaches the correct DOM passage. Package success alone does not pass the gate.
- **SC-CADENCE (NFR-EVAL-01..04)**: Deterministic citation-ID and leakage checks run on every PR once the harness exists; LLM-judged faithfulness, rejection and semantic support run once per release gate on the release candidate against a fixed, deterministic stratified 50-case sample of the versioned golden dataset; that single passing run is sufficient gate evidence (Constitution v2.0.0). Missing runners are reported UNAVAILABLE, never passed.
- **SC-TIMING (NFR-PERF-01, D13)**: Timing uses declared fixtures/environments. Standard chat TTFT starts at submission and ends at the first validated answer token, excluding progress UI. Its <= 2.5 s target is non-gating in v1 and gating from v3; do not turn it into a v1 release gate.

## Assumptions & Out of Scope

- The input is MVP v1.0; this directory owns only its assigned package. Other packages own their implementation while cross-package conditions are integration obligations. The specification does not create tasks or claim implementation/gate success (Gate v1.0).
- Shared contracts are defined once; implementation ordering follows the prerequisites above. Planning assigns file ownership and evaluates CC-01..CC-08 before and after design; tasks derive failing tests before implementation (C-01/C-02, Gate v1.0).
- Bound technical names/schema fields are source requirements, not new design choices. Planning chooses no new framework or datastore without a prior architecture decision. Authentication is required in v1; D6 leaves the concrete corporate IdP to planning/deployment (FR-WM-04).
- DOCX, PPTX, Web URLs, YouTube/Video URLs, Audio ASR, and source re-sync (`v3.0` — `FR-SI-01` Subset B, `FR-SI-05`); automatic Source Guide generation (`v2.0` — `FR-SI-02`); Discover Sources / Deep Research (`v6.0` — `FR-SI-06`, `FR-SI-07`).
- **FR-SI-01 — Out of scope:** Google Drive picker integration, DOCX/PPTX, Web URLs, YouTube, Audio (`v3.0`).
- **FR-SI-01 — Open questions:** None for implementation. Reference chunking internals are unverified. The architecture uses structure-aware chunks targeting 300–600 tokens with overlap, without crossing page/section boundaries; size is a chunker policy, not part of C-01. Short boundary fragments may be below 300 tokens; split oversized sections rather than exceed the configured cap.
- **FR-SI-03 — Out of scope:** Saved selection presets / source folders.
- **FR-SI-03 — Open questions:** None. Selection is local per user, browser session, and notebook and is passed explicitly on each request (see the cross-package rules).
- **FR-SI-04 — Out of scope:** Editing source text inside the inspector; audio/video timestamp player inside the inspector (`v3.0`).
- **FR-SI-04 — Deviations from reference:** In `v1.0`, the top of the Source Inspector displays only the document title and full text; the collapsible *Source Guide* (summary + key topics) at the top of the inspector is added in `v2.0` (`FR-SI-02`).
- D5/DEV-03 defers FR-INT-01 and Gate v6.0 #3; D8/DEV-02 defers Google Slides export; D10 moves audio share links to v6. None is introduced by MVP specification.

## Clarifications

### Session 2026-10-17

- Q: Which `C-01` locator variant is emitted for text-only sources (`.txt`, `.md`, `Copied text`) versus PDFs (`FR-SI-01`, `C-01`)? → A: Both PDF and text-only sources in v1.0 emit the `page_span` variant of the canonical `C-01` locator union (`page_span | time_span | dom_path`); PDFs populate physical `page` plus paragraph/character offsets, whereas text-only sources omit the optional physical `page` and populate paragraph/character offsets. `char_span` and `slide_number` are not separate locator union variants.
- Q: How does opening a deselected source in the Source Inspector interact with `ScopedContextProvider` and active chat scoping (`FR-SI-03`, `FR-SI-04`, `C-02`)? → A: Opening a source via sidebar title click or historical citation executes an authorized singleton `ScopedContextProvider` (`C-02`) read for `{source_id}` without modifying the session's active chat checkbox selection ($S_{\text{aktiv}}$) or making the deselected source eligible for generation prompts.
- Q: How are in-flight chat requests affected when the user toggles source checkboxes mid-stream (`FR-SI-03`, `C-02`)? → A: Each generation request captures an immutable `(source_id, revision)` snapshot of $S_{\text{aktiv}}$ at submission time; mid-stream checkbox changes apply only to subsequent requests, while deletion or authorization revocation of a captured source revision aborts the in-flight request before publication.

### Implementation flow-back 2026-10-19

- Q: What do `page_number` and `physical_page` mean in a v1 `page_span` locator (`C-01`, `FR-SI-01`, `FR-SI-04`)? → A: `page_number` is the 1-based canonical page (the physical PDF page, or a logical page of about 20,000 characters for text-only sources so very large sources paginate); `physical_page` is present only for PDFs; offsets are Unicode code points into that page's canonical text.
