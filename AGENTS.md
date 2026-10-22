# Everlast LM

## Source of truth (highest first)
1. `.specify/memory/constitution.md` — supreme authority (Principles I–VI, gates `CC-01`..`CC-08`, stack).
2. `spec/System_Requirements_Specification_Gemeni_Notebook.md` — release index (release → packages → FR card IDs). The former full SRS is archived as obsolete in `docs/archive/`.
3. `spec/requirements/v<N>/package_<N>_<M>_*.md` + `spec/requirements/README.md` — FR cards, cross-package rules/prerequisites, contracts `C-01..C-03`, release gates, `DEV-xx` deviation log, card clarifications.
4. `docs/solution-architecture.md` — binding architecture decisions (`D1..Dn`).

## Worktree Prerequisite (Mandatory First Step)
- **Every work in this repository ALWAYS has to start with creating a Git worktree and working solely in that. It must be the very first step before doing anything else.**
- Never work, edit files, run specifications, or execute tasks directly in the root repository checkout or on `main`.

## Spec Kit workflow

`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` (or `specify workflow run pipeline`)

- **Worktree-first mandate**: Every task, command, or workflow must begin by creating a dedicated Git worktree and working solely within it as the very first step.
- **Package scope**: One FR package per `specs/<NNN>-<name>/` directory. Always load `spec/requirements/README.md` alongside the package's FR card; write generated specs in English.
- **Bidirectional flow-back**: Downstream clarifications, contract refinements, or implementation discoveries must flow back into `spec.md`/`plan.md` and upstream to FR cards, `spec/requirements/README.md`, the release index, or architecture decisions (`Dn`).
- **Templates & gates**: Follow `.specify/memory/constitution.md` (`CC-01`..`CC-08`) and `.specify/templates/overrides/{spec,plan,tasks}-template.md` (do not edit managed `.specify/templates/*.md` or `{.agents,.github}/skills/speckit-*` directly).
- **Traceability & TDD**: Cite SRS IDs on every requirement, plan section, task, and test (`CC-01`). Spec-derived failing tests precede implementation (`CC-02`, Red → Green → Refactor); report non-existent runners as `UNAVAILABLE`.
- **Worktree isolation & feature pinning**: Work in dedicated Git worktrees on feature branches (never directly on `main`). Pin the active feature via `.specify/feature.json` (avoiding persistent `SPECIFY_FEATURE_DIRECTORY` env vars). Qualify task references with `[<feature-slug>] T001`.
- **Verification & PR**: Pass `node scripts/check-spec-integrity.mjs` and applicable test/eval gates (`NFR-EVAL-01..04`) before opening a PR to `main`.

## Release-to-Package Decomposition & Multi-Package Agent Orchestration

### 1. Release Resolution to Packages and FR Cards
When given a release-level goal (for example, `Release: v3.0 "Version 3.0: Multimodal Ingestion, Visual Graphs & Data Analytics"`), agents must resolve it to its constituent functional packages and FR cards using the following procedure:
1. **Release Index Lookup**: Consult [`spec/System_Requirements_Specification_Gemeni_Notebook.md`](spec/System_Requirements_Specification_Gemeni_Notebook.md) (release index: one table per version) to identify all functional packages assigned to that release milestone. For `v3.0`, this resolves to 4 packages:
   - Paket 3.1: `FR-SI-01` (subset B), `FR-SI-05`
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

