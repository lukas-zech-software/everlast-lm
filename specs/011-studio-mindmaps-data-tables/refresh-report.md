# Latest-main refresh: Package 3.3

Date: 2026-10-21. Scope: FR-ST-08/09/18; supporting FR-ST-10/11, FR-GC-01/02/06, C-01/C-02/C-03, NFR-SEC-01/02, NFR-EVAL-01..04.

## Provenance and workflow (CC-01/06)

- Previous cumulative plan: `e069add47b0df0040b413f90d11bb8d2c9f35059`; previous package plan: `36a744561ac669a770f78d56195b466eb5680880`; own checklist: `e2fa75c88fa88429f5eeb85ecafb1000af3abdad`.
- Latest fetched main: `0a94f3fca01395922fa788ea8cbb4286e8500f4a`, integrated at `6d3624a`; new package base is preceding completed package 3.2 `6d9bf89baf2e2fcf4fad02fe38733ed90e160f54`. Main is an ancestor of the refresh branch.
- First action created `/private/tmp/everlast-v3-refresh-3-3-20261021`, branch `codex/v3-refresh-3-3-20261021`. Second action exported the supplied `SPECIFY_FEATURE_DIRECTORY=specs/011-studio-mindmaps-data-tables`, wrote that exact feature_directory to `.specify/feature.json`, unset and asserted the environment variable absent. Setup scripts resolve the pin; their BRANCH field is the feature slug, while Git retains the actual branch above.
- Restored only own custom checklist from the parallel checklist commit, without restoring its pin. Preserved original 32 items byte-for-byte and appended four latest-main questions, all 36 unchecked. No reviewer evaluation claimed.
- Spec-first ambiguity/coverage review found no new critical product questions; accepted overflow failure/no partial table and individually cited conflicts in one item row remain unchanged. Domain, scope, lifecycle, interaction, security, terminology and completion coverage are clear; implementation choices were resolved in research. Re-executed plan setup and Phase 0/1 design. No tasks, analyze invocation (tasks absent), implementation, cloud activation, deployment or PR.

## Changed assumptions and upstream flow-back (C-02/C-03, FR-ST-08/09/18)

Main has real PostgreSQL ingestion, canonical source_pages (D15), hybrid retrieval and keyset all-original Studio reads. Reuse those C-02 reads with captured owner/revision scope; current keyset function collects an array, so bounded model/application processing and evidence coverage remain explicit design obligations, not a proven total-memory bound.

Current Studio is intentionally API-process memory under D16/DEV-04: `apps/api/src/v2/runtime.ts` instantiates InMemoryStudioArtifactRepository and InlineStudioDispatcher. The SQL under migrations/v3-draft is ignored design, not a production table. This package now explicitly owns the narrow Studio PostgreSQL migration behind existing repository ports, promoting an adapted draft into the next numbered migration and preserving existing reports. Applied 0004_note_sources remains untouched. Guide durability belongs to 3.1; unrelated v2 stores remain outside this package and are not declared migrated.

Durable admission plus outbox, attempt leases/version fences, worker restart recovery, cancellation and transactional source/attempt publication checks replace process-local authority. Existing jobs.ts only admits ingest/cleanup, so adding a Studio delivery kind and adapting worker composition are planned changes, not assumed capabilities. Generic runner dispatch must preserve report validation and select typed per-plugin validation; report Markdown cannot validate maps/tables. Transport redelivery never creates a user retry or silently reruns terminal citation failures. Cutover drains/fences API-local work and discloses the documented PoC reset rather than inventing a durable backfill.

List/get invalidation redacts source-derived metadata as well as payloads; new guarded export/drilldown paths use existing chat/authorization flows. Current report routes do not expose cancel: a new action for new plugins is distinguished from existing report behavior. Existing dev/migration commands really run infrastructure and apply numbered SQL; stale harness-only descriptions were removed.

Spec, plan, research, model, interfaces and quickstart updated together; own FR card and narrow Studio architecture paragraph carry upstream flow-back. D15 canonical text, D16/DEV-04 v2 PoC, D17/DEV-05 warm latency and D18 managed 2vCPU/1.5GB are preserved. R6 sandbox qualification remains pending and is not a new 3.3 dependency. Gate v2 owner override and absent post-fix rerun are accurately retained. Constitution 2.0 requires deterministic evals each PR and judged suites once per release candidate on fixed stratified 50-case sample with case IDs/category composition/hash; old per-prompt-PR judged cadence was removed.

## Review and validation (CC-01..08, NFR-EVAL-01..04)

