# Package 1.1 — Workspace Foundation

- **Release:** v1.0
- **Goal:** Enable authenticated users to create, open, rename, and delete isolated notebook containers with enforced baseline resource quotas.
- **FRs:** FR-WM-01, FR-WM-04, FR-WM-07 (baseline quotas)
- **Gate criteria (release gates):** No Gate v1.0 item directly. Notebook isolation (`FR-WM-04`) is a prerequisite for Gate v1.0 #2 (`NFR-EVAL-04`, $\text{Leakage} = 0$).
- **Out of scope:** Custom emojis/icons and sorting/pinning views (`v2.0` — `FR-WM-02`, `FR-WM-03`), multi-user sharing and RBAC (`v6.0` — `FR-WM-05`), usage analytics (`v6.0` — `FR-WM-06`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-WM-01 — Notebook CRUD

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.1 |
| Priority (within package) | P1 |
| Actors | Owner (in v1.0, only single-user Owner role exists) |
| Depends on | FR-WM-04, C-02 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When an authenticated user clicks the "+ New notebook" ("+ Erstellen") button on the home overview, the system shall create an empty notebook owned by that user, navigate to `/notebook/<notebook_id>`, and open the "Add sources" modal immediately.
- *Event:* When the owner clicks the notebook title in the top navigation bar or selects "Rename" from the three-dot menu on a notebook card and submits a valid string, the system shall persist the new title and update `updated_at`.
- *Event:* When the owner selects "Delete" from the three-dot menu on a notebook card and confirms the modal prompt, the system shall permanently delete the notebook and cascade-delete all associated sources, chunks, chat histories, notes, and Studio artifacts, including stored raw files and generated media. Cancel pending jobs and prevent late writes from recreating deleted data.
- *Unwanted:* If the edited notebook title is empty or consists only of whitespace after trimming, then the system shall reject the change and retain the previous title.

**User story:** As a knowledge worker, I want to create, open, rename, and permanently delete notebooks, so that I can organize separate research projects into dedicated workspaces.

**Reference behaviour**
1. User opens the Gemini Notebook home screen (`/`).
2. User clicks the primary button `+ Create` / `+ New notebook`.
3. System creates a new notebook record with default title `"Untitled notebook"` (`"Unbenanntes Notebook"`), redirects to the 3-column workspace, and automatically opens the source upload dialog.
4. User clicks the title in the top-left header, types a new name, and presses `Enter` or blurs the input field; the new title is saved automatically.
5. On the home screen, user clicks the three-dot menu (`⋮`) on a notebook card, clicks `Delete`, and clicks `Delete` in the confirmation dialog; the card disappears immediately.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.1 FR-WM-01` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Notebook Title | UTF-8 plain text | $1$ to $100$ characters after trimming (exact upper character cap in reference UI: `Unknown`, enforced as $100$ internally) | `"Untitled notebook"` |
| `notebook_id` | UUID v4 | Globally unique, immutable | System-generated |

**Outputs & state**
- Visible: Notebook card in overview; editable title in workspace top bar; confirmation modal on delete.
- Persisted: `Notebook` record (`id`, `owner_id`, `title`, `created_at`, `updated_at`).
- States: `Created (Empty)` $\rightarrow$ `Active` $\rightarrow$ `Deleted (Purged)`.

**Acceptance criteria (Gherkin)**

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

**Edge & error cases**
- User cancels the delete confirmation dialog $\rightarrow$ No data is removed; dialog closes.
- Notebook is deleted in Browser Tab A while open in Browser Tab B $\rightarrow$ Any subsequent action in Tab B returns HTTP `404`, displays `"Notebook no longer exists"`, and redirects to the home overview.
- Network failure during title rename $\rightarrow$ UI reverts the title input to the last persisted value and shows an error toast.

**Measurable criteria**
- Notebook creation and redirect complete in $\le 1.0\text{ s}$ (P95).
- Cascade deletion removes all database and vector/chunk records within $\le 2.0\text{ s}$.

**Deviations from reference:** None.

**Out of scope:** Trash bin / soft-delete recovery; duplicating/cloning notebooks.

**Open questions:** `None` (Reference uses a simple confirmation button without requiring the user to type the notebook name).

---

### FR-WM-04 — Isolated Knowledge Context

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.1 |
| Priority (within package) | P1 |
| Actors | Owner; Editor, Viewer, Chat-only (from v6.0) — enforced system-wide for all actors |
| Depends on | FR-WM-01, C-01, C-02, NFR-EVAL-04 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The system shall logically isolate all sources, document chunks, embeddings, chat histories, notes, and Studio artifacts by `notebook_id`.
- *Event:* When any agent or service requests context via `ScopedContextProvider.getScopedContext(notebook_id, active_source_ids)`, the system shall filter all database and vector queries strictly by `notebook_id` and `source_id IN active_source_ids`.
- *Unwanted:* If a `source_id` passed in `active_source_ids` does not belong to `notebook_id`, then the system shall reject the request with a `403 Forbidden` / `InvalidScopeError` and return zero chunks.

**User story:** As an enterprise compliance officer, I want strict data isolation between notebooks, so that confidential information from one project never leaks into another project's answers.

**Reference behaviour**
1. User uploads Document A into Notebook 1 and Document B into Notebook 2.
2. User opens Notebook 2 and asks a question whose answer only exists in Document A.
3. System searches exclusively within Notebook 2's sources and states that the information is not contained in the sources.

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §3.1 FR-WM-04` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `notebook_id` | UUID | Must belong to the authenticated user (or shared ACL in v6.0) | Required |
| `active_source_ids` | Array of UUIDs | Subset of sources belonging to `notebook_id` | All ready sources in `notebook_id` |

**Outputs & state**
- Visible: No cross-notebook sources or citations ever appear in the UI.
- Persisted: Foreign key constraint `source.notebook_id -> notebook.id` and `chunk.notebook_id -> notebook.id` (partition key).
- States: Stateless enforcement on every read/write query.

**Acceptance criteria (Gherkin)**

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

**Edge & error cases**
- Identical file uploaded to two different notebooks $\rightarrow$ Stored as independent source and chunk sets scoped to their respective `notebook_id`s (deleting one does not affect the other's availability).

**Measurable criteria**
- Cross-notebook chunk leakage = $0.0\%$ across all automated security and `NFR-EVAL-04` tests.

**Deviations from reference:** None.

**Out of scope:** Cross-notebook federated search (`FR-INT-01` is deferred without a target release by D5).

**Open questions:** `None`

---

### FR-WM-07 — Resource Quotas (Baseline v1.0)

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.1 |
| Priority (within package) | P2 |
| Actors | Owner; Editor (from v6.0) |
| Depends on | FR-WM-01, FR-SI-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The system shall enforce configurable per-notebook and per-source limits via environment configuration.
- *State:* While a notebook has reached the maximum number of sources ($N_{\text{max}}$), the system shall disable the "Add source" button and display the quota indicator (e.g., `50 / 50 sources`).
- *Unwanted:* If a user uploads a file exceeding $200\text{ MB}$ or a document whose extracted word count exceeds $500,000$ words, then the system shall abort ingestion for that source, remove the partial upload, and display an explicit quota error message.

**User story:** As a platform administrator, I want hard limits on source count, file size, and word count per notebook, so that storage and LLM context processing costs remain bounded and predictable.

**Reference behaviour**
1. In the "Add sources" modal, a progress bar at the bottom displays `Source limit: <current> / 50` (Standard) or `<current> / 300` (Plus/Enterprise).
2. When the user selects a file larger than $200\text{ MB}$ or containing more than $500,000$ words, upload/ingestion fails with an inline error card in the source list.
3. Once $N_{\text{max}}$ sources are present, the upload dropzone is disabled until a source is deleted.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.1 FR-WM-07` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Max sources per notebook ($N_{\text{max}}$) | Integer | Configurable $50$ to $300$ | $50$ in v1; deployment configuration may raise it to $300$ before v6 tenant policies |
| Max words per single source | Integer | $\le 500,000\text{ words}$ | $500,000$ |
| Max file size per upload | Bytes | $\le 200\text{ MB}$ ($200,000,000\text{ bytes}$) | $200\text{ MB}$ |
| Max notebooks per user | Integer | $\le 100$ in v1; v6 tenant policy permits up to $500$ | $100$ |

**Outputs & state**
- Visible: Source counter badge `n / N_max` in the upload modal and left sidebar; error toast/inline status on limit violation.
- Persisted: `word_count` and `byte_size` metadata on each `Source` entity.
- States: `UnderQuota` $\leftrightarrow$ `AtQuotaLimit`.

**Acceptance criteria (Gherkin)**

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

**Edge & error cases**
- Batch upload of $10$ files when $45 / 50$ slots are used $\rightarrow$ System accepts the first $5$ files and rejects the remaining $5$ with a quota warning.
- Failed source in the sidebar $\rightarrow$ Releases its reserved source slot immediately; dismissing the error row does not alter quota usage. Concurrent uploads reserve slots atomically.

**Measurable criteria**
- Upload authorization rejects a declared size above 200,000,000 bytes in $\le 200\text{ ms}$. Signed upload constraints and server-side object-size validation enforce the actual byte count before parsing; aborted/oversized objects are removed.

**Deviations from reference:** Quotas are exposed as configurable tenant parameters rather than tied to consumer Google One tiers.

**Out of scope:** Per-tenant dynamic billing dashboards (`v6.0`).

**Open questions:** None. Failed uploads release their slot immediately; the dismissible error row is not a source.
