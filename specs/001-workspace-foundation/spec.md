# Feature Specification: Workspace Foundation

**Feature Branch**: `spec/v1-functional-requirements`
**Created**: 2026-10-17
**Status**: Specification reviewed; implementation not started
**Package Source**: `spec/requirements/v1/package_1_1_workspace_foundation.md`
**SRS IDs in Scope**: FR-WM-01, FR-WM-04, FR-WM-07; C-01, C-02; Gate v1.0
**Release & Gate**: v1.0 (Gate v1.0)
**Input**: User request: SRS Version 1.0 (MVP); resumed assigned branch; specify execution 1 of 4, one package per execution.

## Source Traceability & Package Scope *(mandatory)*

Authority: [constitution](../../.specify/memory/constitution.md), [SRS](../../spec/System_Requirements_Specification_Gemeni_Notebook.md), [package cards](../../spec/requirements/v1/package_1_1_workspace_foundation.md) and [binding cross-package rules](../../spec/requirements/README.md), then [architecture decisions](../../docs/solution-architecture.md#decisions). Reference-product observations are unverified background; acceptance choices below are project requirements.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-WM-01 | Notebook CRUD | [Card](../../spec/requirements/v1/package_1_1_workspace_foundation.md#fr-wm-01--notebook-crud) | D1–D4, D6; D13 for citation publication; D5 excludes cross-notebook integration |
| FR-WM-04 | Isolated Knowledge Context | [Card](../../spec/requirements/v1/package_1_1_workspace_foundation.md#fr-wm-04--isolated-knowledge-context) | D1–D4, D6; D13 for citation publication; D5 excludes cross-notebook integration |
| FR-WM-07 | Resource Quotas (Baseline v1.0) | [Card](../../spec/requirements/v1/package_1_1_workspace_foundation.md#fr-wm-07--resource-quotas-baseline-v10) | D1–D4, D6; D13 for citation publication; D5 excludes cross-notebook integration |

- **Within-Release Prerequisites (C-01, C-02, Gate v1.0)**: Define C-01/C-02 once before dependent implementation. This package supplies identity, notebooks and quotas to 1.2; 1.2 then supplies ingestion/inspector to 1.3; 1.4 integrates the release.
- **Role Phasing (FR-WM-04/05, NFR-SEC-02)**: Owner-only in v1–v5. All Editor/Viewer/Chat-only references transcribed below are future v6 conditions, not v1 permissions.
- **Data Residency (D3, NFR-SEC-01)**: EU default `europe-west4`; no region exception requested by this specification.
- **Gate contribution**: No Gate v1.0 item directly. Notebook isolation (`FR-WM-04`) is a prerequisite for Gate v1.0 #2 (`NFR-EVAL-04`, $\text{Leakage} = 0$).
- **Contract boundary (C-01/C-02)**: Use the one shared chunk and scoped-context contract. The C-01 locator union remains `page_span`, `time_span`, `dom_path`; v1 emits `page_span` (physical page optional for text-only content). `char_span` and `slide_number` are not additional variants. C-03 generators begin in v2, not in this package.

## User Scenarios & Testing *(mandatory)*

The following scenarios are transcribed in full. Symbolic chunk IDs denote schema-valid fixture IDs in executable tests. The normative cross-package scenarios below qualify all defaults and historical visibility statements (C-01, C-02, NFR-EVAL-04).

### User Story 1 - Notebook CRUD (Priority: P1)

**SRS IDs**: FR-WM-01
**Actors**: Authenticated notebook Owner.

As a knowledge worker, I want to create, open, rename, and permanently delete notebooks, so that I can organize separate research projects into dedicated workspaces.

**Why this priority**: Required for the package goal: Enable authenticated users to create, open, rename, and delete isolated notebook containers with enforced baseline resource quotas.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-WM-01.

**Interaction flow (FR-WM-01; target behavior from the card, subject to cross-package rules)**:

1. User opens the home screen (`/`).
2. User clicks the primary button `+ Create` / `+ New notebook`.
3. System creates a new notebook record with default title `"Untitled notebook"` (`"Unbenanntes Notebook"`), redirects to the 3-column workspace, and automatically opens the source upload dialog.
4. User clicks the title in the top-left header, types a new name, and presses `Enter` or blurs the input field; the new title is saved automatically.
5. On the home screen, user clicks the three-dot menu (`⋮`) on a notebook card, clicks `Delete`, and clicks `Delete` in the confirmation dialog; the card disappears immediately.

**Acceptance Scenarios (FR-WM-01)**:

```gherkin
Scenario: Create new notebook opens upload modal
  Given an authenticated user on the home overview
  When the user clicks "+ New notebook"
  Then a new notebook with title "Untitled notebook" is persisted
  And the browser navigates to the workspace view for that notebook
  And the "Add sources" modal is open

Scenario: Rename notebook persists valid title and rejects whitespace
  Given an existing notebook titled "Q3 Audit"
  When the owner edits the title to "   " and blurs the input
  Then the title remains "Q3 Audit"
  When the owner edits the title to "Q4 Financial Audit" and presses Enter
  Then the persisted title is "Q4 Financial Audit"

Scenario: Delete notebook cascades to all child entities
  Given a notebook containing 2 sources, 15 document chunks, and 1 chat thread
  When the owner selects "Delete" on the notebook and confirms
  Then the notebook no longer appears in the overview list
  And querying its sources, chunks, or chat threads via API returns 404 Not Found
```

### User Story 2 - Isolated Knowledge Context (Priority: P1)

**SRS IDs**: FR-WM-04
**Actors**: Authenticated notebook Owner.

As an enterprise compliance officer, I want strict data isolation between notebooks, so that confidential information from one project never leaks into another project's answers.

**Why this priority**: Required for the package goal: Enable authenticated users to create, open, rename, and delete isolated notebook containers with enforced baseline resource quotas.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-WM-04.

**Interaction flow (FR-WM-04; target behavior from the card, subject to cross-package rules)**:

1. User uploads Document A into Notebook 1 and Document B into Notebook 2.
2. User opens Notebook 2 and asks a question whose answer only exists in Document A.
3. System searches exclusively within Notebook 2's sources and states that the information is not contained in the sources.

**Acceptance Scenarios (FR-WM-04)**:

```gherkin
Scenario: Cross-notebook query isolation
  Given Notebook A contains a source with the secret code "OMEGA-991"
  And Notebook B contains a source about general company holidays
  When the user asks "What is the secret code OMEGA?" in Notebook B
  Then the system retrieves 0 chunks from Notebook A
  And the response states that the provided sources do not contain information about "OMEGA"

Scenario: Tampered source ID from another notebook is rejected
  Given Source S1 belongs to Notebook A and the user is querying Notebook B
  When a client sends a chat request for Notebook B with active_source_ids including S1
  Then the system rejects the request with HTTP 403 / InvalidScopeError
```

### User Story 3 - Resource Quotas (Baseline v1.0) (Priority: P2)

**SRS IDs**: FR-WM-07
**Actors**: Authenticated notebook Owner.

As a platform administrator, I want hard limits on source count, file size, and word count per notebook, so that storage and LLM context processing costs remain bounded and predictable.

**Why this priority**: Required for the package goal: Enable authenticated users to create, open, rename, and delete isolated notebook containers with enforced baseline resource quotas.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-WM-07.

**Interaction flow (FR-WM-07; target behavior from the card, subject to cross-package rules)**:

1. In the "Add sources" modal, a progress bar at the bottom displays `Source limit: <current> / 50` (Standard) or `<current> / 300` (Plus/Enterprise).
2. When the user selects a file larger than $200\text{ MB}$ or containing more than $500,000$ words, upload/ingestion fails with an inline error card in the source list.
3. Once $N_{\text{max}}$ sources are present, the upload dropzone is disabled until a source is deleted.

**Acceptance Scenarios (FR-WM-07)**:

```gherkin
Scenario: Reject file exceeding 200 MB pre-upload
  Given a notebook with 5 sources
  When the user selects a 215 MB PDF file for upload
  Then the client/server rejects the upload immediately
  And displays an error message stating the 200 MB file size limit was exceeded

Scenario: Reject document exceeding 500,000 words during parsing
  Given a 40 MB TXT file containing 520,000 words
  When the user uploads the file
  Then the ingestion parser aborts after word-count validation
  And marks the source status as Failed with reason "Exceeds 500,000 words limit"

Scenario: Block adding 51st source when quota is 50
  Given a notebook configured with N_max = 50 that currently has 50 sources
  When the user opens the "Add sources" modal
  Then the file upload button is disabled
  And the quota bar displays "50 / 50"

Scenario: Concurrent uploads reserve the final slot atomically
  Given the notebook has 49 occupied or reserved slots with N_max = 50
  When two uploads request the final slot concurrently
  Then exactly one is admitted and the other receives a quota error
  When the admitted upload fails validation
  Then its slot is released even while its error row remains visible
```

### Retained acceptance detail from the inherited draft (FR-WM-01/04/07)


### Supplemental User Story 1 - Manage personal research notebooks (Priority: P1)

As an authenticated knowledge worker, I can create, reopen, rename and permanently delete my notebooks so that each research project has a dedicated workspace. (FR-WM-01)

**Why this priority**: Every source and conversation needs an owned notebook.

**Independent Test**: Using an authenticated owner and notebook fixtures, exercise the complete notebook lifecycle without a model or ingestion engine. Verify the Add sources handoff using an empty workspace.

**Acceptance Scenarios**:

1. **Given** an authenticated user below the notebook quota on the home overview, **When** they choose "+ New notebook", **Then** exactly one owned notebook titled "Untitled notebook" is persisted, its workspace opens and the "Add sources" dialog opens. (FR-WM-01)
2. **Given** an existing owned notebook, **When** the owner opens its card, **Then** the same notebook and its saved title open without creating a duplicate. (FR-WM-01)
3. **Given** a notebook titled "Q3 Audit", **When** the owner submits " Q4 Financial Audit " using Enter or by leaving the title field, **Then** the trimmed title is saved, the modification timestamp advances, and reopening shows the new title; renaming from the card menu has the same result. (FR-WM-01)
4. **Given** a saved title, **When** a submitted title is whitespace-only or exceeds 100 Unicode code points after trimming, **Then** the change is rejected without truncation and the saved title remains; titles of exactly 1 and 100 code points are accepted. (FR-WM-01)
5. **Given** a notebook with sources, chunks, raw files and chat, **When** the owner cancels deletion, **Then** nothing changes; **When** they confirm deletion, **Then** the notebook disappears, its owned content is purged, pending work is cancelled, and late completions cannot restore it. (FR-WM-01)
6. **Given** a notebook open in two tabs, **When** it is deleted in the first tab and an action is attempted in the second, **Then** the second tab shows "Notebook no longer exists" and returns to the overview without exposing cached notebook content. (FR-WM-01, FR-WM-04)

### Supplemental User Story 2 - Keep each notebook private and isolated (Priority: P1)

As an owner, I can trust that another user and another notebook cannot access my project's information. (FR-WM-04)

**Why this priority**: Isolation is a prerequisite for trustworthy grounding and Gate v1.0 #2.

**Independent Test**: Seed two owners and two notebooks with distinct source fixtures; attempt authorized and unauthorized reads, writes and context requests. Chat integration later verifies the same boundary in answers.

**Acceptance Scenarios**:

1. **Given** Notebook A contains "OMEGA-991" and Notebook B contains only holiday information, **When** a question in B asks for the OMEGA secret, **Then** no A content enters B's context and the integrated chat states that its selected sources lack the information. (FR-WM-04, FR-GC-01, NFR-EVAL-04)
2. **Given** a source belonging to A, **When** a request for B explicitly includes that source, **Then** the request is rejected as invalid scope and returns no source content, even when the same user owns both notebooks. (FR-WM-04, C-02)
3. **Given** a notebook owned by another user or an unauthenticated requester, **When** any notebook or child-content read/write is attempted directly, **Then** access is denied before data is returned or changed. (FR-WM-04; constitution VI)
4. **Given** identical files independently imported into A and B, **When** A is deleted, **Then** B's source and context remain available and unchanged. (FR-WM-01, FR-WM-04)
5. **Given** Ready sources in a notebook, **When** a generation request omits its explicit source selection or supplies an empty selection, **Then** it is rejected rather than expanded to all sources. (FR-WM-04, FR-SI-03, C-02)

### Supplemental User Story 3 - Stay within predictable resource limits (Priority: P2)

As an owner, I see available capacity and receive clear limit errors before excess content is accepted. (FR-WM-07)

**Why this priority**: Quotas bound resource use and make upload outcomes predictable.

**Independent Test**: Exercise admission and failure handling with declared sizes, extracted-word counts and concurrent reservations; no completed chat implementation is required.

**Acceptance Scenarios**:

1. **Given** 100 owned notebooks, **When** another notebook is requested, **Then** creation is rejected with a quota explanation; with 99 notebooks, one more is permitted. (FR-WM-07)
2. **Given** a notebook at its configured source limit, **When** the upload dialog opens, **Then** adding sources is disabled and both the dialog and source sidebar show the occupied/reserved count against the limit; a direct attempt is also rejected. (FR-WM-07)
3. **Given** 45 occupied or reserved slots and a limit of 50, **When** ten files are submitted in order, **Then** the first five are admitted and the remaining five receive quota warnings. (FR-WM-07)
4. **Given** 49 occupied or reserved slots and a limit of 50, **When** two uploads concurrently request the final slot, **Then** exactly one is admitted; if that upload fails, the slot is released immediately although its dismissible error row remains. (FR-WM-07)
5. **Given** an upload otherwise within quota, **When** its size exceeds 200,000,000 bytes or its extracted text exceeds 500,000 words, **Then** it is rejected with the exceeded limit identified, partial content is removed and its slot released; values exactly at either bound are accepted if all other checks pass. (FR-WM-07, FR-SI-01)
6. **Given** a deployment configured for 300 sources, **When** a notebook reaches 300 occupied/reserved slots, **Then** the same admission and display rules apply at 300 instead of the default 50. (FR-WM-07)


### Cross-package acceptance scenarios (C-02, FR-WM-04, FR-SI-03, FR-GC-01/02/03/06, NFR-EVAL-04)

1. **Given** Ready sources, **When** a request omits the selection or submits an empty selection, **Then** the server rejects it, and empty selection disables source-based generation with a select-sources prompt. Initial “All Ready sources” selection never becomes a server fallback.
2. **Given** a submitted selection and revision snapshot, **When** checkboxes change, **Then** the current request keeps its snapshot and only later requests use the new selection. **When** a captured revision is deleted, replaced or becomes unauthorized before reading or publishing, **Then** the request fails without publishing stale output or substituting a new revision.
3. **Given** prior turns or caches depend on a now-deselected source or revision (even if it was not cited), **When** a new question is submitted, **Then** both the prior question and answer, derived summaries and tool output are excluded from the prompt. Missing provenance also excludes a turn. Merely deselected historical content remains viewable while authorized.
4. **Given** historical generated content, snippets or search results depend on a deleted/revoked source, **When** they are read, **Then** the affected content is hidden or unavailable and no readable cached copy is exposed. A retained unavailable citation control may display “Source deleted” but cannot reveal text or open the source.
5. **Given** an authorized source outside the current chat selection, **When** its title or a historical citation opens the inspector, **Then** an authorized singleton C-02 read displays it without altering chat selection or making it eligible for generation.
6. **Given** a factual answer with any invalid citation, **When** verification runs, **Then** the entire draft is withheld and replaced immediately by a refusal, without regeneration or citation stripping. Progress events contain no draft factual answer and do not count toward answer TTFT.

### Edge Cases *(mandatory)*

**FR-WM-01**

- User cancels the delete confirmation dialog $\rightarrow$ No data is removed; dialog closes.
- Notebook is deleted in Browser Tab A while open in Browser Tab B $\rightarrow$ Any subsequent action in Tab B returns HTTP `404`, displays `"Notebook no longer exists"`, and redirects to the home overview.
- Network failure during title rename $\rightarrow$ UI reverts the title input to the last persisted value and shows an error toast.

**FR-WM-04**

- Identical file uploaded to two different notebooks $\rightarrow$ Stored as independent source and chunk sets scoped to their respective `notebook_id`s (deleting one does not affect the other's availability).

**FR-WM-07**

- Batch upload of $10$ files when $45 / 50$ slots are used $\rightarrow$ System accepts the first $5$ files and rejects the remaining $5$ with a quota warning.
- Failed source in the sidebar $\rightarrow$ Releases its reserved source slot immediately; dismissing the error row does not alter quota usage. Concurrent uploads reserve slots atomically.

- **Text boundaries (FR-WM-01, FR-GC-01)**: Count Unicode code points after outer whitespace trim, not bytes or grapheme clusters; reject invalid/over-limit input without truncation. Test 0/1/100/101 title code points and 0/1/10,000/10,001 message code points in the owning packages, including non-ASCII input.
- **Independent source limits (FR-WM-07, FR-SI-01)**: 200 MB = 200,000,000 bytes inclusive; 500,000 extracted words is a separate inclusive limit, including copied text. Test both exact maxima and maximum + 1, with the other limit valid. Pasted text must contain at least one code point after trimming. Empty and unsupported uploads never become usable sources.
- **Concurrent admission (FR-WM-07, FR-SI-01)**: Atomically reserve slots before ingestion; Uploading/Processing/Ready consume slots; Failed releases its slot immediately and leaves only a dismissible error row. Dismissing it does not release capacity twice. Partial/oversized objects are removed. Later-release re-sync preserves its old Ready revision and slot if validation fails; this is not v1 re-sync scope.
- **Authorization (FR-WM-04, C-02)**: Every endpoint and worker checks ownership and notebook/document access; login alone is insufficient. Cross-notebook IDs return 403 / InvalidScopeError and zero chunks, including when the same owner owns both notebooks.

## Requirements *(mandatory)*

### Functional Requirements

#### R01 — FR-WM-01 — Notebook CRUD

**Normative EARS (FR-WM-01)**

- *Event:* When an authenticated user clicks the "+ New notebook" ("+ Erstellen") button on the home overview, the system shall create an empty notebook owned by that user, navigate to `/notebook/<notebook_id>`, and open the "Add sources" modal immediately.
- *Event:* When the owner clicks the notebook title in the top navigation bar or selects "Rename" from the three-dot menu on a notebook card and submits a valid string, the system shall persist the new title and update `updated_at`.
- *Event:* When the owner selects "Delete" from the three-dot menu on a notebook card and confirms the modal prompt, the system shall permanently delete the notebook and cascade-delete all associated sources, chunks, chat histories, notes, and Studio artifacts, including stored raw files and generated media. Cancel pending jobs and prevent late writes from recreating deleted data.
- *Unwanted:* If the edited notebook title is empty or consists only of whitespace after trimming, then the system shall reject the change and retain the previous title.

**Inputs, defaults and exact limits (FR-WM-01)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Notebook Title | UTF-8 plain text | $1$ to $100$ characters after trimming (exact upper character cap in reference UI: `Unknown`, enforced as $100$ internally) | `"Untitled notebook"` |
| `notebook_id` | UUID v4 | Globally unique, immutable | System-generated |

#### R02 — FR-WM-04 — Isolated Knowledge Context

**Normative EARS (FR-WM-04)**

- *Ubiquitous:* The system shall logically isolate all sources, document chunks, embeddings, chat histories, notes, and Studio artifacts by `notebook_id`.
- *Event:* When any agent or service requests context via `ScopedContextProvider.getScopedContext(notebook_id, active_source_ids)`, the system shall filter all database and vector queries strictly by `notebook_id` and `source_id IN active_source_ids`.
- *Unwanted:* If a `source_id` passed in `active_source_ids` does not belong to `notebook_id`, then the system shall reject the request with a `403 Forbidden` / `InvalidScopeError` and return zero chunks.

**Inputs, defaults and exact limits (FR-WM-04)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `notebook_id` | UUID | Must belong to the authenticated user (or shared ACL in v6.0) | Required |
| `active_source_ids` | Array of UUIDs | Subset of sources belonging to `notebook_id` | All ready sources in `notebook_id` |

#### R03 — FR-WM-07 — Resource Quotas (Baseline v1.0)

**Normative EARS (FR-WM-07)**

- *Ubiquitous:* The system shall enforce configurable per-notebook and per-source limits via environment configuration.
- *State:* While a notebook has reached the maximum number of sources ($N_{\text{max}}$), the system shall disable the "Add source" button and display the quota indicator (e.g., `50 / 50 sources`).
- *Unwanted:* If a user uploads a file exceeding $200\text{ MB}$ or a document whose extracted word count exceeds $500,000$ words, then the system shall abort ingestion for that source, remove the partial upload, and display an explicit quota error message.

**Inputs, defaults and exact limits (FR-WM-07)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Max sources per notebook ($N_{\text{max}}$) | Integer | Configurable $50$ to $300$ | $50$ in v1; deployment configuration may raise it to $300$ before v6 tenant policies |
| Max words per single source | Integer | $\le 500,000\text{ words}$ | $500,000$ |
| Max file size per upload | Bytes | $\le 200\text{ MB}$ ($200,000,000\text{ bytes}$) | $200\text{ MB}$ |
| Max notebooks per user | Integer | $\le 100$ in v1; v6 tenant policy permits up to $500$ | $100$ |

#### Cross-package requirements (C-02, FR-SI-03, FR-GC-01/02/06, NFR-EVAL-04)

- **CP-01**: Every generation request MUST carry explicit authorized Ready source IDs and capture `(source_id, revision)` at submission; recheck authorization before reads and publication. No empty/omitted fallback is allowed. Selection is local to each user, browser session and notebook.
- **CP-02**: C-02 MUST be the sole source-read boundary, including inspector singleton reads, histories, caches, summaries, generated prompts and follow-up actions. Ingestion writes C-01 and does not bypass read scoping.
- **CP-03**: Cache identity MUST include notebook, exact source/revision set, effective authorization, output language and relevant generation parameters. Context from outside this identity MUST NOT be reused.
- **CP-04**: History inclusion MUST use complete source/revision provenance, not only displayed citations. Deletion/revocation MUST immediately invalidate affected historical generated content and cached snippets, including exports/signed URLs when those later exist. Viewability after mere deselection does not imply eligibility for new prompts.
- **CP-05**: Validate all factual-answer citations before publication; invalid citations yield immediate refusal without retry or a stripped draft. Each factual claim needs scoped supporting evidence. Merely validating the ID does not prove semantic support.
- **CP-06 (NFR-SEC-01)**: Enterprise no-training protection covers documents, prompts and outputs including model, OCR and embedding processing. No-training is not a claim of zero retention. Consumer/developer API keys cannot be used with company data. No new cloud API is authorized by this spec.

### Key Entities *(include if feature involves data)*

**FR-WM-01 — Notebook CRUD — entities, visible outputs and state (FR-WM-01)**

- Visible: Notebook card in overview; editable title in workspace top bar; confirmation modal on delete.
- Persisted: `Notebook` record (`id`, `owner_id`, `title`, `created_at`, `updated_at`).
- States: `Created (Empty)` $\rightarrow$ `Active` $\rightarrow$ `Deleted (Purged)`.

**FR-WM-04 — Isolated Knowledge Context — entities, visible outputs and state (FR-WM-04)**

- Visible: No cross-notebook sources or citations ever appear in the UI.
- Persisted: Foreign key constraint `source.notebook_id -> notebook.id` and `chunk.notebook_id -> notebook.id` (partition key).
- States: Stateless enforcement on every read/write query.

**FR-WM-07 — Resource Quotas (Baseline v1.0) — entities, visible outputs and state (FR-WM-07)**

- Visible: Source counter badge `n / N_max` in the upload modal and left sidebar; error toast/inline status on limit violation.
- Persisted: `word_count` and `byte_size` metadata on each `Source` entity.
- States: `UnderQuota` $\leftrightarrow$ `AtQuotaLimit`.

**Request provenance (C-02, NFR-EVAL-04)**: Explicit source IDs/revisions, notebook identity and effective authorization accompany scoped requests and historical messages. This extends the snapshot field listed in the cards; source IDs alone are insufficient.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**SC-001 (FR-WM-01)**

- Notebook creation and redirect complete in $\le 1.0\text{ s}$ (P95).
- Cascade deletion removes all database and vector/chunk records within $\le 2.0\text{ s}$.

**SC-002 (FR-WM-04)**

- Cross-notebook chunk leakage = $0.0\%$ across all automated security and `NFR-EVAL-04` tests.

**SC-003 (FR-WM-07)**

- Upload authorization rejects a declared size above 200,000,000 bytes in $\le 200\text{ ms}$. Signed upload constraints and server-side object-size validation enforce the actual byte count before parsing; aborted/oversized objects are removed.

- **SC-CROSS (C-01/C-02, Gate v1.0)**: All package and cross-package acceptance cases pass with the exact boundaries above on declared fixtures/environments. Gate v1.0 requires all three integrated outcomes: PDF/MD end-to-end upload yields valid C-01 chunks; hallucination < 0.05, ID precision = 1.0, rejection >= 99%, leakage = 0; citation navigation deterministically reaches the correct DOM passage. Package success alone does not pass the gate.
- **SC-CADENCE (NFR-EVAL-01..04)**: Deterministic citation-ID and leakage checks run on every PR once the harness exists; LLM-judged faithfulness, rejection and semantic support run on retrieval/prompt/chat PRs and every release gate. Missing runners are reported UNAVAILABLE, never passed.
- **SC-TIMING (NFR-PERF-01, D13)**: Timing uses declared fixtures/environments. Standard chat TTFT starts at submission and ends at the first validated answer token, excluding progress UI. Its <= 2.5 s target is non-gating in v1 and gating from v3; do not turn it into a v1 release gate.

## Assumptions & Out of Scope

- The input is MVP v1.0; this directory owns only its assigned package. Other packages own their implementation while cross-package conditions are integration obligations. The specification does not create tasks or claim implementation/gate success (Gate v1.0).
- Shared contracts are defined once; implementation ordering follows the prerequisites above. Planning assigns file ownership and evaluates CC-01..CC-08 before and after design; tasks derive failing tests before implementation (C-01/C-02, Gate v1.0).
- Bound technical names/schema fields are source requirements, not new design choices. Planning chooses no new framework or datastore without a prior architecture decision. Authentication is required in v1; D6 leaves the concrete corporate IdP to planning/deployment (FR-WM-04).
- Custom emojis/icons and sorting/pinning views (`v2.0` — `FR-WM-02`, `FR-WM-03`), multi-user sharing and RBAC (`v6.0` — `FR-WM-05`), usage analytics (`v6.0` — `FR-WM-06`).
- **FR-WM-01 — Out of scope:** Trash bin / soft-delete recovery; duplicating/cloning notebooks.
- **FR-WM-01 — Open questions:** `None` (Reference uses a simple confirmation button without requiring the user to type the notebook name).
- **FR-WM-04 — Out of scope:** Cross-notebook federated search (`FR-INT-01` is deferred without a target release by D5).
- **FR-WM-07 — Out of scope:** Per-tenant dynamic billing dashboards (`v6.0`).
- **FR-WM-07 — Deviations from reference:** Quotas are exposed as configurable tenant parameters rather than tied to consumer Google One tiers.
- **FR-WM-07 — Open questions:** None. Failed uploads release their slot immediately; the dismissible error row is not a source.
- D5/DEV-03 defers FR-INT-01 and Gate v6.0 #3; D8/DEV-02 defers Google Slides export; D10 moves audio share links to v6. None is introduced by MVP specification.
