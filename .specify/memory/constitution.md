<!--
Sync Impact Report
==================
Version change: (unversioned template) → 1.0.0 → 1.0.1
Bump rationale: 1.0.0 is the initial ratification from the design approved on 2026-10-15
(audience: agent guardrails; workflow: Spec Kit only; tech lock-in: settled choices only;
eval gating: tiered). 1.0.1 (PATCH) clarifies Principle I: the FR cards under
spec/requirements/ are part of the source of truth.

Modified principles (template slot → new title):
  - [PRINCIPLE_1_NAME] → I. Spec Traceability
  - [PRINCIPLE_2_NAME] → II. Test-First (NON-NEGOTIABLE)
  - [PRINCIPLE_3_NAME] → III. Grounding & Scoping
  - [PRINCIPLE_4_NAME] → IV. Architectural Contracts
  - [PRINCIPLE_5_NAME] → V. Release Gates
Added principles:
  - VI. Security & Data
Added sections:
  - Platform Constraints (was [SECTION_2_NAME])
  - Workflow & Gates (was [SECTION_3_NAME])
Removed sections: none

Templates (read at runtime, not modified by this command):
  - .specify/templates/plan-template.md — compatible (Constitution Check, Complexity Tracking)
  - .specify/templates/spec-template.md — compatible
  - .specify/templates/tasks-template.md — ⚠ states "Tests are OPTIONAL"; Principle II
    overrides it. Follow-up: amend the template so test tasks are always generated.

Follow-up outside this file:
  - Add a repo CLAUDE.md line stating that the Spec Kit workflow replaces the global
    superpowers brainstorming → docs/superpowers/ pipeline in this repository.

Deferred TODOs: none
-->

# Everlast LM Constitution

## Core Principles

### I. Spec Traceability

- Every feature spec, plan, task and test MUST cite at least one ID from
  `spec/System_Requirements_Specification_Gemeni_Notebook.md` (`FR-*`, `NFR-*`, `C-01`..`C-03`,
  or a release gate).
- The SRS together with its FR cards under `spec/requirements/` is the source of truth. Where
  a card details an FR, the card is binding for that FR.
- Behaviour that cannot be traced to such an ID MUST NOT be built.
- Scope changes MUST be recorded before planning starts: additions as an SRS amendment, removals
  or deferrals as a recorded decision in `docs/solution-architecture.md`.

**Rationale:** The SRS, not an agent's interpretation, defines correct behaviour.

### II. Test-First (NON-NEGOTIABLE)

- For every requirement in scope, `tasks.md` MUST list spec-derived test tasks before the
  implementation tasks they cover. This applies regardless of any template marking tests as
  optional.
- Tests MUST assert the criteria stated in the SRS, not implementation internals.
- Tests MUST fail before implementation and pass after it (Red → Green → Refactor).
- Disabling, skipping or weakening a spec-derived test MUST NOT happen without an SRS amendment.

**Rationale:** Spec-derived tests are the only proof that an autonomous agent implemented a
requirement correctly.

### III. Grounding & Scoping

- Chat and Studio output MUST derive only from the active sources (`S_aktiv`) and conversation
  history. The sole exception is an explicit user request for a web or intranet action
  (FR-GC-01); content obtained that way MUST be labelled as external.
- Every statement derived from sources MUST cite at least one chunk in `S_aktiv`. Citation IDs
  MUST be validated in code before rendering; if validation fails, the answer MUST be replaced
  by the refusal response (NFR-EVAL-02, NFR-EVAL-03).
- Computed output (code sandbox) and generated media MUST be labelled as such and MUST cite the
  source data they were derived from.
- Content from deselected sources MUST NOT appear in retrieval results or prompts
  (NFR-EVAL-04: Leakage = 0).
