# Everlast LM

Re-implementation of Gemini Notebook / NotebookLM on Google Cloud. Greenfield: specs only, no application code yet.

## Source of truth (highest first)
1. `.specify/memory/constitution.md`: overrides everything (Principles I–VI and gates `CC-01`..`CC-08`).
2. `spec/System_Requirements_Specification_Gemeni_Notebook.md` (SRS): index of all IDs (`FR-*`, `NFR-*`, `C-01..C-03`, release gates, and `DEV-xx` in §5.5). Keep the filename spelling; links depend on it.
3. `spec/requirements/v<N>/package_<N>_<M>_*.md` + `spec/requirements/README.md`: FR cards are binding for the detail of their FR; `spec/requirements/README.md` defines the binding cross-package rules (explicit scope, submission snapshots, history/cache/drilldown hygiene, pre-publication citation validation, job lifecycles, text/byte/word limits, role phasing) and within-release package prerequisites.
4. `docs/solution-architecture.md`: binding technical choices; decisions `D1..Dn` in its Decisions table.

Deviations from the original product: `DEV-xx` in SRS §5.5 plus a matching `Dn` in `docs/solution-architecture.md`. IDs are never renumbered.

## Workflow (Spec Kit only)

`/speckit-specify` → `/speckit-clarify` (if markers or ambiguities remain) → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` (if post-implementation gaps remain)

- One package per spec, with one session responsible for its lifecycle. Example: `/speckit-specify spec/requirements/v1/package_1_1_workspace_foundation.md`. Resume existing artifacts instead of creating a competing spec for the same package.
- Always load `spec/requirements/README.md` alongside the package's FR card file during every Spec Kit stage so cross-package rules and within-release prerequisites are enforced.
- Every spec, plan, task and test cites an SRS ID (`FR-*`, `NFR-*`, `C-01..C-03`, or release gate). Untraceable behaviour is not built. Never create `docs/superpowers/`.
- Record scope changes before planning: additions as an SRS amendment, removals or deferrals as an architecture decision (`Dn`). Record technical deviations as a new `Dn` before changing the plan. Constitution amendments use `/speckit-constitution` and require project-owner approval.
- Follow the installed command's skill and hooks. Use `.specify/workflows/pipeline/workflow.yml` (`specify workflow run pipeline`) or execute the full stage sequence directly; the stock `.specify/workflows/speckit/workflow.yml` omits clarify and analyze and does not satisfy this repository's required sequence alone.

| Stage | Required outcome before advancing |
| --- | --- |
| Specify / clarify | English spec transcribing all EARS statements, Gherkin scenarios, error states and exact numeric/unit limits (`200 MB = 200,000,000 bytes`, `500,000 words`, Unicode code points after outer trim) from the package's FR cards and `spec/requirements/README.md`, with SRS IDs on every requirement and all clarification markers resolved (`.specify/templates/overrides/spec-template.md`). |
| Plan | Constitution Check Gate Table (`CC-01`..`CC-08` in `.specify/memory/constitution.md` and `.specify/templates/overrides/plan-template.md`) passes before Phase 0 research and after Phase 1 design; within-release prerequisites, `C-01..C-03` contracts, agentic vs. deterministic boundaries and intended file boundaries are explicit. |
| Tasks | Spec-derived failing test tasks precede the implementation tasks they cover for every requirement, Gherkin scenario and boundary limit (`.specify/templates/overrides/tasks-template.md` and Principle II override the skill's "Tests are OPTIONAL" text). Record task dependencies and file paths; use `[P]` only for genuinely independent tasks. |
| Analyze | Review the current spec, plan and tasks together against `CC-01`..`CC-08` and `spec/requirements/README.md`. Resolve constitution violations and blocking coverage, dependency or contract conflicts before implementation. |
| Implement | Run the specified tests and observe requirement-related failures before implementing; then Green → Refactor. Never skip or weaken a spec-derived test without an SRS amendment. If a check/runner does not exist yet, report `UNAVAILABLE`. |

- Stages within one package remain ordered. Different packages may progress concurrently only when their within-release prerequisites (`spec/requirements/README.md`) and file ownership permit it.
- Specifying and planning later releases may run ahead. Implementation of v(k+1) waits for documented Gate v(k) success; worktree isolation does not waive release gates.
- If requirements, contracts or dependencies change, update the affected artifacts and rerun `/speckit-analyze` before continuing dependent implementation. Do not regenerate another session's active task list.

## Concurrent sessions: ownership and isolation

- Before writing, inspect `pwd`, `git status --short`, `git branch --show-current` and `git worktree list`. Read the constitution, `spec/requirements/README.md`, relevant FR cards, architecture decisions and existing feature artifacts. Preserve unrelated user or agent changes.
- **Worktree-based development is mandatory for every agent**: every agent MUST work in its own isolated Git worktree on a dedicated feature branch—never directly on `main` or in the primary repository checkout, even when only one agent is active. If started in the main checkout or on `main`, create an isolated worktree (`git worktree add -b <feature-branch> <worktree-path> main`) and run all commands from that worktree. A second terminal in the same checkout is not isolation; do not switch branches, stash, reset, clean or edit files in another session's checkout.
- **Task completion workflow (push & merge request to `main`)**: when finished with a task, run all required validation checks, commit the scoped changes on the worktree's feature branch, push the branch to `origin` (`git push -u origin HEAD`), and create a feature merge request (pull request) targeting `main` (`gh pr create --base main`). Never push or merge directly to `main`.
- Use an existing coordinating session or the user to assign work. Record each assignment in a shared issue/PR description or an explicit handoff visible to all participating sessions: owner, package/spec path, task IDs, allowed files, branch/worktree, base commit, dependencies and acceptance checks. A private chat or worktree-local note alone is not a shared reservation.
- Claim work before editing; one owner per task and per shared file at a time. If ownership overlaps or is unknown, resolve that overlap before touching those files and continue independent work where possible. Transfer ownership explicitly on handoff.
- Prefer parallel work on independent packages. Splitting one package across sessions requires an analyzed plan/task list, fixed interface contracts and disjoint file ownership. Assign task IDs explicitly; workers execute only their assigned slice of `/speckit-implement`, not the entire backlog.
- `[P]` is permission to parallelize only after prerequisites are satisfied, not permission to ignore shared files, contracts or test-first ordering. Pass the failing tests to the implementation owner before that implementation starts.
- The package owner integrates worker results and maintains the canonical `tasks.md`. Workers report completed task IDs, commit references and test evidence; the owner marks tasks complete only after integrating and verifying them. Keep task references qualified by spec path (`[001-workspace-foundation] T001`) because `T001` is not globally unique.
- Worktrees isolate files and indexes, but share Git refs and repository configuration. Do not force-checkout a branch already in use, rewrite another session's branch, alter shared Git configuration or remove its worktree. Clean up only worktrees you own after their work is preserved and no session is using them. See [Git worktree documentation](https://git-scm.com/docs/git-worktree).
- Give concurrent dev servers, test databases, output directories and cloud test resources distinct names/ports. Do not run competing migrations or Terraform operations against shared state. Relaxed-permission agents require isolated sandboxes without production credentials; a worktree alone is not a sandbox.

## Pin Spec Kit to the session's feature

The installed scripts resolve the feature directory from `SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`. They do **not** infer it from the Git branch; `SPECIFY_FEATURE` alone does not select the directory.

- Set `SPECIFY_INIT_DIR` to the assigned worktree root and `SPECIFY_FEATURE_DIRECTORY` to the assigned `specs/<feature-directory>` before each Spec Kit stage. Keep these variables session-local; repeat them on tool invocations if shell state does not persist.
- Verify the resolved paths before allowing a command to write. Run this from the assigned worktree, replacing the example directory with the agreed feature path:

```sh
SPECIFY_INIT_DIR="$PWD" \
SPECIFY_FEATURE_DIRECTORY="specs/001-workspace-foundation" \
SPECIFY_FEATURE_NO_PERSIST=1 \
bash .specify/scripts/bash/check-prerequisites.sh --json --paths-only
```

- Confirm `REPO_ROOT` and `FEATURE_DIR` point inside your worktree and to your assigned package. `--paths-only` checks resolution, not readiness; use the stage's normal prerequisite checks afterwards.
- `SPECIFY_FEATURE_NO_PERSIST=1` prevents the installed shell helpers from updating the local feature pointer. It does not isolate files or guarantee that a skill will not write the pointer directly. `.specify/feature.json` is ignored, per-worktree state; never force-add it or share it as coordination state.
- Feature numbering is sequential in `.specify/init-options.json`. Independent worktrees can select the same next number. Allocate feature directory names centrally before `/speckit-specify`, pass the agreed directory explicitly, and check existing specs and active assignments. Branch creation and feature-directory selection are separate operations; verify both.

| Release / Package | Epic Issue | Reserved Feature Directory (`SPECIFY_FEATURE_DIRECTORY`) | Branch Name | FR Card Input |
| --- | --- | --- | --- | --- |
| v1.0 / Package 1.1 | `#2` | `specs/001-workspace-foundation` | `001-workspace-foundation` | `spec/requirements/v1/package_1_1_workspace_foundation.md` |
| v1.0 / Package 1.2 | `#3` | `specs/002-text-pdf-ingestion-inspector` | `002-text-pdf-ingestion-inspector` | `spec/requirements/v1/package_1_2_text_pdf_ingestion_inspector.md` |
| v1.0 / Package 1.3 | `#4` | `specs/003-grounded-chat-citation-engine` | `003-grounded-chat-citation-engine` | `spec/requirements/v1/package_1_3_grounded_chat_citation_engine.md` |
| v1.0 / Package 1.4 | `#5` | `specs/004-ui-skeleton-quality-gates` | `004-ui-skeleton-quality-gates` | `spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md` |