- Pre/post-design CC-01..08: design PASS, with evidence in plan; no runtime pass inferred. Built-in requirements checklist re-evaluated 16/16→16/16; no marker changes, regressions or unchecked built-in items. Technical planning details were removed from spec refinement prose and retained in design artifacts so spec stays outcome-focused.
- Custom checklist original 32 questions preserved; CHK033–036 appended, all 36 unchecked and sequential. Correct feature pin, no tasks.md and expected package-only artifact scope verified.
- Clarification paths-only prerequisites, plan setup and checklist template/prerequisites resolution: PASS. Extensions YAML parsed with Ruby Psych; before/after clarify/plan/checklist hooks are optional Git commit hooks and were skipped. No mandatory hook omitted. Explicit reviewed commit follows validation.
- `node scripts/check-spec-integrity.mjs`: PASS (55 SRS IDs, 32 feature artifacts). `git diff --check`: PASS. Run once again after staging to include newly tracked report/checklist.
- `node scripts/lint.mjs`: document integrity stage PASS; TypeScript stage UNAVAILABLE in fresh worktree (`Cannot find module typescript/bin/tsc`). Shell runtime Node 26.3.0 differs from target Node 24; configure project runtime before implementation qualification. No source code changed, no dependency install or unrelated tests performed.
- New package contracts/plugins/routes, durable Studio migration/recovery, exports, timing/browser/eval and integrated Gate v3 runtime results: UNAVAILABLE until implemented and measured. Existing suites were not run as package acceptance; no live model/cloud operations occurred.

## Handoff (CC-06, C-03)

Package 3.4 must branch from this completed commit and pin its own feature. Next 3.3 lifecycle stage is speckit-tasks, then speckit-analyze and gated test-first implementation. Custom reviewer-owned checklist remains unchecked; planning completion is not approval of those quality criteria or runtime gates.

## Second latest-main refresh — 2026-10-21 (`C-03`, `FR-ST-08/09/18`)

This section supersedes the current-state statements above about process-memory Studio, unapplied drafts and initial persistence work; that earlier section remains as historical evidence of the first refresh.

- Main baseline: `dc25c46` (previous `0a94f3f`), inherited through completed package 3.2 commit `266236c5495de7b7ac4e21e02b9280bb1d3018a6`.
- Worktree: `/private/tmp/everlast-v3-refresh2-3-3-20261021`; branch `codex/v3-refresh2-3-3-20261021`. First action created it; second persisted parent-provided `SPECIFY_FEATURE_DIRECTORY=specs/011-studio-mindmaps-data-tables` into `.specify/feature.json`, then unset/asserted the environment variable absent.
- Evidence inspected: applied `0008_studio_artifacts.sql`, `PostgresStudioArtifactRepository`, `apps/api/src/v2/runtime.ts`, `runWithV2Persistence`, report persistence/restart integration tests, specs/013 and D16/DEV-04 closure. Report-only constraints, existing attempt/retry_of, row-locked terminal transitions, inline dispatch and startup interruption sweep are concrete baseline capabilities; new plugin schemas/outbox/leases/source-publication fences remain planned.
- Replanned Phase 0/1 incrementally: reuse existing table/repository through additive migration; preserve stored reports and their interrupted-to-Failed/explicit-retry semantics. Narrow the legacy sweep before admitting leased new-kind jobs, fence/drain old inline work during rollout, preserve app-scoped pool binding and single-API limit. Do not recreate removed drafts, reset rows or repeat initial v2 persistence work.
- Updated spec, plan, research, model, interfaces and quickstart plus own FR card and the narrow Studio architecture paragraph. Oversized comparisons still fail without a table; conflicting values retain individual citations. No provider/product decision was reopened.
- Built-in 16 spec-quality criteria revalidated; original 36 custom questions preserved verbatim and unchecked, with two distinct delta questions appended (38 unchecked total). Constitution CC-01–CC-08 remain design PASS; runtime acceptance is not implied.
- Parsed extension YAML before/after planning and checklist handling: only optional `speckit.git.commit` hooks apply. Skipped optional hooks in favor of the explicitly authorized final package commit; no mandatory hook was skipped. `setup-plan.sh --json` reused the pinned plan without replacing it.
- Verification: spec integrity and diff whitespace checks recorded below. Existing code tests were inspected as regression requirements, not rerun or reported as new passes. New-plugin runtime/export/timing/eval gates remain UNAVAILABLE until implementation. No tasks, analyze, implementation, database mutation or deployment performed.

- Final checks: PASS — integrity (179 Markdown files, 55 SRS IDs, 35 feature artifacts), `git diff --check`, exact feature pin, latest-main ancestry, and all 38 custom items unchecked with original 36 unchanged.

## Final baseline alignment — 2026-10-21 (`C-03`, `CC-08`)

Main `ce3626b` adds Node 26, API `MIGRATE_ON_START=true` and dev-project example updates after `dc25c46`. Updated current plan/quickstart to Node 26 and additive startup-migration compatibility/readiness ordering; startup migration locking does not implement worker leases or recovery. No package project ID is hardcoded. Accepted decisions and all 38 unchecked custom questions remain unchanged. Worktree `/private/tmp/everlast-v3-refresh-final-3-3-20261021`, branch `codex/v3-refresh-final-3-3-20261021`, parent `05329a684fd70a6b4dbe6c824a386c0e0007ed6f`; first created worktree, second persisted the provided feature variable as `specs/011-studio-mindmaps-data-tables` and unset it. Historical refresh sections are preserved. Integrity/diff checks pass; no runtime qualification or deployment was performed.
