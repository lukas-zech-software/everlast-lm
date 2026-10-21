# Feature Specification: Quantitative Code Execution Sandbox

**Feature Branch**: `codex/v3-refresh-final-3-2-20261021`
**Created**: 2026-10-19
**Status**: Draft
**Package Source**: `spec/requirements/v3/package_3_2_code_execution_sandbox.md`
**SRS IDs in Scope**: `FR-GC-08`; supporting `FR-GC-01/02/03/06`, `FR-SI-03/05`, `FR-WM-04/05`, `C-01`, `C-02`, `NFR-SEC-01/02`, `NFR-EVAL-01..04`, `NFR-PERF-01`
**Release & Gate**: `v3.0` (`Gate v3.0 #2`)
**Input**: User description: "Specify release v3 package 3.2, Quantitative Code Execution Sandbox, in its own worktree with feature directory specs/010-code-execution-sandbox."

## Source Traceability & Package Scope *(mandatory)*

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| FR-GC-08 | Secure Code Execution Sandbox (Cloud Computer) | [FR card](../../spec/requirements/v3/package_3_2_code_execution_sandbox.md#fr-gc-08--secure-code-execution-sandbox-cloud-computer) | D2 sandbox-language exception; D3 residency; D18 managed resource envelope; architecture C6 and R6 |
| FR-SI-03/05, C-01, C-02, NFR-EVAL-04 | Explicit scoped data and revision lifecycle | [Binding rules](../../spec/requirements/README.md#binding-cross-package-rules) | Shared contracts; no source-read bypass |
| FR-GC-01/02/03/06, NFR-EVAL-01..04 | Grounding, citations and historical output hygiene | [Binding rules](../../spec/requirements/README.md#binding-cross-package-rules) | D13 pre-publication validation |
| FR-WM-04/05, NFR-SEC-01/02 | Notebook isolation, role phasing and enterprise data protection | [Binding rules](../../spec/requirements/README.md#binding-cross-package-rules) | D3, D6; Constitution VI |
| NFR-PERF-01 | Progress is not answer TTFT | [Package timing](../../spec/requirements/v3/package_3_2_code_execution_sandbox.md#fr-gc-08--secure-code-execution-sandbox-cloud-computer) | D13; integrated benchmark belongs to 3.4 |

- **Within-Release Prerequisites**: Package 3.1 extends C-01 adapters without changing the locator union; package 3.2 consumes existing contracts. FR-GC-01, FR-SI-03 and C-02 are direct dependencies. Package 3.3 remains separate; package 3.4 benchmarks the integrated v3 result. Gate v2.0 must pass before v3 implementation; specification may proceed beforehand.
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: Owner-only for v3. Editor, Viewer Full and Viewer Chat-Only chat use applies from v6.0, with each role's existing authorization boundaries.
- **Data Residency (`D3`, `NFR-SEC-01`)**: Default `europe-west4`; no new exception is authorized here. Any exception needs a documented per-feature region map and recorded approval. Enterprise endpoints must contractually exclude training on company data; no unverified zero-retention claim.
- **Upstream Flow-Back Status (`CC-01`)**: The 2026-10-19 statistical-intent and execution-attempt clarifications are synchronized with the package 3.2 FR card and architecture sandbox wording. The 2026-10-20 managed-default CPU/RAM revision additionally flows to the SRS FR-GC-08 acceptance amendment, shared README and D18. Future refinements must update this spec and the governing FR card, SRS or architecture and affected issues before implementation.

## Clarifications

### Session 2026-10-19

- Q: When a statistical request has multiple valid interpretations and neither the question nor its sources identifies the intended one, should the assistant ask before calculating? → A: Option A — Ask which interpretation is intended before calculating.
- Q: After an automatic correction retry, which execution attempts should the saved record and “View executed code” drawer retain? → A: Option A — Save and show both attempts in order, clearly marking the final attempt and its published outputs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Calculate and inspect grounded results (Priority: P1)

**SRS IDs**: `FR-GC-08`, `FR-GC-01/02`, `FR-SI-03`, `C-02`
**Actors**: Owner in v3; authorized chat roles from v6.

As an analyst, I want exact sums, growth rates, regressions and plots from my selected source data, with the executed calculation and citations available for inspection. For example, I upload financial reports or table-heavy PDFs, ask for R&D-spend CAGR from 2021 to 2025 and a bar chart, and receive the exact CAGR, chart, code drawer and citations to the source tables. Raw CSV ingestion is not a supported FR-SI-01 format.

**Why this priority**: Real computation prevents invented arithmetic while retaining evidence for audit.
**Independent Test**: Use a Ready source containing 12 monthly latency values; compare the calculated result and plotted values with a known calculation, then inspect labels, code and citations (`FR-GC-08`, Gate v3.0 #2).

**Acceptance Scenarios**:

```gherkin
Scenario: Sandbox computes exact arithmetic and renders plot from active source data (Gate v3.0 #2; FR-GC-08)
  Given an active source containing a table of 12 monthly server latency values
  And the intended sample or population interpretation is identified by the request, sources, or a clarification answer
  When the user asks "What is the exact standard deviation of the monthly latency and plot the trend?"
  Then the Code Execution Agent executes Python in the sandbox
  And the response includes the exact calculated standard deviation labelled "Computed", an inline chart image, and citation [1]
```

1. **Given** an explicit Ready-source selection and resolved statistical intent, **When** a quantitative request is submitted, **Then** “Running code…” appears within 2.5 s, and completion exposes computed values, downloadable PNG/SVG charts, source citations and collapsible “View executed code” / “Code anzeigen” with source and stdout (`FR-GC-08`).
2. **Given** figures in `$M` and `$B`, **When** they are combined, **Then** the visible Python comments explicitly explain unit normalization and both sources are cited (`FR-GC-08`).
3. **Given** a statistical question has multiple valid interpretations and neither request nor sources selects one, **When** the assistant prepares the calculation, **Then** it asks a focused follow-up and waits for the answer before calculating; it does not silently select an interpretation (`FR-GC-08`).
4. **Given** the first execution fails and the correction retry completes, **When** the owner opens “View executed code”, **Then** both attempts appear in execution order, with the final attempt and its published outputs explicitly identified (`FR-GC-08`).

### User Story 2 - Keep calculations isolated and failures honest (Priority: P1)

**SRS IDs**: `FR-GC-08`, `C-02`, `NFR-SEC-02`, `NFR-EVAL-04`
**Actors**: Owner in v3; authorized chat roles from v6.

As a notebook owner, I want calculations confined to the selected data and bounded resources, with a clear failure instead of an invented answer.

**Why this priority**: Source confidentiality and truthful failure are prerequisites for trustworthy computation.
**Independent Test**: Exercise isolation probes, exceptions, memory exhaustion and an infinite loop; verify network isolation, bounded attempts and transparent errors (`FR-GC-08`, Gate v3.0 #2).

**Acceptance Scenarios**:

```gherkin
Scenario: Sandbox blocks all network and filesystem escape attempts (Gate v3.0 #2; FR-GC-08)
  Given a prompt attempting to execute "import urllib.request; urllib.request.urlopen('https://example.com')"
  When the sandbox runs the code
  Then the network call fails immediately due to full network isolation
  And zero packets leave the sandbox environment
```

1. **Given** code raises an exception, **When** its first run fails, **Then** exactly one automatic self-correction retry is permitted; a second failure destroys the container and transparently reports an error with no guessed number (`FR-GC-08`).
2. **Given** an infinite loop or memory violation, **When** the 15.0 s timeout or 1.5 GB bound is reached/exceeded respectively, **Then** the run is terminated, the container destroyed, and the error reported without retry (`FR-GC-08`).
3. **Given** unselected, other-notebook or unauthorized data exists, **When** execution attempts to read it or escape the permitted filesystem/data boundary, **Then** it cannot access that content; source data remains read-only (`FR-GC-08`, `C-02`, `NFR-SEC-02`).

### User Story 3 - Preserve source scope through publication and history (Priority: P1)

**SRS IDs**: `FR-SI-03/05`, `FR-GC-01/02/03/06`, `C-02`, `NFR-EVAL-01..04`
**Actors**: Owner in v3; authorized chat roles from v6.

As an analyst, I want my result to reflect exactly the source revisions I selected and remain protected when access changes.

**Why this priority**: Correct arithmetic on unauthorized or stale evidence is not a valid grounded answer.
**Independent Test**: Change selection and source revision/access during execution, and invalidate a citation; verify the scoped snapshot and refusal behavior (`C-02`, `NFR-EVAL-04`).

**Acceptance Scenarios**:

1. **Given** omitted or empty scope, **When** generation is attempted, **Then** the UI disables source-based generation and the API rejects it without an all-sources fallback (`FR-SI-03`, `C-02`).
2. **Given** a submission snapshot, **When** checkboxes change, **Then** only later requests use that change; deletion, replacement or revocation of a captured revision fails the in-flight request without stale publication or substitution (`FR-SI-05`, `C-02`).
3. **Given** an invalid citation ID, **When** publication validation runs, **Then** an immediate refusal replaces the answer without a citation-stripped draft or retry answer (`FR-GC-02`, `NFR-EVAL-02/03`).
4. **Given** an older computed answer, **When** its source is merely deselected, **Then** the authorized history remains viewable but is excluded from new request context; deletion or revocation hides affected content, cached snippets, exports and signed chart URLs (`FR-GC-03/06`, `NFR-EVAL-04`).

### Edge Cases *(mandatory)*

- **Ambiguous statistical intent (`FR-GC-08`)**: When neither request nor sources determines the intended interpretation, ask a focused follow-up before calculating. A request such as unspecified sample versus population standard deviation cannot proceed on an unstated assumption.
- **Limits (`FR-GC-08`)**: Enforce at most 2 vCPU, 1.5 GB RAM, 64 MB temporary `/tmp` storage and 15.0 s wall-clock execution per run. An infinite loop is killed at 15.0 s; timeout and memory violations never receive a retry. Temporary storage is not permission to alter input source data.
- **Conflicting units (`FR-GC-08`)**: Normalize explicitly in visible code comments, citing both input sources.
- **Concurrent changes (`C-02`, `FR-SI-05`)**: Snapshot revisions cannot silently be replaced during a request; recheck authorization before reads and publication.
- **Unauthorized access (`FR-WM-04`, `NFR-SEC-02`)**: Authentication alone never permits other notebook or document reads. Scope applies to sandbox inputs, caches, history and all generated outputs.
- **Insufficient/invalid evidence (`FR-GC-01/02`, `NFR-EVAL-03/04`)**: Never fabricate a guessed number; invalid citation validation causes refusal. Progress statuses may appear while answers are buffered, but never count as validated answer tokens.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (`FR-GC-08`, `C-02`)**: When a user asks a quantitative, statistical, aggregation, data-cleaning or plotting question over active sources, the Grounded Reasoning Agent MUST delegate computation to the Code Execution Agent, which writes and runs Python in an ephemeral, network-isolated Agent Platform sandbox selected by the architecture. Its resource limits and egress isolation MUST be verified in the R6 spike before implementation; the documented fallback is used only if verification fails.
- **FR-002 (`FR-GC-08`, `C-02`)**: The sandbox MUST have zero inbound and outbound network access, strictly bounded resources, and read-only access solely to data/tables extracted from the current request's active-source snapshot. Local Docker flags are not evidence of isolation for the selected managed service.
- **FR-003 (`FR-GC-08`)**: Each execution MUST enforce CPU ≤2 vCPU, RAM ≤1.5 GB, temporary `/tmp` disk ≤64 MB, and wall-clock execution ≤15.0 s (default 15.0 s). Input is UTF-8 Python with the managed runtime version verified in R6 and pre-installed `math`, `statistics`, `numpy`, `pandas`, `matplotlib`, `scipy`.
- **FR-004 (`FR-GC-08`, `NFR-PERF-01`)**: When execution starts, “Running code…” MUST appear within ≤2.5 s of submission. This is progress, not an answer token, and does not satisfy standard chat TTFT; code-execution turns use their own timing criteria.
- **FR-005 (`FR-GC-08`, `FR-GC-02`)**: On completion, the grounded response MUST embed exact computed numerical values individually labelled `Computed`, generated inline PNG/SVG charts with a download button, a collapsible “View executed code” (“Code anzeigen”) block containing Python source and stdout, and `[n]` citations to the source data used.
- **FR-006 (`FR-GC-08`)**: If generated code raises an exception, the system MUST allow exactly one automatic self-correction retry. If that retry fails, or any run times out or violates memory limits, the system MUST terminate the sandbox container and report the error transparently without guessing a number. Timeout and memory violations MUST receive zero retries.
- **FR-007 (`FR-GC-08`)**: The system MUST retain `code_execution_trace` on `ChatMessage` as an ordered record of every execution attempt, including the failed first attempt when a correction retry occurs. Each attempt MUST retain `code`, `stdout`, `stderr`, `exit_code` and `artifacts: [chart_urls]`. The saved record and “View executed code” drawer MUST identify the final attempt and its published outputs and show both attempts in execution order after a retry; failed-attempt artifacts MUST NOT be presented as published results. Execution states MUST be `CodeGenerating → SandboxRunning → Succeeded` or `TimedOut` / `Failed`.
- **FR-008 (`FR-GC-08`)**: Conflicting units MUST be normalized explicitly in visible Python comments and both sources cited.
- **FR-009 (`FR-SI-03`, `C-01`, `C-02`, `NFR-EVAL-04`)**: Every request MUST use an explicit Ready-source selection and read only through C-02 using existing C-01 chunks. “All Ready sources” is initial UI selection only, never fallback for omitted/empty scope. Selection is local to the user's browser session and notebook; empty scope disables generation and is rejected server-side.
- **FR-010 (`C-02`, `FR-SI-05`, `NFR-SEC-02`)**: Requests MUST capture source IDs/revisions at submission, recheck notebook/document access before reading and publishing, and fail without stale publication when a captured revision is deleted, replaced or unauthorized. Checkbox changes affect subsequent requests only; newer content MUST NOT be silently substituted.
- **FR-011 (`FR-GC-01/03/06`, `C-02`, `NFR-EVAL-04`)**: Sandbox inputs, caches, history and generated prompts MUST obey the same scope. Cache keys MUST include notebook, exact source IDs/revisions, effective authorization, output language and relevant generation parameters. Prior turns whose snapshot includes an out-of-scope revision MUST be excluded from new context. Authorized history stays viewable after mere deselection; follow-ups use current scope and prompt for missing sources rather than restoring old selections. Deletion/revocation MUST hide affected historical content and invalidate cached snippets, exports and signed media URLs.
- **FR-012 (`FR-GC-01/02`, `NFR-EVAL-01..04`)**: Every source-derived claim MUST cite scoped chunks; complete factual answers MUST be buffered until citation-ID validation succeeds. Validation failure MUST produce immediate refusal, without stripped-citation drafts or silent retry answers. Computed results MUST cite their input data.
- **FR-013 (`FR-WM-04/05`, `NFR-SEC-01/02`)**: v3 MUST enforce Owner-only notebook/document authorization server-side and enterprise no-training endpoints. Future v6 chat roles retain their restrictions; Chat-Only scope is resolved server-side to authorized Ready sources without exposing raw-source, Notes or Studio access.
- **FR-014 (`FR-GC-08`)**: When a statistical request has multiple valid interpretations and neither the question nor its sources identifies the intended one, the assistant MUST ask a focused follow-up and wait for the answer before calculating. Clarification-only turns do not start execution or show “Running code…”. The execution-status timing applies to the submission that supplies sufficient statistical intent to start computation. It MUST NOT silently choose an interpretation.

### Key Entities

- **Execution request and source snapshot** (`FR-GC-08`, `C-02`): Quantitative question, notebook, exact selected Ready source IDs/revisions and effective authorization; input data is read-only and scope cannot expand during execution.
- **Sandbox execution** (`FR-GC-08`): Ephemeral bounded computation, generated code and at most one exception retry; states `CodeGenerating`, `SandboxRunning`, `Succeeded`, `TimedOut`, `Failed`.
- **ChatMessage execution trace** (`FR-GC-08`, `FR-GC-06`): Ordered execution attempts, each retaining code, stdout, stderr, exit code and chart URLs, with the final attempt and its published outputs identified. Both attempts remain visible in the code drawer after a retry, subject to current access and deletion hygiene.
- **Computed result and chart** (`FR-GC-08`, `FR-GC-02`): Numerical result labelled `Computed`, PNG/SVG chart and downloadable artifact, linked to validated citations and inspectable executed code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (`FR-GC-08`, Gate v3.0 #2)**: The 12-month fixture produces the known correct standard deviation and matching trend chart with `Computed`, citation [1], inspectable code and download available; the financial CAGR example retains both source references and explicit normalization where needed.
- **SC-002 (`FR-GC-08`, Gate v3.0 #2)**: Security penetration tests observe zero successful outbound network connections and zero packets leaving the sandbox; inbound access and unauthorized filesystem/data access are blocked.
- **SC-003 (`FR-GC-08`)**: On declared standard-tabular fixtures/environments, cold/warm boot plus execution latency is ≤4.0 s P95, and submission-to-“Running code…” is ≤2.5 s. This progress measurement is distinct from validated answer TTFT (`NFR-PERF-01`).
- **SC-004 (`FR-GC-08`)**: Boundary fixtures demonstrate enforcement of 2 vCPU, 1.5 GB RAM, 64 MB temporary disk and 15.0 s per run; exception cases receive exactly one retry opportunity, timeout/memory violations zero, and terminal failures publish no guessed number.
- **SC-005 (`C-02`, `NFR-EVAL-02/04`)**: Scope/revision/authorization and citation fixtures achieve citation-ID precision 1.0 and leakage 0, including stale in-flight outputs, history, caches and chart downloads.
- **SC-006 (`NFR-EVAL-01/03`, Gate v3.0)**: Applicable judged grounding checks retain hallucination <5%, out-of-source rejection ≥99% and semantic citation support. Deterministic citation/leakage suites run every PR once available; judged checks run once per release gate on its release candidate using the fixed deterministic stratified 50-case golden-dataset sample. The gate report records case IDs, category composition and dataset hash; a single passing run suffices and judged checks are not required per PR (Constitution v2.0.0). This package alone does not establish the full v3 gate.
- **SC-007 (`FR-GC-08`)**: An ambiguous statistical request fixture triggers a focused clarification before any calculation; once its interpretation is resolved, the calculation matches that interpretation. A correction-retry fixture preserves and displays both attempts in order and identifies the final attempt and published outputs without publishing failed-attempt results.

## Assumptions & Out of Scope

- **In-Scope Release Constraints (`FR-GC-08`, Gate v3.0)**: This is a specification, not R6 runtime evidence or Gate v2/v3 approval. R6 must verify the chosen managed runtime, quotas and isolation; architecture's documented fallback is Pyodide with egress disabled only if verification fails. API enablement remains subject to project-owner approval. No cloud resources are provisioned here.
- **Required technical terminology (`FR-GC-08`, CC-01)**: Python, resource units, artifact formats and persisted trace fields are source-mandated acceptance contracts, not new implementation choices. The code drawer is the card's documented auditability behavior; no new deviation is introduced.
- **Out of Scope (`FR-GC-08`, `FR-SI-01`)**: A user-facing Jupyter IDE, persistent outbound networking, runtime installation of arbitrary third-party pip packages, and raw CSV ingestion. Other v3 packages retain their separate features and acceptance gates.
- **Evidence boundary (`CC-01`, CC-02)**: Reference behavior is unverified background, not proof of a deployed service. Runtime sandbox/security/performance/eval validation remains UNAVAILABLE in this specification-only work; later tasks must place spec-derived failing tests before implementation.


## Planning decision history (2026-10-20; FR-GC-08, R6, D18)

The initial provider investigation found that the managed default (2 vCPU / 1.5 GB RAM) exceeded the former 1 vCPU / 512 MB limits. The owner initially selected Option A: "Option A: We are not expecting more than one or two simultaneous users, so this should be fine." That decision preserved the former limits and held planning for feasibility evidence.

**Superseding decision:** The owner then instructed: "Revise 3.2-P1 / FR-GC-08: accept the higher limits for default sandbox of 2 vCPU and 1.5 GB RAM". This replaces the earlier CPU/RAM caps and the planning hold caused by that mismatch. Use the managed default profile; the 4 vCPU / 4 GB alternative is not authorized. Zero inbound/outbound network, read-only scoped input, 64 MB temporary storage, 15.0-second per-run execution, retry rules and all citation/access controls remain unchanged. One or two simultaneous users remains workload context. R6 deployment qualification is required before implementation/runtime admission; it is not a condition for completing this design plan.

This changes Everlast's project acceptance envelope, not a verified reference-product deviation; D18 and the SRS FR-GC-08 amendment record the change. No new DEV entry is inferred.

### Session 2026-10-20 (FR-GC-08, D18)

- Q: Retain the old CPU/RAM caps or accept the managed default? → A: "Revise 3.2-P1 / FR-GC-08: accept the higher limits for default sandbox of 2 vCPU and 1.5 GB RAM". This supersedes the initial Option A response recorded above. The managed default is selected; other controls stay unchanged.
- Planning flow-back: use fresh managed sandboxes per attempt, scoped byte transfer without credentials, ordered traces and private authorized chart delivery. [R6 qualification](r6-feasibility.md) records required deployment evidence separately from completed design.

## Main refresh (2026-10-21; FR-GC-08, C-02, NFR-EVAL-01..04)

Latest main supplies a runnable PostgreSQL-backed chat path, buffered citation verification and hybrid scoped retrieval. Integrate sandbox execution into that path; v2 persistence is complete under D16/specs/013 (DEV-04 closed), while durable sandbox execution traces, operational cleanup records and charts remain new work. Keep historical responses compatible while preserving trace provenance, exact results and authorization on every response projection, including saved-response consumers. A targeted retrieval subset must not be presented as complete data for a whole-table calculation: obtain sufficient original evidence through C-02 with the same captured snapshot, or explain insufficient evidence without guessing. Persist a clarification-only response without claiming a computed result; its answer starts a fresh explicitly scoped submission. Retain D18's managed CPU/RAM profile and all R6 admission controls. D15 remains canonical source publication, D17/DEV-05 governs warm chat timing, and none relaxes sandbox acceptance.

## Second main refresh integration baseline (2026-10-21; FR-GC-08, FR-GC-06, C-02)

D16/specs/013 has closed DEV-04: v2 records now persist in PostgreSQL. This changes the implementation prerequisite, not FR-001..014 or the accepted D18 sandbox envelope. Existing history visibility, saved-response access rules and sources/history submission readiness remain applicable to computed and clarification turns. Sandbox admission, trace durability and crash cleanup still require their own implementation and R6 qualification; v2 restart recovery and the single-API deployment are not proof of those controls.
