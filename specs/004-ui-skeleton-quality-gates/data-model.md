# Data Model: UI Skeleton & Quality Gates

Trace: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01, C-02. No migrations are executed by this document.

| Entity | Invariants / ownership |
| :--- | :--- |
| Workspace view state | Active notebook/tab, left/right collapsed preferences, inspector focus, chat draft and scroll. Preferences stored locally; authoritative data/selection remain owned by their feature modules. |
| GoldenCase | Stable ID, category, notebook/source/revision fixtures, explicit active set, question, expected supported/unanswerable claims and forbidden strings; no real customer content. |
| EvalRun | Commit, fixture hashes, model/judge versions, prompts/config/seed when supported, endpoint/region, case IDs, raw metrics, errors, pass/fail and timestamps. |
| ReleaseGate | Pending/Failed/Passed with separate upload/schema, eval and citation-navigation outcomes; never promote from partial success or missing suite. |
| Endpoint evidence | Service/purpose/region, enterprise no-training coverage/configuration reference, retention statement separately, verification date and approver where needed. |

## FR-UI-01 — Adaptive 3-Column Workspace Layout

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Viewport width | Pixels | Desktop $\ge 1280\text{ px}$ (3 columns side-by-side, both side panels expanded); Laptop $1024\text{–}1279\text{ px}$ (3 columns, Right Panel collapsed by default); Tablet/Mobile $< 1024\text{ px}$ (tabbed) | Desktop 3-column open |
| Panel collapse toggle | Click event | Left panel and Right panel independently collapsible | Both expanded on desktop |

- Visible: Top header + Left (`Sources`), Center (`Chat`), Right (`Studio`) panels.
- Persisted: Panel collapsed/expanded UI preference in browser `localStorage`.
- States: `ThreeColumnDefault` $\leftrightarrow$ `LeftInspectorExpanded` $\leftrightarrow$ `LeftCollapsed` / `RightCollapsed`.

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## NFR-EVAL-01..04 & NFR-SEC-01 — Automated Evaluation & Security Gate Suite

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Golden Eval Benchmark | JSONL dataset | $\ge 100$ unanswerable world-knowledge cases (`NFR-EVAL-03`), $\ge 50$ deselected-source cases incl. history carry-over (`NFR-EVAL-04`), $\ge 50$ multi-document synthesis cases (`NFR-EVAL-01`, `02`) | Versioned golden dataset for v1.0 |
| $\epsilon_{\text{hallucination}}$ | Float | $< 0.05$ | Target $\le 0.02$ |
| $\text{Precision}_{\text{ID}}$ | Float | $= 1.00$ | $1.00$ |
| Negative Rejection Rate | Float | $\ge 0.99$ | $1.00$ |
| Scoping Leakage | Integer | $= 0\text{ chunks}$ | $0$ |

- Visible: Structured JSON/Markdown evaluation report (`eval-report-v1.json`) and CI pass/fail badge.
- Persisted: Audit log of gate execution per build commit.
- States: `GatePending` $\rightarrow$ `GatePassed` (unlocks `v2.0` agent tasks) or `GateFailed` (blocks progression).

Defaults are qualified by owner-only release phasing and explicit-scope rules; All Ready is only an initial UI choice.

## Consistency boundaries (C-01/C-02, FR-WM-04)

All persistent children carry notebook identity and parent constraints. Database revision/embedding/epoch data never expands C-01's five-field projection. Keep long-running extraction/model/network operations outside row locks, then recheck parent authorization and captured revision under the shared publication fence before atomic success. A canceled/deleted parent or stale revision cannot be recreated by retries. Use immutable attempt/request IDs and deterministic idempotency. Cascading parent deletion invalidates content, cached snippets and in-flight jobs; no retained copy leaks through search/export/view state.
