# Package 3.3 — Studio: Structure & Data Extraction (Mindmaps & Tables)

- **Release:** v3.0
- **Goal:** Add two interactive structural Studio plugins (`Contract C-03`): hierarchical interactive Mindmaps with node-to-chat drilldown and PNG/SVG export, and multi-document Data Tables with CSV/XLSX export.
- **FRs:** FR-ST-08, FR-ST-09, FR-ST-18
- **Gate criteria (SRS §5.4):** Gate v3.0 #3 — Mindmap-JSON ist azyklisch/hierarchisch; Tabellen-Export liefert valides CSV/XLSX.
- **Out of scope:** Slide Decks and Infographics (`v4.0` — `FR-ST-16`, `FR-ST-17`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-ST-08 — Automatic Mindmap Generation

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor |
| Depends on | FR-SI-03, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks the `"Mind Map"` (`"Mindmap"`) generator chip/tile in the Studio or Chat overview, the `Graph Synthesis Agent` shall synthesize the active sources ($S_{\text{aktiv}}$) into a strictly hierarchical, acyclic tree (`root` $\rightarrow$ `main branches` $\rightarrow$ `sub-topics` $\rightarrow$ `leaf facts`) and store it as a `StudioArtifact` (`Contract C-03`).
- *Unwanted:* If the LLM generates cyclic edges, orphan nodes, or duplicate node IDs, then the schema validator shall reject the invalid graph and mark the job Failed before publishing so that every saved Mindmap is a valid rooted tree.

**User story:** As a visual thinker, I want to generate a hierarchical mindmap from my selected sources with one click, so that I can see how central concepts, subtopics, and details connect across all my documents.

**Reference behaviour**
1. User clicks `Mind Map` in the Studio panel (or the `"Mind Map"` chip in the notebook overview).
2. A job `"Generating Mind Map..."` runs asynchronously in the Studio artifact list.
3. Once complete, clicking the artifact opens a full-bleed interactive canvas showing the central notebook topic branching left-to-right into color-coded category nodes and child nodes.

Evidence: `https://blog.google/technology/ai/notebooklm-mind-maps-2025/`, `SRS §3.5.3 FR-ST-08` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| `active_source_ids` ($S_{\text{aktiv}}$) | Array of UUIDs | $\lvert S_{\text{aktiv}}\rvert \ge 1$ | All `Ready` sources |
| Tree depth & size | Directed Acyclic Tree JSON | Depth $2\text{–}5$ levels; $15\text{–}120$ total nodes; each node label $\le 80\text{ chars}$ | Initial render expanded to depth $2$ |

**Outputs & state**
- Visible: Mindmap entry in Studio artifact list; interactive node-link tree canvas when opened.
- Persisted: `StudioArtifact` (`plugin_type: 'mindmap'`, `payload_json: { root_node: { id, label, summary, source_chunk_ids, children: [...] } }`).
- States: `Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Generated Mindmap JSON is strictly hierarchical and acyclic (Gate v3.0 #3)
  Given a notebook with 3 active sources
  When the owner clicks "Mind Map" in the Studio panel
  Then the completed StudioArtifact payload validates as a single-rooted acyclic tree with depth >= 2
  And every node label is derived exclusively from the active sources
```

**Edge & error cases**
- Very large notebook ($50+$ sources) $\rightarrow$ Hierarchical map-reduce over Source Guides (`FR-SI-02`) ensures balanced top-level branches without omitting sources.

**Measurable criteria**
- $100\%$ of generated Mindmap JSON payloads pass acyclic tree schema validation (`Gate v3.0 #3`).
- Mindmap generation completes in $\le 20.0\text{ s}$ (P95).

**Deviations from reference:** None.

**Out of scope:** Manual drag-and-drop re-parenting of mindmap nodes by the user.

**Open questions:** `None`

---

### FR-ST-09 — Mindmap Interactivity, Chat Drilldown & Export

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer |
| Depends on | FR-ST-08, FR-GC-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The Mindmap Viewer shall provide controls to pan, zoom in/out, fit-to-screen, expand/collapse child branches (`>` / `<` chevron on each parent node), and download the rendered mindmap as a high-resolution `.png` or `.svg` file.
- *Event:* When the user clicks the label/body of any node in the Mindmap, the system shall close/minimize the fullscreen Mindmap overlay (or keep it docked) and automatically submit a targeted prompt in the Center Chat Panel asking to explain that specific sub-topic in the context of its parent branch using the active sources.

**User story:** As a researcher exploring a mindmap, I want to expand or collapse branches, click any node to immediately ask the chat for a cited deep dive on that concept, and export the map as an image for my reports.

**Reference behaviour**
1. In the open Mindmap modal/canvas, each branch node has an expand/collapse button (`>` / `<`) on its right edge.
2. Clicking `>` smoothly animates the reveal of child sub-nodes.
3. Clicking directly on a node's text box sends a pre-constructed query (`"Discuss what the sources say about <Node Label>, in the context of <Parent Label>..."`) to the Chat panel and streams a grounded answer with citations.
4. Clicking the download icon in the top-right corner downloads a `.png` (or `.svg`) image of the currently expanded tree.

Evidence: `https://blog.google/technology/ai/notebooklm-mind-maps-2025/`, `SRS §3.5.3 FR-ST-09` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Node chevron click | DOM Event | Toggles `expanded` boolean on target `node_id` | Depth $1\text{–}2$ expanded initially |
| Node body click | DOM Event | Injects prompt for `(node.label, parent.label)` into Chat | — |
| Image export | `.png` / `.svg` | Captures full bounding box of currently expanded nodes | `.png` ($2\times$ retina scale) |

**Outputs & state**
- Visible: Smooth pan/zoom ($60\text{ fps}$), branch expand/collapse animations, automatic chat turn on node click, downloaded `.png`/`.svg` file.
- Persisted: Resulting drilldown chat turn is persisted in `ChatMessage` history (`FR-GC-06`).
- States: `CanvasViewing` $\rightarrow$ `NodeDrilldownToChat`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Clicking a Mindmap node triggers a grounded chat explanation
  Given an open Mindmap with parent node "Security Architecture" and child node "mTLS Certificates"
  When the user clicks the body of the node "mTLS Certificates"
  Then the Chat panel receives a prompt asking about "mTLS Certificates" in the context of "Security Architecture"
  And streams a grounded response with inline citations

Scenario: Exporting Mindmap downloads valid PNG and SVG files
  Given an open Mindmap with 25 visible nodes
  When the user clicks "Export PNG" and "Export SVG"
  Then a non-empty valid PNG image and a valid SVG document containing all 25 node labels are downloaded

Scenario: Drilldown does not restore a historical source selection
  Given a mindmap node was generated from Source B
  And only Source A is currently selected
  When the user clicks that node
  Then the UI prompts the user to select supporting sources
  And B is not automatically selected
  And no B-derived node label or summary enters the chat prompt
```

**Edge & error cases**
- Clicking a node when all sources were subsequently deselected ($\lvert S_{\text{aktiv}}\rvert = 0$) $\rightarrow$ Prompts the user to select sources; never restores a snapshot automatically or sends labels derived from deselected sources into Chat.

**Measurable criteria**
- Canvas pan/zoom and node expand/collapse render at $60\text{ fps}$ ($\le 16\text{ ms}$ frame time) up to $120$ nodes.

**Deviations from reference:** Supports lossless `.svg` export in addition to `.png`.

**Out of scope:** Exporting to proprietary `.mm` (FreeMind) or `.xmind` formats.

**Open questions:** `None`

---

### FR-ST-18 — Studio: Structured Data Tables & CSV/XLSX Export

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.3 |
| Priority (within package) | P1 |
| Actors | Owner/Editor, Viewer (export) |
| Depends on | FR-SI-03, C-02, C-03 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS §3.5.6 |

**Requirement (EARS)**
- *Event:* When the Owner/Editor clicks the `"Data Table"` (`"Datentabelle"`) tile in the Studio panel (optionally providing a focus prompt such as `"Compare all vendors by pricing, SLA, and certifications"` or choosing a suggested table schema), the `Table Extraction Agent` shall extract structured rows and columns across $S_{\text{aktiv}}$ and persist a `StudioArtifact` (`Contract C-03`).
- *Ubiquitous:* Every cell in a generated Data Table that asserts a factual value shall include a citation reference (`chunk_id`) linking back to the source passage, or display `"N/A (Not in sources)"` if a document does not state that attribute.
- *Unwanted:* If fulfilling the requested comparison requires more than 500 rows or 25 columns, the system shall mark the attempt Failed, explain the exceeded limit, ask for narrower instructions, and publish no table. A partial table is not a successful substitute.
- *State:* When selected documents give conflicting values for the same item and attribute, the table shall keep one row per item, show all conflicting values in the same cell with individual supporting citations, and explicitly mark the disagreement.
- *Event:* When the user clicks `"Export CSV"` or `"Export Excel (.xlsx)"` in the Data Table viewer, the system shall generate and download a valid UTF-8 `.csv` or OpenXML `.xlsx` file.

**User story:** As an enterprise analyst comparing multiple proposals, contracts, or research papers, I want the Studio to extract structured comparison tables across my active sources and export them to CSV or Excel, so that I don't have to copy-paste metrics manually.

**Reference behaviour**
1. User clicks `Data Table` in the Studio panel and either clicks a suggested table topic or types custom column/row instructions.
2. The Studio generates a structured interactive table inside the Right Panel viewer with sortable columns and inline cell citations `[n]`.
3. Clicking `Export CSV` or `Export XLSX` downloads the spreadsheet file immediately.

Evidence: `SRS §3.5.6 FR-ST-18`, `SRS §5.4 Gate v3.0 #3`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Table extraction prompt | UTF-8 text (optional) | $0\text{–}2,000$ characters | Auto-detected comparison schema from $S_{\text{aktiv}}$ |
| Table dimensions | JSON matrix | $2\text{–}25$ columns, $1\text{–}500$ rows | — |
| Export format | File download | RFC 4180 `.csv` (UTF-8 with BOM) \| `.xlsx` (OOXML) | `.xlsx` / `.csv` |

**Outputs & state**
- Visible: Interactive sortable table in the Studio viewer with cell-level citation badges `[n]`; export buttons for `.csv` and `.xlsx`.
- Persisted: `StudioArtifact` (`plugin_type: 'data_table'`, `payload_json: { columns: [...], rows: [{ cells: [{ value, chunk_ids }] }] }`).
- States: `Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed` (or `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Extract multi-document comparison table and export valid CSV and XLSX (Gate v3.0 #3)
  Given 3 active vendor PDFs describing "Vendor A", "Vendor B", and "Vendor C"
  When the owner generates a Data Table with prompt "Compare vendors by Price and Uptime SLA"
  Then the generated table contains 3 rows and columns for Vendor, Price, and Uptime SLA with cell citations
  When the user clicks "Export CSV" and "Export XLSX"
  Then the downloaded CSV parses without syntax errors and the XLSX opens cleanly in openpyxl/Excel

Scenario: Oversized comparison fails without publishing a partial table
  Given a requested comparison requires 501 rows or 26 columns
  When the system determines that either table limit would be exceeded
  Then the attempt is Failed with a clear limit explanation
  And the user is asked to provide narrower instructions
  And no table is published

Scenario: Conflicting values remain individually cited in one cell
  Given two active documents state different prices for Vendor A
  When the owner generates a vendor price comparison
  Then Vendor A occupies one row
  And its Price cell shows both values with individual supporting citations
  And the cell explicitly marks the disagreement
```

**Edge & error cases**
- Oversized requested results (more than 500 rows or 25 columns) → Fail with a clear limit explanation and request narrower instructions; publish no table. Evidence-limited lower counts still follow the shared C-03 rule.
- Conflicting values for one item/attribute → Preserve all values and individual citations within the same cell, mark the disagreement, and retain one row per item; do not silently choose a value or use the missing-evidence marker.
- Formula injection prevention in CSV/XLSX export $\rightarrow$ Cell values starting with `=`, `+`, `-`, or `@` are sanitized/escaped so opening the exported file in Excel cannot trigger CSV macro injection.

**Measurable criteria**
- Boundary fixtures requiring 501 rows or 26 columns publish zero tables and fail with a narrowing request; otherwise valid requests at 500 rows and 25 columns remain within bounds.
- Conflicting-value fixtures preserve one row per item and all conflicting values with individual citations and an explicit disagreement marker.
- $100\%$ of exported `.csv` and `.xlsx` files pass format parser validation (`Gate v3.0 #3`).

**Deviations from reference:** First-class dedicated Studio tile with `.csv`/`.xlsx` export and formula-injection sanitization.

**Out of scope:** Full two-way live spreadsheet formula editing inside the Studio viewer.

**Open questions:** `None`

## Planning contract refinements (refreshed 2026-10-21)

These refine FR-ST-08/09/18 and C-03 without altering release scope or accepted clarification answers.

- **Shared plugin integration (C-03):** Existing report-specialized DTOs and PostgreSQL repository must be extended additively for mindmap/data_table before registration. specs/013 has closed DEV-04 and applied0008 supplies Studio storage. Reuse existing report rows and repository; add a new numbered migration for typed kind/subtype constraints and durable admission/outbox/lease/cancellation/publication fences. Do not recreate deleted drafts or edit applied migrations. Preserve report wire shapes, exported schemas, lifecycle and report plugin behavior, app-scoped pool isolation and D16 single-API operation. Do not fork C-01/C-02 or a second Studio lifecycle.
- **Evidence and validation (FR-ST-08/18, C-02/C-03):** Process all original scoped chunks with retained coverage and field-level evidence. Validate required output dimensions and individual conflicting values before atomic publication. Invalid citations fail immediately; package detail may identify InvalidMindmap/InvalidTable/TableLimitExceeded under existing safe failure codes. A capped model sample must not hide a requested result exceeding500rows/25columns.
- **Drilldown (FR-ST-09, FR-GC-01/02/06):** API accepts artifact/node identity and current explicit Ready selection. Verify node plus parent supporting revisions and authorization before constructing any source-derived prompt; do not trust client labels or auto-restore sources. Reuse ordinary chat admission/history/citation checks.
- **Map presentation/export (FR-ST-08/09):** Use deterministic native SVG layout and browser Canvas for2× PNG from a validated self-contained scene; bounds include every currently expanded node irrespective of viewport transform. Escape labels and forbid active SVG/external resource content. Expansion and sorting are local view state.
- **Table serialization/export (FR-ST-18):** Use text-only ExcelJS XLSX serialization in the existing runtime and deterministic RFC4180 CSV with UTF-8 BOM. Sanitize formula-risk prefixes including whitespace/control bypasses in headers and values before CSV quoting, and use explicit string XLSX cells without formulas/macros/external links. Preserve conflict alternatives, disagreement and per-value citation references within the same exported cell; do not mutate canonical source values.
- **Export authorization (FR-ST-09/18, NFR-SEC-02):** Serve through the application API with live source/notebook access checks and private/no-store delivery; no reusable signed URL bypass. Deletion/revocation invalidates loaded/pending/cached content and delivery; mere deselection alone retains authorized historical export. Clearing application state cannot revoke already downloaded files.

- **Restart/concurrency acceptance (C-03, FR-ST-08/18, D16/specs/013):** Completed artifacts and queued new-plugin work survive API/worker restart. Transport redelivery recovers the same new-plugin attempt without duplicate publication or a user retry; terminal refusal is not silently regenerated. Preserve legacy reports: interrupted Queued/Running reports become Failed/GenerationError and require explicit retry. Exclude new-kind leased jobs from the legacy startup sweep before activation. Live owner/source revision and attempt/cancellation checks serialize atomically with publication. Drain/fence old inline work during rollout without resetting persisted rows; preserve existing row-locked rejection of late terminal report completion.
- **Current source and delivery boundaries (C-02/C-03, NFR-SEC-02):** Reuse real PostgreSQL scoped reads and all-original keyset traversal, not chat top-k for exhaustive synthesis. Carry the captured owner/revision context into workers without process-local ownership caches or recapturing newer revisions. List/get/export invalidation also redacts source-derived titles, snippets and failure text; safe unavailable metadata contains no retained source content.
- **Gate and eval evidence (NFR-EVAL-01..04):** Preserve recorded Gate v2 owner override and absent post-fix live rerun. Deterministic citation/leakage every PR; judged faithfulness/rejection and semantic support once per release candidate on fixed stratified50-case sample with case IDs/category composition/dataset hash (Constitution2.0.0). Neither override nor document integrity proves package3.3 runtime acceptance.

## Task-analysis acceptance refinements (2026-10-22; FR-ST-08/09/18, C-03)

Mindmap generation P95≤20.0s uses predeclared fixtures/environment, cold-warm mix and N≥20 accepted submissions. Queue/model/validation/persistence remain within submission-to-Completed; retain all accepted attempts, failed/unfinished=positive infinity, nearest-rank sorted position ceil(0.95*N). Missing the declared cohort cannot pass; no posthoc exclusions or chat-only warm exception. Declare browser actions/frame population/hardware before recording the unchanged60fps/≤16ms target up to120nodes; retain slow/failed samples. Existing unsupported output-language400 versus other invalid-parameter422 responses remain compatible. These refinements specify reproducible measurement and current validation behavior without changing numeric thresholds, report compatibility, table limits or source/citation rules.
