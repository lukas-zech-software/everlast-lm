# Validation Guide: Package3.3

Scope:`FR-ST-08/09/18`,`C-01..C-03`,`NFR-EVAL-01..04`,`Gate v3.0 #3`. This guide describes verification; it contains no implementation or complete tests.

## Current planning checks (`CC-01/02`)

From the dedicated package worktree, use Node24 and run:

```sh
node scripts/check-spec-integrity.mjs
git diff --check
cat .specify/feature.json
```

Pin must be `specs/011-studio-mindmaps-data-tables`; no persistent SPECIFY_FEATURE_DIRECTORY. Inspect generated plan/research/data model/contracts. These checks establish document consistency only.

## Runtime prerequisites (`C-03`, `NFR-SEC-01/02`)

Gate v2.0 currently has owner-approved override per `docs/gate-v2-live-evaluation.md`, not a passing post-fix live rerun. Preserve known follow-ups and normal v3 gates. Shared C-01/C-02/C-03/language contracts exist and must remain compatible. Prepare isolated EU enterprise test environment with keyless approved identities, existing Cloud SQL/Tasks/worker/API/web, migrated additive Studio variants and reviewed locked dependencies. No new API/service enablement is performed by this plan. Use synthetic schema-valid fixtures, never company content with developer keys.

Existing `pnpm dev -- --offline` actually starts an isolated local PostgreSQL container, ensures its dev database, applies numbered migrations, builds the web app, then starts API/worker. Offline mode uses synthetic embeddings with no configured chat model; plain `pnpm dev` requires approved Vertex project/ADC and EU model configuration. `pnpm db:migrate` really applies pending top-level numbered SQL files using DATABASE_URL/PG variables and an advisory lock; applied0005–0008 include all v2 stores and the former draft directory is removed. Do not run it against an unverified target. Current reports already use PostgreSQL0008 with app-scoped pool binding; inline dispatch and the single API instance remain under D16. Preserve completed reports after restart and interrupted Queued/Running → Failed/GenerationError → explicit retry. New plugin outbox/lease/source publication fences remain planned; they are not supplied by the existing report restart sweep. New mindmap/table routes/tests/timing fixtures remain UNAVAILABLE now. No launch, database mutation or deployment is performed by this document refresh.

After those prerequisites and tests exist, existing repository runners are:

```sh
pnpm install --frozen-lockfile
pnpm test:contract
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm eval:deterministic
pnpm eval:judged
```

Do not call a green unrelated suite package acceptance. The judged harness exists and requires configured approved Vertex/ADC environment; it reports UNAVAILABLE without prerequisites. Its release mode selects the fixed stratified50-case sample; `--limit`/case subsets are diagnostic and cannot substitute gate evidence. Record exact revision, environment, versions, fixture IDs, commands and outputs. Specs-only plan does not run/deploy these feature scenarios.

## Scenarios and expected results (`FR-ST-08/09/18`)

1. Owner selects3 Ready synthetic source documents and generates map. Inspect Queued/Running/Completed, unique rooted acyclic hierarchy, cited labels/summaries, depth2–5,≤120 nodes and≤80-code-point labels; render depth2 initially. Inject cycles/orphans/duplicates/121nodes/81-code-point labels: Failed, no payload. Evidence-limited map explains fewer nodes; no supported facts refuses. Capture submission→Completed≤20s P95 on declared fixtures/environment, sample count and nearest-rank percentile; runtime result currently UNAVAILABLE.
2. Generate with≥50 sources and original chunk coverage manifest, including a fact only in a late original batch and absent from Source Guides. All batches processed, retained evidence retrievable, no summary substitution. Failed/missing batch cannot complete. Re-sync/delete/revoke during read and immediately before commit: fail without stale artifact. Mere checkbox changes do not alter in-flight snapshot.
3. Open120-node map, pan/zoom/fit and toggle chevrons; body click triggers chat rather than branch toggle. Record browser/hardware/frame timings for60fps/≤16ms criterion. With25visible nodes including offscreen branches, PNG is nonempty2× full bounds and SVG parses with all25labels; neither crops to viewport. Export rejects active SVG content and external resources. Browser screenshots/manual inspection validate labels/wrapping, not file parse alone.
4. Click eligible child under parent: ordinary grounded cited chat turn persists. Deselect required supporting source, clear selection, replace revision, submit forged label/node, or revoke permission: safe selection/unavailable response, zero node/parent text enters chat context and no automatic reselect. Existing active chat rejects another request and preserves draft.
5. Compare3vendor PDFs:3rows with Vendor/Price/Uptime SLA; absent value is exact N/A marker; contradictory prices remain one vendor row with all alternatives/citations and disagreement. Sort preserves associations. Boundaries0/2,000/2,001prompt code points,500/501rows and25/26cols behave exactly as spec;501/26attempt fails with narrowing request, zero published tables, not a truncated sample.
6. Export CSV and XLSX using contract [interfaces](contracts/interfaces.md) and [data model](data-model.md). Test comma/quote/CRLF/non-ASCII data, formula-risk=,+,-,@, leading spaces/tabs/control variants, headings and conflicting multiline values. Independently parse CSV after BOM, inspect OOXML for strings and absence of formulas/external links, open XLSX in Excel/LibreOffice or independent OOXML reader without errors. No formula executes. Count/values/conflicts/citations survive; no export silently drops rows.
7. Cross-notebook/unauthorized reads, drilldowns and exports reveal no content. Deletion/revocation invalidates loaded/cached/pending exports and stops application delivery. Merely deselected historical artifacts remain viewable/exportable, while new drilldown cannot reuse them. For new plugins, restart API/worker after admission and between outbox commit/notification; recover the same attempt, retain completed payloads and no duplicate publication. Competing workers, expired leases and cancellation/source mutation immediately before commit cannot publish stale output. Inject citation refusal then redeliver: no silent model rerun. Cancel/retry/redelivery fences prevent double or stale publication. Regress existing report generation/viewing/conversion and startup interrupted-to-Failed with explicit retry; legacy late completions stay rejected. New-kind leased jobs must be excluded from the report sweep. Preserve app-pool isolation for requests, timers and worker continuations and the one-API-instance deployment limit. Existing baseline suites are `apps/api/test/v2-restart.integration.test.ts` and `packages/db/test/studio-artifacts.pg.integration.test.ts`; no new execution result is claimed here.

## Evaluation and handoff (`NFR-EVAL-01..04`, `CC-01..CC-08`)

Require citation-ID precision1.0 and leakage0 deterministic suites on each PR; judged hallucination<5%, rejection≥99%, semantic support once per release candidate on the fixed stratified50-case sample, recording case IDs/category composition/dataset hash. No judged-per-PR obligation is introduced. Use schema-valid multimodal locators and all supported content kinds, not only plain PDFs. Record refusal/no-publication errors as assertions, not ignored failed fixtures. Integrated Gate v3.0 additionally needs3.1/3.2/3.4 runtime evidence;3.2 R6 remains pending and this guide does not qualify it.

Next workflow is speckit-tasks, then speckit-analyze, then gated test-first implementation. No runtime gate is claimed by planning completion.
