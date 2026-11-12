# Everlast LM

## Source of truth (highest first)
1. `.specify/memory/constitution.md` — supreme authority (Principles I–VI, gates `CC-01`..`CC-09`, stack).
2. `spec/System_Requirements_Specification_Gemeni_Notebook.md` — SRS (`FR-*`, `NFR-*`, `C-01..C-03`, release gates, `DEV-xx`).
3. `spec/requirements/v<N>/package_<N>_<M>_*.md` + `spec/requirements/README.md` — FR cards and cross-package rules/prerequisites.
4. `docs/solution-architecture.md` — binding architecture decisions (`D1..Dn`).

## Worktree Prerequisite (Mandatory First Step)
- **Every work in this repository ALWAYS has to start with creating a Git worktree and working solely in that. It must be the very first step before doing anything else.**
- Never work, edit files, run specifications, or execute tasks directly in the root repository checkout or on `main`.

## Spec Kit workflow

`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` (or `specify workflow run pipeline`)

- **Worktree-first mandate**: Every task, command, or workflow must begin by creating a dedicated Git worktree and working solely within it as the very first step.
- **Package scope**: One FR package per `specs/<NNN>-<name>/` directory. Always load `spec/requirements/README.md` alongside the package's FR card; write generated specs in English.
- **Bidirectional flow-back**: Downstream clarifications, contract refinements, or implementation discoveries must flow back into `spec.md`/`plan.md` and upstream to FR cards, SRS, or architecture decisions (`Dn`).
- **Templates & gates**: Follow `.specify/memory/constitution.md` (`CC-01`..`CC-09`) and `.specify/templates/overrides/{spec,plan,tasks}-template.md` (do not edit managed `.specify/templates/*.md` or `{.agents,.github}/skills/speckit-*` directly).
- **Traceability & TDD**: Cite SRS IDs on every requirement, plan section, task, and test (`CC-01`). Spec-derived failing tests precede implementation (`CC-02`, Red → Green → Refactor); report non-existent runners as `UNAVAILABLE`.
- **Worktree isolation & feature pinning**: Work in dedicated Git worktrees on feature branches (never directly on `main`). Pin the active feature via `.specify/feature.json` (avoiding persistent `SPECIFY_FEATURE_DIRECTORY` env vars). Qualify task references with `[<feature-slug>] T001`.
- **Verification & PR**: Pass `node scripts/check-spec-integrity.mjs`, `pnpm check:kpi-sanity`, and applicable test/eval gates (`NFR-EVAL-01..04`) before opening a PR to `main`.

## Hobby-Tier Proportionality & Anti-Ceremony Guardrails (`D24` / `DEV-07`)
- **Single-developer hobby scope**: Never invent or preserve enterprise-SLA KPIs (`>= 500k` active tokens, `< 16.7 ms` `rAF` frame budgets on `60 Hz` displays, `< 5 s` buffered LLM TTFT, `>= 15` live cloud repetitions, or probabilistic LLM-judge bars stricter than `< 10%` hallucination / `>= 90%` rejection).
- **Buffering vs. streaming latency (`D13`)**: Whenever an architectural decision shifts a response path from token streaming to full-answer buffering, recalibrate the corresponding latency target in the same commit.
- **Escalate instead of building benchmark ceremony**: If verifying an NFR would require multi-hour paid cloud runs, pre-warmed always-on infrastructure, or custom cryptographic/cloud-bridge measurement plumbing, **stop and propose a `DEV-xx`/`Dn` recalibration** rather than building infrastructure around an unrealistic target.
- **Generic KPI sanity check**: Run `pnpm check:kpi-sanity` (or invoke the `kpi-sanity-check` skill) during `/speckit-plan`, `/speckit-implement`, and `/speckit-converge` to catch unrealistic metrics before they lock into release gates.

## Release-to-Package Decomposition & Multi-Package Agent Orchestration

### 1. Release Resolution to Packages and FR Cards
When given a release-level goal (for example, `Release: v3.0 "Version 3.0: Multimodal Ingestion, Visual Graphs & Data Analytics"`), agents must resolve it to its constituent functional packages and FR cards using the following procedure:
1. **SRS Release Chapter Lookup**: Consult [`spec/System_Requirements_Specification_Gemeni_Notebook.md`](spec/System_Requirements_Specification_Gemeni_Notebook.md) (§5 Roadmap / Release definitions, e.g. §5.3 Version 3.0) to identify all functional packages assigned to that release milestone. For `v3.0`, this resolves to 4 packages:
   - Paket 3.1: `FR-SI-01`, `FR-SI-05`, `C-01`
   - Paket 3.2: `FR-GC-08`
   - Paket 3.3: `FR-ST-08`, `FR-ST-09`, `FR-ST-18`
   - Paket 3.4: `NFR-PERF-01`
