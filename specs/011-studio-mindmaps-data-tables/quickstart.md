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

Before implementation, Gate v2.0 evidence and shared C-01/C-02/C-03/language contracts must exist. Prepare isolated EU enterprise test environment with keyless approved identities, existing Cloud SQL/Tasks/worker/API/web, migrated additive Studio variants and reviewed locked dependencies. No new API/service enablement is performed by this plan. Use synthetic schema-valid fixtures, never company content with developer keys.

Existing `pnpm dev` and `pnpm db:migrate` print harness-ready messages; they do not prove a running integrated deployment or apply real database migrations. A working launch/migration path and package suites must be supplied in implementation and recorded before runtime claims. New mindmap/table routes and tests are UNAVAILABLE now.

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

Do not call a green unrelated suite package acceptance. `eval:judged` may report UNAVAILABLE until its harness/environment is installed. Record exact revision, environment, versions, fixture IDs, commands and outputs. Specs-only plan does not run/deploy these feature scenarios.

## Scenarios and expected results (`FR-ST-08/09/18`)

1. Owner selects3 Ready synthetic source documents and generates map. Inspect Queued/Running/Completed, unique rooted acyclic hierarchy, cited labels/summaries, depth2–5,≤120 nodes and≤80-code-point labels; render depth2 initially. Inject cycles/orphans/duplicates/121nodes/81-code-point labels: Failed, no payload. Evidence-limited map explains fewer nodes; no supported facts refuses. Capture submission→Completed≤20s P95 on declared fixtures/environment, sample count and nearest-rank percentile; runtime result currently UNAVAILABLE.
2. Generate with≥50 sources and original chunk coverage manifest, including a fact only in a late original batch and absent from Source Guides. All batches processed, retained evidence retrievable, no summary substitution. Failed/missing batch cannot complete. Re-sync/delete/revoke during read and immediately before commit: fail without stale artifact. Mere checkbox changes do not alter in-flight snapshot.
3. Open120-node map, pan/zoom/fit and toggle chevrons; body click triggers chat rather than branch toggle. Record browser/hardware/frame timings for60fps/≤16ms criterion. With25visible nodes including offscreen branches, PNG is nonempty2× full bounds and SVG parses with all25labels; neither crops to viewport. Export rejects active SVG content and external resources. Browser screenshots/manual inspection validate labels/wrapping, not file parse alone.
4. Click eligible child under parent: ordinary grounded cited chat turn persists. Deselect required supporting source, clear selection, replace revision, submit forged label/node, or revoke permission: safe selection/unavailable response, zero node/parent text enters chat context and no automatic reselect. Existing active chat rejects another request and preserves draft.
5. Compare3vendor PDFs:3rows with Vendor/Price/Uptime SLA; absent value is exact N/A marker; contradictory prices remain one vendor row with all alternatives/citations and disagreement. Sort preserves associations. Boundaries0/2,000/2,001prompt code points,500/501rows and25/26cols behave exactly as spec;501/26attempt fails with narrowing request, zero published tables, not a truncated sample.
6. Export CSV and XLSX using contract [interfaces](contracts/interfaces.md) and [data model](data-model.md). Test comma/quote/CRLF/non-ASCII data, formula-risk=,+,-,@, leading spaces/tabs/control variants, headings and conflicting multiline values. Independently parse CSV after BOM, inspect OOXML for strings and absence of formulas/external links, open XLSX in Excel/LibreOffice or independent OOXML reader without errors. No formula executes. Count/values/conflicts/citations survive; no export silently drops rows.
7. Cross-notebook/unauthorized reads, drilldowns and exports reveal no content. Deletion/revocation invalidates loaded/cached/pending exports and stops application delivery. Merely deselected historical artifacts remain viewable/exportable, while new drilldown cannot reuse them. Cancel/retry/redelivery fences prevent double or stale publication. Existing report generation, viewing, lifecycle and conversion still pass regression suites.

## Evaluation and handoff (`NFR-EVAL-01..04`, `CC-01..CC-08`)

Require citation-ID precision1.0 and leakage0 deterministic suites on each PR; judged hallucination<5%, rejection≥99%, semantic support on prompt/chat changes and release. Use schema-valid multimodal locators and all supported content kinds, not only plain PDFs. Record refusal/no-publication errors as assertions, not ignored failed fixtures. Integrated Gate v3.0 additionally needs3.1/3.2/3.4 runtime evidence;3.2 R6 remains pending and this guide does not qualify it.

Next workflow is speckit-tasks, then speckit-analyze, then gated test-first implementation. No runtime gate is claimed by planning completion.