- Eval gating:
  - Deterministic suites (citation-ID validity NFR-EVAL-02, leakage NFR-EVAL-04) MUST run and
    pass on every pull request.
  - LLM-judged suites (hallucination NFR-EVAL-01 < 5 %, rejection NFR-EVAL-03 ≥ 99 %) MUST run
    and pass on every pull request touching retrieval, prompt or chat code, and before every
    release gate.

**Rationale:** Strict grounding with verifiable citations is the product's core promise.

### IV. Architectural Contracts

- `C-02 ScopedContextProvider` (`getScopedContext(notebook_id, active_source_ids)`) MUST be the
  only path from any agent, job or gateway to source content.
- `C-01 UnifiedDocumentChunk` MUST be the only chunk format emitted by ingestion and consumed
  by citation and Studio code.
- Every Studio feature MUST be a `C-03 StudioGeneratorPlugin`; adding a plugin MUST NOT modify
  existing plugins.
- Each contract MUST be defined once as a shared typed schema imported by all consumers.
- A breaking contract change after its release gate has passed MUST ship with an SRS
  amendment, a migration plan and updated consumer tests in the same change.

**Rationale:** Stable contracts keep later releases from breaking accepted ones.

### V. Release Gates

- Implementation of release v(k+1) MUST NOT start until Gate v(k) passes (SRS §5.4).
  Specifying and planning MAY run ahead.
- Every release MUST be a runnable application.
- Each feature MUST ship in its assigned release package unless a recorded decision moves or
  removes it.

**Rationale:** Gates prevent unvalidated foundations from accumulating dependants.

### VI. Security & Data

- Company data, prompts and artifacts MUST be sent only to enterprise model endpoints that
  guarantee no training on customer data (NFR-SEC-01). Consumer or developer API keys MUST NOT
  be used with company data.
- Every API endpoint MUST enforce authorization server-side. Until sharing ships (v6), access
  is owner-only; afterwards the FR-WM-05 roles apply. Notebooks MUST remain isolated (FR-WM-04).
- Secrets MUST NOT be stored in the repository or in plain environment variables.
- From the release that introduces it (v3), web and research content MUST be screened for
  prompt injection before indexing.
- Data processing MUST default to EU regions; every exception MUST be listed in a per-feature
  region map.

**Rationale:** The platform holds internal enterprise knowledge.

## Platform Constraints

- Fixed choices: TypeScript end-to-end (user code executed in the sandbox is exempt), Google
  Cloud, Gemini via enterprise endpoints, EU-default residency.
- All other technical choices are binding as documented in `docs/solution-architecture.md`.
  Deviating from that document MUST be preceded by a recorded decision in it.
- Adding a framework, datastore, language, or any component with fixed idle cost MUST be
  preceded by a recorded decision with alternatives considered.
- Cloud resources MUST be defined as infrastructure as code. Enabling a new Google Cloud API or
  product requires owner approval.
- Each model call MUST use the smallest model that meets its quality bar. Deterministic
  pipelines MUST be used unless the model has to choose tools or steps.

## Workflow & Gates

- The workflow is Spec Kit only: `/speckit-specify` → `/speckit-clarify` (when the spec has
  open clarification markers) → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` →
  `/speckit-implement`. Artifacts under `docs/superpowers/` MUST NOT be created.
- Every plan MUST pass the Constitution Check before research and again after design; any
  violation MUST be justified in the plan's Complexity Tracking.
- Agents running with relaxed permissions MUST run in an isolated sandbox without production
  credentials.
- Every pull request MUST pass lint, type-check, unit tests, contract tests and the eval suites
  required by Principle III.
- All changes MUST merge via pull request.

## Governance

- This constitution supersedes all other development practices in this repository.
- Amendments are made via `/speckit-constitution` in a pull request and require project owner
  approval.
- Versioning follows semantic versioning: MAJOR for removing or redefining a principle; MINOR
  for a new principle or section or materially expanded guidance; PATCH for clarifications.
- Compliance is checked at every plan's Constitution Check, at `/speckit-analyze`, and in pull
  request review.

**Version**: 1.0.1 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-15
