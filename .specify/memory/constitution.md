# Everlast LM Constitution

## Core Principles

### I. Spec Traceability

- Target behavior is governed by a strict four-tier source-of-truth hierarchy (highest first):
  1. `.specify/memory/constitution.md` (principles, invariants, and process gates)
  2. `spec/System_Requirements_Specification_Gemeni_Notebook.md` (SRS index of all `FR-*`,
     `NFR-*`, `C-01`..`C-03`, release packages, and release gates)
  3. `spec/requirements/v<N>/package_<N>_<M>_*.md` (FR cards) together with the binding
     cross-package rules and package prerequisites in `spec/requirements/README.md`
  4. `docs/solution-architecture.md` (binding technical decisions `D1`..`Dn` and risk controls)
- Every feature spec, plan, task, test, and pull request MUST cite at least one SRS ID
  (`FR-*`, `NFR-*`, `C-01`..`C-03`, or a release gate). Behavior that cannot be traced to an
  SRS ID MUST NOT be specified or built.
- One FR package file (`package_<N>_<M>_*.md`) maps to one Spec Kit feature directory
  (`specs/<NNN>-<short-name>/`). `/speckit-specify` MUST transcribe all EARS statements,
  numeric limits, error states, and Gherkin acceptance scenarios from the package's FR cards
  and `spec/requirements/README.md` without inventing unbacked requirements.
- Scope changes MUST be recorded before planning starts: scope additions as an SRS amendment,
  and scope removals or deferrals as a recorded architecture decision (`Dn`) in
  `docs/solution-architecture.md`.
- Every deliberate deviation from the reference product MUST be recorded twice before acting on
  it: as a `DEV-xx` entry in SRS §5.5 and as a matching `Dn` decision in
  `docs/solution-architecture.md`. IDs MUST NEVER be renumbered.
- Deferred packages and requirements (such as Package 6.3 / `FR-INT-01` under `D5` and
  `DEV-03`) MUST NOT be specified, planned, or implemented while their deferral remains active.

**Rationale:** Coding agents fill every ambiguity with their own guess; binding them to a
ranked, traceable specification hierarchy ensures deterministic, auditable delivery.

### II. Test-First (NON-NEGOTIABLE)

- For every requirement in scope, `tasks.md` MUST list spec-derived test tasks before the
  implementation tasks they cover. This rule overrides any template or skill text that describes
  tests as optional.
- Spec-derived tests MUST assert the EARS statements, Gherkin acceptance scenarios, error
  handling, and exact numeric limits defined in the FR cards and `spec/requirements/README.md`,
  not internal implementation details. Symbolic fixture IDs in Gherkin (such as `chk_10`) MUST
  map to schema-valid fixture IDs in tests.
- Text and size limits MUST be tested and enforced deterministically:
  - Unless a field explicitly specifies bytes, words, or grapheme clusters, text limits count
    Unicode code points after trimming outer whitespace.
  - Over-limit inputs MUST be rejected rather than silently truncated.
  - `200 MB` means `200,000,000` bytes inclusive; `500,000` extracted words is a separate
    inclusive limit applied to every source type (`FR-WM-07`, `FR-SI-01`).
- Tests MUST fail for the expected requirement-related reason before implementation starts and
  pass after implementation (`Red → Green → Refactor`).
- Disabling, skipping, or weakening a spec-derived test MUST NOT occur without a prior SRS
  amendment.
- When a test runner, lint script, eval harness, or target environment does not exist yet
  (such as during the specs-only phase), agents MUST report the check explicitly as
  `UNAVAILABLE` and MUST NOT claim that it passed.

**Rationale:** Spec-derived failing tests are the only objective proof that an autonomous agent
implemented the specification accurately.

### III. Grounding & Scoping

- All Chat and Studio outputs MUST derive exclusively from the request's active sources
  (`S_aktiv`) and eligible conversation history. The sole exception is an explicit user-triggered
  discovery or research action (`FR-SI-06`, `FR-SI-07`), whose imported or cited outputs MUST be
  explicitly labelled as external.
- Explicit scope (`FR-SI-03`, `C-02`, `NFR-EVAL-04`):
  - Every source-based generation request MUST carry an explicit list of `Ready` source IDs.
  - `"All Ready sources"` is an initial UI selection only and MUST NEVER act as a server-side
    fallback for an omitted or empty source selection.
  - Source selection is local to each user's browser session and notebook. The sole server-side
    scope resolution is for `Viewer Chat-Only` users (from v6.0), whose scope resolves to all
    `Ready` sources authorized for that user.
  - Empty scope MUST disable source-based generation in the UI and MUST be rejected by the API.
