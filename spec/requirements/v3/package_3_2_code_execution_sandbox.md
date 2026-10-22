# Package 3.2 — Quantitative Code Execution Sandbox

- **Release:** v3.0
- **Goal:** Provide the Grounded Reasoning Agent with an isolated, network-disabled Python code execution sandbox ("Cloud Computer") to perform deterministic calculations, data cleaning, and chart generation over structured/tabular data extracted from active sources.
- **FRs:** FR-GC-08
- **Gate criteria (SRS §5.4):** Gate v3.0 #2 — the Python sandbox (`FR-GC-08`) is network-isolated and returns correct calculation results and plots.
- **Out of scope:** Arbitrary user-facing Jupyter notebook IDE or persistent outbound network access from sandbox containers.

**Cross-package rules:** [Binding scope, roles, lifecycle, quotas and validation](../README.md#binding-cross-package-rules).

---

### FR-GC-08 — Secure Code Execution Sandbox (Cloud Computer)

| Field | Value |
| :- | :- |
| Release / Package | v3.0 / 3.2 |
| Priority (within package) | P1 |
| Actors | Owner; Editor, Viewer, Chat-only (from v6.0) — triggered automatically by the Chat Agent |
| Depends on | FR-GC-01, FR-SI-03, C-02 |
| Reference provenance (unverified) | 2026-10-15, Enterprise SRS §3.3 & §4.1 |

**Requirement (EARS)**
- *Event:* When a user asks a quantitative, statistical, aggregation, or plotting question in Chat over active sources ($S_{\text{aktiv}}$), the Grounded Reasoning Agent shall delegate computation to the `Code Execution Agent`, which writes and executes Python code inside an ephemeral, network-isolated Agent Platform sandbox selected in the architecture; the project owner accepts this managed service under D19, with no separate R6 feasibility or qualification gate.
- *Ubiquitous:* The sandbox environment shall have **zero outbound or inbound network access**, the managed sandbox's CPU/memory limits plus an application-enforced execution deadline, and access solely to copies of the data/tables extracted from the current request's $S_{\text{aktiv}}$ (`Contract C-02`); executed code cannot modify stored sources (D20).
- *Event:* When code execution starts, the system shall show a `"Running code…"` status in the chat response within $\le 2.5\text{ s}$ of the user's submission (this progress event is not an answer token and does not satisfy `NFR-PERF-01`; code-execution turns have their own timing criteria).
- *Event:* When sandbox execution completes, the system shall embed the computed numerical results, each marked with a `Computed` label, generated charts (PNG/SVG), and a collapsible `"View executed code"` (`"Code anzeigen"`) inspection block inside the assistant's grounded chat response alongside source citations `[n]` to the source data used.
- *Unwanted:* If the generated Python code raises an exception, then the system shall allow exactly $1$ automatic self-correction retry; if the retry also fails, or if any run exceeds the application execution deadline ($15\text{ s}$) or the sandbox reports a memory error (managed limit $1.5\text{ GB}$) (no retry for timeout or memory violations), then the system shall delete the sandbox, discard any later result and report the error transparently without fabricating a guessed number.

- *Event:* When a statistical request has multiple valid interpretations and neither the question nor its sources identifies the intended one, the assistant shall ask a focused follow-up and wait for the answer before calculating, rather than silently choosing an interpretation. Clarification-only turns do not start execution or show “Running code…”; execution-status timing applies to the submission that supplies sufficient statistical intent to start computation.

**User story:** As a financial or data analyst, I want the chat assistant to calculate exact sums, growth rates, regressions, and charts by running real Python code on numbers from my sources, so that I never suffer from LLM arithmetic hallucinations.

**Reference behaviour**
1. User uploads financial reports or table-heavy PDFs (raw CSV ingestion is not a supported FR-SI-01 format) and asks `"Calculate the compound annual growth rate (CAGR) of R&D spend from 2021 to 2025 and plot a bar chart"`.
2. The assistant extracts the cited figures from $S_{\text{aktiv}}$, runs Python (`pandas`/`matplotlib`) in the isolated sandbox, and displays the exact CAGR percentage, the rendered bar chart image, an expandable `"View executed code"` drawer, and citations `[1]`, `[2]` to the source tables.

Evidence: `SRS §3.3 FR-GC-08`, `SRS §5.4 Gate v3.0 #2`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Generated Python script | UTF-8 Python code using the managed runtime version recorded by the integration | Pre-installed `math`, `statistics`, `numpy`, `pandas`, `matplotlib`, `scipy` | — |
| Sandbox CPU / RAM limit | Managed sandbox profile | $\le 2\text{ vCPU}$, $\le 1.5\text{ GB RAM}$ (provider default, D18); provider-limited file system; $\le 100\text{ MB}$ input/output files per request or response (D20) | Enforced by the provider |
| Execution timeout | Wall-clock duration, enforced by the application (D20) | $\le 15.0\text{ s}$ per execution (no retry after timeout; max $1$ retry after an exception) | $15.0\text{ s}$ |
| Outbound network | Network namespace | Disabled by the selected managed sandbox; application integration and release tests retain the isolation requirement | Disabled |

**Outputs & state**
- Visible: Exact computed values, inline rendered chart image (PNG/SVG with download button), collapsible code block (`stdout` + Python source), and source citations `[n]`.
- Persisted: `code_execution_trace` stored on `ChatMessage` as an ordered record of every execution attempt. Each attempt retains `code`, `stdout`, `stderr`, `exit_code`, and `artifacts: [chart_urls]`. After an automatic correction retry, save and show both attempts in execution order in the “View executed code” drawer, explicitly identifying the final attempt and its published outputs. Failed-attempt artifacts are not published results; existing scope, authorization and deletion hygiene apply to every attempt.
- States: `CodeGenerating` $\rightarrow$ `SandboxRunning` $\rightarrow$ `Succeeded` (or `TimedOut` / `Failed`).

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Sandbox computes exact arithmetic and renders plot from active source data (Gate v3.0 #2)
  Given an active source containing a table of 12 monthly server latency values
  And the intended sample or population interpretation is identified by the request, sources, or a clarification answer
  When the user asks "What is the exact standard deviation of the monthly latency and plot the trend?"
  Then the Code Execution Agent executes Python in the sandbox
  And the response includes the exact calculated standard deviation labelled "Computed", an inline chart image, and citation [1]

Scenario: Ambiguous statistical intent is clarified before computation (FR-GC-08)
  Given a statistical request has multiple valid interpretations
  And neither the request nor its sources identifies the intended interpretation
  When the assistant prepares the calculation
  Then it asks a focused follow-up and waits for the answer before calculating
  And it does not silently choose an interpretation

Scenario: Correction retry preserves inspectable execution history (FR-GC-08)
  Given the first execution raises an exception
  And the automatic correction retry completes
  When the user opens "View executed code"
  Then both attempts appear in execution order
  And the final attempt and its published outputs are explicitly identified
  And failed-attempt artifacts are not presented as published results

Scenario: Sandbox blocks all network and filesystem escape attempts (Gate v3.0 #2)
  Given a prompt attempting to execute "import urllib.request; urllib.request.urlopen('https://example.com')"
  When the sandbox runs the code
  Then the network call fails because the managed sandbox has no network access
  And no result derived from a network response is published
```

**Edge & error cases**
- Infinite loop (`while True: pass`) in generated code $\rightarrow$ Abandoned at the $15.0\text{ s}$ application deadline; the sandbox is deleted and late results are discarded (D20).
- Whole-table calculation $\rightarrow$ A targeted retrieval subset is not complete data: obtain sufficient original evidence through C-02 with the same captured snapshot, or explain that evidence is insufficient.
- Clarification-only turn $\rightarrow$ Persisted without a computed result; the answer starts a fresh, explicitly scoped submission.
- Execution never starts $\rightarrow$ A request rejected before execution allocation has no trace. An allocated execution failing before code submission records `Failed` with zero attempts, no final attempt and no artifacts (no invented exit code). An unknown result after submission keeps its real attempt and is reconciled without replay.
- Historical responses stay compatible; every stored, visible and saved-response projection keeps trace provenance, exact results and authorization.
- Source numbers have conflicting units (e.g., `$M` vs `$B`) $\rightarrow$ Agent normalizes units explicitly in the visible Python code comments and cites both sources.

**Measurable criteria**
- $0$ successful outbound network connections in security penetration tests (`Gate v3.0 #2`).
- Sandbox cold/warm boot + execution latency $\le 4.0\text{ s}$ (P95) for standard tabular calculations. Fix fixture, runtime and cohort sample counts before collection, keep every run, and fail any cohort containing failed or timed-out runs; missing samples are UNAVAILABLE.

**Deviations from reference:** Exposes the executed Python snippet in a collapsible `"View executed code"` drawer for enterprise auditability.

**Out of scope:** Installing arbitrary third-party `pip` packages at runtime.

**Clarifications (2026-10-19):** The project owner selected a focused follow-up before ambiguous statistical calculations and ordered persistence/display of both execution attempts after a retry, with the final attempt and published outputs identified.

**Open questions:** `None`

## Design and history

Limits follow decisions D18 (2026-10-20), D19 and D20 (2026-10-22) in the [architecture decisions](../../../docs/solution-architecture.md#decisions); the owner's wording is recorded in the [package 3.2 spec clarifications](../../../specs/010-code-execution-sandbox/spec.md#clarifications). Implementation design lives in the [package 3.2 plan](../../../specs/010-code-execution-sandbox/plan.md); the [refresh report](../../../specs/010-code-execution-sandbox/refresh-report.md) records planning history.
