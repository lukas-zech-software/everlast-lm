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
- One package per spec: `/speckit-specify spec/requirements/v1/package_1_1_workspace_foundation.md`
- Never create `docs/superpowers/`.
- Every spec, plan, task and test cites an SRS ID. Untraceable behaviour is not built.
- Spec-derived test tasks come before implementation tasks, regardless of the template.
- Never skip or weaken a spec-derived test without an SRS amendment.
- Scope or tech changes: record them first (SRS amendment or a new `Dn`), then plan.
- All changes merge via pull request.

## Planned stack (not built yet)
pnpm TypeScript monorepo, Zod contracts in `packages/contracts`, ADK TS + `@google/genai`, Cloud Run (`europe-west4`), Cloud SQL Postgres + pgvector + FTS, Vitest eval suites, Terraform in `infra/`. A new framework, datastore or fixed-cost component needs a recorded decision first.

## Gotchas
- `{.claude,.agents,.github}/skills/speckit-*`, `.specify/scripts/` and `.specify/templates/*.md` are managed by Spec Kit (see `.specify/integrations/*.manifest.json`) and get overwritten on upgrade. Customise templates in `.specify/templates/overrides/<name>.md`.
- Package 6.3 (`FR-INT-01`, @Notebook) is deferred (D5). Do not specify it.
- FR cards may be German or English; generated specs are English.