## Shared changes, integration and handoff

- Serialize edits to the SRS, FR cards (`spec/requirements/`), constitution, architecture decisions, `AGENTS.md`, Spec Kit configuration/templates, shared contracts, root package manifests/lockfile, CI and shared infrastructure. Name an owner and integrate these prerequisites before dependent work; do not invent duplicate contracts to avoid coordination.
- Define `C-01`, `C-02` and `C-03` once in shared typed schemas (`packages/contracts`). Contract changes must update affected consumers/tests; breaking changes after the relevant release gate also require an SRS amendment, a `Dn` decision and a migration plan. Treat database migration ordering as a shared dependency.
- All changes merge to `main` via feature merge request (pull request) from an isolated worktree branch pushed to `origin`. Keep each PR scoped to its package or a clearly identified shared prerequisite, link dependencies, and integrate in dependency order. Do not fold unrelated session changes into a commit or PR.
- Before integration, review the actual diff against the intended base and recheck changed upstream requirements/contracts. Resolve conflicts semantically against the source-of-truth hierarchy; never blindly select one side of a conflict. Rerun affected checks on the combined result.
- Every PR must pass `node scripts/check-spec-integrity.mjs` and the constitution's lint, type-check, unit, contract and deterministic eval gates (`NFR-EVAL-02/04`). Retrieval, prompt or chat changes also require the LLM-judged suites (`NFR-EVAL-01/03`); those suites are required before every release gate as well. Use commands actually defined by the repository. While this repository is specs-only, report unavailable checks (`UNAVAILABLE`) explicitly rather than claiming they passed.
- Handoff with package/spec path, branch, `origin` push status and PR URL, commit, task IDs completed/remaining, changed files, validation commands/results, blockers and the next valid Spec Kit stage. Distinguish committed, uncommitted, integrated and verified work; do not mark blocked or untested tasks complete.