- Submission-time snapshots and access re-verification (`C-02`, `C-03`, `FR-SI-05`, `NFR-SEC-02`):
  - Every generation or background job MUST capture the selected `(source_id, revision)` pairs
    at submission time. Subsequent checkbox changes affect only later requests.
  - Workers and gateways MUST re-verify notebook and document authorization before reading
    chunks and again before publishing results.
  - If any captured source revision is deleted, replaced, or becomes unauthorized while a
    generation is in flight, the job MUST fail without publishing stale output and MUST NOT
    silently substitute a newer revision.
  - Cache keys for summaries, overviews, follow-ups, and prompts MUST include `notebook_id`,
    exact `(source_id, revision)` set, effective authorization, output language, and generation
    parameters.
- History, drilldown, and deletion hygiene (`FR-GC-01`, `FR-GC-03`, `FR-GC-06`, `FR-ST-09`,
  `NFR-EVAL-04`):
  - Content from deselected sources MUST NOT appear in retrieval results or prompts
    (`NFR-EVAL-04`: Leakage = 0).
  - If a prior conversation turn cites or depends on any source or revision outside the current
    `S_aktiv`, that turn (both question and answer) MUST be excluded from the context of the
    new turn.
  - Existing chat turns and Studio artifacts remain viewable when a source is merely deselected,
    but interactive actions (mindmap drilldown, Explain, topic chips, follow-ups) MUST use the
    current `S_aktiv` and MUST prompt the user to select missing sources rather than injecting
    out-of-scope text or silently restoring a past selection.
  - When a source is deleted or access is revoked, affected historical generated content,
    cached snippets, exports, and signed media URLs MUST be invalidated or replaced with an
    unavailable placeholder immediately.
- Pre-publication citation validation and labeling (`D13`, `FR-GC-02`, `NFR-EVAL-01..04`):
  - Every source-derived statement, summary, or media transcript claim MUST cite at least one
    chunk ID in `S_aktiv`.
  - Complete factual answers and live voice replies MUST validate all citation IDs against the
    scoped `C-01` chunks before display, publication, or speech synthesis.
  - On citation validation failure, the system MUST immediately return the refusal response (or
    fail the Studio job with a refusal explanation) and MUST NOT publish a stripped-citation
    draft or silently retry.
  - Progress and status events may stream during buffering and validation, but they MUST NOT
    count as answer Time-to-First-Token (`TTFT`); `TTFT` ends at the first validated answer
    token.
  - Code-sandbox outputs MUST be labelled `Computed` and cite their input source data; generated
    audio/video/visual media MUST be labelled `AI-generated`; decorative or structural visuals
    without direct documentary proof MUST be labelled as illustration.
- Eval gating:
  - Deterministic suites (citation-ID validity `NFR-EVAL-02` = 1.0, deselected-source leakage
    `NFR-EVAL-04` = 0) MUST run and pass on every pull request once the test harness exists.
  - LLM-judged suites (hallucination `NFR-EVAL-01` < 5 %, out-of-source rejection
    `NFR-EVAL-03` ≥ 99 %, and semantic citation support) MUST run and pass on every pull request
    touching retrieval, prompt, or chat code, and before every release gate.

**Rationale:** Strict grounding with verifiable citations, snapshot isolation, and zero leakage
through caches or chat history is the product's core enterprise guarantee.

### IV. Architectural Contracts

- `C-01 UnifiedDocumentChunk`, `C-02 ScopedContextProvider`, and `C-03 StudioGeneratorPlugin`
  MUST each be defined once as shared typed Zod schemas in `packages/contracts` (`D2`) and
  imported by all consumers. Duplicate or ad-hoc contract definitions are forbidden.
- `C-01 UnifiedDocumentChunk` MUST be the sole chunk representation emitted by ingestion and
  consumed by retrieval, citation validation, and Studio generators. Later ingestion adapters
  (such as v3 multimodal/Office import under `D11`) MUST normalize into the existing `C-01`
  locator union without breaking v1 consumers.
- `C-02 ScopedContextProvider` (`getScopedContext(notebook_id, active_source_ids)`) MUST be the
  only path by which any chat agent, Studio worker, Source Guide job, live voice gateway, or
  research synthesis reads source content. Ingestion writes `C-01` chunks; it is never a read
  bypass. Source Inspector reads MUST use an explicitly authorized singleton read scope through
  `C-02` without mutating the user's active chat selection.
