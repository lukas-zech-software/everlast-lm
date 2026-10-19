# Feature Specification: Studio Mindmaps and Data Tables

**Feature Branch**: `v3-specify-20261019/011-studio-mindmaps-data-tables`
**Created**: 2026-10-19
**Status**: Draft
**Package Source**: `spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md`
**SRS IDs in Scope**: `FR-ST-08, FR-ST-09, FR-ST-18`; supporting `FR-SI-02/03/05, FR-GC-01/02/06, FR-WM-04/05, C-01..C-03, NFR-EVAL-01..04, NFR-SEC-01/02`
**Release & Gate**: `v3.0` (`Gate v3.0 #3`, mindmap and table portion)
**Input**: User description: "Specify release v3.0 package 3.3: source-grounded hierarchical mindmaps, interactive chat drilldown, PNG/SVG export, and structured data tables with CSV/XLSX export."

## Source Traceability & Package Scope *(mandatory)*

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-ST-08 | Automatic Mindmap Generation | [FR-ST-08](../../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md#fr-st-08--automatic-mindmap-generation) | D12 preserves original evidence; D13 validates before publication |
| FR-ST-09 | Mindmap Interactivity, Chat Drilldown & Export | [FR-ST-09](../../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md#fr-st-09--mindmap-interactivity-chat-drilldown--export) | D13; PNG/SVG behavior already specified by card |
| FR-ST-18 | Structured Data Tables & CSV/XLSX Export | [FR-ST-18](../../spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md#fr-st-18--studio-structured-data-tables--csvxlsx-export) | D13; sanitized exports already specified by card |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: Package 3.1 supplies normalized multimodal evidence through C-01; this package consumes existing C-01/C-02 and package 2.4's C-03 without redefining them. FR-SI-03 supplies explicit selection; FR-GC-01/02/06 supplies grounded chat and history. Package 3.2 is an inherited sibling specification, not a new dependency on sandbox computation. Package 3.4 owns integrated context/latency benchmarks. Gate v2.0 must pass before v3 implementation.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only in v3.0. Owner/Editor generation and Full Viewer reading/export become applicable from v6.0; Chat-Only users have no Studio access.
- **Data Residency (`D3`, `NFR-SEC-01`)**: `europe-west4` default; no new region exception. Enterprise content retains the contractual no-training guarantee; no zero-retention claim is added.
- **Upstream Flow-Back Status (`CC-01`)**: Clarifications dated 2026-10-19 for oversized table requests and conflicting cell values are mirrored in the package FR-ST-18 card. No shared SRS or architecture amendment is needed because these refine existing table limits and grounded comparison behavior. Constitution and README already govern evidence-limited counts, lifecycle, scope, and large-context processing over all original chunks; these take precedence over abbreviated card examples. Later refinements must update this specification and the governing upstream card/SRS/architecture.

## Clarifications

### Session 2026-10-19

- Q: When a requested comparison would need more than 500 rows or 25 columns, should the system ask the user to narrow the request or produce a visibly limited table? → A: Fail the attempt with a clear limit explanation and request narrower instructions; publish no table.
- Q: When selected documents give different values for the same item and attribute, how should the comparison table show that disagreement? → A: Keep one row per compared item; show all conflicting values with their individual citations in the same cell and mark the disagreement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a grounded topic map (Priority: P1)

**SRS IDs**: `FR-ST-08, FR-SI-03, C-01..C-03, NFR-EVAL-02/04`
**Actors**: Owner in v3.0

The owner selects Ready sources and clicks “Mind Map” in Studio or the notebook overview. An asynchronous “Generating Mind Map...” entry becomes an artifact that opens as a full canvas, with a central topic and color-coded categories, subtopics, and leaf facts.

**Why this priority**: The map makes relationships across selected documents visible and supplies the basis for navigation.

**Independent Test**: Generate from three selected source fixtures and inspect the resulting tree, source references, lifecycle, and opening view.

**Acceptance Scenarios**:

1. **Given** three active Ready sources, **When** the owner clicks “Mind Map”, **Then** the completed artifact is a single-rooted, hierarchical acyclic tree at least two levels deep, with labels derived exclusively from those sources. (`FR-ST-08`, `Gate v3.0 #3`)
2. **Given** candidate cyclic edges, orphan nodes, or duplicate node IDs, **When** validation occurs, **Then** the job is Failed and no invalid map is published. (`FR-ST-08`, `C-03`)
3. **Given** at least 50 selected sources, **When** the map is generated, **Then** all original scoped evidence is considered without dropping sources; Source Guides may help organize balanced branches but cannot replace original evidence. (`FR-ST-08`, `FR-SI-02`, `C-02`, `D12`)
4. **Given** sources that cannot support the requested number of nodes, **When** generation completes, **Then** fewer supported items are supplied with an explanation, or the job refuses if none are supported; facts are never invented to fill a target. (`FR-ST-08`, `C-03`)

---

### User Story 2 - Explore and export a mindmap (Priority: P1)

**SRS IDs**: `FR-ST-09, FR-GC-01/02/06, NFR-EVAL-04`
**Actors**: Owner in v3.0

The owner pans, zooms, fits the map to the screen, and expands or collapses branches. Clicking a node opens a source-grounded explanation in the chat panel. The owner exports the currently expanded tree for reports.

**Why this priority**: Navigation, cited deep dives, and portable images make the generated map useful beyond its initial view.

**Independent Test**: Open a valid map fixture, exercise controls, verify the resulting chat scope/history, and inspect both exported image formats.

**Acceptance Scenarios**:

1. **Given** “mTLS Certificates” under “Security Architecture” and currently selected supporting sources, **When** the node body is clicked, **Then** chat receives a prompt about the child in its parent context and publishes a grounded answer with inline citations after validation; the turn persists in history. (`FR-ST-09`, `FR-GC-01/02/06`)
2. **Given** 25 visible nodes, **When** “Export PNG” and “Export SVG” are selected, **Then** a non-empty valid PNG and valid SVG containing all 25 labels are downloaded, covering the full bounds of the currently expanded tree. (`FR-ST-09`)
3. **Given** a node derived from Source B while only Source A is selected, **When** the node is clicked, **Then** a select-supporting-sources prompt appears, B is not automatically selected, and no B-derived node label or summary enters chat. (`FR-ST-09`, `NFR-EVAL-04`)
4. **Given** an open map with no selected sources, **When** a node is clicked, **Then** the owner is prompted to select sources; no historical selection is restored and no new source-derived prompt is submitted. (`FR-ST-09`, `FR-SI-03`)
5. **Given** an initially depth-two expanded map, **When** a branch chevron is toggled, **Then** that branch's children expand/collapse with animation, and pan/zoom and fit-to-screen remain available. (`FR-ST-08/09`)

---

### User Story 3 - Compare documents in a cited table (Priority: P1)

**SRS IDs**: `FR-ST-18, FR-SI-03, C-02/C-03, NFR-EVAL-02`
**Actors**: Owner in v3.0

The owner clicks “Data Table” in Studio and optionally selects a suggested schema or gives focus instructions. The completed table supports sorting, cell citations, and CSV or Excel downloads.

**Why this priority**: Structured comparisons replace manual transcription while retaining evidence for each factual value.

**Independent Test**: Extract Vendor, Price, and Uptime SLA from three selected vendor PDFs and validate the displayed evidence and both exported files.

**Acceptance Scenarios**:

1. **Given** active vendor PDFs A, B, and C, **When** the owner requests “Compare vendors by Price and Uptime SLA”, **Then** the table has three rows and Vendor, Price, and Uptime SLA columns with factual cell citations; **When** CSV and XLSX are exported, **Then** both parse successfully and the spreadsheet opens without errors. (`FR-ST-18`, `Gate v3.0 #3`)
2. **Given** a document does not state a requested attribute, **When** its cell is generated, **Then** it displays “N/A (Not in sources)” instead of an invented value. (`FR-ST-18`)
3. **Given** cell values beginning with `=`, `+`, `-`, or `@`, **When** either format is exported, **Then** those values are escaped/sanitized so opening the file does not execute a formula. (`FR-ST-18`)
4. **Given** an optional prompt of 2,000 trimmed Unicode code points, **When** submitted, **Then** it is within the accepted boundary; **Given** 2,001 code points, **When** submitted, **Then** it is rejected without truncation. (`FR-ST-18`, `C-03`)
5. **Given** a comparison request that requires more than 500 rows or 25 columns, **When** the system determines that the result exceeds either limit, **Then** the attempt becomes Failed with a clear limit explanation and a request for narrower instructions, and no table is published. (`FR-ST-18`, `C-03`)
6. **Given** two selected documents state different prices for the same vendor, **When** the comparison table is generated, **Then** the vendor remains one row, the Price cell contains both values with separate supporting citations, and the cell explicitly marks the disagreement. (`FR-ST-18`, `NFR-EVAL-02`)

### Edge Cases *(mandatory)*

- **Scope (`FR-SI-03`, `C-02`, `NFR-EVAL-04`)**: Empty or omitted selection disables generation and is rejected; “all Ready sources” is only an initial UI selection. Selection is local to the browser session and notebook.
- **Mid-flight changes (`FR-SI-05`, `C-02/C-03`, `NFR-SEC-02`)**: Capture source IDs and revisions at submission. Later checkbox changes affect future requests only. Deletion, replacement, or loss of authorization fails the active job without stale publication or substitution of a new revision.
- **History and exports (`FR-ST-09/18`, `FR-GC-06`, `NFR-EVAL-04`)**: Mere deselection permits authorized historical viewing/export but not reuse in a new prompt. Deletion/revocation immediately hides affected content or replaces it with unavailable placeholders, including cached snippets and exports.
- **Invalid evidence (`FR-GC-02`, `C-03`, `NFR-EVAL-02`)**: Invalid or out-of-scope citations fail a Studio job with a refusal explanation before publication; no stripped-citation artifact or silent retry is exposed. The equivalent chat failure returns a refusal.
- **Limits (`FR-ST-08/18`, `C-03`)**: Node labels are at most 80 trimmed Unicode code points. Table prompts are 0–2,000. Over-limit input is rejected rather than truncated; generated output must satisfy its limits before publication. Insufficient evidence permits fewer supported items with explanation, never padded facts.
- **Oversized comparison (`FR-ST-18`, `C-03`)**: If fulfilling the requested comparison requires more than 500 rows or 25 columns, fail the attempt with a clear limit explanation and ask for narrower instructions; do not publish a truncated or partial table. This upper-bound behavior is distinct from evidence-limited lower counts.
- **Conflicting evidence (`FR-ST-18`, `NFR-EVAL-02`)**: Preserve one row per compared item and show all conflicting values, each individually cited, in the affected cell with an explicit disagreement marker; do not silently choose one value or substitute the missing-evidence marker.
- **Authorization (`FR-WM-04/05`, `NFR-SEC-02`)**: Login alone grants no notebook/document access. Reject cross-notebook and unauthorized reads, generation, drilldowns, and exports; retain upstream document restrictions.
- **Job termination (`C-03`)**: Failed or Cancelled jobs expose no completed invalid artifact. Retry starts a new attempt with fresh explicit scope and authorization; missing required blocks cannot be marked Completed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`FR-ST-08`, `FR-SI-03`, `C-03`)**: When the owner clicks the Mind Map tile/chip in Studio or the overview with explicit Ready source selection, the system MUST generate and retain a hierarchical mindmap as a Studio artifact, with a visible asynchronous job entry and an interactive canvas on opening.
- **FR-002 (`FR-ST-08`, `C-03`)**: Published maps MUST be single-rooted, acyclic trees with unique node IDs and no orphan nodes, organized from central topic through categories/subtopics to facts. Invalid graphs MUST fail before publication. Target depth is 2–5 levels and target size 15–120 nodes; labels MUST be at most 80 characters, with initial expansion to depth 2. Evidence-limited lower counts follow FR-013.
- **FR-003 (`FR-ST-08`, `FR-SI-02`, `C-01/C-02`)**: Generation for notebooks with 50 or more selected sources MUST preserve coverage of all original scoped chunks; summaries may assist organization but MUST NOT replace evidence. Every factual node label/summary MUST retain supporting source references.
- **FR-004 (`FR-ST-09`)**: The viewer MUST provide pan, zoom, fit-to-screen, and animated per-branch chevron expand/collapse controls. It MUST export PNG at the default 2× scale and lossless SVG covering the full bounds of currently expanded nodes.
- **FR-005 (`FR-ST-09`, `FR-GC-01/02/06`)**: Clicking a node body/label MUST bring its contextual explanation into the center chat panel, minimizing/closing the fullscreen overlay or keeping it docked. The prompt MUST concern the node in its parent branch context, use current selected supporting sources, publish only validated cited answers, and persist the resulting turn.
- **FR-006 (`FR-ST-09`, `NFR-EVAL-04`)**: If supporting sources/revisions for a node or its contextual text are outside current scope, the system MUST prompt for source selection without injecting that text or automatically restoring historical scope. This applies to empty scope and prior history used in the new turn.
- **FR-007 (`FR-ST-18`, `C-03`)**: Clicking Data Table MUST extract a persistent comparison table from explicit active sources. It MUST accept an optional 0–2,000-character focus prompt, a suggested schema, or automatic schema selection when no prompt is supplied; the viewer MUST provide sortable columns, inline citation badges, and export controls.
- **FR-008 (`FR-ST-18`)**: Tables MUST target 2–25 columns and 1–500 rows. Every factual cell MUST reference its supporting source passage by chunk ID; absent attributes MUST display “N/A (Not in sources)”. Evidence-limited counts follow FR-013.
- **FR-009 (`FR-ST-18`)**: CSV downloads MUST be valid RFC 4180 UTF-8 with BOM; Excel downloads MUST be valid OpenXML XLSX. Both MUST escape/sanitize leading `=`, `+`, `-`, and `@` values against formula execution.
- **FR-010 (`FR-SI-03/05`, `C-02/C-03`, `NFR-SEC-02`, `NFR-EVAL-04`)**: All generation MUST use explicit Ready sources through the shared scoped-content contract and capture source ID/revision pairs at submission. Authorization MUST be checked before reads and publication. Deleted/replaced/unauthorized revisions MUST fail the attempt without stale output or implicit substitution.
- **FR-011 (`FR-GC-02/06`, `FR-ST-09/18`, `NFR-EVAL-01..04`)**: Validate all factual citation IDs against scoped evidence before publishing. Failure MUST refuse rather than strip citations or silently retry. History, cached summaries, generated prompts, and exports MUST obey current authorization and source/revision hygiene; cache identity MUST include notebook, scope/revisions, authorization, language, and generation parameters.
- **FR-012 (`C-03`, `FR-ST-08/18`)**: Both generators MUST use the shared Studio lifecycle `Queued → Running → Completed | Failed | Cancelled`; rendering stages are Running substates. Retry MUST create a new attempt. The new artifact types MUST coexist with existing generators without altering their behavior.
- **FR-013 (`C-03`, `FR-ST-08/18`)**: Requested counts are evidence-constrained targets. Generate fewer supported items with an explanation or refuse if none are supported; never invent padding or publish an artifact missing required blocks. Text limits count Unicode code points after outer-whitespace trimming, with over-limit inputs rejected.
- **FR-014 (`FR-WM-04/05`, `NFR-SEC-01/02`, `C-02`)**: v3 operations MUST remain owner-only and notebook/document authorized, preserving upstream restrictions and enterprise no-training handling. Deleted/revoked derived artifacts MUST become unavailable immediately; generated visuals MUST be labelled AI-generated and structural illustration must not be presented as documentary evidence.
- **FR-015 (`FR-ST-18`, `C-03`)**: If a requested comparison requires more than 500 rows or 25 columns, the system MUST fail the attempt with a clear limit explanation and request narrower instructions; it MUST NOT publish a table for that attempt.
- **FR-016 (`FR-ST-18`, `NFR-EVAL-02`)**: When selected sources disagree about an item’s attribute, the table MUST retain one row for that item and show all conflicting values in the affected cell, each with its own supporting citation, and explicitly mark the disagreement.

### Key Entities *(include if feature involves data)*

- **Source selection snapshot** (`C-01/C-02`, `FR-SI-03/05`): Explicit Ready source IDs, exact revisions, notebook, and effective authorization captured for one attempt; subsequent checkbox changes do not alter it.
- **Studio artifact and job** (`C-03`): Notebook-bound generated result, kind (mindmap or data table), attempt, parameters, supporting snapshot, and lifecycle state; only validated completed results are published.
- **Mindmap node** (`FR-ST-08/09`): Unique identity, bounded label, summary, supporting chunk references, children, and expansion state within a rooted tree.
- **Data table** (`FR-ST-18`): Ordered columns and rows containing cell values and supporting chunk references, or the explicit missing-evidence marker; conflicting cells retain all values with per-value references and an explicit disagreement marker within one item row; presented with sorting and safe downloads.
- **Drilldown chat turn** (`FR-GC-06`, `FR-ST-09`): Persisted question/validated answer tied to the current scope; historical map provenance does not grant scope for a new turn.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`FR-ST-08`, `Gate v3.0 #3`)**: 100% of published mindmaps pass rooted, hierarchical, acyclic structure validation; cyclic, duplicate-ID, and orphan fixtures publish no map.
- **SC-002 (`FR-ST-08`)**: Mindmap generation completes in at most 20.0 seconds at P95 on declared fixtures and environment.
- **SC-003 (`FR-ST-09`)**: Pan/zoom and expand/collapse meet the card's 60 fps and at most 16 ms frame-time targets with up to 120 nodes on the declared environment.
- **SC-004 (`FR-ST-09`)**: Exporting the 25-visible-node fixture produces valid non-empty PNG and SVG files containing all 25 labels and the full expanded tree bounds.
- **SC-005 (`FR-ST-18`, `Gate v3.0 #3`)**: 100% of exported CSV/XLSX files pass format validation and open without errors; all tested leading formula characters remain inert on opening.
- **SC-006 (`FR-ST-18`, `NFR-EVAL-02`)**: The three-vendor fixture yields three cited rows with the requested columns; all factual cells have valid supporting references and every absent requested value uses the missing-evidence marker.
- **SC-007 (`NFR-EVAL-01..04`, `FR-ST-09`)**: Applicable evaluation fixtures achieve citation-ID precision 1.0, leakage 0, hallucination below 5%, and out-of-source rejection at least 99%; semantic citation support is evaluated. Missing-scope drilldowns introduce zero out-of-scope labels or summaries.
- **SC-008 (`FR-ST-08/18`, `C-03`, `NFR-SEC-02`)**: Boundary fixtures enforce the specified text/dimension limits and evidence exception; all deletion/replacement/revocation and invalid-citation fixtures fail without exposing invalid artifacts.
- **SC-009 (`FR-ST-18`, `C-03`)**: Fixtures requiring 501 rows or 26 columns fail with a limit explanation and a request for narrower instructions, publishing zero tables; otherwise valid requests at 500 rows and 25 columns remain within bounds.
- **SC-010 (`FR-ST-18`, `NFR-EVAL-02`)**: In conflicting-value fixtures, every compared item remains one row and every conflicting source value appears in its attribute cell with an individual supporting citation and an explicit disagreement marker.

## Assumptions & Out of Scope

- **In-Scope Release Constraints** (`C-03`, `FR-ST-08/09/18`): This is a specification-only deliverable for package 3.3. Existing contracts, language preferences, source selection, and chat remain prerequisites. Card reference behavior is unverified background, not a claim of observed current external behavior. Runtime timing and format success criteria require later tests on declared fixtures; this document does not claim those gates passed.
- **Priority and bounds** (`FR-ST-08/09/18`, `C-03`): All three card priorities are P1. Depth-two initial expansion satisfies both cards' opening-view bounds. The constitution's evidence-limited lower-count rule governs nominal node/table targets without widening upper bounds.
- **Out of Scope / Deferred** (`FR-ST-08/09/18`, `FR-ST-16/17`): Manual drag-and-drop re-parenting, FreeMind/XMind exports, full two-way spreadsheet formula editing, v4 slide decks/infographics, and v6 collaboration roles. No new sandbox, ingestion adapter, or integrated performance benchmark is delivered in this package.