## Planned stack (not built yet)
pnpm TypeScript monorepo, Zod contracts in `packages/contracts`, ADK TS + `@google/genai`, Cloud Run (`europe-west4`), Cloud SQL Postgres + pgvector + FTS, Vitest eval suites, Terraform in `infra/`. A new framework, datastore or fixed-cost component needs a recorded decision first.

## Gotchas
- `{.agents,.github}/skills/speckit-*`, `.specify/scripts/` and `.specify/templates/*.md` are managed by Spec Kit (see `.specify/integrations/*.manifest.json`) and get overwritten on upgrade. Customise templates in `.specify/templates/overrides/<name>.md` (`spec-template.md`, `plan-template.md`, `tasks-template.md`).
- The managed `speckit-tasks` skill says "Tests are OPTIONAL" and stock `spec-template.md` uses generic `FR-001` IDs; `.specify/memory/constitution.md` (`CC-01`, `CC-02`) and `.specify/templates/overrides/{spec,plan,tasks}-template.md` override both.
- Active deferrals & scope shifts: Package 6.3 (`FR-INT-01`, `@Notebook`) and `Gate v6.0 #3` are deferred (`D5`/`DEV-03`); do not specify them. Google Slides export is deferred (`D8`/`DEV-02`: `.pptx` and `.pdf` only). Audio share-links in `FR-ST-04` ship in `v6.0` (`D10`), while player and export ship in `v5.0`.
- FR cards may be German or English; generated specs are English.