2. **Package Requirements Directory Lookup**: Locate the corresponding package requirement cards under `spec/requirements/v<N>/` (e.g. `spec/requirements/v3/`):
   - Package 3.1: [`spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md`](spec/requirements/v3/package_3_1_multimodal_ingestion_sync.md)
   - Package 3.2: [`spec/requirements/v3/package_3_2_code_execution_sandbox.md`](spec/requirements/v3/package_3_2_code_execution_sandbox.md)
   - Package 3.3: [`spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md`](spec/requirements/v3/package_3_3_studio_structure_data_extraction_mindmaps_tables.md)
   - Package 3.4: [`spec/requirements/v3/package_3_4_long_context_latency_scaling.md`](spec/requirements/v3/package_3_4_long_context_latency_scaling.md)
3. **Cross-Package Prerequisite Analysis**: Consult [`spec/requirements/README.md`](spec/requirements/README.md#package-prerequisites) to inspect the within-release dependency graph among the identified packages.

### 2. Single-Package Branch Restriction
- **One Package Per Branch**: Exactly one FR package may be processed in one git branch and one feature directory (`specs/<NNN>-<slug>/`) at a time. Spec Kit commands (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`, etc.) must never lump multiple packages into a single branch or feature directory.

### 3. Spec Kit Context Awareness
- Spec Kit tracks the active feature currently being worked on in `.specify/feature.json`.
- Avoid using the environment variable `SPECIFY_FEATURE_DIRECTORY`. If this environment variable is encountered, prefer writing its value into `.specify/feature.json` and unsetting the environment variable.
- The `feature_directory` in `.specify/feature.json` must match the agent's current work, except at the very start before `/speckit-specify` was invoked (before that, it might contain nothing or previous values).

### 4. Multi-Package Subagent Orchestration
Whenever an agent is tasked with `/speckit-specify` or other Spec Kit workflows with a prompt covering a release or multiple packages, the agent encounters the single-package restriction. Although multiple packages have been identified, the agent must NOT process them in a single branch or directory. Instead, the agent must determine whether the packages depend on each other:
- **Interdependent Packages (Sequential Subagent Execution)**:
  - If the packages depend on each other (e.g., Package 3.1 extends C-01 adapters with audio/video/web chunks, Packages 3.2 and 3.3 consume these grounded outputs, and Package 3.4 benchmarks the combined result):
  - The agent **MUST NOT** process them in parallel or together.
  - The agent **MUST invoke subagents to work on each package one after another**: exactly **one subagent per package**, and **only one subagent active at a time**.
  - The next subagent **MAY NOT be started until the previous subagent has completely finished**.
  - **Worktree creation**: Each subagent MUST create a new Git worktree branching off the previous agent's completed work/branch (ensuring clean lineage, isolated directories, and preventing branch collisions).
  - **Context initialization (second mandatory step)**: Immediately after creating the worktree, the subagent MUST set the `feature_directory` in `.specify/feature.json` to the feature directory it was started for. The parent agent must provide this target feature path via the environment variable `SPECIFY_FEATURE_DIRECTORY` (which the subagent writes to `.specify/feature.json` and then unsets).
- **Independent Packages (Concurrent Subagent Execution)**:
  - **ONLY IF** the packages do not depend on each other and have no shared uncommitted prerequisites, the agent **MAY invoke the subagents at the same time** (each running in its own dedicated worktree and feature branch, with its context initialized as above).


## Architectural guardrails (all agents)

- Before repository changes, read Constitution IV/CC-09 and
  [the architecture guardrail procedure](docs/agent-architecture-guardrails.md).
  Apply it to every feature, fix, refactor and delegated task, including work outside a skill.
- Preserve feature-oriented modules; shared packages must not depend on applications, and
  applications must not consume other deployment applications as libraries. Use explicit
  public exports and ports; composition roots wire adapters.
- Routes own transport concerns; services own multi-step workflows; adapters own SQL and
  transaction mechanics. Authorized simple CRUD requires a rationale, not a forwarding layer.
- Populate CC-09 boundary and behavior evidence in plans, tasks, analysis, convergence and PRs.
  Recheck it on the actual final diff. Missing evidence or new violations blocks completion.
- Existing violations require individually scoped, approved migration exceptions; never treat
  current code as permission to copy the pattern. Preserve D16, C-02, atomicity and publication
  fencing during extraction. Report a missing checker as UNAVAILABLE, never as a passing lint gate.
- When resuming an older feature, refresh its plan/tasks for CC-09 and rerun analysis before
  implementation. Governance-only work does not repoint `.specify/feature.json`.
- Delegation/bootstrap must pass these instructions, the constitution, procedure, feature path,
  package scope, allowed files and exception evidence to every agent. Verify instruction loading
  for integrations that do not discover AGENTS.md automatically.
- Use project-owned template overrides and workflow overlays for durable guardrails. Do not
  weaken rules or edit generated skills to make a task pass. Follow the constitution's amendment
  and exception process when a rule cannot be met.

- Run `pnpm test:architecture`, `pnpm check:architecture` and
  `pnpm check:architecture-artifacts` (also part of lint). CI compares exceptions and feature
  artifacts against the PR base. Do not regenerate or widen the migration inventory to make
  a feature pass. Remove stale entries with the actual remediation; expired debt blocks CI.