- `C-03 StudioGeneratorPlugin` governs every Studio feature:
  - Adding a new Studio plugin MUST NOT modify existing plugins (open-closed principle).
  - Every Studio job MUST use the unified registry and state lifecycle:
    `Queued → Running → Completed | Failed | Cancelled` (rendering phases are substates of
    `Running`).
  - Retrying a job MUST create a new attempt with fresh authorization and explicit scope.
  - Requested item counts or durations are targets constrained by scoped evidence: when active
    sources lack sufficient evidence, generators MUST produce fewer items with an explanation
    or fail with a refusal rather than invent padding. A composite artifact MUST NEVER transition
    to `Completed` if any required block fails.
  - Large-context Studio jobs MUST process all original scoped chunks in bounded batches (`D12`);
    source summaries alone MUST NOT be treated as lossless evidence.
- Agentic vs. deterministic execution boundary:
  - ADK `LlmAgent` loops MUST be used only where the model must dynamically select tools or
    multi-step actions (grounded chat, autonomous discovery/deep research, interactive note
    assistant).
  - Ingestion, Source Guide generation, Studio artifact generators, and media rendering MUST be
    implemented as deterministic pipelines with structured outputs.
- Any breaking change to `C-01`, `C-02`, or `C-03` after its introducing release gate has passed
  MUST be preceded by an SRS amendment, a recorded architecture decision (`Dn`), a migration
  plan, and updated consumer tests in the same pull request.

**Rationale:** Enforced shared contracts and a strict boundary between agentic loops and
deterministic pipelines prevent cross-package regressions, latency spikes, and ungrounded drift.

### V. Release Gates

- Implementation of release `v(k+1)` MUST NOT start until `Gate v(k)` (SRS §5.4) has passed with
  documented evidence. Specification (`/speckit-specify`, `/speckit-clarify`) and planning
  (`/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`) for later releases MAY run ahead.
  Git worktree isolation does not waive release gates.
- Every release `v1.0` through `v6.0` MUST produce a runnable application. Passing a single
  package's unit or integration tests does not satisfy the release gate.
- Within each release, planning and task generation MUST honor the package prerequisites in
  `spec/requirements/README.md`:
  - `v1`: Shared `C-01`/`C-02` contracts first; `1.1` (identity, notebooks, quotas) → `1.2`
    (ingestion, inspector) → `1.3` (chat, citations) → `1.4` (UI shell, eval gates).
  - `v2`: `2.1` language preferences precede language-sensitive generators; `2.2` and `2.3`
    share one save-note contract; `2.4` defines `C-03`.
  - `v3`: `3.1` extends `C-01` adapters; `3.2` and `3.3` consume existing contracts; `3.4`
    benchmarks the integrated `v3` system (`≥ 1,000,000` active tokens excluding decoys).
  - `v4`: `4.1` flashcards/quizzes and `4.2` infographics (`D9` deterministic SVG, `D8`
    `.pptx`/`.pdf` only) precede the composite `FR-ST-12` Learning Overview.
  - `v5`: `5.1` TTS and player (`FR-ST-04`, single-host Join-In per `D7`/`DEV-01`) plus `v4`
    slide rendering precede `5.2` narrated video (both renditions validated; no silent fallback
    from failed Cinematic jobs to slideshows).
  - `v6`: `6.1` RBAC, enterprise quotas, and `D10` audio share-link delivery precede `6.2`
    research agents; `6.3` (`FR-INT-01`) and `Gate v6.0 #3` remain inactive under `D5`/`DEV-03`.
- Each feature MUST ship in its assigned release package unless a recorded architecture decision
  (`Dn`) and SRS amendment move or defer it.

**Rationale:** Sequential release gates and explicit within-release dependency ordering allow
parallel agent execution without building on unverified foundations.

### VI. Security & Data

- Enterprise model endpoints (`NFR-SEC-01`):
  - Company data, prompts, chunks, and generated artifacts MUST be sent only to enterprise
    Google Cloud / Gemini endpoints that contractually guarantee no training on customer data.
  - Consumer or developer API keys MUST NEVER be used with company data.
  - Specifications and documentation MUST distinguish the contractual no-training guarantee from
    zero-data-retention claims unless a specific endpoint configuration is verified to provide
    zero retention.
