# Everlast LM

## Source of truth (highest first)
1. `.specify/memory/constitution.md` — supreme authority (Principles I–VI, gates `CC-01`..`CC-08`, stack).
2. `spec/System_Requirements_Specification_Gemeni_Notebook.md` — SRS (`FR-*`, `NFR-*`, `C-01..C-03`, release gates, `DEV-xx`).
3. `spec/requirements/v<N>/package_<N>_<M>_*.md` + `spec/requirements/README.md` — FR cards and cross-package rules/prerequisites.
4. `docs/solution-architecture.md` — binding architecture decisions (`D1..Dn`).

## Spec Kit workflow

`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` (or `specify workflow run pipeline`)

- **Package scope**: One FR package per `specs/<NNN>-<name>/` directory. Always load `spec/requirements/README.md` alongside the package's FR card; write generated specs in English.
- **Templates & gates**: Follow `.specify/memory/constitution.md` (`CC-01`..`CC-08`) and `.specify/templates/overrides/{spec,plan,tasks}-template.md` (do not edit managed `.specify/templates/*.md` or `{.agents,.github}/skills/speckit-*` directly).
- **Traceability & TDD**: Cite SRS IDs on every requirement, plan section, task, and test (`CC-01`). Spec-derived failing tests precede implementation (`CC-02`, Red → Green → Refactor); report non-existent runners as `UNAVAILABLE`.
- **Worktree & feature pinning**: Use one Git worktree/branch per concurrent session and pin the feature via `.specify/feature.json` or `SPECIFY_INIT_DIR="$PWD" SPECIFY_FEATURE_DIRECTORY="specs/<NNN>-<name>" SPECIFY_FEATURE_NO_PERSIST=1`. Qualify task references with `[<feature-slug>] T001`.
- **Verification**: Pass `node scripts/check-spec-integrity.mjs` and applicable test/eval gates (`NFR-EVAL-01..04`) before merging.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/004-ui-skeleton-quality-gates/plan.md
<!-- SPECKIT END -->
