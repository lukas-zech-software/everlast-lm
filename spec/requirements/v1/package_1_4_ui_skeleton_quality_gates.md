# Package 1.4 — UI Skeleton & Quality Gates

- **Release:** v1.0
- **Goal:** Provide the responsive 3-column Single-Page Application workspace layout and enforce automated quality/security gates for grounding faithfulness, citation precision, negative rejection, context scoping, and zero data training.
- **FRs:** FR-UI-01, NFR-SEC-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04
- **Gate criteria (SRS §5.4):** Gate v1.0 #2 — the automated suite for `NFR-EVAL-01` to `04` passes ($\epsilon_{\text{hallucination}} < 0.05$, $\text{Precision}_{\text{ID}} = 1.0$, $\text{Rejection} \ge 99\%$, $\text{Leakage} = 0$).
- **Out of scope:** Dark/Light mode and per-notebook language selector (`v2.0` — `FR-UI-02`), active Studio generator tiles in the right panel (`v2.0`–`v5.0` — `FR-ST-*`), `@Notebook` enterprise chat integration (deferred by D5 — `FR-INT-01`).

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-UI-01 — Adaptive 3-Column Workspace Layout

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.4 |
| Priority (within package) | P1 |
| Actors | Owner; Editor, Viewer, Chat-only (from v6.0; Chat-only hides side panels) |
| Depends on | FR-WM-01, FR-SI-03, FR-SI-04, FR-GC-01 |
| Reference provenance (unverified) | 2026-10-15, Gemini Notebook web |

**Requirement (EARS)**
- *Ubiquitous:* The web application shall render the notebook workspace as a reactive Single-Page Application (SPA) divided into a top navigation header and three distinct functional panels:
  1. **Left Panel (Sources):** Source list, `"Select all"` and per-source checkboxes, `"+ Add source"` button, and the collapsible Source Inspector (`FR-SI-04`).
  2. **Center Panel (Chat):** Scrollable conversation stream, inline citation badges, and bottom prompt input bar displaying the active source count (`"<n> sources"`).
  3. **Right Panel (Studio & Notes):** Collapsible container reserved for Notes and Studio artifacts (rendered as an empty/placeholder panel in `v1.0` and populated starting in `v2.0`).
- *Event:* When the user clicks the collapse/expand toggle icon on the Left Panel or Right Panel header, the system shall collapse that panel into a narrow rail and expand the Center Chat Panel smoothly without losing scroll position or input state.
- *State:* While the Source Inspector (`FR-SI-04`) is open in the Left Panel, the system shall widen the Left Panel so that the source document and the Center Chat Panel can be read side-by-side.

**User story:** As a knowledge worker, I want a clean three-column workspace where my sources, chat, and studio/notes sit side-by-side and can be collapsed or expanded as needed, so that I never lose context while researching.

**Reference behaviour**
1. Opening a notebook displays the 3-panel workspace (`Sources` on the left, `Chat` in the middle, `Studio` on the right) below a top bar showing the notebook logo, editable title, and user profile area.
2. Both the `Sources` panel and the `Studio` panel have a panel-collapse icon in their header bar.
3. Clicking a citation in `Chat` expands the `Sources` panel into the document viewer while keeping `Chat` interactive next to it.
4. On narrow viewports ($< 1024\text{ px}$), panels switch to tabbed navigation (`Sources` | `Chat` | `Studio`) so the app remains usable on smaller screens.

Evidence: `https://blog.google/technology/ai/notebooklm-redesign-audio-overviews/`, `SRS §3.6 FR-UI-01` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Viewport width | Pixels | Desktop $\ge 1280\text{ px}$ (3 columns side-by-side, both side panels expanded); Laptop $1024\text{–}1279\text{ px}$ (3 columns, Right Panel collapsed by default); Tablet/Mobile $< 1024\text{ px}$ (tabbed) | Desktop 3-column open |
| Panel collapse toggle | Click event | Left panel and Right panel independently collapsible | Both expanded on desktop |

**Outputs & state**
- Visible: Top header + Left (`Sources`), Center (`Chat`), Right (`Studio`) panels.
- Persisted: Panel collapsed/expanded UI preference in browser `localStorage`.
- States: `ThreeColumnDefault` $\leftrightarrow$ `LeftInspectorExpanded` $\leftrightarrow$ `LeftCollapsed` / `RightCollapsed`.

**Acceptance criteria (Gherkin)**

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

**Edge & error cases**
- Clicking citation `[1]` while the Left Panel is collapsed $\rightarrow$ Automatically un-collapses the Left Panel, opens the Source Inspector, and scrolls to chunk `[1]`.

**Measurable criteria**
- Panel expand/collapse layout transition completes in $\le 200\text{ ms}$ at $60\text{ fps}$ with zero layout shift data loss.

**Deviations from reference:** In `v1.0` (MVP), the Right Panel (`Studio`) renders a clean empty-state container (`"Notes and Studio tools will appear here"`), ready to receive `StudioPluginRegistry` (`Contract C-03`) tiles and Notes in `v2.0`.

