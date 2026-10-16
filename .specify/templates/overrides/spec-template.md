# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`
**Created**: [DATE]
**Status**: Draft
**Package Source**: `spec/requirements/v[N]/package_[N]_[M]_[name].md`
**SRS IDs in Scope**: `[FR-*, NFR-*, C-01..C-03]`
**Release & Gate**: `v[N].0` (`Gate v[N].0`)
**Input**: User description: "$ARGUMENTS"

## Source Traceability & Package Scope *(mandatory)*

<!--
  Constitution Principle I (CC-01):
  Every requirement, scenario, limit, and error state in this specification MUST be
  transcribed from the assigned package's FR cards and the binding cross-package rules
  in `spec/requirements/README.md`. Never invent unbacked behavior or specify deferred
  packages (such as Package 6.3 / FR-INT-01 under D5/DEV-03).
-->

| SRS ID | Requirement Title | FR Card Anchor | Architecture Decisions / Deviations |
| :--- | :--- | :--- | :--- |
| `[e.g. FR-WM-01]` | `[Title from SRS / FR card]` | `[package_N_M.md#anchor]` | `[e.g. D1, D3, D6 or none]` |

- **Within-Release Prerequisites (`spec/requirements/README.md`)**: `[List upstream packages or contracts (C-01..C-03) required by this package]`
- **Role Phasing (`FR-WM-04/05`, `NFR-SEC-02`)**: `[Owner-only in v1.0–v5.0; Owner, Editor, Viewer Full, Viewer Chat-Only active from v6.0]`
- **Data Residency (`D3`)**: `europe-west4` default `[Note any explicit region-map exception or "None"]`

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT:
  - Transcribe all user flows and Gherkin acceptance scenarios from the package's FR cards
    and `spec/requirements/README.md`.
  - User stories MUST be prioritized (P1, P2, P3...) and independently testable.
  - Symbolic fixture IDs in Gherkin (such as `chk_10`) stand for schema-valid fixture IDs
    when spec-derived tests are generated (Principle II / CC-02).
-->

### User Story 1 - [Brief Title] (Priority: P1)

**SRS IDs**: `[e.g. FR-WM-01, FR-WM-04]`
**Actors**: `[Owner (v1.0–v5.0); Owner / Editor / Viewer Full / Viewer Chat-Only (from v6.0)]`

[Describe this user journey in plain language grounded in the FR card's main flow]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this story can be tested independently against its SRS acceptance criteria]

**Acceptance Scenarios**:

1. **Given** [initial state with explicit scope/role], **When** [action], **Then** [expected outcome with exact state/status] (`[SRS-ID]`)
2. **Given** [initial state], **When** [action], **Then** [expected outcome] (`[SRS-ID]`)

---

### User Story 2 - [Brief Title] (Priority: P2)

**SRS IDs**: `[e.g. FR-WM-07]`
**Actors**: `[Actors per release phase]`

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome] (`[SRS-ID]`)

---

[Add more user stories as needed to cover every FR card in the package, each with an assigned priority and SRS IDs]

### Edge Cases *(mandatory)*

<!--
  ACTION REQUIRED: Include all edge and error cases from the package's FR cards PLUS the
  applicable binding cross-package rules from `spec/requirements/README.md`:
  - Boundary & unit limits (Unicode code points after outer whitespace trim; reject over-limit
    input rather than truncate; 200 MB = 200,000,000 bytes inclusive; 500,000 words inclusive)
  - Explicit scope (empty source selection disables generation and is rejected by API; no
    server-side "All Ready sources" fallback)
  - Submission-time (source_id, revision) snapshots & mid-flight source deletion, replacement,
    or access revocation (fail without publishing stale output)
  - Deselected/deleted source hygiene in chat history, caches, drilldowns, and exports
  - Pre-publication citation ID validation failure (immediate refusal, no citation-stripping)
  - Atomic source-slot reservation & failed-upload slot release
-->

- **[Boundary / Limit Condition (`SRS-ID`)]**: [Exact rejection behavior and error message/status]
- **[Concurrent / Mid-Flight State Change (`SRS-ID`)]**: [How in-flight jobs or requests handle deleted, replaced, or revoked sources]
- **[Unauthorized / Cross-Notebook Access (`FR-WM-04`, `NFR-SEC-02`)]**: [Server-side rejection behavior]

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED:
  - Every requirement bullet MUST cite its SRS ID, e.g., `**FR-001 (FR-WM-01)**:`.
  - Transcribe all EARS statements (Ubiquitous, Event-driven, State-driven, Unwanted) and
    numeric constraints from the package's FR cards.
  - Limit [NEEDS CLARIFICATION: ...] markers to at most 3 total across the entire spec.
-->

### Functional Requirements

- **FR-001 (`[SRS-ID]`)**: *(Ubiquitous)* The system MUST [requirement transcribed from FR card EARS statement].
- **FR-002 (`[SRS-ID]`)**: *(Event-driven)* When [trigger], the system MUST [response with exact limits/states].
- **FR-003 (`[SRS-ID]`)**: *(State-driven)* While [state], the system MUST [behavior].
- **FR-004 (`[SRS-ID]`)**: *(Unwanted)* If [error/invalid condition], then the system MUST [refusal/error transition without data leakage or truncation].

### Key Entities *(include if feature involves data)*

- **[Entity 1]** (`[SRS-ID / Contract C-01..C-03]`): [What it represents, key attributes, state transitions, and constraints without implementation-specific code]
- **[Entity 2]** (`[SRS-ID]`): [What it represents and its relationships/isolation boundaries]

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable, verifiable outcomes from the FR cards and SRS release gates.
  Note: Where TTFT is measured, standard chat TTFT starts at submission and ends at the first
  validated answer token, excluding streaming progress UI (D13).
-->

### Measurable Outcomes

- **SC-001 (`[SRS-ID / Gate vN.0]`)**: [Measurable threshold from FR card, e.g., latency P95, eval metric NFR-EVAL-01..04, or deterministic limit verification]
- **SC-002 (`[SRS-ID / Gate vN.0]`)**: [Measurable outcome verifiable via automated spec-derived tests]

## Assumptions & Out of Scope

- **In-Scope Release Constraints**: [Document assumptions grounded in `spec/requirements/README.md` and `docs/solution-architecture.md`]
- **Out of Scope / Deferred**: [List features explicitly excluded by the FR cards or deferred by architecture decisions `D5`/`DEV-03`, `D8`/`DEV-02`, `D10`]