- Authorization and role phasing (`FR-WM-04`, `FR-WM-05`, `NFR-SEC-02`):
  - Every API endpoint and background worker MUST enforce notebook and document authorization
    server-side. A valid authentication token never substitutes for resource authorization.
  - Notebooks MUST remain strictly isolated from one another (`FR-WM-04`).
  - Releases `v1.0` through `v5.0` are strictly **Owner-only**. Role references (`Editor`,
    `Viewer Full`, `Viewer Chat-Only`) in earlier FR cards take effect only in `v6.0`.
  - From `v6.0`: only `Owner` manages shares or deletes a notebook; `Owner` and `Editor` mutate
    sources, notes, and Studio artifacts; `Viewer Full` reads/exports artifacts and manages
    personal chat, learning progress, and preferences; `Viewer Chat-Only` has access only to
    personal chat and answer-bound citation hover snippets, and MUST receive `403` on raw
    source, `/chunks`, Notes, or Studio APIs.
  - Imported or derived content MUST preserve upstream document ACLs; the least restrictive
    explicit notebook grant applies without overriding upstream source restrictions.
- Quotas and atomic slot reservation (`FR-WM-07`, `FR-SI-01`, `FR-NM-03`, `FR-SI-06`, `FR-SI-07`):
  - Source slots MUST be reserved atomically before ingestion across single upload, batch
    upload, note-to-source conversion, research import, and re-sync paths.
  - `Uploading`, `Processing`, and `Ready` sources consume a slot; `Failed` uploads MUST release
    their slot and leave only a dismissible error record. A failed re-sync MUST preserve the
    prior `Ready` revision and its slot intact.
- Untrusted content and sandbox isolation (`FR-SI-05`, `FR-GC-08`, `FR-SI-06`, `FR-SI-07`):
  - From `v3.0`, web, synced, and discovered content MUST be screened for prompt injection
    before indexing into `C-01` and MUST enforce SSRF protections against private, loopback,
    and metadata destinations.
  - Code execution (`FR-GC-08`) MUST run in an isolated managed sandbox with strict resource
    and network controls.
- Secrets and data residency (`D3`):
  - Secrets MUST NOT be committed to the repository or passed in plain environment files;
    cloud services authenticate via keyless service accounts / Workload Identity Federation and
    Secret Manager.
  - Data storage and model processing MUST default to EU regions (`europe-west4`). Every
    exception MUST be documented in a per-feature region map and approved via a recorded
    decision.

**Rationale:** The platform processes confidential enterprise documents; tenant isolation,
server-side RBAC, atomic quotas, and EU residency cannot be retrofitted later.

## Platform Constraints

- **Fixed stack (`D1`–`D4`, `D6`)**: pnpm TypeScript monorepo end-to-end (user code inside the
  `FR-GC-08` execution sandbox is exempt), Zod schemas in `packages/contracts`, Google ADK for
  TypeScript + `@google/genai`, Cloud Run services/jobs in `europe-west4` scaling to zero, one
  Cloud SQL for PostgreSQL instance (`relational` + `pgvector` + PostgreSQL FTS with Reciprocal
  Rank Fusion), Identity Platform (generic OIDC/SAML), Vitest + Playwright test/eval suites, and
  Terraform in `infra/`.
- **Architecture authority**: All technical choices in `docs/solution-architecture.md` (`D1`..`Dn`)
  are binding. Deviating from `docs/solution-architecture.md`, or introducing any new framework,
  datastore, programming language, or component with fixed idle cost, MUST be preceded by a
  recorded `Dn` decision evaluating alternatives.
- **Infrastructure & APIs**: All Google Cloud resources MUST be provisioned as Terraform IaC in
  `infra/`. Enabling any new Google Cloud API or billable service requires project-owner
  approval.
- **Model efficiency**: Every model call MUST select the smallest approved Gemini model tier
  that satisfies the package's quality and latency targets.

## Workflow & Gates