**Out of scope:** Drag-to-resize arbitrary pixel widths on every sub-widget if standard responsive flex/grid presets cover desktop and tablet breakpoints.

**Open questions:** `None`

---

### NFR-EVAL-01..04 & NFR-SEC-01 — Automated Evaluation & Security Gate Suite

| Field | Value |
| :- | :- |
| Release / Package | v1.0 / 1.4 |
| Priority (within package) | P1 |
| Actors | Automated CI/CD Evaluation Runner, Security Auditor |
| Depends on | FR-WM-04, FR-SI-03, FR-GC-01, FR-GC-02, C-01, C-02 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS Validation Standard |

**Requirement (EARS)**
- *Ubiquitous (`NFR-SEC-01`):* The system shall configure all LLM, OCR, and embedding model calls with enterprise no-training policies so that uploaded documents, prompts, and outputs are never used to train foundation models.
- *Event (`NFR-EVAL-01` — Grounding Faithfulness):* When the CI/CD pipeline executes the Grounding Evaluation Suite against a golden dataset of $(S_{\text{aktiv}}, Q, A)$ triples, the automated NLI / LLM-as-a-Judge verifier shall verify that the hallucination rate $\epsilon_{\text{hallucination}}$ is strictly $< 0.05$ ($5\%$).
- *Event (`NFR-EVAL-02` — Citation Precision):* When the CI/CD pipeline evaluates generated citations, the system shall verify that $100\%$ of inline citation badges reference a real `chunk_id` in $S_{\text{aktiv}}$ ($\text{Precision}_{\text{ID}} = 1.0$); a separate LLM-judged semantic-support suite shall check that the chunk entails the claim. Deterministic ID validation does not require a model judge.
- *Event (`NFR-EVAL-03` — Negative Rejection):* When the CI/CD pipeline runs unanswerable world-knowledge queries against unrelated active sources, the system shall refuse to answer from world knowledge in $\ge 99\%$ of test cases.
- *Event (`NFR-EVAL-04` — Strict Context Scoping):* When the CI/CD pipeline runs queries while specific sources are deselected ($s_i \notin S_{\text{aktiv}}$), the system shall verify that zero chunks from $s_i$ appear in the retrieval log, LLM prompt, or response ($\text{Leakage} = 0$).

**User story:** As a spec-driven development lead, I want an automated evaluation and security gate suite that blocks release promotion unless all mathematical grounding, citation, rejection, and scoping thresholds pass.

**Reference behaviour**
1. Google Gemini Notebook enforces enterprise data privacy (never training on workspace/uploaded data) and strict source grounding.
2. In our spec-driven pipeline, running the v1.0 gate eval suite executes all four evaluation harnesses and returns exit code `0` only if every metric meets its threshold (test tooling is decided in `/speckit-plan`).

Evidence: `https://support.google.com/notebooklm/answer/16164461`, `SRS §4.2 & §5.4 Gate v1.0`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Golden Eval Benchmark | JSONL dataset | $\ge 100$ unanswerable world-knowledge cases (`NFR-EVAL-03`), $\ge 50$ deselected-source cases incl. history carry-over (`NFR-EVAL-04`), $\ge 50$ multi-document synthesis cases (`NFR-EVAL-01`, `02`) | Versioned golden dataset for v1.0 |
| $\epsilon_{\text{hallucination}}$ | Float | $< 0.05$ | Target $\le 0.02$ |
| $\text{Precision}_{\text{ID}}$ | Float | $= 1.00$ | $1.00$ |
| Negative Rejection Rate | Float | $\ge 0.99$ | $1.00$ |
| Scoping Leakage | Integer | $= 0\text{ chunks}$ | $0$ |

**Outputs & state**
- Visible: Structured JSON/Markdown evaluation report (`eval-report-v1.json`) and CI pass/fail badge.
- Persisted: Audit log of gate execution per build commit.
- States: `GatePending` $\rightarrow$ `GatePassed` (unlocks `v2.0` agent tasks) or `GateFailed` (blocks progression).

**Acceptance criteria (Gherkin)**

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

**Edge & error cases**
- Any single metric falls below threshold (e.g., $\text{Precision}_{\text{ID}} = 0.99$) $\rightarrow$ Gate fails with non-zero exit code and logs the exact failing test case IDs.

**Measurable criteria**
- $\epsilon_{\text{hallucination}} < 0.05$, $\text{Precision}_{\text{ID}} = 1.0$, $\text{Rejection} \ge 0.99$, $\text{Leakage} = 0$ (`SRS §4.2` & `§5.4 Gate v1.0`).

**Deviations from reference:** Formalizes implicit product quality properties into hard, automated CI/CD release gates for agentic development.

**Out of scope:** Audio/Video/Mindmap evaluation gates (introduced in `Gate v3.0`–`Gate v5.0`).

**Open questions:** `None`
