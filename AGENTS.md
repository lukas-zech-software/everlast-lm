# Everlast LM

Re-implementation of Gemini Notebook / NotebookLM on Google Cloud. Greenfield: specs only, no application code yet.

## Source of truth (highest first)
1. `.specify/memory/constitution.md`: overrides everything.
2. `spec/System_Requirements_Specification_Gemeni_Notebook.md` (SRS): index of all IDs (`FR-*`, `NFR-*`, `C-01..C-03`, release gates). Keep the filename spelling; links depend on it.
3. `spec/requirements/v<N>/package_<N>_<M>_*.md`: FR cards, binding for the detail of their FR. Format: `spec/requirements/README.md`.
4. `docs/solution-architecture.md`: binding technical choices; decisions `D1..Dn` in its Decisions table.

Deviations from the original product: `DEV-xx` in SRS §5.5 plus a matching `Dn`. IDs are never renumbered.

## Workflow (Spec Kit only)

`/speckit-specify` → `/speckit-clarify` (if markers remain) → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`

- One package per spec, with one session responsible for its lifecycle. Example: `/speckit-specify spec/requirements/v1/package_1_1_workspace_foundation.md`. Resume existing artifacts instead of creating a competing spec for the same package.
- Every spec, plan, task and test cites an SRS ID. Untraceable behaviour is not built. Never create `docs/superpowers/`.
- Record scope changes before planning: additions as an SRS amendment, removals or deferrals as an architecture decision. Record technical deviations as a new `Dn` before changing the plan. Constitution amendments use `/speckit-constitution` and require project-owner approval.
- Follow the installed command's skill and hooks. The bundled `.specify/workflows/speckit/workflow.yml` omits clarify and analyze; running that workflow alone does not satisfy this repository's required sequence.

| Stage | Required outcome before advancing |
| --- | --- |
| Specify / clarify | English spec grounded in the package's FR cards, with SRS IDs and resolved clarification markers. |
| Plan | Constitution Check passes before research and after design; dependencies, shared contracts and intended file boundaries are explicit. |
| Tasks | Spec-derived test tasks precede the implementation tasks they cover. Record task dependencies and file paths; use `[P]` only for genuinely independent tasks. |
| Analyze | Review the current spec, plan and tasks together. Resolve constitution violations and blocking coverage, dependency or contract conflicts before implementation. |
| Implement | Run the specified tests and observe requirement-related failures before implementing; then Green → Refactor. Never skip or weaken a spec-derived test without an SRS amendment. |

- Stages within one package remain ordered. Different packages may progress concurrently only when their prerequisites and file ownership permit it.
- Specifying and planning later releases may run ahead. Implementation of v(k+1) waits for documented Gate v(k) success; worktree isolation does not waive release gates.
- If requirements, contracts or dependencies change, update the affected artifacts and rerun `/speckit-analyze` before continuing dependent implementation. Do not regenerate another session's active task list.

## Concurrent sessions: ownership and isolation

- Before writing, inspect `pwd`, `git status --short`, `git branch --show-current` and `git worktree list`. Read the constitution, relevant FR cards, architecture decisions and existing feature artifacts. Preserve unrelated user or agent changes.
- Each concurrent writing session uses its own Git worktree and branch. A second terminal in the same checkout is not isolation. Run commands from the assigned worktree; do not switch branches, stash, reset, clean or edit files in another session's checkout.
- Use an existing coordinating session or the user to assign work. Record each assignment in a shared issue/PR description or an explicit handoff visible to all participating sessions: owner, package/spec path, task IDs, allowed files, branch/worktree, base commit, dependencies and acceptance checks. A private chat or worktree-local note alone is not a shared reservation.
- Claim work before editing; one owner per task and per shared file at a time. If ownership overlaps or is unknown, resolve that overlap before touching those files and continue independent work where possible. Transfer ownership explicitly on handoff.
- Prefer parallel work on independent packages. Splitting one package across sessions requires an analyzed plan/task list, fixed interface contracts and disjoint file ownership. Assign task IDs explicitly; workers execute only their assigned slice of `/speckit-implement`, not the entire backlog.
- `[P]` is permission to parallelize only after prerequisites are satisfied, not permission to ignore shared files, contracts or test-first ordering. Pass the failing tests to the implementation owner before that implementation starts.
- The package owner integrates worker results and maintains the canonical `tasks.md`. Workers report completed task IDs, commit references and test evidence; the owner marks tasks complete only after integrating and verifying them. Keep task references qualified by spec path because `T001` is not globally unique.
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

## Shared changes, integration and handoff

- Serialize edits to the SRS, constitution, architecture decisions, `AGENTS.md`, Spec Kit configuration/templates, shared contracts, root package manifests/lockfile, CI and shared infrastructure. Name an owner and integrate these prerequisites before dependent work; do not invent duplicate contracts to avoid coordination.
- Define `C-01`, `C-02` and `C-03` once in shared typed schemas. Contract changes must update affected consumers/tests; breaking changes after the relevant release gate also require an SRS amendment and migration plan. Treat database migration ordering as a shared dependency.
- All changes merge via pull request. Keep each PR scoped to its package or a clearly identified shared prerequisite, link dependencies, and integrate in dependency order. Do not fold unrelated session changes into a commit or PR.
- Before integration, review the actual diff against the intended base and recheck changed upstream requirements/contracts. Resolve conflicts semantically against the source-of-truth hierarchy; never blindly select one side of a conflict. Rerun affected checks on the combined result.
- Every PR must pass the constitution's lint, type-check, unit, contract and deterministic eval gates (NFR-EVAL-02/04). Retrieval, prompt or chat changes also require the LLM-judged suites (NFR-EVAL-01/03); those suites are required before every release gate as well. Use commands actually defined by the repository. While this repository is specs-only, report unavailable checks explicitly rather than claiming they passed.
- Handoff with package/spec path, branch and commit, task IDs completed/remaining, changed files, validation commands/results, blockers and the next valid Spec Kit stage. Distinguish committed, uncommitted, integrated and verified work; do not mark blocked or untested tasks complete.

## Planned stack (not built yet)
pnpm TypeScript monorepo, Zod contracts in `packages/contracts`, ADK TS + `@google/genai`, Cloud Run (`europe-west4`), Cloud SQL Postgres + pgvector + FTS, Vitest eval suites, Terraform in `infra/`. A new framework, datastore or fixed-cost component needs a recorded decision first.

## Gotchas
- `{.claude,.agents,.github}/skills/speckit-*`, `.specify/scripts/` and `.specify/templates/*.md` are managed by Spec Kit (see `.specify/integrations/*.manifest.json`) and get overwritten on upgrade. Customise templates in `.specify/templates/overrides/<name>.md`.
- Package 6.3 (`FR-INT-01`, @Notebook) is deferred (D5). Do not specify it.
- FR cards may be German or English; generated specs are English.