- **Mandatory Spec Kit sequence**: All feature work MUST follow the repository's six-stage
  Spec Kit workflow in order:
  `/speckit-specify` → `/speckit-clarify` (mandatory whenever open clarification markers or
  high-impact ambiguities exist) → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` →
  `/speckit-implement` (followed by `/speckit-converge` if post-implementation gaps remain).
  The bundled 4-step `.specify/workflows/speckit/workflow.yml` alone is insufficient, and
  creating artifacts under `docs/superpowers/` is forbidden.
- **Constitution Check Gate Table (`CC-01`..`CC-08`)**: Every `plan.md` (before Phase 0 research
  and again after Phase 1 design) and every `/speckit-analyze` run MUST evaluate these eight
  gates explicitly. Any justified exception MUST be recorded in the plan's Complexity Tracking
  table or as a prior `Dn` / SRS amendment:

| Gate ID | Principle | Required Verification in `plan.md` and `/speckit-analyze` |
| :--- | :--- | :--- |
| `CC-01` | I. Traceability | Every requirement, design element, and task cites its SRS ID (`FR-*`, `NFR-*`, `C-01..03`) and matches its FR card and `spec/requirements/README.md`. |
| `CC-02` | II. Test-First | Spec-derived failing test tasks precede implementation tasks for every requirement, Gherkin scenario, and numeric/text limit. |
| `CC-03` | III. Scope & Snapshot | All source reads go exclusively through `C-02` with explicit `Ready` source IDs, submission-time `(source_id, revision)` snapshots, and access re-checks. |
| `CC-04` | III. Citations & Leakage | Pre-publication citation ID validation (`D13`, `NFR-EVAL-02/03`), immediate refusal on failure, and zero deselected/revoked source leakage (`NFR-EVAL-04`) across history, caches, and drilldowns. |
| `CC-05` | IV. Contracts & Pipelines | Uses shared `C-01..C-03` schemas in `packages/contracts`; uses deterministic pipelines unless dynamic tool selection requires ADK `LlmAgent`. |
| `CC-06` | V. Release & Package Order | Honors `Gate v(k)` and within-release package prerequisites; excludes deferred items (`D5`/`DEV-03`, `D8`/`DEV-02`, `D10` before `v6.0`). |
| `CC-07` | VI. Security, RBAC & Residency | Enforces server-side auth (`Owner`-only in `v1–v5`, RBAC in `v6`), atomic quota slot reservation, enterprise no-training endpoints (`NFR-SEC-01`), and `europe-west4` residency. |
| `CC-08` | Platform & Cost | Fits the pnpm TypeScript / Cloud Run / single Cloud SQL Postgres stack without unrecorded frameworks, datastores, or fixed-idle-cost resources. |

- **Multi-session isolation & feature pinning**:
  - Every concurrent writing session MUST use its own dedicated Git worktree and branch, and
    MUST pin `SPECIFY_INIT_DIR`, `SPECIFY_FEATURE_DIRECTORY`, and `SPECIFY_FEATURE_NO_PERSIST=1`
    as defined in `AGENTS.md`.
  - Feature directory numbers (`specs/NNN-<package>`) MUST be allocated centrally before
    running `/speckit-specify` to prevent sequential numbering collisions across worktrees.
  - Task references in commits, issues, and handoffs MUST be qualified by spec path (for example,
    `specs/001-workspace-foundation T001`).
  - Edits to shared files (SRS, FR cards, constitution, `docs/solution-architecture.md`,
    `AGENTS.md`, `packages/contracts`, root manifests, CI, and `infra/`) MUST be serialized
    under a single assigned owner and merged before dependent package work.
- **Sandbox & PR gates**:
  - Agents running with relaxed permissions MUST execute inside an isolated sandbox without
    production credentials.
  - All changes MUST merge via pull request and pass `node scripts/check-spec-integrity.mjs` plus
    the lint, type-check, unit, contract, and eval suites required by Principle III.

## Governance

- This constitution is the supreme governing document of the repository and supersedes all
  conflicting templates, agent skills, or local conventions. Runtime coordination and multi-agent
  procedures in `AGENTS.md` implement and must remain aligned with this constitution.
- Amendments MUST be authored via `/speckit-constitution` in a dedicated pull request, verified
  against `node scripts/check-spec-integrity.mjs`, and approved by the project owner
  (`@lukas-zech-software`).
- Versioning follows Semantic Versioning (`MAJOR.MINOR.PATCH`):
  - `MAJOR`: Removing or weakening a core principle or mandatory gate.
  - `MINOR`: Adding a principle, gate, or materially expanded architectural/operational rules.
  - `PATCH`: Wording clarifications, cross-reference updates, or non-semantic refinements.
- Compliance MUST be verified at every `/speckit-plan` Constitution Check (`CC-01`..`CC-08`),
  during `/speckit-analyze`, and in pull request review.

**Version**: 1.1.0 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-17
