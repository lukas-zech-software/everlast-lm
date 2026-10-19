# Feature Specification: UI Skeleton & Quality Gates

**Feature Branch**: `spec/v1-functional-requirements`
**Created**: 2026-10-17
**Status**: Specification reviewed; implementation not started
**Package Source**: `spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md`
**SRS IDs in Scope**: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01; C-01, C-02; Gate v1.0
**Release & Gate**: v1.0 (Gate v1.0)
**Input**: User request: SRS Version 1.0 (MVP); resumed assigned branch; specify execution 4 of 4, one package per execution.

## Source Traceability & Package Scope *(mandatory)*

Authority: [constitution](../../.specify/memory/constitution.md), [SRS](../../spec/System_Requirements_Specification_Gemeni_Notebook.md), [package cards](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md) and [binding cross-package rules](../../spec/requirements/README.md), then [architecture decisions](../../docs/solution-architecture.md#decisions). Reference-product observations are unverified background; acceptance choices below are project requirements.

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-UI-01 | Adaptive 3-Column Workspace Layout | [Card](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#fr-ui-01--adaptive-3-column-workspace-layout) | D1–D4, D6, D14; D13 for citation publication; D5 excludes cross-notebook integration |
| NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01 | Automated Evaluation & Security Gate Suite | [Card](../../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md#nfr-eval-0104--nfr-sec-01--automated-evaluation--security-gate-suite) | D1–D4, D6, D14; D13 for citation publication; D5 excludes cross-notebook integration |

- **Within-Release Prerequisites (C-01, C-02, Gate v1.0)**: Shared C-01/C-02 and integrated packages 1.1–1.3 precede full gate execution. Test harnesses and UI shells may be built ahead of their consumers.
- **Role Phasing (FR-WM-04/05, NFR-SEC-02)**: Owner-only in v1–v5. All Editor/Viewer/Chat-only references transcribed below are future v6 conditions, not v1 permissions.
- **Data Residency (D3, NFR-SEC-01)**: EU default `europe-west4`; no region exception requested by this specification.
- **Gate contribution**: Gate v1.0 #2 — the automated suite for `NFR-EVAL-01` to `04` passes ($\epsilon_{\text{hallucination}} < 0.05$, $\text{Precision}_{\text{ID}} = 1.0$, $\text{Rejection} \ge 99\%$, $\text{Leakage} = 0$).
- **Contract boundary (C-01/C-02)**: Use the one shared chunk and scoped-context contract. The C-01 locator union remains `page_span`, `time_span`, `dom_path`; v1 emits `page_span` (physical page optional for text-only content). `char_span` and `slide_number` are not additional variants. C-03 generators begin in v2, not in this package.

## User Scenarios & Testing *(mandatory)*

The following scenarios are transcribed in full. Symbolic chunk IDs denote schema-valid fixture IDs in executable tests. The normative cross-package scenarios below qualify all defaults and historical visibility statements (C-01, C-02, NFR-EVAL-04).

### User Story 1 - Adaptive 3-Column Workspace Layout (Priority: P1)

**SRS IDs**: FR-UI-01
**Actors**: Authenticated notebook Owner.

As a knowledge worker, I want a clean three-column workspace where my sources, chat, and studio/notes sit side-by-side and can be collapsed or expanded as needed, so that I never lose context while researching.

**Why this priority**: Required for the package goal: Provide the responsive 3-column Single-Page Application workspace layout and enforce automated quality/security gates for grounding faithfulness, citation precision, negative rejection, context scoping, and zero data training.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for FR-UI-01.

**Interaction flow (FR-UI-01; target behavior from the card, subject to cross-package rules)**:

1. Opening a notebook displays the 3-panel workspace (`Sources` on the left, `Chat` in the middle, `Studio` on the right) below a top bar showing the notebook logo, editable title, and user profile area.
2. Both the `Sources` panel and the `Studio` panel have a panel-collapse icon in their header bar.
3. Clicking a citation in `Chat` expands the `Sources` panel into the document viewer while keeping `Chat` interactive next to it.
4. On narrow viewports ($< 1024\text{ px}$), panels switch to tabbed navigation (`Sources` | `Chat` | `Studio`) so the app remains usable on smaller screens.

**Acceptance Scenarios (FR-UI-01)**:

```gherkin
Scenario: Workspace renders all three panels and active source counter
  Given a notebook with 3 Ready sources all selected
  When the user opens the notebook on a 1440x900 desktop viewport
  Then the Left Panel ("Sources"), Center Panel ("Chat"), and Right Panel ("Studio") are visible simultaneously
  And the Chat input bar displays "3 sources"

Scenario: Collapsing side panels preserves chat draft and scroll position
  Given the user has typed "Summarize section 2" into the chat input without sending
  When the user collapses the Left Panel and the Right Panel
  Then the Center Chat Panel expands to fill the available horizontal width
  And the chat input still contains "Summarize section 2"
```

### User Story 2 - Automated Evaluation & Security Gate Suite (Priority: P1)

**SRS IDs**: NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01
**Actors**: Evaluation runner and security auditor.

As a spec-driven development lead, I want an automated evaluation and security gate suite that blocks release promotion unless all mathematical grounding, citation, rejection, and scoping thresholds pass.

**Why this priority**: Required for the package goal: Provide the responsive 3-column Single-Page Application workspace layout and enforce automated quality/security gates for grounding faithfulness, citation precision, negative rejection, context scoping, and zero data training.

**Independent Test**: Exercise the scenarios below with isolated notebook/source fixtures; supply upstream contract fixtures where dependencies are not yet implemented. Assert the exact limits, failure states and measurable outcomes for NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01.

**Acceptance Scenarios (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01)**:

```gherkin
Scenario: Release Gate v1.0 passes all four evaluation metrics
  Given the v1.0 application and the golden evaluation dataset
  When the automated evaluation runner executes NFR-EVAL-01 through NFR-EVAL-04
  Then hallucination rate is < 0.05
  And citation ID precision is 1.0
  And negative rejection rate on out-of-scope world knowledge is >= 0.99
  And chunk leakage from deselected sources is 0
  And the evaluation portion of Gate(v1.0) passes
  And the full gate remains pending until upload/schema and citation-navigation checks also pass

Scenario: Deselected source does not leak via conversation history
  Given Sources A and B are selected and only Source B states "Project Aurora budget is $4.2M"
  And the user asked "What is the Project Aurora budget?" and received an answer citing Source B
  When the user deselects Source B and leaves Source A selected
  And asks "Repeat the Project Aurora budget"
  Then neither the prompt context nor the response contains "$4.2M"
  And the answer states that the selected sources do not mention Project Aurora
```

### Cross-package acceptance scenarios (C-02, FR-WM-04, FR-SI-03, FR-GC-01/02/03/06, NFR-EVAL-04)

1. **Given** Ready sources, **When** a request omits the selection or submits an empty selection, **Then** the server rejects it, and empty selection disables source-based generation with a select-sources prompt. Initial “All Ready sources” selection never becomes a server fallback.
2. **Given** a submitted selection and revision snapshot, **When** checkboxes change, **Then** the current request keeps its snapshot and only later requests use the new selection. **When** a captured revision is deleted, replaced or becomes unauthorized before reading or publishing, **Then** the request fails without publishing stale output or substituting a new revision.
3. **Given** prior turns or caches depend on a now-deselected source or revision (even if it was not cited), **When** a new question is submitted, **Then** both the prior question and answer, derived summaries and tool output are excluded from the prompt. Missing provenance also excludes a turn. Merely deselected historical content remains viewable while authorized.
4. **Given** historical generated content, snippets or search results depend on a deleted/revoked source, **When** they are read, **Then** the affected content is hidden or unavailable and no readable cached copy is exposed. A retained unavailable citation control may display “Source deleted” but cannot reveal text or open the source.
5. **Given** an authorized source outside the current chat selection, **When** its title or a historical citation opens the inspector, **Then** an authorized singleton C-02 read displays it without altering chat selection or making it eligible for generation.
6. **Given** a factual answer with any invalid citation, **When** verification runs, **Then** the entire draft is withheld and replaced immediately by a refusal, without regeneration or citation stripping. Progress events contain no draft factual answer and do not count toward answer TTFT.

### Boundary and security acceptance (FR-UI-01, NFR-SEC-01, NFR-EVAL-01..04)

- **Given** no saved panel preference, **When** viewport width is 1023 px, **Then** navigation is tabbed; at 1024 and 1279 px three columns exist with Studio initially collapsed; at 1280 px both side panels initially expand. Saved panel preferences persist across reloads; tab/panel changes preserve the chat draft and scroll state.
- **Given** a collapsed Sources panel, **When** a citation is clicked, **Then** it opens the inspector and highlights the cited passage. Studio shows “Notes and Studio tools will appear here” and exposes no generator in v1.
- **Given** documents, prompts and outputs, **When** model, OCR and embedding processing is configured, **Then** every selected endpoint has verifiable enterprise no-training coverage, no consumer/developer key is used, and retention claims remain separate from no-training evidence.
- **Given** the versioned benchmark, **When** counts are checked, **Then** it contains at least 100 unanswerable cases, 50 deselection cases including history, and 50 multi-document synthesis cases. A hallucination rate of exactly 0.05 fails, ID precision of 0.99 fails, rejection of exactly 0.99 passes, and any nonzero leakage fails. The 0.02 hallucination target is not substituted for the <0.05 gate.
- **Given** a metric failure, **When** the evaluation completes, **Then** the runner exits nonzero and reports failing case IDs against the build commit. Evaluation success alone leaves the full gate pending until upload/schema and citation-navigation checks also pass.

### Edge Cases *(mandatory)*

**FR-UI-01**

- Clicking citation `[1]` while the Left Panel is collapsed $\rightarrow$ Automatically un-collapses the Left Panel, opens the Source Inspector, and scrolls to chunk `[1]`.

**NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01**

- Any single metric falls below threshold (e.g., $\text{Precision}_{\text{ID}} = 0.99$) $\rightarrow$ Gate fails with non-zero exit code and logs the exact failing test case IDs.

- **Text boundaries (FR-WM-01, FR-GC-01)**: Count Unicode code points after outer whitespace trim, not bytes or grapheme clusters; reject invalid/over-limit input without truncation. Test 0/1/100/101 title code points and 0/1/10,000/10,001 message code points in the owning packages, including non-ASCII input.
- **Independent source limits (FR-WM-07, FR-SI-01)**: 200 MB = 200,000,000 bytes inclusive; 500,000 extracted words is a separate inclusive limit, including copied text. Test both exact maxima and maximum + 1, with the other limit valid. Pasted text must contain at least one code point after trimming. Empty and unsupported uploads never become usable sources.
- **Concurrent admission (FR-WM-07, FR-SI-01)**: Atomically reserve slots before ingestion; Uploading/Processing/Ready consume slots; Failed releases its slot immediately and leaves only a dismissible error row. Dismissing it does not release capacity twice. Partial/oversized objects are removed. Later-release re-sync preserves its old Ready revision and slot if validation fails; this is not v1 re-sync scope.
- **Authorization (FR-WM-04, C-02)**: Every endpoint and worker checks ownership and notebook/document access; login alone is insufficient. Cross-notebook IDs return 403 / InvalidScopeError and zero chunks, including when the same owner owns both notebooks.

## Requirements *(mandatory)*

### Functional Requirements

#### R01 — FR-UI-01 — Adaptive 3-Column Workspace Layout

**Normative EARS (FR-UI-01)**

- *Ubiquitous:* The web application shall render the notebook workspace as a reactive Single-Page Application (SPA) divided into a top navigation header and three distinct functional panels:
  1. **Left Panel (Sources):** Source list, `"Select all"` and per-source checkboxes, `"+ Add source"` button, and the collapsible Source Inspector (`FR-SI-04`).
  2. **Center Panel (Chat):** Scrollable conversation stream, inline citation badges, and bottom prompt input bar displaying the active source count (`"<n> sources"`).
  3. **Right Panel (Studio & Notes):** Collapsible container reserved for Notes and Studio artifacts (rendered as an empty/placeholder panel in `v1.0` and populated starting in `v2.0`).
- *Event:* When the user clicks the collapse/expand toggle icon on the Left Panel or Right Panel header, the system shall collapse that panel into a narrow rail and expand the Center Chat Panel smoothly without losing scroll position or input state.
- *State:* While the Source Inspector (`FR-SI-04`) is open in the Left Panel, the system shall widen the Left Panel so that the source document and the Center Chat Panel can be read side-by-side.

**Inputs, defaults and exact limits (FR-UI-01)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Viewport width | Pixels | Desktop $\ge 1280\text{ px}$ (3 columns side-by-side, both side panels expanded); Laptop $1024\text{–}1279\text{ px}$ (3 columns, Right Panel collapsed by default); Tablet/Mobile $< 1024\text{ px}$ (tabbed) | Desktop 3-column open |
| Panel collapse toggle | Click event | Left panel and Right panel independently collapsible | Both expanded on desktop |

#### R02 — NFR-EVAL-01..04 & NFR-SEC-01 — Automated Evaluation & Security Gate Suite

**Normative EARS (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01)**

- *Ubiquitous (`NFR-SEC-01`):* The system shall configure all LLM, OCR, and embedding model calls with enterprise no-training policies so that uploaded documents, prompts, and outputs are never used to train foundation models.
- *Event (`NFR-EVAL-01` — Grounding Faithfulness):* When the CI/CD pipeline executes the Grounding Evaluation Suite against a golden dataset of $(S_{\text{aktiv}}, Q, A)$ triples, the automated NLI / LLM-as-a-Judge verifier shall verify that the hallucination rate $\epsilon_{\text{hallucination}}$ is strictly $< 0.05$ ($5\%$).
- *Event (`NFR-EVAL-02` — Citation Precision):* When the CI/CD pipeline evaluates generated citations, the system shall verify that $100\%$ of inline citation badges reference a real `chunk_id` in $S_{\text{aktiv}}$ ($\text{Precision}_{\text{ID}} = 1.0$); a separate LLM-judged semantic-support suite shall check that the chunk entails the claim. Deterministic ID validation does not require a model judge.
- *Event (`NFR-EVAL-03` — Negative Rejection):* When the CI/CD pipeline runs unanswerable world-knowledge queries against unrelated active sources, the system shall refuse to answer from world knowledge in $\ge 99\%$ of test cases.
- *Event (`NFR-EVAL-04` — Strict Context Scoping):* When the CI/CD pipeline runs queries while specific sources are deselected ($s_i \notin S_{\text{aktiv}}$), the system shall verify that zero chunks from $s_i$ appear in the retrieval log, LLM prompt, or response ($\text{Leakage} = 0$).

**Inputs, defaults and exact limits (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01)**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Golden Eval Benchmark | JSONL dataset | $\ge 100$ unanswerable world-knowledge cases (`NFR-EVAL-03`), $\ge 50$ deselected-source cases incl. history carry-over (`NFR-EVAL-04`), $\ge 50$ multi-document synthesis cases (`NFR-EVAL-01`, `02`) | Versioned golden dataset for v1.0 |
| Judged release sample | Case-ID list in gate report | Exactly 50 cases, deterministic stratified selection from the golden dataset (proportional by category, each category ≥ 1); judged metrics are computed on this sample once per release gate | Fixed by dataset version |
| $\epsilon_{\text{hallucination}}$ | Float | $< 0.05$ | Target $\le 0.02$ |
| $\text{Precision}_{\text{ID}}$ | Float | $= 1.00$ | $1.00$ |
| Negative Rejection Rate | Float | $\ge 0.99$ | $1.00$ |
| Scoping Leakage | Integer | $= 0\text{ chunks}$ | $0$ |

#### Cross-package requirements (C-02, FR-SI-03, FR-GC-01/02/06, NFR-EVAL-04)

- **CP-01**: Every generation request MUST carry explicit authorized Ready source IDs and capture `(source_id, revision)` at submission; recheck authorization before reads and publication. No empty/omitted fallback is allowed. Selection is local to each user, browser session and notebook.
- **CP-02**: C-02 MUST be the sole source-read boundary, including inspector singleton reads, histories, caches, summaries, generated prompts and follow-up actions. Ingestion writes C-01 and does not bypass read scoping.
- **CP-03**: Cache identity MUST include notebook, exact source/revision set, effective authorization, output language and relevant generation parameters. Context from outside this identity MUST NOT be reused.
- **CP-04**: History inclusion MUST use complete source/revision provenance, not only displayed citations. Deletion/revocation MUST immediately invalidate affected historical generated content and cached snippets, including exports/signed URLs when those later exist. Viewability after mere deselection does not imply eligibility for new prompts.
- **CP-05**: Validate all factual-answer citations before publication; invalid citations yield immediate refusal without retry or a stripped draft. Each factual claim needs scoped supporting evidence. Merely validating the ID does not prove semantic support.
- **CP-06 (NFR-SEC-01)**: Enterprise no-training protection covers documents, prompts and outputs including model, OCR and embedding processing. No-training is not a claim of zero retention. Consumer/developer API keys cannot be used with company data. No new cloud API is authorized by this spec.

### Key Entities *(include if feature involves data)*

**FR-UI-01 — Adaptive 3-Column Workspace Layout — entities, visible outputs and state (FR-UI-01)**

- Visible: Top header + Left (`Sources`), Center (`Chat`), Right (`Studio`) panels.
- Persisted: Panel collapsed/expanded UI preference in browser `localStorage`.
- States: `ThreeColumnDefault` $\leftrightarrow$ `LeftInspectorExpanded` $\leftrightarrow$ `LeftCollapsed` / `RightCollapsed`.

**NFR-EVAL-01..04 & NFR-SEC-01 — Automated Evaluation & Security Gate Suite — entities, visible outputs and state (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01)**

- Visible: Structured JSON/Markdown evaluation report (`eval-report-v1.json`) and CI pass/fail badge.
- Persisted: Audit log of gate execution per build commit.
- States: `GatePending` $\rightarrow$ `GatePassed` (unlocks `v2.0` agent tasks) or `GateFailed` (blocks progression).

**Request provenance (C-02, NFR-EVAL-04)**: Explicit source IDs/revisions, notebook identity and effective authorization accompany scoped requests and historical messages. This extends the snapshot field listed in the cards; source IDs alone are insufficient.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**SC-001 (FR-UI-01)**

- Panel expand/collapse layout transition completes in $\le 200\text{ ms}$ at $60\text{ fps}$ with zero layout shift data loss.

**SC-002 (NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01)**

- $\epsilon_{\text{hallucination}} < 0.05$, $\text{Precision}_{\text{ID}} = 1.0$, $\text{Rejection} \ge 0.99$, $\text{Leakage} = 0$ (`SRS §4.2` & `§5.4 Gate v1.0`).

- **SC-CROSS (C-01/C-02, Gate v1.0)**: All package and cross-package acceptance cases pass with the exact boundaries above on declared fixtures/environments. Gate v1.0 requires all three integrated outcomes: PDF/MD end-to-end upload yields valid C-01 chunks; hallucination < 0.05, ID precision = 1.0, rejection >= 99%, leakage = 0; citation navigation deterministically reaches the correct DOM passage. Package success alone does not pass the gate.
- **SC-CADENCE (NFR-EVAL-01..04)**: Deterministic citation-ID and leakage checks run on every PR once the harness exists; LLM-judged faithfulness, rejection and semantic support run once per release gate on the release candidate against a fixed, deterministic stratified 50-case sample of the versioned golden dataset; that single passing run is sufficient gate evidence (Constitution v2.0.0). Missing runners are reported UNAVAILABLE, never passed.
- **SC-TIMING (NFR-PERF-01, D13)**: Timing uses declared fixtures/environments. Standard chat TTFT starts at submission and ends at the first validated answer token, excluding progress UI. Its <= 2.5 s target is non-gating in v1 and gating from v3; do not turn it into a v1 release gate.

## Assumptions & Out of Scope

- The input is MVP v1.0; this directory owns only its assigned package. Other packages own their implementation while cross-package conditions are integration obligations. The specification does not create tasks or claim implementation/gate success (Gate v1.0).
- Shared contracts are defined once; implementation ordering follows the prerequisites above. Planning assigns file ownership and evaluates CC-01..CC-08 before and after design; tasks derive failing tests before implementation (C-01/C-02, Gate v1.0).
- Bound technical names/schema fields are source requirements, not new design choices. Planning chooses no new framework or datastore without a prior architecture decision. Authentication is required in v1; D6 leaves the concrete corporate IdP to planning/deployment (FR-WM-04).
- Dark/Light mode and per-notebook language selector (`v2.0` — `FR-UI-02`), active Studio generator tiles in the right panel (`v2.0`–`v5.0` — `FR-ST-*`), `@Notebook` enterprise chat integration (deferred by D5 — `FR-INT-01`).
- **FR-UI-01 — Out of scope:** Drag-to-resize arbitrary pixel widths on every sub-widget if standard responsive flex/grid presets cover desktop and tablet breakpoints.
- **FR-UI-01 — Deviations from reference:** In `v1.0` (MVP), the Right Panel (`Studio`) renders a clean empty-state container (`"Notes and Studio tools will appear here"`), ready to receive `StudioPluginRegistry` (`Contract C-03`) tiles and Notes in `v2.0`.
- **NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01 — Out of scope:** Audio/Video/Mindmap evaluation gates (introduced in `Gate v3.0`–`Gate v5.0`).
- **NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01 — Deviations from reference:** Formalizes implicit product quality properties into hard, automated CI/CD release gates for agentic development.
- D5/DEV-03 defers FR-INT-01 and Gate v6.0 #3; D8/DEV-02 defers Google Slides export; D10 moves audio share links to v6. None is introduced by MVP specification.

## Clarifications

### Session 2026-10-17

- Q: Which evaluation checks run on every PR versus on retrieval/prompt/chat PRs and release gates (`NFR-EVAL-01..04`, `Gate v1.0`)? → A: Deterministic citation-ID (`NFR-EVAL-02` `Precision_ID = 1.0`) and context-scoping/leakage (`NFR-EVAL-04` `Leakage = 0`) suites run on every PR once the harness exists; LLM-judged grounding faithfulness (`NFR-EVAL-01` `hallucination < 0.05`), semantic citation support (`NFR-EVAL-02`), and negative rejection (`NFR-EVAL-03` `rejection >= 0.99`) run once per release gate on the release candidate against a fixed, deterministic stratified 50-case sample of the versioned golden dataset; that single passing run is sufficient gate evidence (Constitution v2.0.0). *(Amended 2026-10-19, project owner.)*
- Q: How do viewport breakpoints and `localStorage` panel preferences interact with citation click-through (`FR-UI-01`, `FR-SI-04`, `FR-GC-03`)? → A: Default layout is tabbed at `< 1024 px`, 3-column with `Studio` collapsed at `1024–1279 px`, and 3-column with both side panels expanded at `>= 1280 px`; explicit user collapse/expand preferences persist in browser `localStorage`, but clicking an inline citation `[n]` always un-collapses/switches to the `Sources` panel, opens the Source Inspector, and scrolls deterministically to `[data-chunk-id]` without losing chat draft or scroll state.
- Q: How is `NFR-SEC-01` enterprise no-training compliance verified independently of zero-retention claims (`NFR-SEC-01`, `D14`)? → A: Automated security checks verify that all LLM, OCR, and embedding endpoints use Vertex AI / Google Cloud enterprise APIs in `europe-west4` with no consumer/developer API keys (`GEMINI_API_KEY` / `GOOGLE_API_KEY` forbidden in runtime env/config), and audit reports separate no-training verification from data-retention settings.

