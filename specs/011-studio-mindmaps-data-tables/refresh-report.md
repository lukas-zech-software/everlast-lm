# Latest-main refresh: Package 3.3

Date: 2026-10-21. Scope: FR-ST-08/09/18; supporting FR-ST-10/11, FR-GC-01/02/06, C-01/C-02/C-03, NFR-SEC-01/02, NFR-EVAL-01..04.

## Provenance and workflow (CC-01/06)

- Previous cumulative plan: `e069add47b0df0040b413f90d11bb8d2c9f35059`; previous package plan: `36a744561ac669a770f78d56195b466eb5680880`; own checklist: `e2fa75c88fa88429f5eeb85ecafb1000af3abdad`.
- Latest fetched main: `0a94f3fca01395922fa788ea8cbb4286e8500f4a`, integrated at `6d3624a`; new package base is preceding completed package3.2 `6d9bf89baf2e2fcf4fad02fe38733ed90e160f54`. Main is an ancestor of the refresh branch.
- First action created `/private/tmp/everlast-v3-refresh-3-3-20261021`, branch `codex/v3-refresh-3-3-20261021`. Second action exported the supplied `SPECIFY_FEATURE_DIRECTORY=specs/011-studio-mindmaps-data-tables`, wrote that exact feature_directory to `.specify/feature.json`, unset and asserted the environment variable absent. Setup scripts resolve the pin; their BRANCH field is the feature slug, while Git retains the actual branch above.
- Restored only own custom checklist from the parallel checklist commit, without restoring its pin. Preserved original32 items byte-for-byte and appended four latest-main questions, all36 unchecked. No reviewer evaluation claimed.
- Spec-first ambiguity/coverage review found no new critical product questions; accepted overflow failure/no partial table and individually cited conflicts in one item row remain unchanged. Domain, scope, lifecycle, interaction, security, terminology and completion coverage are clear; implementation choices were resolved in research. Re-executed plan setup and Phase0/1 design. No tasks, analyze invocation (tasks absent), implementation, cloud activation, deployment or PR.

## Changed assumptions and upstream flow-back (C-02/C-03, FR-ST-08/09/18)

Main has real PostgreSQL ingestion, canonical source_pages (D15), hybrid retrieval and keyset all-original Studio reads. Reuse those C-02 reads with captured owner/revision scope; current keyset function collects an array, so bounded model/application processing and evidence coverage remain explicit design obligations, not a proven total-memory bound.

Current Studio is intentionally API-process memory under D16/DEV-04: `apps/api/src/v2/runtime.ts` instantiates InMemoryStudioArtifactRepository and InlineStudioDispatcher. The SQL under migrations/v3-draft is ignored design, not a production table. This package now explicitly owns the narrow Studio PostgreSQL migration behind existing repository ports, promoting an adapted draft into the next numbered migration and preserving existing reports. Applied0004_note_sources remains untouched. Guide durability belongs to3.1; unrelated v2 stores remain outside this package and are not declared migrated.

Durable admission plus outbox, attempt leases/version fences, worker restart recovery, cancellation and transactional source/attempt publication checks replace process-local authority. Existing jobs.ts only admits ingest/cleanup, so adding a Studio delivery kind and adapting worker composition are planned changes, not assumed capabilities. Generic runner dispatch must preserve report validation and select typed per-plugin validation; report Markdown cannot validate maps/tables. Transport redelivery never creates a user retry or silently reruns terminal citation failures. Cutover drains/fences API-local work and discloses the documented PoC reset rather than inventing a durable backfill.

List/get invalidation redacts source-derived metadata as well as payloads; new guarded export/drilldown paths use existing chat/authorization flows. Current report routes do not expose cancel: a new action for new plugins is distinguished from existing report behavior. Existing dev/migration commands really run infrastructure and apply numbered SQL; stale harness-only descriptions were removed.

Spec, plan, research, model, interfaces and quickstart updated together; own FR card and narrow Studio architecture paragraph carry upstream flow-back. D15 canonical text, D16/DEV-04 v2 PoC, D17/DEV-05 warm latency and D18 managed2vCPU/1.5GB are preserved. R6 sandbox qualification remains pending and is not a new3.3 dependency. Gate v2 owner override and absent post-fix rerun are accurately retained. Constitution2.0 requires deterministic evals each PR and judged suites once per release candidate on fixed stratified50-case sample with case IDs/category composition/hash; old per-prompt-PR judged cadence was removed.

## Review and validation (CC-01..08, NFR-EVAL-01..04)

- Pre/post-design CC-01..08: design PASS, with evidence in plan; no runtime pass inferred. Built-in requirements checklist re-evaluated16/16→16/16; no marker changes, regressions or unchecked built-in items. Technical planning details were removed from spec refinement prose and retained in design artifacts so spec stays outcome-focused.
- Custom checklist original32 questions preserved; CHK033–036 appended, all36 unchecked and sequential. Correct feature pin, no tasks.md and expected package-only artifact scope verified.
- Clarification paths-only prerequisites, plan setup and checklist template/prerequisites resolution: PASS. Extensions YAML parsed with Ruby Psych; before/after clarify/plan/checklist hooks are optional Git commit hooks and were skipped. No mandatory hook omitted. Explicit reviewed commit follows validation.
- `node scripts/check-spec-integrity.mjs`: PASS (55 SRS IDs,32 feature artifacts). `git diff --check`: PASS. Run once again after staging to include newly tracked report/checklist.
- `node scripts/lint.mjs`: document integrity stage PASS; TypeScript stage UNAVAILABLE in fresh worktree (`Cannot find module typescript/bin/tsc`). Shell runtime Node26.3.0 differs from target Node24; configure project runtime before implementation qualification. No source code changed, no dependency install or unrelated tests performed.
- New package contracts/plugins/routes, durable Studio migration/recovery, exports, timing/browser/eval and integrated Gate v3 runtime results: UNAVAILABLE until implemented and measured. Existing suites were not run as package acceptance; no live model/cloud operations occurred.

## Handoff (CC-06, C-03)

Package3.4 must branch from this completed commit and pin its own feature. Next3.3 lifecycle stage is speckit-tasks, then speckit-analyze and gated test-first implementation. Custom reviewer-owned checklist remains unchecked; planning completion is not approval of those quality criteria or runtime gates.
